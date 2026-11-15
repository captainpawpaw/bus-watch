// Variables used by Scriptable.
// These must be at the very top. Do not edit.
// icon-color: deep-red; icon-glyph: tv;

const FIRE_IP = "192.168.1.122";
// DIAL ports to try, in order. Chromecast uses 8008, Fire TV usually 8009.
const DIAL_PORTS = [8008, 8009];
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY";
const REGION = "GB";

const HAS_KEY = YOUTUBE_API_KEY && YOUTUBE_API_KEY !== "YOUR_YOUTUBE_API_KEY";

// ---------- TV (DIAL) ----------

// Tries each port until one accepts a connection, then keeps using that one.
async function dial(method, path, body) {
  let lastError;
  for (let port of DIAL_PORTS.slice()) {
    let req = new Request("http://" + FIRE_IP + ":" + port + "/apps/YouTube" + (path || ""));
    req.method = method;
    req.timeoutInterval = 5;
    if (body) {
      req.headers = { "Content-Type": "text/plain; charset=utf-8" };
      req.body = body;
    }
    try {
      await req.loadString();
    } catch (e) {
      lastError = e;
      continue;
    }
    DIAL_PORTS.splice(DIAL_PORTS.indexOf(port), 1);
    DIAL_PORTS.unshift(port);
    return req.response.statusCode;
  }
  throw lastError;
}

function unreachable(e) {
  return "Could not reach TV at " + FIRE_IP + " (ports " + DIAL_PORTS.join(", ") + ") - " + e.message;
}

async function playOnTV(videoId) {
  try {
    let status = await dial("POST", "", "v=" + encodeURIComponent(videoId));
    if (status >= 200 && status < 300) return "Sent to TV";
    if (status === 404) return "TV has no YouTube app at this address (HTTP 404)";
    return "TV refused the request (HTTP " + status + ")";
  } catch (e) {
    return unreachable(e);
  }
}

async function stopOnTV() {
  try {
    let status = await dial("DELETE", "/run");
    return status >= 200 && status < 300 ? "Stopped" : "Stop failed (HTTP " + status + ")";
  } catch (e) {
    return unreachable(e);
  }
}

// ---------- YouTube Data API ----------

// "PT1H2M3S" -> "1:02:03"
function formatDuration(iso) {
  let m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return "";
  let h = Number(m[1] || 0) * 24 + Number(m[2] || 0);
  let min = Number(m[3] || 0);
  let s = Number(m[4] || 0);
  let pad = (n) => (n < 10 ? "0" + n : "" + n);
  return h > 0 ? h + ":" + pad(min) + ":" + pad(s) : min + ":" + pad(s);
}

async function fetchPopular() {
  if (!HAS_KEY) return { videos: [], note: "Add a YouTube API key to see popular videos." };
  let url =
    "https://www.googleapis.com/youtube/v3/videos" +
    "?part=snippet,contentDetails&chart=mostPopular&maxResults=12" +
    "&regionCode=" + REGION +
    "&key=" + encodeURIComponent(YOUTUBE_API_KEY);
  try {
    let res = await new Request(url).loadJSON();
    if (res.error) return { videos: [], note: "YouTube API: " + res.error.message };
    let videos = (res.items || []).map((item) => {
      let t = item.snippet.thumbnails || {};
      return {
        id: item.id,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumb: (t.medium || t.high || t.default || {}).url || "",
        duration: formatDuration(item.contentDetails && item.contentDetails.duration)
      };
    });
    return { videos: videos, note: videos.length ? "" : "No videos returned." };
  } catch (e) {
    return { videos: [], note: "Could not load videos - " + e.message };
  }
}

// ---------- UI (native table) ----------

// Accepts a watch/share/shorts/embed/live link or a bare 11-character ID.
function parseId(text) {
  text = (text || "").trim();
  let m = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(text);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(text) ? text : null;
}

async function askForLink() {
  let alert = new Alert();
  alert.title = "Cast a video";
  alert.message = "Paste a YouTube link or video ID";
  let clip = Pasteboard.pasteString() || "";
  alert.addTextField("Link or ID", parseId(clip) ? clip : "");
  alert.addAction("Cast");
  alert.addCancelAction("Cancel");
  if ((await alert.presentAlert()) === -1) return undefined;
  return parseId(alert.textFieldValue(0));
}

function actionRow(title, subtitle, onSelect) {
  let row = new UITableRow();
  row.height = 56;
  row.dismissOnSelect = false;
  let cell = row.addText(title, subtitle);
  cell.titleFont = Font.semiboldSystemFont(16);
  cell.subtitleFont = Font.systemFont(13);
  cell.subtitleColor = Color.gray();
  row.onSelect = onSelect;
  return row;
}

function textRow(text, color) {
  let row = new UITableRow();
  row.height = 44;
  let cell = row.addText(text);
  cell.titleFont = Font.systemFont(14);
  cell.titleColor = color;
  return row;
}

function videoRow(v, onSelect) {
  let row = new UITableRow();
  row.height = 84;
  row.cellSpacing = 12;
  row.dismissOnSelect = false;
  if (v.thumb) {
    let img = row.addImageAtURL(v.thumb);
    img.widthWeight = 32;
  }
  let meta = [v.channel, v.duration].filter(Boolean).join(" • ");
  let cell = row.addText(v.title, meta);
  cell.widthWeight = 68;
  cell.titleFont = Font.semiboldSystemFont(15);
  cell.subtitleFont = Font.systemFont(13);
  cell.subtitleColor = Color.gray();
  row.onSelect = onSelect;
  return row;
}

// ---------- Main ----------

async function main() {
  let feed = await fetchPopular();
  let table = new UITable();
  table.showSeparators = true;
  let status = "Tap a video to play it on the TV";

  let run = async (label, job) => {
    status = label;
    draw();
    status = await job();
    console.log(status);
    draw();
  };

  function draw() {
    table.removeAllRows();
    table.addRow(textRow(status, Color.red()));
    table.addRow(
      actionRow("Cast a link…", "Paste a YouTube link or video ID", async () => {
        let id = await askForLink();
        if (id === undefined) return;
        if (!id) {
          status = "That doesn't look like a YouTube link or ID";
          draw();
          return;
        }
        await run("Sending…", () => playOnTV(id));
      })
    );
    table.addRow(
      actionRow("Stop", "Close YouTube on the TV", () => run("Stopping…", stopOnTV))
    );
    if (feed.note) table.addRow(textRow(feed.note, Color.gray()));
    for (let v of feed.videos) {
      table.addRow(videoRow(v, () => run("Sending: " + v.title, () => playOnTV(v.id))));
    }
    table.reload();
  }

  draw();
  await table.present(true);
}

await main();
Script.complete();
