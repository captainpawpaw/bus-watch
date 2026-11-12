// Live bus arrivals from TfL.
//
// BUS_STOPS lists stops separated by ";". Each is a TfL stop ID, optionally
// followed by ":" and the routes to show, e.g. "490000077E:5,145; 490005183E".
import { getJson } from "./util.js";

export function parseStops(text) {
  return String(text || "").split(";").map(s => s.trim()).filter(Boolean).map(s => {
    const [id, routes] = s.split(":");
    return {
      id: id.trim(),
      routes: routes ? routes.split(",").map(r => r.trim().toLowerCase()).filter(Boolean) : [],
    };
  });
}

export async function getBuses(env, now) {
  const stops = parseStops(env.BUS_STOPS);
  if (!stops.length) throw new Error("BUS_STOPS is not set");
  const key = env.TFL_APP_KEY ? `?app_key=${encodeURIComponent(env.TFL_APP_KEY)}` : "";
  const walk = Number(env.BUS_WALK_MINUTES) || 0;

  return Promise.all(stops.map(async stop => {
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

    // The first bus you can still walk to in time.
    const catchable = walk ? wanted.find(a => a.mins >= walk) : null;

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
      leave: catchable ? { route: catchable.route, inMins: catchable.mins - walk } : null,
    };
  }));
}
