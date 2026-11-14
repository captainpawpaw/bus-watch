// Variables used by Scriptable.
// These must be at the very top. Do not edit.
// icon-color: deep-red; icon-glyph: tv;

const FIRE_IP = "192.168.1.122";
// DIAL port. Chromecast uses 8008; if you get "not found" / connection
// errors on a Fire TV, try 8009.
const DIAL_PORT = 8008;
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY";
const REGION = "GB";

const HAS_KEY = YOUTUBE_API_KEY && YOUTUBE_API_KEY !== "YOUR_YOUTUBE_API_KEY";
const DIAL_URL = "http://" + FIRE_IP + ":" + DIAL_PORT + "/apps/YouTube";

// ---------- TV (DIAL) ----------

async function dial(method, path, body) {
  let req = new Request(DIAL_URL + (path || ""));
  req.method = method;
  req.timeoutInterval = 8;
  if (body) {
    req.headers = { "Content-Type": "text/plain; charset=utf-8" };
    req.body = body;
  }
  await req.loadString();
  return req.response.statusCode;
}

async function playOnTV(videoId) {
  try {
    let status = await dial("POST", "", "v=" + encodeURIComponent(videoId));
    if (status >= 200 && status < 300) return "Sent to TV";
    if (status === 404) return "TV has no YouTube app at this address (HTTP 404)";
    return "TV refused the request (HTTP " + status + ")";
  } catch (e) {
    return "Could not reach TV at " + FIRE_IP + ":" + DIAL_PORT + " - " + e.message;
  }
}

async function stopOnTV() {
  try {
    let status = await dial("DELETE", "/run");
    return status >= 200 && status < 300 ? "Stopped" : "Stop failed (HTTP " + status + ")";
  } catch (e) {
    return "Could not reach TV - " + e.message;
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

// ---------- UI ----------

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCards(videos) {
  return videos
    .map((v) => {
      let meta = [v.channel, v.duration].filter(Boolean).map(esc).join(" &bull; ");
      return (
        '<div class="video-card" data-id="' + esc(v.id) + '">' +
        '<img src="' + esc(v.thumb) + '" alt="">' +
        '<div class="video-info">' +
        '<div class="video-title">' + esc(v.title) + "</div>" +
        '<div class="video-meta">' + meta + "</div>" +
        "</div></div>"
      );
    })
    .join("");
}

function generateHTML(feed) {
  let note = feed.note ? '<div class="note">' + esc(feed.note) + "</div>" : "";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    background-color: #0f0f0f; color: #fff; margin: 0;
    padding: 16px 16px 80px;
    font-family: -apple-system, system-ui, sans-serif;
  }
  h1 { font-size: 20px; margin: 4px 0 14px; }
  h2 { font-size: 15px; color: #aaa; margin: 22px 0 10px; font-weight: 600; }
  .row { display: flex; gap: 8px; }
  input {
    flex: 1; min-width: 0; background: #222; color: #fff; border: 1px solid #333;
    border-radius: 10px; padding: 12px; font-size: 16px;
  }
  button {
    border: 0; border-radius: 10px; padding: 12px 16px; font-size: 16px;
    font-weight: 600; color: #fff; background: #c00;
  }
  button.secondary { background: #333; }
  button:active, .video-card:active { opacity: 0.6; }
  .video-card { margin-bottom: 18px; }
  .video-card img {
    width: 100%; aspect-ratio: 16 / 9; object-fit: cover;
    border-radius: 12px; background: #222; display: block;
  }
  .video-info { padding: 8px 2px 0; }
  .video-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
  .video-meta { font-size: 13px; color: #aaa; margin-top: 3px; }
  .note { color: #aaa; font-size: 14px; padding: 8px 0; }
  #status {
    position: fixed; left: 16px; right: 16px; bottom: 20px;
    background: #2a2a2a; border-radius: 12px; padding: 12px 14px;
    font-size: 14px; display: none;
  }
</style>
</head>
<body>
  <h1>YouTube to TV</h1>
  <div class="row">
    <input id="link" placeholder="Paste YouTube link or video ID" autocapitalize="off" autocorrect="off">
    <button id="cast">Cast</button>
    <button id="stop" class="secondary">Stop</button>
  </div>
  <h2>Popular</h2>
  ${note}
  <div id="feed">${renderCards(feed.videos)}</div>
  <div id="status"></div>
<script>
  // Commands queue up here; the Scriptable side collects them one at a time.
  var queue = [];
  var waiter = null;
  function send(cmd) {
    if (waiter) { var w = waiter; waiter = null; w(cmd); }
    else { queue.push(cmd); }
  }
  var statusTimer = null;
  function showStatus(text) {
    var el = document.getElementById("status");
    el.textContent = text;
    el.style.display = "block";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.style.display = "none"; }, 4000);
  }
  function parseId(text) {
    text = (text || "").trim();
    var m = /(?:[?&]v=|youtu\\.be\\/|\\/shorts\\/|\\/embed\\/|\\/live\\/)([\\w-]{11})/.exec(text);
    if (m) return m[1];
    return /^[\\w-]{11}$/.test(text) ? text : null;
  }
  document.getElementById("feed").addEventListener("click", function (e) {
    var card = e.target.closest(".video-card");
    if (!card) return;
    showStatus("Sending...");
    send({ action: "play", id: card.getAttribute("data-id") });
  });
  document.getElementById("cast").addEventListener("click", function () {
    var id = parseId(document.getElementById("link").value);
    if (!id) { showStatus("That doesn't look like a YouTube link or ID"); return; }
    showStatus("Sending...");
    send({ action: "play", id: id });
  });
  document.getElementById("stop").addEventListener("click", function () {
    showStatus("Stopping...");
    send({ action: "stop" });
  });
</script>
</body>
</html>`;
}

// ---------- Main ----------

async function main() {
  let feed = await fetchPopular();
  let wv = new WebView();
  await wv.loadHTML(generateHTML(feed));

  // Resolves when the user closes the web view.
  let closed = wv.present(true).then(() => null);

  while (true) {
    let next = wv.evaluateJavaScript(
      "if (queue.length) { completion(queue.shift()); } else { waiter = completion; }",
      true
    );
    let cmd = await Promise.race([closed, next]);
    if (!cmd) break;

    let message;
    if (cmd.action === "play") message = await playOnTV(cmd.id);
    else if (cmd.action === "stop") message = await stopOnTV();
    else message = "Unknown action";

    console.log(cmd.action + (cmd.id ? " " + cmd.id : "") + ": " + message);
    try {
      await wv.evaluateJavaScript("showStatus(" + JSON.stringify(message) + "); null");
    } catch (e) {
      break; // web view was closed mid-command
    }
  }
}

await main();
Script.complete();
