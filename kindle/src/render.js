// Draws the dashboard as an SVG, 600 x 800 (the basic Kindle's screen, portrait).
import { describe } from "./weather.js";
import { clock } from "./util.js";

export const WIDTH = 600;
export const HEIGHT = 800;
const M = 24; // side margin
const RIGHT = WIDTH - M;
const GREY = "#666";
const LIGHT = "#aaa";

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Rough text width, good enough to shorten long names before they overflow.
const textWidth = (s, size, bold) => String(s).length * size * (bold ? 0.6 : 0.55);
function fit(s, size, maxWidth, bold) {
  s = String(s);
  if (textWidth(s, size, bold) <= maxWidth) return s;
  const n = Math.max(1, Math.floor(maxWidth / (size * (bold ? 0.6 : 0.55))) - 1);
  return s.slice(0, n).trimEnd() + "…";
}

function text(x, y, s, { size = 20, bold = false, fill = "#000", anchor = "start", max } = {}) {
  const content = max ? fit(s, size, max, bold) : s;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 700 : 400}"` +
    ` fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;
}

const line = (y, x1 = M, x2 = RIGHT) =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#000" stroke-width="2"/>`;

const heading = (y, s) => text(M, y, s.toUpperCase(), { size: 15, bold: true, fill: GREY });

const temp = t => `${Math.round(t)}°`;

// ---------- weather icons (drawn in a 100 x 100 box) ----------
const CLOUD = "M24 76 H74 A17 17 0 0 0 74 42 A25 25 0 0 0 28 38 A19 19 0 0 0 24 76 Z";
function icon(kind, x, y, size, day = true) {
  const s = size / 100;
  const stroke = `fill="none" stroke="#000" stroke-width="${Math.max(5, 2.2 / s)}" stroke-linecap="round" stroke-linejoin="round"`;
  const cloud = (dx = 0, dy = 0, k = 1) =>
    `<path d="${CLOUD}" transform="translate(${dx} ${dy}) scale(${k})" fill="#fff" ${stroke.replace('fill="none" ', "")}/>`;
  const sun = (cx, cy, r) => {
    if (!day) {
      return `<path d="M${cx + r * 0.3} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.35} A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.3} ${cy - r} Z" ${stroke}/>`;
    }
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rays += `<line x1="${cx + Math.cos(a) * r * 1.45}" y1="${cy + Math.sin(a) * r * 1.45}" x2="${cx + Math.cos(a) * r * 1.85}" y2="${cy + Math.sin(a) * r * 1.85}" ${stroke}/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${r}" ${stroke}/>${rays}`;
  };
  let body;
  switch (kind) {
    case "sun": body = sun(50, 50, 22); break;
    case "partly": body = sun(38, 36, 15) + cloud(8, 8, 0.9); break;
    case "rain":
      body = cloud(0, -14) +
        [30, 50, 70].map(px => `<line x1="${px}" y1="72" x2="${px - 6}" y2="90" ${stroke}/>`).join("");
      break;
    case "snow":
      body = cloud(0, -14) +
        [[30, 76], [50, 86], [70, 76], [40, 96], [60, 96]]
          .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4" fill="#000"/>`).join("");
      break;
    case "storm":
      body = cloud(0, -14) + `<path d="M54 62 L42 80 H54 L46 98" ${stroke}/>`;
      break;
    case "fog":
      body = [30, 46, 62, 78].map((py, i) =>
        `<line x1="${16 + (i % 2) * 8}" y1="${py}" x2="${84 - ((i + 1) % 2) * 8}" y2="${py}" ${stroke}/>`).join("");
      break;
    default: body = cloud(0, 0);
  }
  return `<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`;
}

const unavailable = (y, what, err) =>
  text(M, y, `${what} unavailable: ${err?.message || err}`, { size: 16, fill: GREY, max: WIDTH - 2 * M });

// ---------- sections ----------

