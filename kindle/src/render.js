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

// The bus section between top and bottom. Returns { svg, end }, end being where
// it finished. opt.left/opt.right set the edges (portrait margins by default);
// opt.big draws everything larger and shows the next two buses per route.
function buses(result, zone, top, bottom, opt = {}) {
  const L = opt.left ?? M, R = opt.right ?? RIGHT, W = R - L, big = !!opt.big;
  const z = big
    ? { stop: 21, badge: 30, badgeH: 46, badgeW: 88, to: 18, times: 17, mins: 42, row: 80, leave: 19, count: 3 }
    : { stop: 19, badge: 24, badgeH: 38, badgeW: 76, to: 18, times: 15, mins: 28, row: 50, leave: 16, count: 3 };
  let y = top + 22;
  const heading = s => text(L, y, s.toUpperCase(), { size: 15, bold: true, fill: GREY });
  if (!result.ok) {
    return { svg: heading("Buses") + text(L, y + 30, `Bus times unavailable: ${result.error?.message || result.error}`,
      { size: 16, fill: GREY, max: W }), end: y + 40 };
  }
  let out = heading("Buses");
  // Of the buses you can still catch at each stop, the one you need to set off
  // for first. The clock time stays right even if the picture is a few minutes old.
  const leave = result.value.map(s => s.leave).filter(Boolean).sort((a, b) => a.at - b.at)[0];
  if (leave) {
    // Which bus it means, and how far away that bus is.
    const bus = `${leave.route} due in ${leave.busMins} min`;
    const advice = leave.inMins <= 0 ? `Leave now · ${bus}`
      : `Leave in ${leave.inMins} min (${clock(leave.at, zone)}) · ${bus}`;
    if (big) {
      // Its own line, so it's never cut short.
      y += 28;
      out += text(L, y, advice, { size: z.leave, bold: true, max: W * 1.12 });
    } else {
      out += text(R, y, advice, { size: z.leave, bold: true, anchor: "end", max: W - 70 });
    }
  }
  y += 10;

  for (const stop of result.value) {
    // Only start a stop if its name and at least one bus row fit.
    if (y + 32 + z.row > bottom) break;
    y += z.stop + 7;
    const letter = stop.letter ? (big ? ` (${stop.letter})` : ` (stop ${stop.letter})`) : "";
    // (The width estimate is cautious; bold Inter names really fit about 10% more.)
    out += text(L, y, stop.name + letter, { size: z.stop, bold: true, max: big ? W * 1.1 : W });
    y += 6;
    if (!stop.routes.length) {
      y += 26;
      out += text(L, y, stop.error ? `Couldn't load this stop: ${stop.error}` : "No buses due",
        { size: stop.error ? 16 : 18, fill: GREY, max: W });
      y += 10;
      continue;
    }
    for (const r of stop.routes) {
      if (y + z.row + 2 > bottom) break;
      const shown = r.buses.slice(0, z.count);
      const rowTop = y + 6;
      const badgeW = Math.max(z.badgeW, textWidth(r.route, z.badge, true) + 18);
      out += `<rect x="${L}" y="${rowTop}" width="${badgeW}" height="${z.badgeH}" rx="6" fill="#000"/>`;
      out += text(L + badgeW / 2, rowTop + z.badgeH * 0.74, r.route, { size: z.badge, bold: true, fill: "#fff", anchor: "middle" });

      const mins = shown.map(b => (b.mins === 0 ? "Due" : String(b.mins))).join(" · ");
      const minsText = shown[shown.length - 1].mins === 0 ? mins : `${mins} min`;
      if (big) {
        // Badge and big minutes on one line; where it's going and the clock times underneath.
        out += text(R, rowTop + z.badgeH * 0.86, minsText, { size: z.mins, bold: true, anchor: "end" });
        const times = shown.map(b => clock(b.at, zone)).join(", ");
        const timesW = textWidth(times, z.times);
        out += text(L, rowTop + z.badgeH + 24, `to ${r.towards}`, { size: z.to, max: W - timesW - 16 });
        out += text(R, rowTop + z.badgeH + 24, times, { size: z.times, fill: GREY, anchor: "end" });
        y += z.row;
        continue;
      }
      const minsW = textWidth(minsText, z.mins, true);
      const tx = L + badgeW + 14;
      out += text(tx, rowTop + z.to, `to ${r.towards}`, { size: z.to, max: R - minsW - tx - 12 });
      out += text(tx, rowTop + z.badgeH, shown.map(b => clock(b.at, zone)).join(", "), { size: z.times, fill: GREY });
      out += text(R, rowTop + z.badgeH * 0.82, minsText, { size: z.mins, bold: true, anchor: "end" });
      y += z.row;
    }
  }
  return { svg: out, end: y };
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
  const title = d.from ? `${d.from} → ${d.label}` : `Drive · ${d.label}`;
  out += text(M, y, title.toUpperCase(), { size: 15, bold: true, fill: GREY, max: right - M });

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
    const last = latestDay(f);
    out += text(x, y + 26, last < 0 ? "No readings yet"
      : `${dayLabel(last, e.dayNames)} ${kwh(last).toFixed(1)} kWh ${cost(last)}`,
      { size: 18, bold: true, max: colW });
    out += text(x, y + 46, kwh(6) ? `Today so far ${kwh(6).toFixed(1)} kWh` : "Today: no data yet",
      { size: 15, fill: GREY, max: colW });

    // Last 7 days as bars, today on the right.
    const chartTop = y + 56, chartH = 40, max = Math.max(...f.kwh.map(v => v || 0), 0.1);
    const barW = colW / 7;
    f.kwh.forEach((v, i) => {
      const bx = x + i * barW + 4;
      const h = v ? Math.max(2, (v / max) * chartH) : 0;
      if (h) out += `<rect x="${bx}" y="${chartTop + chartH - h}" width="${barW - 8}" height="${h}" fill="${i === last ? "#000" : "#888"}"/>`;
      out += text(bx + (barW - 8) / 2, chartTop + chartH + 16, e.days[i], { size: 13, fill: GREY, anchor: "middle" });
    });
  });
  return out;
}

