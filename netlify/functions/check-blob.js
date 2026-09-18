import { getStore } from "@netlify/blobs";
const SITE_ID_ACCESS = process.env.SITE_ID_ACCESS;
const TOKEN_ACCESS = process.env.TOKEN_ACCESS;

export default async () => {
  try {
    const store = getStore({
        name: "digital-products",
        siteID: SITE_ID_ACCESS,
        token: TOKEN_ACCESS,
      });
    const { blobs } = await store.list();

    return new Response(JSON.stringify({
      message: "Files currently in the store",
      files: blobs.map(b => b.key)
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message
    }), { status: 500 });
  }
};