// Vercel function: GET /dashboard.png?key=... returns the Kindle image.
// All settings are Vercel environment variables (see kindle/README.md).
import { handle } from "../src/dashboard.js";
import { loadAssets } from "../src/assets.js";

// POST is for the notice board (/notes): adding and removing notes, and email.
export const POST = request => GET(request);

export async function GET(request) {
  try {
    // The notice board doesn't draw anything, so it doesn't need the fonts.
    const assets = new URL(request.url).searchParams.get("format") === "notes" || request.method === "POST"
      ? {} : await loadAssets();
    return await handle(request, process.env, assets);
  } catch (e) {
    console.error(e);
    // A non-200 reply makes the Kindle keep its last good picture.
    return new Response(`Dashboard failed: ${e.message}`, { status: 500 });
  }
}