// Gas and electric for page 2: a big block each with a 7-day chart.
// Bright usually runs a day behind and sends 0 for days it hasn't got yet, so
// use the most recent full day (not today) that actually has readings.
function latestDay(f) {
  for (let i = 5; i >= 0; i--) if (f.kwh[i] > 0) return i;
  return -1;
}
const dayLabel = (i, names) => (i === 5 ? "Yesterday" : names ? names[i] : "");
const pounds = p => `£${(p / 100).toFixed(2)}`;
// Totals over the 7 days in the chart; pence is null if Bright has no costs.
function weekTotal(f) {
  const kwh = f.kwh.reduce((t, v) => t + (v || 0), 0);
  const costs = (f.pence || []).filter(v => v != null);
  return { kwh, pence: costs.length ? costs.reduce((t, v) => t + v, 0) : null };
}

function energyBlock(name, f, days, top, names) {
  let y = top + 24;
  let out = heading(y, name);
  if (!f) return out + text(M, y + 32, "No meter found", { size: 18, fill: GREY });
  const cost = i => (f.pence && f.pence[i] != null ? ` · £${(f.pence[i] / 100).toFixed(2)}` : "");
  const last = latestDay(f), today = f.kwh[6];
  out += text(M, y + 36, last < 0 ? "No readings yet"
    : `${dayLabel(last, names)} ${f.kwh[last].toFixed(1)} kWh${cost(last)}`,
    { size: 26, bold: true, max: WIDTH - 2 * M });
  // The last 7 days' spend (including standing charges) and use, as in the chart.
  const week = weekTotal(f);
  const parts = [];
  if (week.pence !== null) parts.push(`Last 7 days: ${pounds(week.pence)}`);
  parts.push(`${week.kwh.toFixed(0)} kWh`);
  if (today > 0) parts.push(`today so far ${today.toFixed(1)} kWh`);
  out += text(M, y + 60, parts.join(" · "), { size: 17, fill: GREY, max: WIDTH - 2 * M });

  // Last 7 days as bars with their values, the latest full day in black.
  const chartTop = y + 92, chartH = 76, max = Math.max(...f.kwh.map(v => v || 0), 0.1);
  const barW = (WIDTH - 2 * M) / 7;
  f.kwh.forEach((v, i) => {
    const bx = M + i * barW + 8, w = barW - 16, cx = bx + w / 2;
    const h = v ? Math.max(2, (v / max) * chartH) : 0;
    if (h) {
      out += `<rect x="${bx}" y="${chartTop + chartH - h}" width="${w}" height="${h}" fill="${i === last ? "#000" : "#999"}"/>`;
      out += text(cx, chartTop + chartH - h - 5, v.toFixed(v < 10 ? 1 : 0), { size: 13, fill: GREY, anchor: "middle" });
    }
    out += text(cx, chartTop + chartH + 18, days[i], { size: 14, fill: GREY, anchor: "middle", bold: i === last });
  });
  return out;
}

function backButton(y = HEIGHT - 52, cx = WIDTH / 2) {
  const w = 220, h = 40, x = cx - w / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#fff" stroke="#000" stroke-width="2.5"/>` +
    `<path d="M${x + 30} ${y + h / 2} l12 -8 v16 z" fill="#000"/>` +
    text(cx + 12, y + 27, "Tap for buses", { size: 18, bold: true, anchor: "middle" });
}

const dateText = (now, zone) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(now);