function header(now, zone, weather) {
  let out = text(M, 100, clock(now, zone), { size: 100, bold: true });
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(now);
  out += text(M + 4, 140, date, { size: 24 });

  if (weather.ok) {
    const w = weather.value;
    const [desc, kind] = describe(w.now.code);
    out += icon(kind, 330, 22, 86, w.now.day);
    out += text(RIGHT, 80, temp(w.now.temp), { size: 60, bold: true, anchor: "end" });
    out += text(RIGHT, 110, `${desc}, feels ${temp(w.now.feels)}`, { size: 18, anchor: "end", max: 230 });
    out += text(RIGHT, 136, `High ${temp(w.today.max)} · Low ${temp(w.today.min)} · ${Math.round(w.now.wind)} mph`,
      { size: 16, fill: GREY, anchor: "end" });
  }
  return out + line(158);
}

function forecast(weather) {
  if (!weather.ok) return unavailable(200, "Weather", weather.error) + line(296);
  const w = weather.value;
  const slots = [
    ...w.hours.map(h => ({ label: h.time, code: h.code, day: h.day, top: temp(h.temp), rain: h.rain })),
    { label: "Tomorrow", code: w.tomorrow.code, day: true,
      top: `${temp(w.tomorrow.max)}/${temp(w.tomorrow.min)}`, rain: w.tomorrow.rain },
  ];
  const width = (WIDTH - 2 * M) / slots.length;
  let out = "";
  slots.forEach((s, i) => {
    const cx = M + width * i + width / 2;
    const last = i === slots.length - 1;
    out += text(cx, 186, s.label, { size: last ? 15 : 17, bold: last, fill: last ? "#000" : GREY, anchor: "middle" });
    out += icon(describe(s.code)[1], cx - 24, 194, 48, s.day);
    out += text(cx, 266, s.top, { size: last ? 20 : 22, bold: true, anchor: "middle" });
    out += text(cx, 288, `${s.rain ?? 0}% rain`, { size: 14, fill: GREY, anchor: "middle" });
  });
  // Thin divider before "Tomorrow".
  const x = M + width * (slots.length - 1);
  out += `<line x1="${x}" y1="172" x2="${x}" y2="290" stroke="${LIGHT}" stroke-width="1.5"/>`;
  return out + line(298);
}

function buses(result, zone, top, bottom) {
  let y = top + 22;
  if (!result.ok) return heading(y, "Buses") + unavailable(y + 30, "Bus times", result.error);
  let out = heading(y, "Buses");
  // Of the buses you can still catch at each stop, the one you need to set off
  // for first. The clock time stays right even if the picture is a few minutes old.
  const leave = result.value.map(s => s.leave).filter(Boolean).sort((a, b) => a.at - b.at)[0];
  if (leave) {
    out += text(RIGHT, y, leave.inMins <= 0 ? `Leave now for the ${leave.route}`
      : `Leave ${clock(leave.at, zone)} for the ${leave.route} (in ${leave.inMins} min)`,
      { size: 17, bold: true, anchor: "end" });
  }
  y += 10;

  for (const stop of result.value) {
    // Only start a stop if its name and at least one bus row fit.
    if (y + 32 + 50 > bottom) break;
    y += 26;
    out += text(M, y, stop.letter ? `${stop.name} (stop ${stop.letter})` : stop.name, { size: 19, bold: true, max: WIDTH - 2 * M });
    y += 6;
    if (!stop.routes.length) {
      y += 26;
      out += text(M, y, stop.error ? `Couldn't load this stop: ${stop.error}` : "No buses due",
        { size: stop.error ? 16 : 18, fill: GREY, max: WIDTH - 2 * M });
      y += 10;
      continue;
    }
    for (const r of stop.routes) {
      if (y + 52 > bottom) break;
      const rowTop = y + 6;
      const badgeW = Math.max(76, textWidth(r.route, 24, true) + 18);
      out += `<rect x="${M}" y="${rowTop}" width="${badgeW}" height="38" rx="6" fill="#000"/>`;
      out += text(M + badgeW / 2, rowTop + 28, r.route, { size: 24, bold: true, fill: "#fff", anchor: "middle" });

      const mins = r.buses.map(b => (b.mins === 0 ? "Due" : String(b.mins))).join(" · ");
      const minsText = r.buses[r.buses.length - 1].mins === 0 ? mins : `${mins} min`;
      const minsW = textWidth(minsText, 28, true);
      const tx = M + badgeW + 14;
      out += text(tx, rowTop + 18, `to ${r.towards}`, { size: 18, max: RIGHT - minsW - tx - 12 });
      out += text(tx, rowTop + 38, r.buses.map(b => clock(b.at, zone)).join(", "), { size: 15, fill: GREY });
      out += text(RIGHT, rowTop + 31, minsText, { size: 28, bold: true, anchor: "end" });
      y += 50;
    }
  }
  return out;
}

