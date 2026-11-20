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
  let fresh;
  try {
    fresh = await fetchWeather(env, lat, lon);
  } catch (e) {
    // Open-Meteo refused or failed: try yr.no (MET Norway) instead.
    try {
      fresh = await fetchYr(env, lat, lon);
    } catch {
      if (cached && cachedFor === key && Date.now() - cachedAt < KEEP_MS) return cached;
      throw e;
    }
  }
  cached = fresh; cachedAt = Date.now(); cachedFor = key;
  return fresh;
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
  return summarise(w, "Open-Meteo");
}

// Turns an Open-Meteo-shaped forecast into what the dashboard shows.
function summarise(w, source) {
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
    source,
  };
}

// ---------- yr.no (MET Norway) backup ----------
// Free, no key; MET Norway asks apps to identify themselves. Data from MET
// Norway, CC BY 4.0. Its hourly forecast is reshaped to look like Open-Meteo's
// (no 15-minute rain, and no chance-of-rain figure for the UK).
const YR_AGENT = "kindle-weather-dashboard/1.0 (personal use)";

// yr symbol codes -> the WMO codes describe() understands.
function yrCode(symbol = "") {
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (s.includes("thunder")) return 95;
  if (s.includes("snow")) return s.includes("showers") ? 85 : 73;
  if (s.includes("sleet")) return 66;
  if (s.includes("rainshowers")) return 80;
  if (s.includes("heavyrain")) return 65;
  if (s.includes("lightrain")) return 61;
  if (s.includes("rain")) return 63;
  if (s === "fog") return 45;
  if (s === "cloudy") return 3;
  if (s === "partlycloudy") return 2;
  if (s === "fair") return 1;
  return 0;
}
const yrDay = symbol => !/_night$/.test(symbol || "");

async function fetchYr(env, lat, lon) {
  const d = await getJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,
    { headers: { "user-agent": YR_AGENT } });
  return summarise(fromYr(d, tz(env)), "yr.no");
}

export function fromYr(d, zone, now = new Date()) {
  const local = ms => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const g = t => p.find(x => x.type === t).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };
  // Hourly entries only (later ones are 6-hourly).
  const ts = d.properties.timeseries.filter(t => t.data.next_1_hours);
  const at = ts.map(t => Date.parse(t.time));
  const one = i => ts[i].data.next_1_hours;
  const inst = i => ts[i].data.instant.details;
  const mph = ms => ms * 2.23694;

  // Open-Meteo's hourly values describe the hour *ending* at their time, so the
  // value for hour T comes from yr's "next hour" of the entry at T - 1h.
  const hourly = { time: [], temperature_2m: [], precipitation: [], precipitation_probability: [], weather_code: [], is_day: [] };
  for (let i = 0; i < ts.length; i++) {
    hourly.time.push(local(at[i]));
    hourly.temperature_2m.push(inst(i).air_temperature);
    const prev = i > 0 ? one(i - 1) : null;
    hourly.precipitation.push(prev ? prev.details.precipitation_amount ?? 0 : 0);
    hourly.precipitation_probability.push(prev?.details.probability_of_precipitation ?? null);
    hourly.weather_code.push(yrCode(one(i).summary.symbol_code));
    hourly.is_day.push(yrDay(one(i).summary.symbol_code) ? 1 : 0);
  }

  // Today and tomorrow (local dates): high, low, the midday symbol.
  const dates = [...new Set(hourly.time.map(t => t.slice(0, 10)))].slice(0, 2);
  const daily = { weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], sunrise: [], sunset: [] };
  for (const date of dates) {
    const idx = hourly.time.map((t, i) => (t.startsWith(date) ? i : -1)).filter(i => i >= 0);
    const temps = idx.map(i => hourly.temperature_2m[i]);
    const noon = idx.find(i => hourly.time[i].slice(11, 13) === "12") ?? idx[Math.floor(idx.length / 2)];
    const probs = idx.map(i => hourly.precipitation_probability[i]).filter(v => v != null);
    daily.weather_code.push(hourly.weather_code[noon]);
    daily.temperature_2m_max.push(Math.max(...temps));
    daily.temperature_2m_min.push(Math.min(...temps));
    daily.precipitation_probability_max.push(probs.length ? Math.max(...probs) : null);
    daily.sunrise.push("");
    daily.sunset.push("");
  }

  const c = inst(0);
  const nowQuarter = Math.floor(now.getTime() / 900e3) * 900e3;
  return {
    current: {
      time: local(Math.max(nowQuarter, at[0])),
      temperature_2m: c.air_temperature,
      apparent_temperature: c.apparent_air_temperature ?? c.air_temperature,
      weather_code: yrCode(one(0).summary.symbol_code),
      wind_speed_10m: mph(c.wind_speed ?? 0),
      is_day: yrDay(one(0).summary.symbol_code) ? 1 : 0,
      precipitation: 0,
    },
    hourly,
    daily,
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