const outlook = w => {
  const [tdesc] = describe(w.tomorrow.code);
  return [
    `Today: high ${temp(w.today.max)}, low ${temp(w.today.min)} · ${w.today.rain ?? 0}% rain`,
    `Tomorrow: ${tdesc.toLowerCase() || "—"}, ${temp(w.tomorrow.max)}/${temp(w.tomorrow.min)} · ${w.tomorrow.rain ?? 0}% rain`,
  ];
};

// The night screensaver: a big clock, the date and a little weather.
function screensaver(now, zone, weather) {
  const cx = WIDTH / 2;
  let out = text(cx, 250, clock(now, zone), { size: 176, bold: true, anchor: "middle" });
  out += text(cx, 312, dateText(now, zone), { size: 30, anchor: "middle" });
  out += line(360, 60, WIDTH - 60);

  if (weather.ok) {
    const w = weather.value;
    const [desc, kind] = describe(w.now.code);
    out += icon(kind, 92, 392, 120, w.now.day);
    out += text(236, 476, temp(w.now.temp), { size: 96, bold: true });
    out += text(236, 512, `${desc}, feels ${temp(w.now.feels)}`, { size: 22, max: WIDTH - 236 - M });
    const [today, tomorrow] = outlook(w);
    out += text(cx, 580, today, { size: 20, fill: GREY, anchor: "middle", max: WIDTH - 2 * M });
    out += text(cx, 616, tomorrow, { size: 20, fill: GREY, anchor: "middle", max: WIDTH - 2 * M });
  } else {
    out += text(cx, 470, "Weather unavailable", { size: 22, fill: GREY, anchor: "middle" });
  }
  out += text(cx, HEIGHT - 30, "Tap to wake", { size: 18, fill: GREY, anchor: "middle" });
  return out;
}

