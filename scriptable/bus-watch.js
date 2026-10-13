// Bus Watch for Scriptable (iPhone)
// Run it in the Scriptable app to set up to 6 buses (route, stop, hours, days, walk time).
// Then add a Scriptable widget (Home Screen or Lock Screen) and choose this script.
// Optional widget Parameter: 1 to 6 to pin that widget to one of your buses.
// Live times: TfL Open Data.

const API = "https://api.tfl.gov.uk";
const MAX = 6;
const TREND_WINDOW = 6 * 60000;
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fm = FileManager.local();
const DIR = fm.documentsDirectory();
const CFG = fm.joinPath(DIR, "buswatch-config.json");
const HIST = fm.joinPath(DIR, "buswatch-history.json");
const readJSON = (p, d) => { try { return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : d; } catch (e) { return d; } };
const writeJSON = (p, v) => fm.writeString(p, JSON.stringify(v));

// Tapping "↻ Refresh" on the widget runs this script in Scriptable with your latest settings
const REFRESH_URL = "scriptable:///run/" + encodeURIComponent(Script.name()) + "?action=refresh";

let watches = readJSON(CFG, []);
let hist = readJSON(HIST, {});

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1b1d22")),
  fg: Color.dynamic(new Color("#1b1d22"), new Color("#f2f1ee")),
  muted: Color.dynamic(new Color("#6b6f78"), new Color("#9a9ea8")),
  accent: Color.dynamic(new Color("#c8261d"), new Color("#ff4a3d")),
  ok: Color.dynamic(new Color("#1f7a4d"), new Color("#4fc58a")),
  warn: Color.dynamic(new Color("#b26a00"), new Color("#f0a83a")),
  info: Color.dynamic(new Color("#2a5db0"), new Color("#7aa7ff")),
};

/* ===================== SETUP (runs in the app) ===================== */

async function say(title, message) {
  const a = new Alert(); a.title = title; a.message = message || ""; a.addAction("OK");
  await a.presentAlert();
}

async function loadRoute(route) {
  const dirs = [];
  for (const d of ["inbound", "outbound"]) {
    try {
      const j = await new Request(`${API}/Line/${encodeURIComponent(route.toLowerCase())}/Route/Sequence/${d}`).loadJSON();
      if (!j || !j.stopPointSequences || !j.stopPointSequences.length) continue;
      const seen = new Set(), stops = [];
      let longest = j.stopPointSequences[0];
      for (const seq of j.stopPointSequences) {
        if (seq.stopPoint.length > longest.stopPoint.length) longest = seq;
        for (const s of seq.stopPoint) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          stops.push({ id: s.id, name: s.name, letter: (s.stopLetter || "").startsWith("->") ? "" : (s.stopLetter || ""), lat: s.lat, lon: s.lon });
        }
      }
      dirs.push({ dir: d, dest: longest.stopPoint[longest.stopPoint.length - 1].name, stops });
    } catch (e) { /* try the other direction */ }
  }
  return dirs;
}