export const DRIVE_H = 132;
export const DRIVE_MAP_H = 176;

function incidentLine(inc, x, y, max) {
  const what = [inc.kind, inc.road, inc.where].filter(Boolean).join(" · ");
  return `<path d="M${x + 7} ${y - 14} L${x + 15} ${y} H${x - 1} Z" fill="#000"/>` +
    text(x + 22, y, what, { size: 16, bold: inc.severity >= 3, max: max - 22 });
}

function routeMap(m, x, y) {
  const pts = m.line.map(([px, py]) => `${px},${py}`).join(" ");
  let out = `<defs><clipPath id="mapclip"><rect width="${m.w}" height="${m.h}"/></clipPath></defs>`;
  out += `<g transform="translate(${x} ${y})"><g clip-path="url(#mapclip)">`;
  out += `<rect width="${m.w}" height="${m.h}" fill="#fff"/>`;
  // Faded street map, so the route stands out on e-ink.
  if (m.image) out += `<image href="${m.image}" width="${m.w}" height="${m.h}" opacity="0.45"/>`;
  out += `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>`;
  out += `<polyline points="${pts}" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  for (const [mx, my] of m.marks) {
    out += `<path d="M${mx} ${my - 9} L${mx + 8} ${my + 5} H${mx - 8} Z" fill="#000" stroke="#fff" stroke-width="2"/>`;
  }
  const [sx, sy] = m.start, [ex, ey] = m.end;
  out += `<circle cx="${sx}" cy="${sy}" r="6" fill="#000" stroke="#fff" stroke-width="2"/>`;
  out += `<circle cx="${ex}" cy="${ey}" r="8" fill="#fff" stroke="#000" stroke-width="3"/>` +
    `<circle cx="${ex}" cy="${ey}" r="3" fill="#000"/>`;
  out += `</g><rect width="${m.w}" height="${m.h}" fill="none" stroke="#000" stroke-width="1.5"/></g>`;
  return out;
}

function drive(result, zone, top) {
  let y = top + 22;
  if (!result.ok) return heading(y, "Drive") + unavailable(y + 30, "Drive time", result.error);
  const d = result.value;
  const map = d.map;
  // With a map, the text sits in a column to its left.
  const right = map ? RIGHT - map.w - 14 : RIGHT;
  let out = map ? routeMap(map, RIGHT - map.w, top + 12) : "";
  out += text(M, y, `Drive · ${d.label}`.toUpperCase(), { size: 15, bold: true, fill: GREY, max: right - M });

  const arrive = `Arrive ${clock(d.arrival, zone)}`;
  const delay = d.delayMinutes > 0 ? `+${d.delayMinutes} min traffic`
    : d.delayMinutes < 0 ? `${-d.delayMinutes} min quicker` : "Normal traffic";
  const delayStyle = { size: 16, fill: d.delayMinutes >= 5 ? "#000" : GREY, bold: d.delayMinutes >= 5 };

  if (map) {
    // The ETA if you leave now, then how traffic compares with usual.
    out += text(M, top + 64, `${d.minutes} min`, { size: 42, bold: true });
    out += text(M, top + 96, arrive, { size: 24, bold: true });
    out += text(M, top + 118, `${delay} · usually ${d.usualMinutes} min`, { ...delayStyle, max: right - M });
    y = top + 122;
  } else {
    y += 46;
    out += text(M, y, `${d.minutes} min`, { size: 42, bold: true });
    const x = M + textWidth(`${d.minutes} min`, 42, true) + 18;
    out += text(x, y - 18, arrive, { size: 24, bold: true });
    out += text(x, y + 2, `${delay} · usually ${d.usualMinutes} min`, { ...delayStyle, max: RIGHT - x });
    y += 4;
  }

  if (d.incidents === null) {
    out += text(M, y + 22, "Incidents unavailable", { size: 16, fill: GREY });
  } else if (!d.incidents.length) {
    out += text(M, y + 22, "No incidents on the route", { size: 16, fill: GREY });
  } else {
    for (const inc of d.incidents.slice(0, 2)) {
      y += 22;
      out += incidentLine(inc, M, y, right - M);
    }
    if (d.incidents.length > 2) {
      // Under the map when there is one, otherwise on the heading line.
      out += text(RIGHT, map ? top + 164 : top + 22, `+${d.incidents.length - 2} more`,
        { size: 15, fill: GREY, anchor: "end" });
    }
  }
  return out;
}

function energy(result, top) {
  let y = top + 22;
  if (!result.ok) return heading(y, "Energy") + unavailable(y + 30, "Smart meter", result.error);
  const e = result.value;
  const colW = (WIDTH - 2 * M - 24) / 2;
  let out = "";
  [["Electric", e.electric], ["Gas", e.gas]].forEach(([name, f], col) => {
    const x = M + col * (colW + 24);
    out += text(x, y, name.toUpperCase(), { size: 15, bold: true, fill: GREY });
    if (!f) {
      out += text(x, y + 28, "No meter found", { size: 16, fill: GREY });
      return;
    }
    const kwh = i => f.kwh[i];
    const cost = i => (f.pence && f.pence[i] != null ? `£${(f.pence[i] / 100).toFixed(2)}` : "");
    const yest = kwh(5);
    out += text(x, y + 26, yest == null ? "Yesterday: no data" : `Yesterday ${yest.toFixed(1)} kWh ${cost(5)}`,
      { size: 18, bold: true, max: colW });
    out += text(x, y + 46, kwh(6) ? `Today so far ${kwh(6).toFixed(1)} kWh` : "Today: no data yet",
      { size: 15, fill: GREY, max: colW });

    // Last 7 days as bars, today on the right.
    const chartTop = y + 56, chartH = 40, max = Math.max(...f.kwh.map(v => v || 0), 0.1);
    const barW = colW / 7;
    f.kwh.forEach((v, i) => {
      const bx = x + i * barW + 4;
      const h = v ? Math.max(2, (v / max) * chartH) : 0;
      if (h) out += `<rect x="${bx}" y="${chartTop + chartH - h}" width="${barW - 8}" height="${h}" fill="${i === 5 ? "#000" : "#888"}"/>`;
      out += text(bx + (barW - 8) / 2, chartTop + chartH + 16, e.days[i], { size: 13, fill: GREY, anchor: "middle" });
    });
  });
  return out;
}

export function renderSvg({ now, zone, weather, bus, car, power }) {
  // Sections that aren't configured are left out and the space goes to the buses.
  const showDrive = car.ok || !car.missing;
  const showEnergy = power.ok || !power.missing;
  let bottom = HEIGHT;
  let energySvg = "", driveSvg = "";
  if (showEnergy) {
    bottom -= 140;
    energySvg = line(bottom) + energy(power, bottom);
  }
  if (showDrive) {
    bottom -= car.ok && car.value.map ? DRIVE_MAP_H : DRIVE_H;
    driveSvg = line(bottom) + drive(car, zone, bottom);
  }
  const body = header(now, zone, weather) + forecast(weather) + buses(bus, zone, 298, bottom) + driveSvg + energySvg;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Inter">` +
    `<rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}
