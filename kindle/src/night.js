// Night mode: NIGHT="22:00-04:00" (Vercel setting). During those hours the
// Kindle turns Wi-Fi off and stops downloading, to save battery, and keeps the
// clock going itself by drawing digit pictures it fetched beforehand onto a
// background picture. A tap turns Wi-Fi back on and wakes the dashboard for a
// few minutes.
//
// The Kindle asks for ?page=night&part=...:
//   info        text: when the next (or current) night starts and ends, the
//               time zone offset, and where to draw each digit of the clock
//   bg&day=0|1  the background, with the date before / after midnight
//   digit&d=0-9 and colon   the clock's pieces
import { localParts, tz, utcOffsetMinutes } from "./util.js";
import { L_WIDTH, L_HEIGHT, WIDTH, HEIGHT, nightBackground } from "./render.js";

export const hasNight = env => !!parseNight(env);

export function parseNight(env) {
  const m = String(env.NIGHT || "").trim().match(/^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})$/);
  return m ? { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] } : null;
}

// The epoch time (ms) of a local date and time in the dashboard's time zone.
function localToEpoch(y, mo, d, mins, zone) {
  const guess = Date.UTC(y, mo - 1, d, 0, mins);
  const off = utcOffsetMinutes(new Date(guess), zone);
  const t = guess - off * 60000;
  // Right across a clock change too.
  return guess - utcOffsetMinutes(new Date(t), zone) * 60000;
}

// The night that is going on now, or the next one.
export function nightWindow(env, now = new Date()) {
  const n = parseNight(env);
  if (!n) return null;
  const zone = tz(env);
  const p = localParts(now, zone);
  const crosses = n.end <= n.start; // e.g. 22:00-04:00
  for (const back of [-1, 0, 1]) {
    // A night starting on the day `back` days from today.
    const day = new Date(Date.UTC(+p.y, +p.m - 1, +p.d + back));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const start = localToEpoch(y, mo, d, n.start, zone);
    const end = localToEpoch(y, mo, d, n.end + (crosses ? 24 * 60 : 0), zone);
    const midnight = localToEpoch(y, mo, d, 24 * 60, zone);
    if (end > now.getTime()) {
      return { start, end, midnight: crosses ? midnight : end, startDate: new Date(start), endText: fmt(n.end) };
    }
  }
  return null;
}
const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Where the clock goes, in the picture's own layout (before turning it for the Kindle).
export function clockLayout(landscape) {
  return landscape
    ? { W: L_WIDTH, H: L_HEIGHT, size: 200, dw: 128, cw: 56, h: 160, y: 40 }
    : { W: WIDTH, H: HEIGHT, size: 176, dw: 112, cw: 48, h: 140, y: 110 };
}
function boxes(L) {
  const total = 4 * L.dw + L.cw;
  let x = Math.round((L.W - total) / 2);
  return ["h1", "h2", "colon", "m1", "m2"].map(name => {
    const w = name === "colon" ? L.cw : L.dw;
    const b = { name, x, y: L.y, w, h: L.h };
    x += w;
    return b;
  });
}
// The same box on the Kindle's screen, after the picture is turned (see png.js rotate).
function onScreen(b, L, turn) {
  if (turn === "cw") return { x: L.H - b.y - b.h, y: b.x };
  if (turn === "ccw") return { x: b.y, y: L.W - b.x - b.w };
  return { x: b.x, y: b.y };
}

export function nightInfo(env, landscape, turn, now = new Date()) {
  const w = nightWindow(env, now);
  if (!w) return null;
  const L = clockLayout(landscape);
  const lines = [
    `start ${Math.floor(w.start / 1000)}`,
    `end ${Math.floor(w.end / 1000)}`,
    `midnight ${Math.floor(w.midnight / 1000)}`,
    // The offset at the end of the night, so the clock is right in the morning
    // (it would be an hour out only between a clock change and the end of the night).
    `offset ${utcOffsetMinutes(new Date(w.end - 60000), tz(env)) * 60}`,
    ...boxes(L).map(b => { const s = onScreen(b, L, turn); return `pos ${b.name} ${s.x} ${s.y}`; }),
  ];
  return lines.join("\n") + "\n";
}

// One piece of the clock: a digit or the colon, black on white.
export function pieceSvg(landscape, what) {
  const L = clockLayout(landscape);
  const w = what === ":" ? L.cw : L.dw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${L.h}" viewBox="0 0 ${w} ${L.h}" font-family="Inter">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="${w / 2}" y="${L.h - 10}" font-size="${L.size}" font-weight="700" text-anchor="middle" fill="#000">${what}</text></svg>`;
}

export function backgroundSvg(env, landscape, weather, day, now = new Date()) {
  const w = nightWindow(env, now);
  const date = new Date((day === 1 ? w.midnight : w.start) + 60000);
  return nightBackground({ date, zone: tz(env), weather, landscape, until: w.endText, clockBottom: clockLayout(landscape).y + clockLayout(landscape).h });
}