function dist(s, p) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const a = Math.sin(r(s.lat - p.latitude) / 2) ** 2 +
    Math.cos(r(p.latitude)) * Math.cos(r(s.lat)) * Math.sin(r(s.lon - p.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const stopLabel = s => s.name + (s.letter ? ` (Stop ${s.letter})` : "");

async function pick(title, items, label, sub) {
  const t = new UITable(); t.showSeparators = true;
  let chosen = null;
  const head = new UITableRow(); head.isHeader = true; head.addText(title); t.addRow(head);
  for (const it of items) {
    const row = new UITableRow(); row.height = 54; row.dismissOnSelect = true;
    row.addText(label(it), sub ? sub(it) : null);
    row.onSelect = () => { chosen = it; };
    t.addRow(row);
  }
  await t.present();
  return chosen;
}

const hoursText = w => w.from === w.to ? "All day" : `${w.from}–${w.to}`;

function daysText(days) {
  const k = [...days].sort().join(",");
  if (k === "1,2,3,4,5") return "Mon–Fri";
  if (k === "0,1,2,3,4,5,6") return "Every day";
  if (k === "0,6") return "Sat & Sun";
  return [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => DAY[d]).join(" ");
}

async function addBus() {
  // 1. Route
  let a = new Alert();
  a.title = "Bus route"; a.message = "Type the route number, e.g. 62";
  a.addTextField("62", ""); a.addAction("Find stops"); a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return;
  const route = a.textFieldValue(0).trim().toUpperCase();
  if (!route) return;
  const dirs = await loadRoute(route);
  if (!dirs.length) return say("Route not found", `Couldn't find route ${route}. Check the number and your connection.`);

  // 2. Direction
  a = new Alert(); a.title = `Route ${route}`; a.message = "Which direction do you travel?";
  dirs.forEach(d => a.addAction("Towards " + d.dest)); a.addCancelAction("Cancel");
  const di = await a.presentSheet(); if (di === -1) return;
  const dir = dirs[di];

  // 3. Stop
  a = new Alert(); a.title = "Find your stop";
  a.addAction("Nearest to me"); a.addAction("Search by name"); a.addAction("Show all stops"); a.addCancelAction("Cancel");
  const how = await a.presentSheet(); if (how === -1) return;
  let stop = null;
  if (how === 0) {
    try {
      Location.setAccuracyToHundredMeters();
      const here = await Location.current();
      const near = [...dir.stops].sort((x, y) => dist(x, here) - dist(y, here)).slice(0, 15);
      stop = await pick("Nearest stops", near, stopLabel, s => Math.round(dist(s, here)) + " m away");
    } catch (e) { return say("Location not available", "Allow Scriptable to use your location, or search by name instead."); }
  } else if (how === 1) {
    a = new Alert(); a.title = "Search stops"; a.addTextField("e.g. Ilchester", ""); a.addAction("Search"); a.addCancelAction("Cancel");
    if (await a.presentAlert() === -1) return;
    const q = a.textFieldValue(0).trim().toLowerCase();
    const found = dir.stops.filter(s => s.name.toLowerCase().includes(q) || s.letter.toLowerCase() === q);
    if (!found.length) return say("No stops found", `No stop on route ${route} matches "${q}".`);
    stop = await pick("Choose your stop", found, stopLabel);
  } else {
    stop = await pick(`Route ${route} towards ${dir.dest}`, dir.stops, stopLabel);
  }
  if (!stop) return;

  // 4. Hours
  a = new Alert(); a.title = "When should it show live times?"; a.message = "24-hour times, e.g. 07:00 and 09:00.\nUse the same time twice for all day.";
  a.addTextField("From", "07:00"); a.addTextField("Until", "09:00"); a.addAction("Next"); a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return;
  const tidy = t => { const m = t.trim().match(/^(\d{1,2})[:.]?(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? m[1].padStart(2, "0") + ":" + m[2] : null; };
  const from = tidy(a.textFieldValue(0)), to = tidy(a.textFieldValue(1));
  if (!from || !to) return say("Times not recognised", "Use the 24-hour format, like 07:30 or 17:45.");

  // 5. Days
  a = new Alert(); a.title = "Which days?";
  ["Mon–Fri", "Every day", "Sat & Sun", "Choose days…"].forEach(x => a.addAction(x)); a.addCancelAction("Cancel");
  const dsel = await a.presentSheet(); if (dsel === -1) return;
  let days = [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6], [0, 6]][dsel];
  if (dsel === 3) {
    a = new Alert(); a.title = "Choose days"; a.message = "Type the days, e.g. Mon Wed Fri";
    a.addTextField("Mon Tue Wed", ""); a.addAction("Next"); a.addCancelAction("Cancel");
    if (await a.presentAlert() === -1) return;
    days = DAY.map((d, i) => a.textFieldValue(0).toLowerCase().includes(d.toLowerCase()) ? i : -1).filter(i => i >= 0);
    if (!days.length) return say("No days recognised", "Type day names like Mon Tue Wed.");
  }

  // 6. Walk
  a = new Alert(); a.title = "Walk to the stop"; a.message = "How many minutes from home to the stop?";
  a.addTextField("3", "3"); a.addAction("Save"); a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return;
  const walk = Math.max(0, parseInt(a.textFieldValue(0)) || 0);

  watches.push({ route, dir: dir.dir, dest: dir.dest, stop: stop.id, stopName: stop.name, letter: stop.letter, from, to, days, walk });
  writeJSON(CFG, watches);
}

async function setupMenu() {
  while (true) {
    const a = new Alert();
    a.title = "Bus Watch";
    a.message = watches.length
      ? watches.map((w, i) => `${i + 1}. ${w.route} from ${w.stopName}${w.letter ? " (" + w.letter + ")" : ""}\n    ${hoursText(w)}, ${daysText(w.days)}, ${w.walk} min walk`).join("\n")
      : `No buses yet. Add up to ${MAX}.`;
    const acts = [];
    if (watches.length < MAX) { a.addAction("Add a bus"); acts.push("add"); }
    if (watches.length) {
      a.addAction("Remove a bus"); acts.push("remove");
      a.addAction("Show live times now"); acts.push("live");
      a.addAction("Preview medium widget"); acts.push("medium");
      a.addAction("Preview small widget"); acts.push("small");
    }
    a.addCancelAction("Done");
    const r = await a.presentSheet();
    if (r === -1) return;
    const act = acts[r];
    if (act === "add") await addBus();
    if (act === "remove") {
      const w = await pick("Remove which bus?", watches, w => `${w.route} from ${w.stopName}`, w => `${hoursText(w)}, ${daysText(w.days)}`);
      if (w) { watches = watches.filter(x => x !== w); writeJSON(CFG, watches); }
    }
    if (act === "live") { const wd = await buildWidget("large", null, false, 2); await wd.presentLarge(); }
    if (act === "medium") { const wd = await buildWidget("medium", null, false); await wd.presentMedium(); }
    if (act === "small") { const wd = await buildWidget("small", null, false); await wd.presentSmall(); }
  }
}

/* ===================== SCHEDULE ===================== */

const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function isActive(w, d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes(), f = toMin(w.from), t = toMin(w.to), day = d.getDay();
  if (f === t) return w.days.includes(day);   // same start and end = all day
  if (f < t) return w.days.includes(day) && m >= f && m < t;
  return (w.days.includes(day) && m >= f) || (w.days.includes((day + 6) % 7) && m < t);
}
function nextStart(w) {
  const now = new Date();
  for (let k = 0; k < 8; k++) {
    const d = new Date(now); d.setDate(d.getDate() + k);
    const [h, m] = w.from.split(":").map(Number); d.setHours(h, m, 0, 0);
    if (d > now && w.days.includes(d.getDay())) return { date: d, k };
  }
  return null;
}
function nextStartText(w) {
  const n = nextStart(w); if (!n) return "No days set";
  const when = n.k === 0 ? "today" : n.k === 1 ? "tomorrow" : DAY[n.date.getDay()];
  return w.from === w.to ? `All day ${when}` : `From ${w.from} ${when}`;
}

/* ===================== LIVE DATA ===================== */

async function fetchLine(route) {
  try {
    const j = await new Request(`${API}/Line/${encodeURIComponent(route.toLowerCase())}/Arrivals`).loadJSON();
    return Array.isArray(j) ? j : null;
  } catch (e) { return null; }
}

// TfL service status (diversions, closed stops) for several routes in one request
async function fetchStatus(routes) {
  const out = {};
  if (!routes.length) return out;
  try {
    const j = await new Request(`${API}/Line/${routes.map(r => encodeURIComponent(r.toLowerCase())).join(",")}/Status`).loadJSON();
    const now = Date.now();
    const current = s => !s.validityPeriods || !s.validityPeriods.length ||
      s.validityPeriods.some(v => Date.parse(v.fromDate) <= now && now <= Date.parse(v.toDate));
    for (const l of Array.isArray(j) ? j : [])
      out[l.id] = (l.lineStatuses || []).filter(s => s.statusSeverity !== 10 && s.reason && current(s)).map(s => s.reason.trim());
  } catch (e) { /* status is a bonus; live times still work without it */ }
  return out;
}
// The most relevant disruption for this watch: one that names your stop comes first
function disruptionFor(w, status) {
  const list = status[w.route.toLowerCase()] || [];
  if (!list.length) return null;
  const mine = list.find(r => r.toLowerCase().includes(w.stopName.toLowerCase()));
  return { text: (mine ? "Your stop: " : "") + (mine || list[0]), mine: !!mine, more: list.length - 1 };
}

function analyse(w, preds) {
  const byBus = {};
  for (const p of preds) (byBus[p.vehicleId] = byBus[p.vehicleId] || []).push(p);
  const out = [], now = Date.now();
  for (const vid in byBus) {
    const list = byBus[vid];
    const here = list.find(p => p.naptanId === w.stop);
    if (!here) continue;
    const eta = Date.parse(here.expectedArrival);
    if (eta < now - 30000) continue;
    const before = list.filter(p => p.direction === here.direction && Date.parse(p.expectedArrival) < eta)
      .sort((a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival));
    out.push({ vid, eta, stopsAway: before.length, nextStop: before.length ? before[0].stationName : null });
  }
  return out.sort((a, b) => a.eta - b.eta);
}

function record(w, buses) {
  const now = Date.now();
  for (const b of buses) {
    const k = w.stop + "|" + b.vid, h = (hist[k] = hist[k] || []);
    if (!h.length || now - h[h.length - 1][0] > 15000) h.push([now, b.eta]);
  }
}
function trend(w, b) {
  const h = hist[w.stop + "|" + b.vid]; if (!h || h.length < 2) return null;
  const now = Date.now(), base = h.find(([t]) => now - t <= TREND_WINDOW);
  if (!base || now - base[0] < 90000) return null;
  return (b.eta - base[1]) / 60000;
}
function trendText(w, b) {
  const t = trend(w, b);
  if (t === null) return { text: "Watching…", color: C.muted };
  if (t >= 1) return { text: `▲ Slipping +${Math.round(t)}m`, color: C.warn };
  if (t <= -1) return { text: `▼ Catching up ${Math.round(-t)}m`, color: C.info };
  return { text: "● On track", color: C.ok };
}
const spareSecs = (w, b) => (b.eta - Date.now()) / 1000 - w.walk * 60;
const leaveIn = s => s < 120 ? "leave now" : `leave in ${Math.floor(s / 60)}m`;
function leaveText(w, b, list) {
  const spare = spareSecs(w, b);
  if (spare < 0) {
    // Can't make this one: point at the first bus you can still catch
    const nx = (list || []).find(x => x.eta > b.eta && spareSecs(w, x) >= 0);
    return { text: nx ? `Too tight · next: ${leaveIn(spareSecs(w, nx))}` : "Too tight", color: C.accent };
  }
  if (spare < 120) return { text: "Leave now", color: C.warn };
  return { text: `Leave in ${Math.floor(spare / 60)}m`, color: C.ok };
}
function adviceText(w, list) {
  const [b1, b2] = list; if (!b1) return null;
  const gap = b2 ? (b2.eta - b1.eta) / 60000 : null, t = trend(w, b1);
  if (b2 && gap <= 3) return { text: `Bunched: next one ${Math.max(1, Math.round(gap))} min behind, may have more room`, color: C.info };
  if (gap === null || gap >= 15) return { text: gap === null ? "Don't miss this one: no other bus predicted" : `Don't miss this one: next is ${Math.round(gap)} min later`, color: C.warn };
  if (t !== null && t >= 2) return { text: `Next bus held up: ${Math.round(t)} min later than before`, color: C.warn };
  return null;
}
const firstEta = p => (p.buses && p.buses[0]) ? p.buses[0].eta : 9e15;
const mins = b => Math.max(0, Math.floor((b.eta - Date.now()) / 60000));
const minsStr = b => mins(b) === 0 ? "Due" : mins(b) + " min";
const clock = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

/* ===================== DRAWING ===================== */

function stripImage(list, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height); ctx.opaque = false; ctx.respectScreenScale = true;
  const max = Math.max(10, ...list.map(b => b.stopsAway)) + 1;
  const y = height / 2, pad = 10, usable = width - pad * 2;
  ctx.setFillColor(new Color("#8a8f99", 0.35));
  ctx.fillRect(new Rect(pad, y - 2, usable, 4));
  ctx.setFillColor(new Color("#e0362b"));
  ctx.fillEllipse(new Rect(width - pad - 8, y - 8, 16, 16));
  // Each marker shows the time left (e.g. "8m" or "Due") instead of a bus number
  const box = 16, fontSize = 10.5;
  const canStagger = height >= box * 2 + 2;
  const marks = list.map(b => {
    const label = mins(b) === 0 ? "Due" : mins(b) + "m";
    const bw = Math.max(box + 4, label.length * fontSize * 0.62 + 8);
    const x = pad + usable * (1 - b.stopsAway / max) - (b.stopsAway === 0 ? 16 : 0);
    const cx = Math.max(pad + bw / 2, Math.min(width - pad - 12 - bw / 2, x));
    return { label, bw, cx, row: 0 };
  });
  // If two markers would overlap, move one above and one below the line
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i];
    if (canStagger && Math.abs(a.cx - b.cx) < (a.bw + b.bw) / 2 + 2) {
      if (a.row === 0) a.row = 1;
      b.row = a.row === 1 ? -1 : 1;
    }
  }
  // Draw the furthest bus first so the soonest one sits on top
  [...marks].reverse().forEach(m => {
    const cy = y + m.row * (box / 2 + 1);
    ctx.setFillColor(new Color("#3a3d45"));
    const path = new Path(); path.addRoundedRect(new Rect(m.cx - m.bw / 2, cy - box / 2, m.bw, box), 4, 4);
    ctx.addPath(path); ctx.fillPath();
    ctx.setFont(Font.boldSystemFont(fontSize)); ctx.setTextColor(Color.white()); ctx.setTextAlignedCenter();
    ctx.drawTextInRect(m.label, new Rect(m.cx - m.bw / 2, cy - fontSize * 0.62, m.bw, box));
  });
  return ctx.getImage();
}

