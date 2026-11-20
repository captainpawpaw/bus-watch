// Renders the dashboard on your computer to preview.png, using real live data.
// Settings come from a .env file in this folder (same names as on Vercel).
//   npm run preview            -> live data
//   npm run preview -- --demo  -> made-up data, no keys needed
//   add --page 2 for the energy page (--page 1 for the bus page, --page 0 for the screensaver)
//   add --notes to include made-up notice board notes
//   add --landscape to draw it on its side (as ORIENTATION=landscape-right does),
//   and --kindle to save it turned the way the Kindle receives it
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSvg, svgToPng, orientation } from "../src/dashboard.js";
import { renderSvg } from "../src/render.js";
import { loadAssets } from "../src/assets.js";

const here = p => fileURLToPath(new URL(p, import.meta.url));

const env = {};
if (existsSync(here("../.env"))) {
  for (const l of readFileSync(here("../.env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

const { Resvg, fonts } = await loadAssets();

if (process.argv.includes("--landscape")) env.ORIENTATION = "landscape-right";
const pageArg = process.argv.indexOf("--page");
const page = pageArg > 0 ? Number(process.argv[pageArg + 1]) : null;
const svg = process.argv.includes("--demo") ? demoSvg(page ?? 1, page === null)
  : await buildSvg(env, new Date(), page ?? 1, { single: page === null });
const t = performance.now();
const png = await svgToPng(svg, Resvg, fonts, process.argv.includes("--kindle") ? orientation(env).turn : null);
console.log(`Rendered in ${Math.round(performance.now() - t)} ms, ${png.length} bytes`);
writeFileSync(here("../preview.png"), png);
console.log("Wrote preview.png");

function demoSvg(page, single) {
  const now = new Date();
  const at = m => new Date(now.getTime() + m * 60000);
  const bus = (route, towards, mins) => ({ route, towards, buses: mins.map(m => ({ mins: m, at: at(m) })) });
  return renderSvg({
    now, zone: "Europe/London", page, landscape: orientation(env).landscape,
    // --notes shows some made-up notes on the notice board.
    notes: process.argv.includes("--note") ? [{ text: "Bins out tonight" }] : process.argv.includes("--notes") ? [
      { text: "Bins out tonight, recycling week" },
      { text: "Dentist Thursday 4:15pm, bring the forms from the drawer in the kitchen and the new insurance card" },
      { text: "Gas meter reading due" },
      { text: "Mum's birthday Sunday" },
    ] : [],
    weather: { ok: true, value: {
      now: { temp: 11.4, feels: 9.2, code: 2, wind: 9, day: true },
      today: { max: 13, min: 6 }, tomorrow: { code: 61, max: 12, min: 7, rain: 70 }, place: "Dagenham",
      rain: { now: false, start: "21:15", startDay: "", end: "23:45", endsInWindow: true, minutes: 150, peak: 1.8, total: 2.6, intensity: "light", chance: 60 },
      hours: [[19, 3, 10, 0], [22, 61, 9, 45], [1, 63, 8, 80], [4, 3, 7, 20], [7, 1, 7, 5]]
        .map(([h, code, temp, rain]) => ({ time: `${String(h).padStart(2, "0")}:00`, code, temp, rain, day: h >= 7 && h < 17 })),
    } },
    bus: { ok: true, value: [
      { name: "Trafalgar Square", letter: "S", leave: { route: "24", inMins: 2, at: at(2), busMins: 8, busAt: at(8) }, routes: [
        bus("24", "Hampstead Heath", [6, 14, 22]), bus("176", "Penge", [9, 21, 33])] },
      { name: "Strand", letter: "", routes: [bus("9", "Aldwych", [0, 12])] },
    ] },
    car: { ok: true, value: {
      label: "Langdon Academy", from: "Home", minutes: 27, usualMinutes: 19, delayMinutes: 8, miles: 9.4, arrival: at(27),
      incidents: [
        { kind: "Roadworks", road: "A4", where: "Cromwell Road to Earls Court Road", severity: 2 },
        { kind: "Queue", road: "A3", where: "Wandsworth Bridge Roundabout", severity: 3 },
      ] } },
    power: page === 1 && !single ? { ok: false, missing: true } : { ok: true, value: {
      // Monday last week to Sunday this week; today is Tuesday (index 8).
      days: ["M", "T", "W", "T", "F", "S", "S", "M", "T", "W", "T", "F", "S", "S"],
      dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      weekStart: 7, todayIndex: 8,
      electric: { kwh: [8.1, 7.4, 9.0, 11.2, 10.6, 8.4, 9.3, 8.8, 3.1, null, null, null, null, null],
        pence: [204, 186, 226, 281, 266, 210, 233, 221, 78, null, null, null, null, null] },
      gas: { kwh: [32.5, 28.1, 30.4, 41.0, 38.2, 30.9, 35.0, 33.1, 12.4, null, null, null, null, null],
        pence: [221, 191, 207, 279, 260, 210, 238, 225, 84, null, null, null, null, null] },
    } },
  });
}
