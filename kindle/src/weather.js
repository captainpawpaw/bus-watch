// Weather forecast from Open-Meteo (free, no key needed).
import { getJson, parseLatLon, tz } from "./util.js";

export async function getWeather(env) {
  const { lat, lon } = parseLatLon(env.HOME_LATLON, "HOME_LATLON");
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: tz(env), forecast_days: "2",
    wind_speed_unit: "mph",
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
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
  };
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
