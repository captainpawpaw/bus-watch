// Gas and electricity use from your smart meter, via the Bright app (Glowmarkt API).
// Works with any UK supplier: sign up in the free Bright app, then set
// GLOW_USERNAME and GLOW_PASSWORD to that login.
import { getJson, localParts, tz, utcOffsetMinutes } from "./util.js";

const API = "https://api.glowmarkt.com/api/v0-1";
// Public application ID that Bright's own apps use.
const APP_ID = "b0f1b774-a586-4f72-9edd-27ead8aa7a8d";

// Kept between requests while the service stays warm.
let token = null, tokenExpires = 0, resources = null;
let cached = null, cachedAt = 0;
const CACHE_MS = 20 * 60 * 1000; // Meter data only changes every 30 minutes at best.
// Bright's readings can take several seconds each, so allow plenty of time.
const SLOW = 25000;
// If Bright is slow or down, show the last figures we got (up to this old)
// rather than an error: they only change about once a day.
const KEEP_MS = 36 * 60 * 60 * 1000;

async function login(env) {
  if (token && Date.now() < tokenExpires) return token;
  const res = await getJson(`${API}/auth`, {
    method: "POST",
    headers: { applicationId: APP_ID, "content-type": "application/json" },
    body: JSON.stringify({ username: env.GLOW_USERNAME, password: env.GLOW_PASSWORD }),
  }, SLOW);
  if (!res.valid || !res.token) throw new Error("Bright login failed");
  token = res.token;
  // Tokens last about a week; renew a day early.
  tokenExpires = (res.exp ? res.exp * 1000 : Date.now() + 6 * 864e5) - 864e5;
  resources = null;
  return token;
}

export async function getEnergy(env, now) {
  try {
    return await fetchEnergy(env, now);
  } catch (e) {
    if (cached && Date.now() - cachedAt < KEEP_MS) return { ...cached, stale: true };
    throw e;
  }
}

async function fetchEnergy(env, now) {
  if (!env.GLOW_USERNAME || !env.GLOW_PASSWORD) throw new Error("GLOW_USERNAME / GLOW_PASSWORD not set");
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const t = await login(env);
  const headers = { applicationId: APP_ID, token: t };
  if (!resources) resources = await getJson(`${API}/resource`, { headers }, SLOW);
  const find = c => resources.find(r => r.classifier === c)?.resourceId;

  // Daily totals from Monday of last week to Sunday of this week (14 days):
  // this calendar week for the chart and totals, plus last week in case
  // Bright's latest full day is before this Monday.
  const zone = tz(env);
  const p = localParts(now, zone);
  const today = Date.UTC(+p.y, +p.m - 1, +p.d);
  const dow = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
  const start = today - (dow + 7) * 864e5; // Monday last week
  const DAYS = 14;
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const from = `${day(start)}T00:00:00`;
  const to = `${day(today)}T23:59:59`;
  const offset = -utcOffsetMinutes(now, zone);

  const series = async classifier => {
    const id = find(classifier);
    if (!id) return null;
    // Ask Bright to fetch the newest readings from the meter (best effort, don't wait).
    if (classifier.endsWith("consumption")) {
      fetch(`${API}/resource/${id}/catchup`, { headers }).catch(() => {});
    }
    const q = new URLSearchParams({ from, to, period: "P1D", function: "sum", offset: String(offset) });
    const r = await getJson(`${API}/resource/${id}/readings?${q}`, { headers }, SLOW);
    const values = new Array(DAYS).fill(null);
    for (const [ts, value] of r.data || []) {
      const lp = localParts(new Date(ts * 1000), zone);
      const i = Math.round((Date.UTC(+lp.y, +lp.m - 1, +lp.d) - start) / 864e5);
      if (i >= 0 && i < DAYS) values[i] = value;
    }
    return values;
  };

  const fuel = async name => {
    const [kwh, pence] = await Promise.all([
      series(`${name}.consumption`), series(`${name}.consumption.cost`),
    ]);
    if (!kwh) return null;
    return { kwh, pence };
  };

  const [electric, gas] = await Promise.all([fuel("electricity"), fuel("gas")]);
  if (!electric && !gas) throw new Error("No smart meter found in Bright");

  const name = (i, style) => new Intl.DateTimeFormat("en-GB", { weekday: style, timeZone: "UTC" })
    .format(new Date(start + i * 864e5));
  const days = [...Array(DAYS).keys()].map(i => name(i, "narrow"));
  const dayNames = [...Array(DAYS).keys()].map(i => name(i, "long"));
  // weekStart: index of this Monday; todayIndex: index of today.
  cached = { electric, gas, days, dayNames, weekStart: 7, todayIndex: 7 + dow };
  cachedAt = Date.now();
  return cached;
}
