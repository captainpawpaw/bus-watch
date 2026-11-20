// Live bus arrivals from TfL.
//
// BUS_STOPS lists stops separated by ";". Each is a TfL stop ID, optionally
// followed by ":" and the routes to show, and "@" and your walk to it in minutes,
// then optionally the days and hours to show it,
// e.g. "490008458N:62@7; 490008457S:368@12 Sat-Sun 08:00-10:00".
// Without "@", BUS_WALK_MINUTES is used. Stops without their own hours follow
// BUS_HOURS (or always show, if that isn't set).
import { getJson } from "./util.js";
import { inWindow } from "./driving.js";

export function parseStops(text) {
  // Forgiving: stray spaces, underscores or quotes around an ID are ignored,
  // and stops can also be on separate lines.
  const clean = t => t.replace(/[^0-9A-Za-z]/g, "");
  return String(text || "").split(/[;\n]/).map(s => s.trim()).filter(Boolean).map(s => {
    const [main, after = ""] = s.split("@");
    const [id, routes] = main.split(":");
    // After "@": the walk in minutes, then optionally "days times".
    const m = after.trim().match(/^([\d.]+)\s*(.*)$/);
    const mins = m ? parseFloat(m[1]) : NaN;
    return {
      id: clean(id).toUpperCase(),
      routes: routes ? routes.split(",").map(r => clean(r).toLowerCase()).filter(Boolean) : [],
      walk: Number.isFinite(mins) ? mins : null,
      hours: m && m[2].trim() ? m[2].trim() : null,
    };
  }).filter(s => s.id);
}

// Whether a stop is shown now: its own hours, else BUS_HOURS, else always.
export function stopShown(stop, env, now = new Date()) {
  if (stop.hours) return inWindow(stop.hours, env, now);
  return !env.BUS_HOURS || inWindow(env.BUS_HOURS, env, now);
}

export async function getBuses(env, now) {
  if (!parseStops(env.BUS_STOPS).length) throw new Error("BUS_STOPS is not set");
  const stops = parseStops(env.BUS_STOPS).filter(s => stopShown(s, env, now));
  const key = env.TFL_APP_KEY ? `?app_key=${encodeURIComponent(env.TFL_APP_KEY)}` : "";
  const walk = Number(env.BUS_WALK_MINUTES) || 0;

  return Promise.all(stops.map(stop => getStop(stop, key, stop.walk ?? walk, now).catch(error => ({
    // One bad stop shouldn't hide the others.
    name: stop.id, letter: "", routes: [], leave: null,
    error: /\b404\b/.test(error.message) ? "stop ID not found, check it in BUS_STOPS" : error.message,
  }))));
}

async function getStop(stop, key, walk, now) {
  const arrivals = await getJson(
    `https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stop.id)}/Arrivals${key}`,
    { headers: { "cache-control": "no-cache" } });
  const wanted = arrivals
    .filter(a => !stop.routes.length || stop.routes.includes(String(a.lineName).toLowerCase()))
    .map(a => ({
      route: a.lineName,
      towards: a.destinationName || a.towards || "",
      at: new Date(a.expectedArrival),
      mins: Math.max(0, Math.floor((new Date(a.expectedArrival) - now) / 60000)),
    }))
    .sort((a, b) => a.at - b.at);

  // Group by route, keeping each route's next three buses.
  const byRoute = new Map();
  for (const a of wanted) {
    if (!byRoute.has(a.route)) byRoute.set(a.route, []);
    const list = byRoute.get(a.route);
    if (list.length < 3) list.push(a);
  }
  const routes = [...byRoute.entries()]
    .map(([route, buses]) => ({ route, towards: buses[0].towards, buses }))
    .sort((a, b) => a.buses[0].at - b.buses[0].at);

  // The first bus you can still walk to in time, and when to set off for it.
  const catchable = walk ? wanted.find(a => a.at - now >= walk * 60000) : null;
  const leaveAt = catchable ? new Date(catchable.at.getTime() - walk * 60000) : null;

  let name = arrivals[0]?.stationName;
  let letter = arrivals[0]?.platformName;
  if (!name) {
    // Nothing due (e.g. overnight), so look the stop's name up instead.
    try {
      const info = await getJson(`https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stop.id)}${key}`);
      const me = (info.children || []).find(c => c.naptanId === stop.id) || info;
      name = info.commonName;
      letter = me.stopLetter || (me.indicator || "").replace(/^Stop\s+/i, "");
    } catch { /* fall back to the ID */ }
  }
  return {
    name: name || stop.id,
    letter: letter && letter !== "null" ? letter : "",
    routes,
    leave: catchable ? {
      route: catchable.route,
      at: leaveAt,
      busAt: catchable.at,
      busMins: catchable.mins,
      inMins: Math.floor((leaveAt - now) / 60000),
    } : null,
  };
}
