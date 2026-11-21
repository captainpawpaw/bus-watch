// Gathers everything and draws it. Platform-neutral: the caller supplies resvg
// (the SVG -> pixels renderer) and the font files.
import { getWeather } from "./weather.js";
import { getBuses, parseStops, stopShown } from "./buses.js";
import { getDrive, hasDrives, inDriveWindow, inWindow, activeJourney } from "./driving.js";
import { getEnergy } from "./energy.js";
import { getNotes, hasNotes, handleNotes } from "./notes.js";
import { hasNight, nightInfo, pieceSvg, backgroundSvg } from "./night.js";
import { renderSvg, WIDTH, HEIGHT } from "./render.js";
import { greyPng, rotate } from "./png.js";
import { tz, localParts } from "./util.js";

// Each section has 22 seconds at most: the Kindle gives up on the whole picture
// after 30, so a slow service just shows as unavailable instead.
const LIMIT_MS = 22000;
const settle = (configured, fn) => {
  if (!configured) return Promise.resolve({ ok: false, missing: true, error: new Error("not set up") });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("took too long to answer")), LIMIT_MS);
  });
  const work = fn();
  work.catch(() => {});
  return Promise.race([work, timeout])
    .then(value => ({ ok: true, value }), error => ({ ok: false, error }))
    .finally(() => clearTimeout(timer));
};

export const hasEnergy = env => !!(env.GLOW_USERNAME && env.GLOW_PASSWORD);

// ORIENTATION: "portrait" (the default), "landscape-right" (Kindle on its side with
// the charging port on the right) or "landscape-left" (port on the left).
export function orientation(env) {
  const o = String(env.ORIENTATION || "portrait").trim().toLowerCase();
  if (o === "landscape-right" || o === "landscape") return { landscape: true, turn: "cw" };
  if (o === "landscape-left") return { landscape: true, turn: "ccw" };
  return { landscape: false, turn: null };
}

// Screensaver hours, e.g. SCREENSAVER="00:00-06:00" (the default) or "22:30-06:00",
// or "off". Times are in the dashboard's time zone and can cross midnight.
// SCREENSAVER=outside-drives shows it at all times except during the timed
// journeys (DRIVE_1, DRIVE_2, ...) and bus hours (any stop due to be shown),
// so the full dashboard only appears then (or for a few minutes after a tap).
export function isScreensaverTime(env, now = new Date()) {
  const setting = String(env.SCREENSAVER ?? "00:00-06:00").trim().toLowerCase();
  if (setting === "off" || setting === "") return false;
  if (setting === "outside-drives") return !inDriveWindow(env, now) && !busHours(env, now);
  const m = setting.match(/^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})$/);
  if (!m) return false;
  const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
  const p = localParts(now, tz(env));
  const mins = +p.hh * 60 + +p.mm;
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}

// page 1: clock, weather, buses, drive. page 2: clock, weather, energy.
// Without ?page (the old single-page layout), energy sits at the bottom of page 1.
// Whether any stop is shown now (each stop has its own hours, or BUS_HOURS,
// e.g. "Mon-Fri 04:30-10:00", or always).
export const busHours = (env, now = new Date()) =>
  parseStops(env.BUS_STOPS).some(stop => stopShown(stop, env, now));
const driveNow = (env, now) => hasDrives(env) && !!activeJourney(env, now);

// Outside bus hours and outside any drive, page 1 has nothing of its own, so it
// shows the energy page instead (and there's no separate page 2 to rotate to).
export const page1IsEnergy = (env, now = new Date()) =>
  hasEnergy(env) && !busHours(env, now) && !driveNow(env, now);

let lastWeatherSource = "", lastWeatherSkipped = "";

export async function buildSvg(env, now = new Date(), page = 1, { single = true } = {}) {
  let back = true;
  if (page === 1 && !single && page1IsEnergy(env, now)) { page = 2; back = false; }
  const buses = busHours(env, now);
  const wantBus = page === 1 && buses;
  const wantDrive = page === 1;
  // Energy goes on page 1 too in the single-page layout, or in place of the
  // bus times outside bus hours (under the drive).
  const wantEnergy = page === 2 || (page === 1 && (single || !buses));
  const skip = Promise.resolve({ ok: false, missing: true });
  // Notes go on the energy page and the screensaver.
  const wantNotes = (page === 0 || page === 2) && hasNotes(env);
  const [weather, bus, car, power, notes] = await Promise.all([
    settle(true, () => getWeather(env)),
    wantBus ? settle(true, () => getBuses(env, now)) : skip,
    wantDrive ? settle(hasDrives(env), () => getDrive(env, now)) : skip,
    wantEnergy ? settle(hasEnergy(env), () => getEnergy(env, now)) : skip,
    wantNotes ? getNotes(env, now).catch(e => { console.error(e); return []; }) : [],
  ]);
  lastWeatherSource = weather.ok ? weather.value.source || "" : "unavailable";
  lastWeatherSkipped = weather.ok ? (weather.value.skipped || []).join(" | ") : String(weather.error?.message || "");
  // WEATHER_PLACE (e.g. "Dagenham") is shown with the weather.
  if (weather.ok && env.WEATHER_PLACE) weather.value = { ...weather.value, place: String(env.WEATHER_PLACE).trim() };
  // A drive outside its days and hours is left out, like one that isn't set up.
  const drive = car.ok && car.value === null ? { ok: false, missing: true } : car;
  return renderSvg({ now, zone: tz(env), weather, bus, car: drive, power, notes, page, back, landscape: orientation(env).landscape });
}

