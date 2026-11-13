// A small map of the drive: TomTom's street map as a faded background, with the
// route, start, destination and incidents drawn on top by the renderer.
//
// Uses the standard web map projection (256-pixel tiles), so we can work out
// exactly where each point of the route falls on TomTom's picture.
import { Buffer } from "node:buffer";

export const MAP_W = 240;
export const MAP_H = 132;
const PAD = 12;

const mercX = lon => (lon + 180) / 360 * 256;
const mercY = lat => {
  const s = Math.sin(lat * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};
const unMercY = y => {
  const n = Math.PI - 2 * Math.PI * y / 256;
  return 180 / Math.PI * Math.atan(Math.sinh(n));
};

// The background only depends on where the route is, so keep it while warm.
const images = new Map();

async function backgroundImage(key, centre, zoom) {
  const id = `${centre.lat.toFixed(5)},${centre.lon.toFixed(5)},${zoom}`;
  if (images.has(id)) return images.get(id);
  const q = new URLSearchParams({
    key, zoom: String(zoom), center: `${centre.lon},${centre.lat}`,
    width: String(MAP_W), height: String(MAP_H),
    format: "png", layer: "basic", style: "main", view: "Unified", language: "en-GB",
  });
  const res = await fetch(`https://api.tomtom.com/map/1/staticimage?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`map image ${res.status}`);
  const uri = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  if (images.size > 20) images.clear();
  images.set(id, uri);
  return uri;
}

// points: [{latitude, longitude}], incidents: [{at: [lon, lat]}]
// Returns pixel positions within a MAP_W x MAP_H box, plus the background
// (null if it couldn't be fetched; the route is still drawn).
export async function buildMap(key, points, incidents = []) {
  if (!points.length) return null;
  const xs = points.map(p => mercX(p.longitude));
  const ys = points.map(p => mercY(p.latitude));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // The closest whole zoom level where the whole route fits.
  const fit = Math.min((MAP_W - 2 * PAD) / Math.max(maxX - minX, 1e-9),
    (MAP_H - 2 * PAD) / Math.max(maxY - minY, 1e-9));
  const zoom = Math.max(1, Math.min(17, Math.floor(Math.log2(fit))));
  const scale = 2 ** zoom;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const centre = { lon: cx / 256 * 360 - 180, lat: unMercY(cy) };

  const toPx = (lon, lat) => [
    Math.round(((mercX(lon) - cx) * scale + MAP_W / 2) * 10) / 10,
    Math.round(((mercY(lat) - cy) * scale + MAP_H / 2) * 10) / 10,
  ];

  // Route as pixels, skipping points less than a pixel apart.
  const line = [];
  for (const p of points) {
    const xy = toPx(p.longitude, p.latitude);
    const last = line[line.length - 1];
    if (!last || Math.abs(last[0] - xy[0]) + Math.abs(last[1] - xy[1]) >= 1) line.push(xy);
  }
  const inside = ([x, y]) => x >= 4 && y >= 4 && x <= MAP_W - 4 && y <= MAP_H - 4;
  const marks = incidents.filter(i => i.at).map(i => toPx(i.at[0], i.at[1])).filter(inside);

  let image = null;
  try {
    image = await backgroundImage(key, centre, zoom);
  } catch {
    // Draw the route on its own rather than lose the map entirely.
  }
  return { w: MAP_W, h: MAP_H, image, line, start: line[0], end: line[line.length - 1], marks };
}
