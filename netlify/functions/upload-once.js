import { getStore } from "@netlify/blobs";
import fs from "fs";

export default async () => {
  // Only allow this in development or with a secret
  const store = getStore("digital-products");

  // For real use you would receive the file via form-data.
  // For now we assume the file is already in the function bundle (not ideal for large files).

  return new Response("Use the CLI method for large PDFs", { status: 200 });
};