import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

const EXPECTED_PRICE = Number(process.env.PRODUCT_PRICE || 22);
const SETTLEMENT_ACCOUNT = process.env.SETTLEMENT_ACCOUNT; // your receiving number/account
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;
const PRODUCT_NAME = "The Complete Discipline System";

// ========== Helper: Create signed download token ==========
function createDownloadToken(orderId, email) {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 3; // 3 days
  const payload = `${orderId}:${email}:${expires}`;
  const signature = crypto
    .createHmac("sha256", DOWNLOAD_SECRET)
    .update(payload)
    .digest("hex");

  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

// ========== Helper: Call verify.et ==========
async function verifyWithVerifyEt({ bank, reference, accountSuffix, phone }) {
  const body = {
    bank: bank.toLowerCase(),
  };

  // Map fields correctly per bank
  if (bank === "cbe") {
    body.referenceNumber = reference;
    body.accountSuffix = accountSuffix; // must be exactly 8 digits
  } else if (bank === "boa") {
    body.referenceNumber = reference;
    body.accountSuffix = accountSuffix; // 5 digits
  } else if (bank === "telebirr" || bank === "mpesa") {
    body.transactionNumber = reference;
  } else if (bank === "cbebirr") {
    body.receiptNumber = reference;
    body.phone = phone;
  } else {
    body.referenceNumber = reference;
  }

  // Very important: check the money actually came to YOUR account
  if (SETTLEMENT_ACCOUNT) {
    body.settlementAccount = SETTLEMENT_ACCOUNT;
  }

  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(
    "https://verify.et/api/verify?waitMs=8000",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.VERIFY_ET_API_KEY,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  return { status: response.status, data };
}

// ========== Main Handler ==========
export default async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    const {
      bank,           // "telebirr" | "cbe" | "boa" | "cbebirr" ...
      reference,      // transaction reference
      accountSuffix,  // required for CBE (8 digits) and BOA (5 digits)
      phone,          // required for CBE Birr
      email,
      fullName = "",
      orderId = crypto.randomUUID(),
    } = body;

    // ---------- Basic validation ----------
    if (!bank || !reference || !email) {
      return new Response(
        JSON.stringify({ success: false, message: "bank, reference and email are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (bank === "cbe" && (!accountSuffix || accountSuffix.length !== 8)) {
      return new Response(
        JSON.stringify({ success: false, message: "CBE requires exactly 8-digit accountSuffix" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ---------- Call verify.et ----------
    const { status, data } = await verifyWithVerifyEt({
      bank,
      reference,
      accountSuffix,
      phone,
    });

    // Handle queued response (202)
    if (status === 202 || data?.verification?.processingStatus === "queued") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Verification is still processing. Please wait a few seconds and try again.",
          requestId: data.requestId,
          statusUrl: data.statusUrl || data.links?.statusUrl,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    }

    // ---------- Check result ----------
    const verification = data?.data?.[0] || data?.verification || data?.data;

    if (!verification || verification.verified !== true || verification.status !== "success") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment could not be verified. Please check the reference number and try again.",
          details: verification || data,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ---------- Amount check ----------
    const paidAmount = Number(verification.amount);
    if (paidAmount < EXPECTED_PRICE) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Amount mismatch. Expected at least ${EXPECTED_PRICE} ETB, received ${paidAmount} ETB.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ---------- Settlement account check (extra safety) ----------
    if (verification.settlementAccountMatch && verification.settlementAccountMatch.matched === false) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment was verified but it was not sent to the correct account.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ---------- SUCCESS → Create download token + send email ----------
    const downloadToken = createDownloadToken(orderId, email);
    const downloadUrl = `${new URL(req.url).origin}/.netlify/functions/download?token=${downloadToken}`;

    // Send email to customer
    await resend.emails.send({
      from: process.env.FROM_EMAIL || "orders@yourdomain.com",
      to: email,
      subject: `Your download is ready – ${PRODUCT_NAME}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Thank you for your purchase!</h2>
          <p>Hi ${fullName || "there"},</p>
          <p>Your payment of <strong>${paidAmount} ETB</strong> has been verified.</p>
          <p>
            <a href="${downloadUrl}" 
               style="background:#111;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">
              Download ${PRODUCT_NAME}
            </a>
          </p>
          <p style="color:#666;font-size:14px;">
            This link is valid for 3 days and can be used a limited number of times.
          </p>
          <hr>
          <p style="font-size:12px;color:#999;">Order ID: ${orderId}</p>
        </div>
      `,
    });

    // Optional: notify you
    if (process.env.ADMIN_EMAIL) {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || "orders@yourdomain.com",
        to: process.env.ADMIN_EMAIL,
        subject: `New sale – ${paidAmount} ETB`,
        text: `New order!\n\nEmail: ${email}\nAmount: ${paidAmount}\nBank: ${bank}\nReference: ${reference}\nOrder ID: ${orderId}`,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment verified successfully. Check your email for the download link.",
        orderId,
        amount: paidAmount,
        downloadUrl, // you can also hide this and only send via email
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("verify-payment error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Server error. Please try again or contact support.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};