function svgDoc(body, w = WIDTH, h = HEIGHT) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter">` +
    `<rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}

// Buses, with the drive and (single-page layout) energy at the bottom,
// between top and bottom, in portrait coordinates (600 wide).
function travel(bus, car, power, zone, top, bottom) {
  // Sections that aren't configured are left out and the space goes to the buses.
  const showDrive = car.ok || !car.missing;
  const showEnergy = power && (power.ok || !power.missing);
  let energySvg = "", driveSvg = "";
  if (showEnergy) {
    bottom -= 140;
    energySvg = line(bottom) + energy(power, bottom);
  }
  if (showDrive) {
    bottom -= car.ok && car.value.map ? DRIVE_MAP_H : DRIVE_H;
    driveSvg = line(bottom) + drive(car, zone, bottom);
  }
  return buses(bus, zone, top, bottom).svg + driveSvg + energySvg;
}

// Gas and electric stacked, with the back button, from top (portrait coordinates).
function energyPage(power, top, buttonY) {
  if (!power.ok) return heading(top + 22, "Energy") + unavailable(top + 52, "Smart meter", power.error);
  const e = power.value;
  // Both fuels together, top right.
  const totals = [e.electric, e.gas].filter(Boolean).map(weekTotal).map(t => t.pence).filter(p => p !== null);
  const both = totals.length === 2
    ? text(RIGHT, top + 24, `Gas + electric, last 7 days: ${pounds(totals[0] + totals[1])}`, { size: 16, bold: true, anchor: "end" })
    : "";
  return both + energyBlock("Electric", e.electric, e.days, top, e.dayNames) + line(top + 222) +
    energyBlock("Gas", e.gas, e.days, top + 222, e.dayNames) + backButton(buttonY);
}

// ---------- landscape (800 x 600) ----------
export const L_WIDTH = 800;
export const L_HEIGHT = 600;
const COL = 290; // left column: clock and weather
// The right-hand side reuses the portrait sections, scaled to fit.
const SCALE = (L_WIDTH - COL) / WIDTH;
const INNER_H = L_HEIGHT / SCALE;

function leftColumn(now, zone, weather) {
  const x = M, w = COL - 2 * M;
  let out = text(x, 96, clock(now, zone), { size: 86, bold: true });
  out += text(x + 2, 132, dateText(now, zone), { size: 20, max: w });
  out += line(154, x, COL - M);
  if (!weather.ok) return out + text(x, 190, "Weather unavailable", { size: 16, fill: GREY });

  const wv = weather.value;
  const [desc, kind] = describe(wv.now.code);
  out += icon(kind, x - 4, 166, 76, wv.now.day);
  out += text(x + 92, 226, temp(wv.now.temp), { size: 58, bold: true });
  out += text(x, 268, `${desc}, feels ${temp(wv.now.feels)}`, { size: 17, max: w });
  out += text(x, 292, `High ${temp(wv.today.max)} · Low ${temp(wv.today.min)} · ${Math.round(wv.now.wind)} mph`,
    { size: 14, fill: GREY, max: w });
  out += line(310, x, COL - M);

  // Next hours, one per row, then tomorrow.
  const rows = [
    ...wv.hours.slice(0, 4).map(h => ({ label: h.time, code: h.code, day: h.day, t: temp(h.temp), rain: h.rain })),
    { label: "Tmrw", code: wv.tomorrow.code, day: true, t: `${temp(wv.tomorrow.max)}/${temp(wv.tomorrow.min)}`, rain: wv.tomorrow.rain, bold: true },
  ];
  rows.forEach((r, i) => {
    const y = 346 + i * 50;
    out += text(x, y, r.label, { size: 16, fill: r.bold ? "#000" : GREY, bold: r.bold });
    out += icon(describe(r.code)[1], x + 58, y - 28, 38, r.day);
    out += text(x + 108, y, r.t, { size: 20, bold: true });
    out += text(COL - M, y, `${r.rain ?? 0}%`, { size: 14, fill: GREY, anchor: "end" });
  });
  return out;
}

// Landscape bus page: buses at full size (not scaled down), then the drive and
// (single-page layout) energy straight underneath, scaled to fit.
function travelLandscape(bus, car, power, zone) {
  const showDrive = car.ok || !car.missing;
  const showEnergy = power && (power.ok || !power.missing);
  const driveH = showDrive ? (car.ok && car.value.map ? DRIVE_MAP_H : DRIVE_H) * SCALE : 0;
  const energyH = showEnergy ? 140 * SCALE : 0;
  const b = buses(bus, zone, 4, L_HEIGHT - driveH - energyH - 6, { left: COL + 18, right: L_WIDTH - 20, big: true });
  let out = b.svg;
  let y = b.end + 8;
  const scaled = (svg, at) => `<g transform="translate(${COL} ${at.toFixed(1)}) scale(${SCALE.toFixed(4)})">${svg}</g>`;
  if (showDrive) {
    out += scaled(line(0) + drive(car, zone, 0), y);
    y += driveH;
  }
  if (showEnergy) out += scaled(line(0) + energy(power, 0), y);
  return out;
}

function landscapeScreensaver(now, zone, weather) {
  const cx = L_WIDTH / 2;
  let out = text(cx, 230, clock(now, zone), { size: 210, bold: true, anchor: "middle" });
  out += text(cx, 290, dateText(now, zone), { size: 30, anchor: "middle" });
  out += line(326, 100, L_WIDTH - 100);
  if (weather.ok) {
    const w = weather.value;
    const [desc, kind] = describe(w.now.code);
    out += icon(kind, 170, 344, 104, w.now.day);
    out += text(300, 424, temp(w.now.temp), { size: 84, bold: true });
    out += text(300, 458, `${desc}, feels ${temp(w.now.feels)}`, { size: 22, max: L_WIDTH - 300 - M });
    const [today, tomorrow] = outlook(w);
    out += text(cx, 518, today, { size: 20, fill: GREY, anchor: "middle" });
    out += text(cx, 548, tomorrow, { size: 20, fill: GREY, anchor: "middle" });
  } else {
    out += text(cx, 440, "Weather unavailable", { size: 22, fill: GREY, anchor: "middle" });
  }
  out += text(cx, L_HEIGHT - 16, "Tap to wake", { size: 15, fill: GREY, anchor: "middle" });
  return out;
}

function renderLandscape({ now, zone, weather, bus, car, power, page }) {
  if (page === 0) return svgDoc(landscapeScreensaver(now, zone, weather), L_WIDTH, L_HEIGHT);
  const right = page === 2
    ? `<g transform="translate(${COL} 0) scale(${SCALE.toFixed(4)})">${energyPage(power, 12, INNER_H - 56)}</g>`
    : travelLandscape(bus, car, power, zone);
  const body = leftColumn(now, zone, weather) +
    `<line x1="${COL}" y1="${M}" x2="${COL}" y2="${L_HEIGHT - M}" stroke="#000" stroke-width="2"/>` + right;
  return svgDoc(body, L_WIDTH, L_HEIGHT);
}

// page 0: screensaver. page 1: clock, weather, buses and drive. page 2: clock, weather and energy.
// landscape: draw 800 x 600 instead of 600 x 800 (rotating for the Kindle happens later).
export function renderSvg({ now, zone, weather, bus, car, power, page = 1, landscape = false }) {
  if (landscape) return renderLandscape({ now, zone, weather, bus, car, power, page });
  if (page === 0) return svgDoc(screensaver(now, zone, weather));
  const top = header(now, zone, weather) + forecast(weather);
  if (page === 2) return svgDoc(top + energyPage(power, 298, HEIGHT - 52));
  // (Without the page 2 setup, energy still shows on page 1 at the bottom.)
  return svgDoc(top + travel(bus, car, power, zone, 298, HEIGHT));
}
