// Vercel function: GET /dashboard.png?key=... returns the Kindle image.
// All settings are Vercel environment variables (see kindle/README.md).
import { handle } from "../src/dashboard.js";
import { loadAssets } from "../src/assets.js";

export async function GET(request) {
  try {
    return await handle(request, process.env, await loadAssets());
  } catch (e) {
    console.error(e);
    // A non-200 reply makes the Kindle keep its last good picture.
    return new Response(`Dashboard failed: ${e.message}`, { status: 500 });
  }
}
