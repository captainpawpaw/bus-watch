// Gathers everything and draws it. Platform-neutral: the caller supplies resvg
// (the SVG -> pixels renderer) and the font files.
import { getWeather } from "./weather.js";
import { getBuses } from "./buses.js";
import { getDrive } from "./driving.js";
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
    settle(!!(env.TOMTOM_KEY && env.DRIVE_FROM && env.DRIVE_TO), () => getDrive(env)),
    settle(!!(env.GLOW_USERNAME && env.GLOW_PASSWORD), () => getEnergy(env, now)),
  ]);
  return renderSvg({ now, zone: tz(env), weather, bus, car, power });
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
  const svg = await buildSvg(env);
  if (url.pathname.endsWith(".svg") || url.searchParams.get("format") === "svg") {
    return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
  }
  const png = await svgToPng(svg, Resvg, fonts);
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}

export { WIDTH, HEIGHT };
