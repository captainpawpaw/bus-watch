// Weather forecast from Open-Meteo (free, no key needed).
import { getJson, parseLatLon, tz } from "./util.js";

// Open-Meteo updates current conditions about every 15 minutes, so reuse a
// forecast for 15 minutes. Its free tier limits requests per internet address
// (shared with other users on Vercel), so if it refuses, keep showing the last
// forecast for up to 6 hours rather than "Weather unavailable".
const CACHE_MS = 15 * 60 * 1000;
const KEEP_MS = 6 * 60 * 60 * 1000;
let cached = null, cachedAt = 0, cachedFor = "";

export async function getWeather(env) {
  const { lat, lon } = parseLatLon(env.HOME_LATLON, "HOME_LATLON");
  const key = `${lat},${lon}`;
  if (cached && cachedFor === key && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    const fresh = await fetchWeather(env, lat, lon);
    cached = fresh; cachedAt = Date.now(); cachedFor = key;
    return fresh;
  } catch (e) {
    if (cached && cachedFor === key && Date.now() - cachedAt < KEEP_MS) return cached;
    throw e;
  }
}

async function fetchWeather(env, lat, lon) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: tz(env), forecast_days: "2",
    wind_speed_unit: "mph",
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,precipitation",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    // Rain in 15-minute steps for the next 12 hours, for the rain alert.
    minutely_15: "precipitation",
    forecast_minutely_15: "48",
  });
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);

  // Next five 3-hourly slots, starting from the next whole hour.
  const nowHour = w.current.time.slice(0, 13); // "2026-11-10T18"
  let start = w.hourly.time.findIndex(t => t.slice(0, 13) > nowHour);
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < w.hourly.time.length && hours.length < 5; i += 3) {
    hours.push({
      time: w.hourly.time[i].slice(11, 16),
      temp: w.hourly.temperature_2m[i],
      rain: w.hourly.precipitation_probability[i],
      code: w.hourly.weather_code[i],
      day: w.hourly.is_day[i] === 1,
    });
  }

  const day = i => ({
    code: w.daily.weather_code[i],
    max: w.daily.temperature_2m_max[i],
    min: w.daily.temperature_2m_min[i],
    rain: w.daily.precipitation_probability_max[i],
    sunrise: w.daily.sunrise[i].slice(11, 16),
    sunset: w.daily.sunset[i].slice(11, 16),
  });

  return {
    now: {
      temp: w.current.temperature_2m,
      feels: w.current.apparent_temperature,
      code: w.current.weather_code,
      wind: w.current.wind_speed_10m,
      day: w.current.is_day === 1,
    },
    today: day(0),
    tomorrow: day(1),
    hours,
    rain: rainAlert(w),
  };
}

// ---------- rain alert ----------
// Times from Open-Meteo are local, like "2026-11-20T17:15". Treat them as plain
// clock times (no time zone) for arithmetic.
const asMs = t => Date.parse(`${t}:00Z`);
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
const sameDay = (a, b) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

// Rain intensity in mm per hour, in the Met Office's bands (plus "very light"
// so even a small amount of rain is called out).
export function intensity(mmPerHour) {
  if (mmPerHour < 0.5) return "very light";
  if (mmPerHour < 2) return "light";
  if (mmPerHour < 10) return "moderate";
  if (mmPerHour < 50) return "heavy";
  return "very heavy";
}

// The next rain in the next 12 hours, even a small amount: whether it's raining
// now, when it starts and stops, how heavy at its heaviest, how much in all, and
// the chance of rain for that hour. Uses the 15-minute forecast, or hourly if
// that's missing. null = no rain expected in that time.
export function rainAlert(w) {
  const nowMs = asMs(w.current.time);
  const chanceAt = ms => {
    const h = w.hourly || {};
    const i = (h.time || []).findIndex(t => asMs(t) <= ms && ms < asMs(t) + 3600e3);
    return i >= 0 ? h.precipitation_probability?.[i] ?? null : null;
  };

  // Each value is the rain that fell in the step *ending* at its time.
  let slots, step;
  const m = w.minutely_15;
  if (m?.time?.length && m.precipitation?.some(v => v != null)) {
    step = 15 * 60e3;
    slots = m.time.map((t, i) => ({ end: asMs(t), mm: m.precipitation[i] || 0 }));
  } else {
    step = 3600e3;
    slots = (w.hourly?.time || []).map((t, i) => ({ end: asMs(t), mm: w.hourly.precipitation?.[i] || 0 }));
  }
  slots = slots.filter(s => s.end > nowMs && s.end <= nowMs + 12 * 3600e3);
  const first = slots.findIndex(s => s.mm > 0);
  if (first < 0) return null;

  let last = first;
  while (last + 1 < slots.length && slots[last + 1].mm > 0) last++;
  const run = slots.slice(first, last + 1);
  const start = run[0].end - step;
  const end = run[run.length - 1].end;
  const peak = Math.max(...run.map(s => s.mm)) * (3600e3 / step);
  const total = run.reduce((t, s) => t + s.mm, 0);
  const now = start <= nowMs || (w.current.precipitation || 0) > 0;
  return {
    now,
    start: hhmm(start),
    startDay: sameDay(start, nowMs) ? "" : "tomorrow ",
    end: hhmm(end),
    endsInWindow: last + 1 < slots.length,
    minutes: Math.round((end - Math.max(start, nowMs)) / 60e3),
    peak: Math.round(peak * 10) / 10,
    total: Math.round(total * 10) / 10,
    intensity: intensity(peak),
    chance: chanceAt(Math.max(start, nowMs)),
  };
}

// Short descriptions of the alert for the screen: [headline, details].
export function rainText(r) {
  if (!r) return ["No rain expected in the next 12 hours", ""];
  const dur = r.minutes >= 90 ? `${Math.round(r.minutes / 30) / 2} h` : `${r.minutes} min`;
  const details = [
    r.endsInWindow ? (r.now ? `until ${r.end}` : `for ${dur}`) : `until at least ${r.end}`,
    `up to ${r.peak} mm/h`,
    r.chance != null ? `${r.chance}% chance` : "",
  ].filter(Boolean).join(" · ");
  const head = r.now ? `Raining now · ${r.intensity}` : `Rain from ${r.startDay}${r.start} · ${r.intensity}`;
  return [head, details];
}

// WMO weather codes -> short text and an icon kind.
export function describe(code) {
  if (code === 0) return ["Clear", "sun"];
  if (code === 1) return ["Mostly clear", "sun"];
  if (code === 2) return ["Partly cloudy", "partly"];
  if (code === 3) return ["Overcast", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return [code >= 65 ? "Heavy rain" : "Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunder", "storm"];
  return ["", "cloud"];
}