function txt(stack, s, size, color, bold, lines = 1) {
  const t = stack.addText(s);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = lines > 1 ? 1 : 0.6;
  return t;
}
function badge(stack, route, size) {
  const b = stack.addStack();
  b.backgroundColor = C.accent; b.cornerRadius = 5; b.setPadding(1, 5, 1, 5);
  const t = b.addText(route); t.font = Font.heavySystemFont(size); t.textColor = Color.white();
  return b;
}

/* ===================== WIDGET ===================== */

async function buildWidget(family, pinned, forceAll, minShow = 0) {
  const w = new ListWidget();
  const lock = family.startsWith("accessory");
  if (!lock) { w.backgroundColor = C.bg; w.setPadding(12, 14, 12, 14); }

  if (!watches.length) {
    txt(w, "Bus Watch", 14, lock ? Color.white() : C.fg, true);
    txt(w, "Open Scriptable to add your buses", 11, lock ? Color.white() : C.muted, false);
    return w;
  }

  let pool = watches.map((x, i) => ({ w: x, i }));
  if (pinned && watches[pinned - 1]) pool = [pool[pinned - 1]];
  const active = pool.filter(p => forceAll || isActive(p.w));
  // Top up with the routes whose hours start soonest (used by the Refresh screen)
  if (active.length < minShow) {
    const extra = pool.filter(p => !active.includes(p)).map(p => ({ p, n: nextStart(p.w) }))
      .sort((a, b) => (a.n ? a.n.date : 9e15) - (b.n ? b.n.date : 9e15)).map(x => x.p);
    extra.slice(0, minShow - active.length).forEach(p => { p.forced = true; active.push(p); });
  }
  const sleeping = pool.filter(p => !active.includes(p));

  // Fetch each route once
  const routes = [...new Set(active.map(p => p.w.route))];
  const data = {};
  const [status] = await Promise.all([fetchStatus(routes), ...routes.map(async r => { data[r] = await fetchLine(r); })]);
  for (const p of active) {
    p.buses = data[p.w.route] ? analyse(p.w, data[p.w.route]) : null;
    p.alert = disruptionFor(p.w, status);
    if (p.buses) record(p.w, p.buses);
  }
  // Put the route with the soonest bus first, everywhere
  active.sort((a, b) => firstEta(a) - firstEta(b));
  // Every upcoming bus across all live routes, soonest first
  const upcoming = active.flatMap(p => (p.buses || []).map(b => ({ p, b }))).sort((x, y) => x.b.eta - y.b.eta);
  const now = Date.now();
  for (const k in hist) { hist[k] = hist[k].filter(([t]) => now - t < 20 * 60000); if (!hist[k].length) delete hist[k]; }
  writeJSON(HIST, hist);

  // Refresh: every minute while live, otherwise at the next window
  if (active.length) w.refreshAfterDate = new Date(now + 60000);
  else {
    const starts = sleeping.map(p => nextStart(p.w)).filter(Boolean).map(n => n.date);
    w.refreshAfterDate = starts.length ? new Date(Math.min(...starts)) : new Date(now + 3600000);
  }

  const n = active.length;
  const fg = lock ? Color.white() : C.fg, muted = lock ? Color.white() : C.muted;
  w.url = REFRESH_URL;   // tapping any part without its own link refreshes

  /* ---- Lock Screen ---- */
  if (family === "accessoryInline") {
    txt(w, n ? active.map(p => `${p.w.route} ${p.buses && p.buses[0] ? (mins(p.buses[0]) || "Due") + (mins(p.buses[0]) ? "m" : "") : "–"}`).join(" · ")
      : `${sleeping[0].w.route} ${nextStartText(sleeping[0].w)}`, 12, fg, false);
    return w;
  }
  if (family === "accessoryCircular") {
    const p = active[0] || sleeping[0];
    const b = p.buses && p.buses[0];
    w.addSpacer(); txt(w, p.w.route, 11, fg, true).centerAlignText();
    txt(w, b ? (mins(b) ? mins(b) + "m" : "Due") : "–", 16, fg, true).centerAlignText(); w.addSpacer();
    return w;
  }
  if (family === "accessoryRectangular") {
    if (!n) { txt(w, `${sleeping[0].w.route} bus`, 14, fg, true); txt(w, nextStartText(sleeping[0].w), 12, fg, false); return w; }
    if (n === 1) {
      const p = active[0], b = p.buses && p.buses[0];
      if (!b) { txt(w, `${p.w.route} · none due`, 14, fg, true); return w; }
      txt(w, `${p.w.route}  ${minsStr(b)}${p.alert ? "  ⚠" : ""}`, 16, fg, true);
      txt(w, `${leaveText(p.w, b, p.buses).text} · ${trendText(p.w, b).text}`, 12, fg, false);
      txt(w, p.buses[1] ? `next ${minsStr(p.buses[1])}` : "next not predicted yet", 12, fg, false);
      return w;
    }
    const soonest = active.slice(0, 3);
    for (const p of soonest) {
      const b = p.buses || [];
      txt(w, `${p.w.route}  ${b[0] ? minsStr(b[0]) : "–"}${b[1] ? "  · next " + mins(b[1]) + "m" : ""}`, n === 2 ? 14 : 12, fg, true);
    }
    return w;
  }

  /* ---- Home Screen ---- */
  const refreshFooter = () => {
    const foot = w.addStack(); foot.centerAlignContent(); foot.url = REFRESH_URL;
    txt(foot, `Updated ${clock(now)} · TfL`, 9, muted, false);
    foot.addSpacer();
    txt(foot, "↻ Refresh", family === "small" ? 10 : 11, C.accent, true);
  };

  const large = family === "large" || family === "extraLarge";

  if (!n) {
    txt(w, "Nothing due right now", family === "small" ? 13 : 16, fg, true);
    w.addSpacer(6);
    const cap = family === "small" ? 3 : large ? 6 : 4;
    for (const p of sleeping.slice(0, cap)) {
      const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
      badge(r, p.w.route, 12); txt(r, nextStartText(p.w), 12, muted, false);
      w.addSpacer(4);
    }
    if (sleeping.length > cap) txt(w, `+${sleeping.length - cap} more`, 11, muted, false);
    w.addSpacer();
    refreshFooter();
    return w;
  }

  if (family === "small") {
    // Small widget: the soonest bus, plus a note if more are live
    const first = upcoming[0];
    const p = first ? first.p : active[0];
    const b = first ? first.b : null;
    const h = w.addStack(); h.centerAlignContent(); h.spacing = 6; badge(h, p.w.route, 14);
    txt(h, p.w.letter ? "Stop " + p.w.letter : "", 11, muted, false);
    w.addSpacer(4);
    if (!b) { txt(w, p.buses ? "None due" : "No signal", 18, fg, true); }
    else {
      txt(w, minsStr(b), 34, mins(b) === 0 ? C.accent : fg, true);
      const lv = leaveText(p.w, b, p.buses); txt(w, lv.text, 12, lv.color, true);
      const tr = trendText(p.w, b); txt(w, tr.text, 11, tr.color, false);
    }
    if (p.alert) txt(w, "⚠ " + (p.alert.mine ? "Your stop affected" : "Route disrupted"), 10, C.warn, true);
    w.addSpacer();
    // The next incoming bus after this one, on any of your live routes
    const nx = upcoming[1];
    if (nx) {
      const r = w.addStack(); r.centerAlignContent(); r.spacing = 5;
      txt(r, "Next", 11, muted, false); badge(r, nx.p.w.route, 10); txt(r, minsStr(nx.b), 12, fg, true);
    } else if (b) txt(w, "Next: not predicted yet", 10, muted, false);
    const f = w.addStack(); f.url = REFRESH_URL;
    txt(f, `${clock(now)}  `, 9, muted, false); txt(f, "↻ Refresh", 10, C.accent, true);
    return w;
  }

  const W = large ? 310 : 300;

  // One section per live bus. Size depends on how many are live.
  const sect = (parent, p, mode) => {
    const s = parent.addStack(); s.layoutVertically(); s.url = "https://tfl.gov.uk/bus/stop/" + p.w.stop;
    const h = s.addStack(); h.centerAlignContent(); h.spacing = 6;
    badge(h, p.w.route, mode === "xl" ? 18 : 14);
    txt(h, `${p.w.stopName}${p.w.letter ? " · " + p.w.letter : ""}${p.forced ? " · outside your hours" : ""}`, 11, muted, false);
    if (p.alert) {
      if (mode === "col") txt(s, "⚠ " + (p.alert.mine ? "Your stop affected" : "Route disrupted"), 10, C.warn, true);
      else txt(s, "⚠ " + p.alert.text, mode === "xl" ? 11 : 10, C.warn, mode === "xl", mode === "xl" ? 3 : mode === "l" ? 2 : 1);
    }
    const list = p.buses || [];
    const b = list[0];
    if (!b) { s.addSpacer(4); txt(s, p.buses ? "No buses in the next 30 min" : "Can't reach TfL", 13, muted, false); return s; }
    const big = { xl: 56, l: 36, m: 30, s: 24, col: n === 2 ? 30 : 24 }[mode];
    if (mode === "col") {
      txt(s, minsStr(b), big, mins(b) === 0 ? C.accent : fg, true);
      const lv = leaveText(p.w, b, list); txt(s, lv.text, 11, lv.color, true);
      const tr = trendText(p.w, b); txt(s, tr.text, 10, tr.color, false);
      txt(s, list[1] ? "Next " + list.slice(1, 3).map(x => minsStr(x)).join(", ") : "Next: not predicted yet", 11, list[1] ? fg : muted, !!list[1]);
      return s;
    }
    const row = s.addStack(); row.bottomAlignContent(); row.spacing = 8;
    txt(row, minsStr(b), big, mins(b) === 0 ? C.accent : fg, true);
    const side = row.addStack(); side.layoutVertically();
    const lv = leaveText(p.w, b, list); txt(side, lv.text, 12, lv.color, true);
    const tr = trendText(p.w, b); txt(side, tr.text, 11, tr.color, false);
    if (mode !== "s") {
      const adv = adviceText(p.w, list.slice(0, 4));
      if (adv && mode === "xl") { s.addSpacer(4); txt(s, adv.text, 12, adv.color, true); }
    }
    s.addSpacer(mode === "s" ? 2 : 4);
    const stripH = mode === "s" ? 20 : 36;
    const img = s.addImage(stripImage(list.slice(0, 4), W, stripH));
    img.imageSize = new Size(W, stripH);
    if (mode === "xl") {
      s.addSpacer(4);
      list.slice(0, 4).forEach(x => {
        const r = s.addStack(); r.centerAlignContent(); r.spacing = 8;
        const m = r.addStack(); m.size = new Size(52, 0); txt(m, minsStr(x), 13, fg, true);
        txt(r, `${x.stopsAway} stops away${x.nextStop ? " · " + x.nextStop : ""}`, 11, muted, false);
        r.addSpacer();
        const t = trendText(p.w, x); txt(r, t.text, 10, t.color, false);
        s.addSpacer(3);
      });
    } else {
      txt(s, list[1] ? "Next " + list.slice(1, 3).map(x => minsStr(x)).join(" · ") : "Next: not predicted yet", 11, list[1] ? fg : muted, !!list[1]);
    }
    return s;
  };

  // One compact line per bus, used when 4 or more are live
  const compactRow = (parent, p) => {
    const r = parent.addStack(); r.centerAlignContent(); r.spacing = 8;
    r.url = "https://tfl.gov.uk/bus/stop/" + p.w.stop;
    const bd = r.addStack(); bd.size = new Size(46, 0); badge(bd, p.w.route, 13);
    const mid = r.addStack(); mid.layoutVertically();
    txt(mid, `${p.alert ? "⚠ " : ""}${p.w.stopName}${p.w.letter ? " · " + p.w.letter : ""}${p.forced ? " · outside hours" : ""}`, 10, p.alert ? C.warn : muted, false);
    const list = p.buses || [], b = list[0];
    if (!b) txt(mid, p.buses ? "None due in 30 min" : "Can't reach TfL", 11, muted, false);
    else {
      const lv = leaveText(p.w, b, list), tr = trendText(p.w, b);
      const st = mid.addStack(); st.spacing = 4;
      txt(st, lv.text, 11, lv.color, true); txt(st, "·", 11, muted, false); txt(st, tr.text, 10, tr.color, false);
    }
    r.addSpacer();
    if (b) {
      const right = r.addStack(); right.layoutVertically();
      txt(right, minsStr(b), 20, mins(b) === 0 ? C.accent : fg, true).rightAlignText();
      txt(right, list[1] ? "next " + mins(list[1]) + "m" : "next –", 10, muted, false).rightAlignText();
    }
  };

  if (n >= 4) {
    // 4–6 buses live: one line each, soonest first (medium shows the soonest 3)
    const shown = large ? active : active.slice(0, 3);
    shown.forEach((p, i) => { compactRow(w, p); if (i < shown.length - 1) w.addSpacer(large ? 8 : 4); });
    if (shown.length < n) { w.addSpacer(2); txt(w, `+${n - shown.length} more live · tap Refresh to see all`, 10, muted, false); }
  } else if (!large) {
    // Medium: one bus = full section; 2–3 buses = side-by-side columns
    if (n === 1) sect(w, active[0], "m");
    else {
      const cols = w.addStack(); cols.spacing = 12; cols.topAlignContent();
      active.forEach((p, i) => { const c = sect(cols, p, "col"); if (i < n - 1) cols.addSpacer(); });
    }
  } else {
    // Large: 1 bus = full detail; 2 = two medium sections; 3 = three compact sections
    const mode = n === 1 ? "xl" : n === 2 ? "l" : "s";
    active.forEach((p, i) => { sect(w, p, mode); if (i < n - 1) w.addSpacer(n === 3 ? 6 : 10); });
  }

  w.addSpacer();
  if (sleeping.length && n < 3 && large) {
    for (const p of sleeping.slice(0, 3 - n)) {
      const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
      badge(r, p.w.route, 11); txt(r, nextStartText(p.w), 11, muted, false);
    }
    const rest = sleeping.slice(3 - n);
    if (rest.length) txt(w, "Later: " + rest.map(p => `${p.w.route} ${nextStartText(p.w).replace("From ", "")}`).join(" · "), 10, muted, false);
    w.addSpacer(4);
  }
  refreshFooter();
  return w;
}

/* ===================== START ===================== */

if (config.runsInWidget) {
  const pinned = parseInt(args.widgetParameter) || null;
  Script.setWidget(await buildWidget(config.widgetFamily || "medium", pinned, false));
} else if (config.runsInAccessoryWidget) {
  Script.setWidget(await buildWidget(config.widgetFamily, parseInt(args.widgetParameter) || null, false));
} else if (args.queryParameters && args.queryParameters.action === "refresh" && watches.length) {
  // Opened from the widget's Refresh link: re-read settings and show fresh live times
  // for at least 2 of your routes (in-hours ones first, then whichever starts soonest).
  const wd = await buildWidget("large", null, false, 2);
  await wd.presentLarge();
  const a = new Alert(); a.title = "Bus Watch";
  a.message = "Your widget will show these settings at its next update.";
  a.addAction("Close"); a.addAction("Edit my buses");
  if (await a.presentAlert() === 1) await setupMenu();
} else {
  if (!watches.length) await say("Welcome to Bus Watch", "Let's add the buses you catch. You can add up to 6, each with its own stop and hours.");
  if (!watches.length) await addBus();
  await setupMenu();
}
Script.complete();
