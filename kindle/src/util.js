// Small helpers shared by the data sources and the renderer.

export function tz(env) {
  return env.TIMEZONE || "Europe/London";
}

// Parts of a date in the dashboard's time zone.
export function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

export function clock(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.hh}:${p.mm}`;
}

// Minutes the time zone is ahead of UTC at this moment (60 during BST).
export function utcOffsetMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(+p.y, +p.m - 1, +p.d, +p.hh, +p.mm);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

export async function getJson(url, init = {}, timeoutMs = 8000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).host} replied ${res.status}`);
  return res.json();
}

export function parseLatLon(text, name) {
  const m = String(text || "").split(",").map(s => parseFloat(s.trim()));
  if (m.length !== 2 || m.some(Number.isNaN)) throw new Error(`${name} should look like 51.54,0.13`);
  return { lat: m[0], lon: m[1] };
}
