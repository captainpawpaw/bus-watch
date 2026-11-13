// Drive time with live traffic, plus incidents along the route, from TomTom.
//
// DRIVE_FROM is where you start: a UK postcode (e.g. "E6 2PS") or "latitude,longitude".
// Each journey is a setting DRIVE_1, DRIVE_2, ... (up to 9), written as
//   "<days> <from time>-<to time> | <name> | <destination>"
// e.g. "Mon-Fri 06:00-07:30 | Langdon Academy | E6 2PS". A journey only shows
// (and only uses TomTom lookups) during its days and hours. Days can be like
// "Mon-Fri", "Sat,Sun", "Weekdays", "Weekends" or "Daily".
// The older DRIVE_TO (+ DRIVE_LABEL) setting still works and shows all the time.
import { getJson, parseLatLon, tz } from "./util.js";

const CATEGORY = {
  1: "Accident", 2: "Fog", 3: "Hazard", 4: "Rain", 5: "Ice", 6: "Queue",
  7: "Lane closed", 8: "Road closed", 9: "Roadworks", 10: "Wind",
  11: "Flooding", 14: "Broken down vehicle",
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseDays(text) {
  const t = text.toLowerCase();
  if (t === "daily" || t === "everyday" || t === "all") return new Set([0, 1, 2, 3, 4, 5, 6]);
  if (t === "weekdays") return new Set([1, 2, 3, 4, 5]);
  if (t === "weekends") return new Set([0, 6]);
  const out = new Set();
  for (const part of t.split(",")) {
    const [a, b] = part.split("-").map(d => DAYS.indexOf(d.trim().slice(0, 3)));
    if (a < 0 || (b !== undefined && b < 0)) throw new Error(`Can't read the days "${text}"`);
    if (b === undefined) { out.add(a); continue; }
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return out;
}

const toMinutes = hhmm => {
  const m = hhmm.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) throw new Error(`Can't read the time "${hhmm}"`);
  return +m[1] * 60 + +m[2];
};

export function parseJourney(text, name) {
  const [when, label, to] = String(text).split("|").map(s => s.trim());
  if (!when || !to) throw new Error(`${name} should look like "Mon-Fri 06:00-07:30 | School | E6 2PS"`);
  const m = when.match(/^(.*?)\s+(\S+)\s*-\s*(\S+)$/);
  if (!m) throw new Error(`${name}: can't read "${when}"`);
  return { days: parseDays(m[1].replace(/\s+/g, "")), start: toMinutes(m[2]), end: toMinutes(m[3]), label, to };
}

// The journey to show right now, or null if none is due.
export function activeJourney(env, now) {
  const zone = tz(env);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  const day = DAYS.indexOf(get("weekday").toLowerCase().slice(0, 3));
  const mins = +get("hour") * 60 + +get("minute");
  for (let i = 1; i <= 9; i++) {
    const text = env[`DRIVE_${i}`];
    if (!text) continue;
    const j = parseJourney(text, `DRIVE_${i}`);
    if (j.days.has(day) && mins >= j.start && mins <= j.end) return j;
  }
  if (env.DRIVE_TO) return { label: env.DRIVE_LABEL || "Drive", to: env.DRIVE_TO };
  return null;
}

export const hasDrives = env =>
  !!(env.TOMTOM_KEY && env.DRIVE_FROM &&
    (env.DRIVE_TO || [1, 2, 3, 4, 5, 6, 7, 8, 9].some(i => env[`DRIVE_${i}`])));

// "latitude,longitude" or a UK postcode (looked up on postcodes.io, then remembered).
const places = new Map();
async function resolvePlace(text, name) {
  if (/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(text)) return parseLatLon(text, name);
  const pc = String(text || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
    throw new Error(`${name} should be a postcode or latitude,longitude`);
  }
  if (!places.has(pc)) {
    const r = await getJson(`https://api.postcodes.io/postcodes/${pc}`);
    places.set(pc, { lat: r.result.latitude, lon: r.result.longitude });
  }
  return places.get(pc);
}

export async function getDrive(env, now = new Date()) {
  if (!env.TOMTOM_KEY) throw new Error("TOMTOM_KEY is not set");
  const journey = activeJourney(env, now);
  if (!journey) return null; // Nothing due now: the section is left out.
  const [from, to] = await Promise.all([
    resolvePlace(env.DRIVE_FROM, "DRIVE_FROM"),
    resolvePlace(journey.to, journey.label),
  ]);
  const key = encodeURIComponent(env.TOMTOM_KEY);

  const route = await getJson(
    `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json` +
    `?key=${key}&traffic=true&travelMode=car&computeTravelTimeFor=all&routeRepresentation=polyline`);
  const r = route.routes[0];
  const s = r.summary;
  const points = r.legs.flatMap(l => l.points);

  let incidents = [];
  try {
    incidents = await incidentsOnRoute(key, points);
  } catch (e) {
    incidents = null; // Journey time still shows; incidents just say unavailable.
  }

  return {
    label: journey.label,
    minutes: Math.round(s.travelTimeInSeconds / 60),
    usualMinutes: Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds) / 60),
    delayMinutes: Math.round((s.trafficDelayInSeconds || 0) / 60),
    miles: s.lengthInMeters / 1609.344,
    arrival: new Date(s.arrivalTime),
    incidents,
  };
}

// Cells about 150 m across, used to tell whether an incident touches the route.
const CELL = 0.0014;
const cellKey = (lat, lon) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;

async function incidentsOnRoute(key, points) {
  const cells = new Set();
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    cells.add(cellKey(p.latitude, p.longitude));
    minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude); maxLon = Math.max(maxLon, p.longitude);
  }
  const pad = 0.005;
  const bbox = [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad].map(n => n.toFixed(5)).join(",");
  const fields = "{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}";

  const data = await getJson(
    `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${key}&bbox=${bbox}` +
    `&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present`);

  const near = (lon, lat) => {
    const r = Math.floor(lat / CELL), c = Math.floor(lon / CELL);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (cells.has(`${r + dr},${c + dc}`)) return true;
    }
    return false;
  };

  return (data.incidents || [])
    .filter(f => {
      const g = f.geometry;
      const coords = g.type === "Point" ? [g.coordinates] : g.coordinates;
      // Count it if a reasonable share of the incident lies on the route,
      // so roads that merely cross ours aren't included.
      const hits = coords.filter(([lon, lat]) => near(lon, lat)).length;
      return hits >= Math.max(1, Math.ceil(coords.length * 0.3));
    })
    .map(f => {
      const p = f.properties;
      const road = (p.roadNumbers || [])[0] || "";
      return {
        kind: CATEGORY[p.iconCategory] || "Incident",
        road,
        where: [p.from, p.to].filter(Boolean).join(" to "),
        text: (p.events || [])[0]?.description || "",
        severity: p.magnitudeOfDelay || 0,
        delayMinutes: Math.round((p.delay || 0) / 60),
      };
    })
    .sort((a, b) => b.severity - a.severity || b.delayMinutes - a.delayMinutes);
}