// turn: "cw" or "ccw" to rotate a landscape picture for the Kindle (see png.js).
export async function svgToPng(svg, Resvg, fonts, turn = null) {
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Inter" },
  });
  const img = resvg.render();
  let { pixels, width, height } = img;
  if (turn) ({ pixels, width, height } = rotate(pixels, width, height, turn));
  const png = await greyPng(pixels, width, height);
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
  if (url.pathname.endsWith("/notes") || url.searchParams.get("format") === "notes") {
    return handleNotes(request, env, url.searchParams.get("key"));
  }
  if (url.pathname.endsWith("/view") || url.searchParams.get("format") === "html") {
    return new Response(viewerPage(url.searchParams.get("key")), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // Night mode pieces for the Kindle (see night.js).
  if (url.searchParams.get("page") === "night") {
    if (!hasNight(env)) return new Response("Night mode is off (set NIGHT, e.g. 22:00-04:00).", { status: 404 });
    const { landscape, turn } = orientation(env);
    const part = url.searchParams.get("part");
    if (part === "info") {
      return new Response(nightInfo(env, landscape, turn), { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    }
    let svg;
    if (part === "bg") {
      const weather = await settle(true, () => getWeather(env));
      svg = backgroundSvg(env, landscape, weather, url.searchParams.get("day") === "1" ? 1 : 0);
    } else if (part === "colon") svg = pieceSvg(landscape, ":");
    else if (part === "digit" && /^\d$/.test(url.searchParams.get("d") || "")) svg = pieceSvg(landscape, url.searchParams.get("d"));
    else return new Response("Unknown night part.", { status: 404 });
    if (url.searchParams.get("format") === "svg") return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
    const png = await svgToPng(svg, Resvg, fonts, url.searchParams.get("upright") === "1" ? null : turn);
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  }
  // ?page=1 or ?page=2. Asking for a page at all means the multi-page layout, so
  // energy moves to page 2; without ?page the single-page layout stays as it was.
  const pageParam = url.searchParams.get("page");
  const page = pageParam === "2" ? 2 : pageParam === "0" ? 0 : 1;
  if (page === 2 && !hasEnergy(env)) {
    // Tells the Kindle there's no page 2 yet, so it just shows page 1.
    return new Response("No page 2: the smart meter isn't set up.", { status: 404 });
  }
  if (page === 2 && pageParam === "2" && page1IsEnergy(env)) {
    // Page 1 is already the energy page (outside bus hours), so don't rotate.
    return new Response("No page 2: page 1 is showing energy.", { status: 404 });
  }
  // Page 0 is the screensaver. It only exists during screensaver hours, which is
  // how the Kindle knows when to show it (?force=1 shows it any time, to preview).
  if (page === 0 && !isScreensaverTime(env) && url.searchParams.get("force") !== "1") {
    return new Response("Not screensaver time.", { status: 404 });
  }
  let svg = await buildSvg(env, new Date(), page, { single: pageParam === null });
  // Say where the weather came from in the SVG (invisible), to check the Met
  // Office is being used: e.g. view-source on /dashboard.svg?key=...
  const attr = t => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  if (lastWeatherSource) {
    const why = lastWeatherSkipped ? ` data-weather-skipped="${attr(lastWeatherSkipped)}"` : "";
    svg = svg.replace("<svg ", `<svg data-weather-source="${attr(lastWeatherSource)}"${why} `);
  }
  if (url.pathname.endsWith(".svg") || url.searchParams.get("format") === "svg") {
    return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
  }
  // The Kindle needs a landscape picture turned on its side; ?upright=1 (used by
  // the browser view) leaves it the right way up.
  const turn = url.searchParams.get("upright") === "1" ? null : orientation(env).turn;
  const png = await svgToPng(svg, Resvg, fonts, turn);
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}

// A page for phones and computers that works like the Kindle: new pictures just
// after each minute, swapping between page 1 (buses) and page 2 (energy) every
// 10 seconds, the screensaver (page 0) during screensaver hours, and a tap or
// click goes back to page 1 for 5 minutes. It shows the
// PNGs, not the SVG: they have the dashboard's font built in, so they look
// exactly like the Kindle (browsers don't have Inter and fall back to Times).
function viewerPage(key) {
  const base = `/dashboard.png?key=${encodeURIComponent(key)}&upright=1`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard</title>
<noscript><meta http-equiv="refresh" content="60"></noscript>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  body { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  img { max-width: 100vw; max-height: 100vh; background: #fff; }
</style>
</head><body>
<img id="dash" src="${base}&page=1" alt="Dashboard">
<script>
  const BASE = ${JSON.stringify(base)}, ROTATE = 10000, HOLD = 300000;
  const img = document.getElementById("dash");
  const pages = { 0: null, 1: img.src, 2: null };
  let tapped = 0, shown = 1;

  function load(n) {
    const next = new Image();
    next.onload = () => { pages[n] = next.src; show(true); };
    next.onerror = () => { if (n !== 1) { pages[n] = null; show(); } };
    next.src = BASE + "&page=" + n + "&t=" + Date.now();
  }
  function show(force) {
    const now = Date.now();
    const idle = now - tapped >= HOLD;
    // Screensaver at night unless tapped; otherwise page 1, or page 2 on its turn.
    const want = idle && pages[0] ? 0 : idle && pages[2] && Math.floor(now / ROTATE) % 2 === 1 ? 2 : 1;
    if (want !== shown || force) { img.src = pages[want]; shown = want; }
  }
  function refresh() {
    load(0); load(1); load(2);
    // Next pictures 2 seconds after the next minute starts, so the clock stays right.
    setTimeout(refresh, 62000 - (Date.now() % 60000));
  }
  document.body.addEventListener("click", () => { tapped = Date.now(); show(); });
  load(0); load(2);
  setTimeout(refresh, 62000 - (Date.now() % 60000));
  setInterval(show, 1000);
</script>
</body></html>`;
}

export { WIDTH, HEIGHT };
