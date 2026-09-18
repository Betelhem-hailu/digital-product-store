import crypto from "crypto";
import { getStore } from "@netlify/blobs";

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;
const SITE_ID_ACCESS = process.env.SITE_ID_ACCESS;
const TOKEN_ACCESS = process.env.TOKEN_ACCESS;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    console.log("Decoded token string:", decoded);

    const parts = decoded.split(":");
    if (parts.length !== 4) {
      return { valid: false, reason: `malformed token (got ${parts.length} parts)` };
    }

    const [orderId, email, expires, signature] = parts;

    if (Date.now() > Number(expires)) {
      return { valid: false, reason: "link expired" };
    }

    const payload = `${orderId}:${email}:${expires}`;
    const expectedSignature = crypto
      .createHmac("sha256", DOWNLOAD_SECRET)
      .update(payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      return { valid: false, reason: "invalid signature" };
    }

    return { valid: true, orderId, email };
  } catch (err) {
    console.error("Token error:", err);
    return { valid: false, reason: "token decode failed" };
  }
}

export default async (req) => {
  console.log("=== DOWNLOAD FUNCTION STARTED ===");

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    console.log("Token present:", !!token);

    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    if (!DOWNLOAD_SECRET) {
      console.error("DOWNLOAD_SECRET is missing!");
      return new Response("Server misconfiguration: DOWNLOAD_SECRET missing", { status: 500 });
    }

    // 1. Verify the token
    const check = verifyToken(token);
    console.log("Token verification result:", check);

    if (!check.valid) {
      return new Response(`Invalid or expired link: ${check.reason}`, {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2. Get the store
    const store = getStore({
        name: "digital-products",
        siteID: SITE_ID_ACCESS,
        token: TOKEN_ACCESS,
      });
    console.log("Store created: digital-products");

    // 3. List files first (for debugging)
    const listed = await store.list();
    console.log("Files in store:", listed.blobs.map(b => b.key));

    // 4. Try to get the file
    const key = "Product_01.pdf";
    console.log("Trying to get key:", key);

    const fileData = await store.get(key, { type: "arrayBuffer" });

    if (!fileData) {
      console.error("store.get returned null/undefined");
      return new Response(
        `File not found in Blobs.\n\nAvailable files: ${listed.blobs.map(b => b.key).join(", ") || "none"}`,
        { status: 404, headers: { "Content-Type": "text/plain" } }
      );
    }

    console.log("File successfully retrieved. Size:", fileData.byteLength, "bytes");

    // 5. Return the file
    return new Response(fileData, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Complete-Discipline-System.pdf"',
        "Cache-Control": "no-store",
        "Content-Length": String(fileData.byteLength),
      },
    });
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    return new Response(`Server error: ${err.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
};