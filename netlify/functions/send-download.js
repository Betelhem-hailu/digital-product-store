import crypto from "crypto";
import { getStore } from "@netlify/blobs";

const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET;

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const [orderId, email, expires, signature] = decoded.split(":");

    if (Date.now() > Number(expires)) {
      return { valid: false, reason: "expired" };
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
  } catch {
    return { valid: false, reason: "malformed token" };
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const check = verifyToken(token);
  if (!check.valid) {
    return new Response(`Invalid or expired link (${check.reason})`, {
      status: 403,
    });
  }

  // Option A: Serve from Netlify Blobs
  try {
    const store = getStore("digital-products");
    const file = await store.get("discipline-system.pdf", {
      type: "stream",
    });

    if (!file) {
      return new Response("File not found", { status: 404 });
    }

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Complete-Discipline-System.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Download error:", err);
    return new Response("Error serving file", { status: 500 });
  }
};