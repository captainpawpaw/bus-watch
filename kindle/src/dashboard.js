// Gathers everything and draws it. Platform-neutral: the caller supplies resvg
// (the SVG -> pixels renderer) and the font files.
import { getWeather } from "./weather.js";
import { getBuses } from "./buses.js";
import { getDrive, hasDrives } from "./driving.js";
import { getEnergy } from "./energy.js";
import { renderSvg, WIDTH, HEIGHT } from "./render.js";
import { greyPng } from "./png.js";
import { tz } from "./util.js";

const settle = (configured, fn) => configured
  ? fn().then(value => ({ ok: true, value }), error => ({ ok: false, error }))
  : Promise.resolve({ ok: false, missing: true, error: new Error("not set up") });

export async function buildSvg(env, now = new Date()) {
  const [weather, bus, car, power] = await Promise.all([
    settle(true, () => getWeather(env)),
    settle(true, () => getBuses(env, now)),
    settle(hasDrives(env), () => getDrive(env, now)),
    settle(!!(env.GLOW_USERNAME && env.GLOW_PASSWORD), () => getEnergy(env, now)),
  ]);
  // A drive outside its days and hours is left out, like one that isn't set up.
  const drive = car.ok && car.value === null ? { ok: false, missing: true } : car;
  return renderSvg({ now, zone: tz(env), weather, bus, car: drive, power });
}

export async function svgToPng(svg, Resvg, fonts) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Inter" },
  });
  const img = resvg.render();
  const png = await greyPng(img.pixels, img.width, img.height);
  img.free?.();
  resvg.free?.();
  return png;
}

// Handles one web request: /dashboard.png for the Kindle, /dashboard.svg to look at in a browser.
export async function handle(request, env, { Resvg, fonts }) {
  const url = new URL(request.url);
  if (!env.DASH_TOKEN) {
    return new Response("Set DASH_TOKEN first, so your dashboard isn't public.", { status: 500 });
  }
  if (url.searchParams.get("key") !== env.DASH_TOKEN) {
    return new Response("Add ?key=<your DASH_TOKEN> to the address.", { status: 401 });
  }
  if (url.pathname.endsWith("/view") || url.searchParams.get("format") === "html") {
    return new Response(viewerPage(url.searchParams.get("key")), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const svg = await buildSvg(env);
  if (url.pathname.endsWith(".svg") || url.searchParams.get("format") === "svg") {
    return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
  }
  const png = await svgToPng(svg, Resvg, fonts);
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}

// A page for phones and computers that shows the dashboard and refreshes it
// just after each minute, swapping the picture only once the new one has loaded.
function viewerPage(key) {
  // The PNG, not the SVG: it has the dashboard's font built in, so it looks
  // exactly like the Kindle (browsers don't have Inter and fall back to Times).
  const src = `/dashboard.png?key=${encodeURIComponent(key)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard</title>
<noscript><meta http-equiv="refresh" content="60"></noscript>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100vw; max-height: 100vh; background: #fff; image-rendering: auto; }
</style>
</head><body>
<img id="dash" src="${src}&t=${Date.now()}" alt="Dashboard">
<script>
  const img = document.getElementById("dash");
  function refresh() {
    const next = new Image();
    next.onload = () => { img.src = next.src; };
    next.src = ${JSON.stringify(src)} + "&t=" + Date.now();
    // Next update 2 seconds after the next minute starts, so the clock stays right.
    setTimeout(refresh, 62000 - (Date.now() % 60000));
  }
  setTimeout(refresh, 62000 - (Date.now() % 60000));
</script>
</body></html>`;
}

export { WIDTH, HEIGHT };
