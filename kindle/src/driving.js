// Drive time with live traffic, plus incidents along the route, from TomTom.
// Needs a free TomTom developer key (TOMTOM_KEY), DRIVE_FROM and DRIVE_TO.
import { getJson, parseLatLon } from "./util.js";

const CATEGORY = {
  1: "Accident", 2: "Fog", 3: "Hazard", 4: "Rain", 5: "Ice", 6: "Queue",
  7: "Lane closed", 8: "Road closed", 9: "Roadworks", 10: "Wind",
  11: "Flooding", 14: "Broken down vehicle",
};

export async function getDrive(env) {
  if (!env.TOMTOM_KEY) throw new Error("TOMTOM_KEY is not set");
  const from = parseLatLon(env.DRIVE_FROM, "DRIVE_FROM");
  const to = parseLatLon(env.DRIVE_TO, "DRIVE_TO");
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
    label: env.DRIVE_LABEL || "Drive",
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
