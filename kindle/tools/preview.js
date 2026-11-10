// Renders the dashboard on your computer to preview.png, using real live data.
// Settings come from a .env file in this folder (same names as on Vercel).
//   npm run preview            -> live data
//   npm run preview -- --demo  -> made-up data, no keys needed
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSvg, svgToPng } from "../src/dashboard.js";
import { renderSvg } from "../src/render.js";
import { loadAssets } from "../src/assets.js";

const here = p => fileURLToPath(new URL(p, import.meta.url));

const env = {};
if (existsSync(here("../.env"))) {
  for (const l of readFileSync(here("../.env"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

const { Resvg, fonts } = await loadAssets();

const svg = process.argv.includes("--demo") ? demoSvg() : await buildSvg(env);
const t = performance.now();
const png = await svgToPng(svg, Resvg, fonts);
console.log(`Rendered in ${Math.round(performance.now() - t)} ms, ${png.length} bytes`);
writeFileSync(here("../preview.png"), png);
console.log("Wrote preview.png");

function demoSvg() {
  const now = new Date();
  const at = m => new Date(now.getTime() + m * 60000);
  const bus = (route, towards, mins) => ({ route, towards, buses: mins.map(m => ({ mins: m, at: at(m) })) });
  return renderSvg({
    now, zone: "Europe/London",
    weather: { ok: true, value: {
      now: { temp: 11.4, feels: 9.2, code: 2, wind: 9, day: true },
      today: { max: 13, min: 6 }, tomorrow: { code: 61, max: 12, min: 7, rain: 70 },
      hours: [[19, 3, 10, 0], [22, 61, 9, 45], [1, 63, 8, 80], [4, 3, 7, 20], [7, 1, 7, 5]]
        .map(([h, code, temp, rain]) => ({ time: `${String(h).padStart(2, "0")}:00`, code, temp, rain, day: h >= 7 && h < 17 })),
    } },
    bus: { ok: true, value: [
      { name: "Trafalgar Square", letter: "S", leave: { route: "24", inMins: 2 }, routes: [
        bus("24", "Hampstead Heath", [6, 14, 22]), bus("176", "Penge", [9, 21, 33])] },
      { name: "Strand", letter: "", routes: [bus("9", "Aldwych", [0, 12])] },
    ] },
    car: { ok: true, value: {
      label: "Home to work", minutes: 27, usualMinutes: 19, delayMinutes: 8, miles: 9.4, arrival: at(27),
      incidents: [
        { kind: "Roadworks", road: "A4", where: "Cromwell Road to Earls Court Road", severity: 2 },
        { kind: "Queue", road: "A3", where: "Wandsworth Bridge Roundabout", severity: 3 },
      ] } },
    power: { ok: true, value: {
      days: ["W", "T", "F", "S", "S", "M", "T"],
      electric: { kwh: [8.1, 7.4, 9.0, 11.2, 10.6, 8.4, 3.1], pence: [204, 186, 226, 281, 266, 210, 78] },
      gas: { kwh: [32.5, 28.1, 30.4, 41.0, 38.2, 30.9, 12.4], pence: [221, 191, 207, 279, 260, 210, 84] },
    } },
  });
}
