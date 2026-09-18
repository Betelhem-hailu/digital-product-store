import { getStore } from "@netlify/blobs";
import fs from "fs";
import path from "path";

const PRODUCT_NAME = process.env.PRODUCT_NAME;
const SITE_ID = "";      
const TOKEN = "";    
async function upload() {
  // 1. Read your local PDF file
  const filePath = path.resolve(`./${PRODUCT_NAME}.pdf`); // change to your actual filename
  const fileBuffer = fs.readFileSync(filePath);

  // 2. Connect to the Blobs store
  // The store name must match what you used in download.js ("digital-products")
const store = getStore({
    name: "digital-products",
    siteID: SITE_ID,
    token: TOKEN,
  });

  // 3. Upload the file
  await store.set(`${PRODUCT_NAME}.pdf`, fileBuffer, {
    metadata: {
      contentType: "application/pdf",
      uploadedAt: new Date().toISOString(),
      product: PRODUCT_NAME
    }
  });

  console.log("✅ File uploaded successfully to Netlify Blobs!");
  console.log(`✅ File: ${PRODUCT_NAME}.pdf`);
}

upload().catch((err) => {
  console.error("Upload failed:", err);
});