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
  // The Met Office first (if METOFFICE_KEY is set), then Open-Meteo, then yr.no.
  const sources = [
    ...(env.METOFFICE_KEY ? [() => fetchMetOffice(env, lat, lon)] : []),
    () => fetchWeather(env, lat, lon),
    () => fetchYr(env, lat, lon),
  ];
  let firstError;
  for (const source of sources) {
    try {
      const fresh = await source();
      cached = fresh; cachedAt = Date.now(); cachedFor = key;
      return fresh;
    } catch (e) {
      firstError ??= e;
    }
  }
  // All failed: keep showing the last forecast for a while.
  if (cached && cachedFor === key && Date.now() - cachedAt < KEEP_MS) return cached;
  throw firstError;
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

// ---------- helpers for reshaping other forecasts like Open-Meteo's ----------
function localTime(zone) {
  return ms => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const g = t => p.find(x => x.type === t).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };
}

// Today and tomorrow (local dates) from an hourly series: high, low, the
// midday weather and the highest chance of rain.
function dailyFrom(hourly) {
  const dates = [...new Set(hourly.time.map(t => t.slice(0, 10)))].slice(0, 2);
  const daily = { weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], sunrise: [], sunset: [] };
  for (const date of dates) {
    const idx = hourly.time.map((t, i) => (t.startsWith(date) ? i : -1)).filter(i => i >= 0);
    const temps = idx.map(i => hourly.temperature_2m[i]).filter(v => v != null);
    const noon = idx.find(i => hourly.time[i].slice(11, 13) === "12") ?? idx[Math.floor(idx.length / 2)];
    const probs = idx.map(i => hourly.precipitation_probability[i]).filter(v => v != null);
    daily.weather_code.push(hourly.weather_code[noon]);
    daily.temperature_2m_max.push(Math.max(...temps));
    daily.temperature_2m_min.push(Math.min(...temps));
    daily.precipitation_probability_max.push(probs.length ? Math.max(...probs) : null);
    daily.sunrise.push("");
    daily.sunset.push("");
  }
  return daily;
}

// ---------- Met Office (first choice when METOFFICE_KEY is set) ----------
// Weather DataHub, Site-specific "Global Spot" (free plan: 360 calls a day; at
// one call per 15 minutes this uses about 96). Hourly, so the rain alert has
// hourly timing.

// Met Office significant weather codes -> the WMO codes describe() understands,
// and whether the code is a night one.
const MO_CODES = {
  "-1": 51, 0: 0, 1: 0, 2: 2, 3: 2, 5: 45, 6: 45, 7: 3, 8: 3, 9: 80, 10: 80, 11: 51, 12: 61,
  13: 81, 14: 81, 15: 65, 16: 66, 17: 66, 18: 66, 19: 80, 20: 80, 21: 80, 22: 85, 23: 85, 24: 71,
  25: 86, 26: 86, 27: 75, 28: 95, 29: 95, 30: 95,
};
const MO_NIGHT = new Set([0, 2, 9, 13, 16, 19, 22, 25, 28]);

async function fetchMetOffice(env, lat, lon) {
  const q = new URLSearchParams({
    latitude: (+lat).toFixed(4), longitude: (+lon).toFixed(4),
    excludeParameterMetadata: "true", includeLocationName: "false",
  });
  const d = await getJson(`https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly?${q}`,
    { headers: { apikey: String(env.METOFFICE_KEY).trim(), accept: "application/json" } });
  return summarise(fromMetOffice(d, tz(env)), "Met Office");
}

export function fromMetOffice(d, zone, now = new Date()) {
  const local = localTime(zone);
  const ts = d.features[0].properties.timeSeries;
  const at = ts.map(t => Date.parse(t.time));
  const code = t => MO_CODES[t.significantWeatherCode] ?? 3;
  const isDay = t => (MO_NIGHT.has(t.significantWeatherCode) ? 0 : 1);

  // Values already describe the hour ending at their time, like Open-Meteo's.
  const hourly = { time: [], temperature_2m: [], precipitation: [], precipitation_rate: [], precipitation_probability: [], weather_code: [], is_day: [] };
  ts.forEach((t, i) => {
    hourly.time.push(local(at[i]));
    hourly.temperature_2m.push(t.screenTemperature);
    hourly.precipitation.push(t.totalPrecipAmount ?? 0);
    hourly.precipitation_rate.push(t.precipitationRate ?? 0);
    hourly.precipitation_probability.push(t.probOfPrecipitation ?? null);
    hourly.weather_code.push(code(t));
    hourly.is_day.push(isDay(t));
  });

  // "Now" is the latest hour that has started.
  let c = 0;
  while (c + 1 < ts.length && at[c + 1] <= now.getTime()) c++;
  const nowQuarter = Math.floor(now.getTime() / 900e3) * 900e3;
  return {
    current: {
      time: local(Math.max(nowQuarter, at[0])),
      temperature_2m: ts[c].screenTemperature,
      apparent_temperature: ts[c].feelsLikeTemperature ?? ts[c].screenTemperature,
      weather_code: code(ts[c]),
      wind_speed_10m: (ts[c].windSpeed10m ?? 0) * 2.23694,
      is_day: isDay(ts[c]),
      precipitation: ts[c].precipitationRate > 0 ? ts[c].precipitationRate : 0,
    },
    hourly,
    daily: dailyFrom(hourly),
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
  const local = localTime(zone);
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
    daily: dailyFrom(hourly),
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
    // Hourly. Where the forecast also gives the rain rate at each hour (the Met
    // Office does), use it too: a short heavy shower can be a small hourly total.
    step = 3600e3;
    const rate = w.hourly?.precipitation_rate;
    slots = (w.hourly?.time || []).map((t, i) => ({
      end: asMs(t), mm: w.hourly.precipitation?.[i] || 0, rate: rate?.[i] || 0,
    }));
  }
  slots = slots.filter(s => s.end > nowMs && s.end <= nowMs + 12 * 3600e3);
  const wet = s => s.mm > 0 || s.rate > 0;
  const first = slots.findIndex(wet);
  if (first < 0) return null;

  let last = first;
  while (last + 1 < slots.length && wet(slots[last + 1])) last++;
  const run = slots.slice(first, last + 1);
  const start = run[0].end - step;
  const end = run[run.length - 1].end;
  const peak = Math.max(...run.map(s => Math.max(s.mm * (3600e3 / step), s.rate || 0)));
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
