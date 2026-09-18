import crypto from "crypto";

// Do NOT create Resend here at the top level

const EXPECTED_PRICE = Number(process.env.PRODUCT_PRICE || 22);
const SETTLEMENT_ACCOUNT = process.env.SETTLEMENT_ACCOUNT;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Complete-Discipline-System";

function createDownloadToken(orderId, email) {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 3; // 3 days
  const payload = `${orderId}:${email}:${expires}`;
  const signature = crypto
    .createHmac("sha256", DOWNLOAD_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

async function verifyWithVerifyEt({ bank, reference, accountSuffix, phone }) {
  const body = { bank: bank.toLowerCase() };

  if (bank === "cbe") {
    body.referenceNumber = reference;
    body.accountSuffix = accountSuffix;
  } else if (bank === "boa") {
    body.referenceNumber = reference;
    body.accountSuffix = accountSuffix;
  } else if (bank === "telebirr" || bank === "mpesa") {
    body.transactionNumber = reference;
  } else if (bank === "cbebirr") {
    body.receiptNumber = reference;
    body.phone = phone;
  } else {
    body.referenceNumber = reference;
  }

  if (SETTLEMENT_ACCOUNT) {
    body.settlementAccount = SETTLEMENT_ACCOUNT;
  }

  const response = await fetch("https://verify.et/api/verify?waitMs=8000", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.VERIFY_ET_API_KEY,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { status: response.status, data };
}

export default async (req) => {
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
      bank,
      reference,
      accountSuffix,
      phone,
      email,
      fullName = "",
      orderId = crypto.randomUUID(),
    } = body;

    if (!bank || !reference || !email) {
      return new Response(
        JSON.stringify({ success: false, message: "bank, reference and email are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ===== Call verify.et =====
    const { status, data } = await verifyWithVerifyEt({
      bank,
      reference,
      accountSuffix,
      phone,
    });

    console.log("verify.et status:", status);
    console.log("verify.et data:", JSON.stringify(data, null, 2));

    if (status === 202 || data?.verification?.processingStatus === "queued") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Verification is still processing. Please try again in a few seconds.",
          requestId: data.requestId,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    }

    const verification = data?.data?.[0] || data?.verification || data?.data;

    if (!verification || verification.verified !== true) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment could not be verified. Please check the reference number.",
          details: verification || data,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const paidAmount = Number(verification.amount || 0);
    if (paidAmount < EXPECTED_PRICE) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Amount too low. Expected at least ${EXPECTED_PRICE} ETB, got ${paidAmount} ETB.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ===== Success - create download token =====
    const downloadToken = createDownloadToken(orderId, email);
    const downloadUrl = `${new URL(req.url).origin}/.netlify/functions/download?token=${downloadToken}`;

    // ===== Send email (only if Resend key exists) =====
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
          from: process.env.FROM_EMAIL || "onboarding@resend.dev",
          to: email,
          subject: `Your download is ready – ${PRODUCT_NAME}`,
          html: `
            <h2>Thank you for your purchase!</h2>
            <p>Hi ${fullName || "there"},</p>
            <p>Your payment of <strong>${paidAmount} ETB</strong> has been verified.</p>
            <p><a href="${downloadUrl}">Click here to download</a></p>
            <p>This link is valid for 3 days.</p>
          `,
        });
      } catch (emailErr) {
        console.error("Email sending failed:", emailErr);
        // We still return success even if email fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment verified successfully! Check your email for the download link.",
        orderId,
        amount: paidAmount,
        downloadUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        message: err.message || "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};