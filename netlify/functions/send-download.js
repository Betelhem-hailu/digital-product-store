import crypto from "crypto";
import { getStore } from "@netlify/blobs";

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;
const SITE_ID_ACCESS = process.env.SITE_ID_ACCESS;
const TOKEN_ACCESS = process.env.TOKEN_ACCESS;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    console.log("Decoded token:", decoded);

    const parts = decoded.split(":");
    if (parts.length !== 4) {
      return { valid: false, reason: "malformed token (wrong parts)" };
    }

    const [orderId, email, expires, signature] = parts;

    if (Date.now() > Number(expires)) {
      return { valid: false, reason: "link expired" };
    }

    const payload = `${orderId}:${email}:${expires}`;
    const expected = crypto
      .createHmac("sha256", DOWNLOAD_SECRET)
      .update(payload)
      .digest("hex");

    if (signature !== expected) {
      return { valid: false, reason: "invalid signature" };
    }

    return { valid: true, orderId, email };
  } catch (err) {
    console.error("Token verification error:", err);
    return { valid: false, reason: "token decode failed" };
  }
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    console.log("Download request received");
    console.log("Token:" , token ? "present" : "missing");

    if (!token) {
      return new Response("Missing download token", { status: 400 });
    }

    if (!DOWNLOAD_SECRET) {
      console.error("DOWNLOAD_SECRET is not set");
      return new Response("Server configuration error", { status: 500 });
    }

    const check = verifyToken(token);
    console.log("Token check result:", check);

    if (!check.valid) {
      return new Response(`Invalid or expired link (${check.reason})`, {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ===== Get the file from Netlify Blobs =====
    const store = getStore({
    name: "digital-products",
    siteID: SITE_ID_ACCESS,
    token: TOKEN_ACCESS,
  });

    // Try to get the file
    const file = await store.get("Product_01.pdf", {
      type: "arrayBuffer", // more reliable than stream for many cases
    });
    console.log("File retrieved from Blobs store:", file);
    if (!file) {
      console.error("File not found in Blobs store");
      return new Response("File not found. Please contact support.", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.log("File found, size:", file.byteLength);

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Product_01.pdf"',
        "Cache-Control": "no-store",
        "Content-Length": file.byteLength.toString(),
      },
    });
  } catch (err) {
    console.error("Download function error:", err);
    return new Response(`Server error: ${err.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
};