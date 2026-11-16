// YouTube Remote for Scriptable (iPhone) — controls the YouTube app on a Fire TV Stick (or any TV).
// Run it in the Scriptable app. YouTube must be open on the TV.
// First run: on the TV open YouTube > Settings > "Link with TV code", then type that code here.
// Optional: sign in to YouTube (gear button) to see your own suggestions and subscriptions.
// Tap any video in For you / Subs / History / Search to play it on the TV.
// The volume bar and power button control the Panasonic TV itself (same address as the TV Remote script).
// START turns the TV on and opens YouTube on the Fire Stick (needs the Fire Stick address, gear button).

const fm = FileManager.local();
const CFG_PATH = fm.joinPath(fm.documentsDirectory(), "youtube-remote-config.json");
const readCfg = () => { try { return fm.fileExists(CFG_PATH) ? JSON.parse(fm.readString(CFG_PATH)) : {}; } catch (e) { return {}; } };

// Volume and mute go straight to the Panasonic TV, at the address the TV Remote script uses.
const TV_DEFAULT_IP = "192.168.1.222";
function tvIP() {
  try {
    const p = fm.joinPath(fm.documentsDirectory(), "tv-remote-config.json");
    const ip = fm.fileExists(p) ? JSON.parse(fm.readString(p)).ip : "";
    if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip || "")) return ip;
  } catch (e) {}
  return TV_DEFAULT_IP;
}
async function tvKey(key) {
  const ip = tvIP();
  const req = new Request("http://" + ip + ":55000/nrc/control_0");
  req.method = "POST";
  req.timeoutInterval = 4;
  req.headers = {
    "Content-Type": 'text/xml; charset="utf-8"',
    "SOAPACTION": '"urn:panasonic-com:service:p00NetworkControl:1#X_SendKey"',
  };
  req.body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body><u:X_SendKey xmlns:u="urn:panasonic-com:service:p00NetworkControl:1">' +
    "<X_KeyEvent>NRC_" + key + "-ONOFF</X_KeyEvent>" +
    "</u:X_SendKey></s:Body></s:Envelope>";
  try { await req.loadString(); } catch (e) { return "Can't reach the TV at " + ip + " for volume"; }
  const code = req.response && req.response.statusCode;
  return code && code !== 200 ? "TV refused the volume change (" + code + ")" : "";
}

// Is the TV on? It answers a simple question when on, refuses it in standby, and is silent when fully off.
async function tvState(ip) {
  const req = new Request("http://" + ip + ":55000/dmr/control_0");
  req.method = "POST";
  req.timeoutInterval = 3;
  req.headers = {
    "Content-Type": 'text/xml; charset="utf-8"',
    "SOAPACTION": '"urn:schemas-upnp-org:service:RenderingControl:1#GetMute"',
  };
  req.body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body><u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">' +
    "<InstanceID>0</InstanceID><Channel>Master</Channel>" +
    "</u:GetMute></s:Body></s:Envelope>";
  try { await req.loadString(); } catch (e) { return "off"; }
  return req.response && req.response.statusCode === 200 ? "on" : "standby";
}

// Turn the TV on if it is in standby, then ask the Fire Stick to open YouTube (and play a video, if one was chosen).
async function wake(fire, video) {
  if ((await tvState(tvIP())) === "standby") await tvKey("POWER");
  if (!/^(\d{1,3})(\.\d{1,3}){3}$/.test(fire || "")) return "Add the Fire Stick's address in settings (gear) so I can open YouTube on it";
  const req = new Request("http://" + fire + ":8009/apps/YouTube");
  req.method = "POST";
  req.timeoutInterval = 6;
  req.headers = { "Content-Type": "text/plain", "Origin": "https://www.youtube.com" };
  req.body = /^[\w-]{11}$/.test(video || "") ? "v=" + video : "";
  try { await req.loadString(); } catch (e) { return "Can't reach the Fire Stick at " + fire; }
  const code = req.response && req.response.statusCode;
  return code && code >= 300 ? "The Fire Stick would not open YouTube (" + code + ")" : "";
}

// Waits inside the page for the next thing it wants done on the home network, then hands it back to this script.
const NEXT_TV_KEY = `(() => {
  if (window.tvq && tvq.length) { completion(tvq.shift()); return; }
  window.addEventListener("tvkey", () => completion(tvq.shift()), { once: true });
})()`;
async function relayVolume(wv, state) {
  while (state.open) {
    let msg;
    try { msg = JSON.parse(await wv.evaluateJavaScript(NEXT_TV_KEY, true)); } catch (e) { return; }
    if (!state.open || !msg) continue;
    let err = "";
    if (msg.t === "tv" && /^(VOLUP|VOLDOWN|MUTE|POWER)$/.test(msg.key || "")) err = await tvKey(msg.key);
    else if (msg.t === "wake") err = await wake(msg.fire, msg.v);
    if (err && state.open) { try { await wv.evaluateJavaScript("toast(" + JSON.stringify(err) + "); 1"); } catch (e) {} }
  }
}

// The page is loaded as if it came from YouTube, so it can talk to YouTube directly.
const ORIGIN = "https://m.youtube.com/";

const HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<title>YT Remote</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  :root { --bg:#0f0f0f; --key:#222326; --key2:#33353a; --fg:#f2f1ee; --muted:#9a9ea8; --accent:#ff3d33; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-touch-callout:none; user-select:none; -webkit-user-select:none; }
  html,body { margin:0; background:var(--bg); color:var(--fg); font:600 17px -apple-system,system-ui,sans-serif; }
  body { padding:max(60px, calc(env(safe-area-inset-top) + 10px)) 16px calc(8px + env(safe-area-inset-bottom)); max-width:440px; margin:0 auto; }
  button { font:inherit; color:var(--fg); background:var(--key); border:0; border-radius:16px; height:56px; padding:0;
           display:flex; align-items:center; justify-content:center; touch-action:manipulation; }
  button:active, button.down { background:var(--key2); transform:scale(.96); }
  button small { font-size:13px; color:var(--muted); font-weight:600; letter-spacing:.04em; }

  nav { display:flex; gap:6px; align-items:center; }
  nav { gap:2px; }
  nav button { flex:1 1 auto; height:38px; padding:0 9px; border-radius:19px; font-size:13px; white-space:nowrap; color:var(--muted); background:transparent; }
  nav button.on { background:var(--fg); color:var(--bg); }
  nav .gear { flex:none; width:40px; background:var(--key); color:var(--fg); }
  #status { margin:8px 2px 0; font-size:12px; font-weight:500; color:var(--muted); min-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #status.bad { color:#ff8a82; }

  .view { display:none; } .view.on { display:block; }

  /* Now playing */
  #now { display:flex; gap:10px; align-items:center; margin-top:10px; background:var(--key); border-radius:16px; padding:8px; min-height:66px; }
  #now img { width:72px; height:41px; border-radius:8px; object-fit:cover; background:#000; flex:none; }
  #now div { min-width:0; flex:1; }
  #now b { display:block; font-size:14px; line-height:1.25; max-height:2.5em; overflow:hidden; }
  #now span { font-size:12px; color:var(--muted); font-weight:500; }
  #now button { width:46px; height:46px; border-radius:50%; flex:none; background:var(--key2); font-size:20px; }
  #now .pw { background:var(--accent); }
  #now button small { font-size:10px; color:var(--fg); }
  #bar { margin-top:6px; height:40px; display:flex; align-items:center; position:relative; touch-action:none; }
  #bar i { display:block; flex:1; height:10px; border-radius:5px; background:var(--key2); position:relative; overflow:hidden; pointer-events:none; }
  #knob { position:absolute; top:50%; left:0; width:22px; height:22px; margin:-11px 0 0 -11px; border-radius:50%; background:var(--fg); pointer-events:none; display:none; }
  #bar.drag #knob { width:30px; height:30px; margin:-15px 0 0 -15px; }
  #times { display:flex; justify-content:space-between; margin-top:-6px; font-size:12px; font-weight:500; color:var(--muted); min-height:15px; }
  #bar i u { position:absolute; left:0; top:0; bottom:0; width:0; background:var(--accent); }

  /* The main controls: play/pause biggest, skip either side */
  .main { display:grid; grid-template-columns:1fr 132px 1fr; gap:12px; align-items:center; margin-top:8px; }
  .main button { height:68px; border-radius:20px; flex-direction:column; gap:0; font-size:22px; }
  .main button small { font-size:12px; }
  .main .pp { height:132px; border-radius:50%; background:var(--accent); font-size:54px; }
  .main .pp:active, .main .pp.down { background:#d93a2f; }
  .row { display:grid; gap:10px; margin-top:12px; }
  .c4 { grid-template-columns:repeat(4,1fr); }
  .row button { font-size:18px; height:44px; }
  .vol { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; margin-top:12px; background:var(--fg); border-radius:18px; }
  .vol button { background:transparent; color:var(--bg); font-size:34px; font-weight:500; height:50px; }
  .vol button:active, .vol button.down { background:#d4d2cc; }
  .vol .mute { color:#5a5e68; font-size:13px; font-weight:700; padding:0 14px; letter-spacing:.04em; }
  .nav { display:grid; grid-template-columns:1fr 200px 1fr; gap:8px; align-items:center; margin-top:12px; }
  .nav > button { height:76px; }
  .nav > button small { font-size:12px; line-height:1.3; }
  .pad { width:200px; height:200px; display:grid; grid-template:repeat(3,1fr)/repeat(3,1fr); background:var(--key); border-radius:50%; padding:4px; }
  .pad button { background:transparent; height:auto; font-size:26px; border-radius:50%; }
  .pad button:active, .pad button.down { background:var(--key2); }
  .pad .ok { background:var(--key2); font-size:18px; }

  /* Video lists */
  .search { display:flex; gap:8px; margin-top:10px; }
  input { flex:1; min-width:0; height:44px; border-radius:12px; border:0; background:var(--key); color:var(--fg); font:inherit; font-weight:500; padding:0 12px;
          user-select:text; -webkit-user-select:text; }
  .search button, .set button { height:44px; padding:0 16px; font-size:15px; background:var(--accent); border-radius:12px; flex:none; }
  .list { margin-top:10px; padding-bottom:84px; }
  .msg { color:var(--muted); font-size:14px; font-weight:500; padding:24px 6px; text-align:center; line-height:1.4; }
  .vid { display:flex; gap:10px; align-items:center; padding:8px 0; }
  .vid .th { position:relative; width:132px; height:74px; border-radius:10px; overflow:hidden; background:var(--key); flex:none; }
  .vid img { width:100%; height:100%; object-fit:cover; display:block; }
  .vid em { position:absolute; right:4px; bottom:6px; background:rgba(0,0,0,.82); color:#fff; font-style:normal; font-size:11px; font-weight:600; padding:1px 5px; border-radius:5px; }
  .vid strong { position:absolute; left:4px; top:4px; background:rgba(0,0,0,.82); color:#fff; font-size:10px; font-weight:700; letter-spacing:.04em; padding:2px 5px; border-radius:5px; }
  .vid .th i { position:absolute; left:0; right:0; bottom:0; height:4px; background:rgba(255,255,255,.35); }
  .vid .th u { display:block; height:100%; background:var(--accent); }
  .vid.watched img { opacity:.45; }
  .vid.watched b { color:var(--muted); }
  .vid .tx { flex:1; min-width:0; }
  .vid b { display:block; font-size:14px; line-height:1.25; max-height:2.5em; overflow:hidden; }
  .vid span { display:block; margin-top:3px; font-size:12px; color:var(--muted); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .vid button { width:40px; height:40px; border-radius:50%; font-size:20px; flex:none; }
  .vid.sent b { color:var(--accent); }
  .morebtn { width:100%; height:48px; margin-top:8px; font-size:15px; color:var(--muted); }

  /* Small controls that stay on screen while browsing */
  #mini { position:fixed; left:0; right:0; bottom:0; padding:8px 16px calc(8px + env(safe-area-inset-bottom)); background:rgba(15,15,15,.94);
          display:none; grid-template-columns:1fr 1.4fr 1fr; gap:10px; max-width:440px; margin:0 auto; }
  #mini.on { display:grid; }
  #mini button { height:52px; font-size:20px; }
  #mini .pp { background:var(--accent); font-size:26px; }

  .set { background:var(--key); border-radius:16px; padding:12px; margin-top:10px; }
  .set p { margin:0 0 8px; font-size:13px; color:var(--muted); font-weight:500; line-height:1.35; }
  .set div { display:flex; gap:8px; }
  .set input { background:var(--bg); }
  .set .wide { width:100%; background:var(--key2); }

  #toast { position:fixed; left:50%; bottom:calc(84px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:#3a1512; color:#ffb4ad;
           padding:10px 16px; border-radius:12px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; max-width:90%; text-align:center; }
  #toast.show { opacity:1; }
</style></head><body>

<nav>
  <button data-tab="remote" class="on">Remote</button>
  <button data-tab="home">For you</button>
  <button data-tab="subs">Subs</button>
  <button data-tab="hist">History</button>
  <button data-tab="search">Search</button>
  <button data-tab="set" class="gear" aria-label="Settings">⚙︎</button>
</nav>
<div id="status"></div>

<div class="view on" id="v-remote">
  <div id="now"><img id="nowimg" alt=""><div><b id="nowtitle">Nothing playing</b><span id="nowtime"></span></div>
    <button data-a="startyt" aria-label="Turn on the TV and open YouTube"><small>START</small></button>
    <button class="pw" data-a="power" aria-label="TV power">⏻</button></div>
  <div id="bar"><i><u id="fill"></u></i><b id="knob"></b></div>
  <div id="times"><span id="tnow"></span><span id="tleft"></span></div>

  <div class="main">
    <button data-a="back10" data-r aria-label="Back 10 seconds">⏪︎<small>10</small></button>
    <button class="pp" data-a="pp" aria-label="Play or pause">⏯︎</button>
    <button data-a="fwd10" data-r aria-label="Forward 10 seconds">⏩︎<small>10</small></button>
  </div>

  <div class="row c4">
    <button data-a="back5m" aria-label="Back 5 minutes"><small>−5 MIN</small></button>
    <button data-a="prev" aria-label="Previous video">⏮︎</button>
    <button data-a="next" aria-label="Next video">⏭︎</button>
    <button data-a="fwd5m" aria-label="Forward 5 minutes"><small>+5 MIN</small></button>
  </div>

  <div class="vol">
    <button data-a="voldown" data-r aria-label="Volume down">−</button>
    <button data-a="mute" class="mute">MUTE</button>
    <button data-a="volup" data-r aria-label="Volume up">+</button>
  </div>

  <div class="nav">
    <button data-a="dBACK"><small>BACK</small></button>
    <div class="pad">
      <span></span><button data-a="dUP" data-r aria-label="Up">▲</button><span></span>
      <button data-a="dLEFT" data-r aria-label="Left">◀</button><button class="ok" data-a="dENTER">OK</button><button data-a="dRIGHT" data-r aria-label="Right">▶</button>
      <span></span><button data-a="dDOWN" data-r aria-label="Down">▼</button><span></span>
    </div>
    <button data-a="skipad"><small>SKIP<br>AD</small></button>
  </div>
</div>

<div class="view" id="v-home"><div class="list" id="l-home"></div></div>
<div class="view" id="v-subs"><div class="list" id="l-subs"></div></div>
<div class="view" id="v-hist"><div class="list" id="l-hist"></div></div>
<div class="view" id="v-search">
  <div class="search"><input id="q" placeholder="Search YouTube" autocomplete="off" enterkeyhint="search"><button id="go">Search</button></div>
  <div class="list" id="l-search"></div>
</div>

<div class="view" id="v-set">
  <div class="set">
    <p id="linkmsg">On the TV: open YouTube, go to Settings, then "Link with TV code". Type the code here.</p>
    <div><input id="code" inputmode="numeric" placeholder="TV code" autocomplete="off"><button id="link">Link</button></div>
  </div>
  <div class="set">
    <p id="firemsg">Fire Stick address, so START can open YouTube on it. On the Fire Stick: Settings &gt; My Fire TV &gt; About &gt; Network.</p>
    <div><input id="fire" inputmode="decimal" placeholder="192.168.1.x" autocomplete="off"><button id="firesave">Save</button></div>
  </div>
  <div class="set">
    <p id="signmsg">Sign in to YouTube to see your own suggestions and subscriptions. When you have signed in, tap Close (top left) and the remote reopens.</p>
    <button class="wide" id="signin">Sign in to YouTube</button>
  </div>
</div>

<div id="mini">
  <button data-a="back10" data-r aria-label="Back 10 seconds">⏪︎</button>
  <button class="pp" data-a="pp" aria-label="Play or pause">⏯︎</button>
  <button data-a="fwd10" data-r aria-label="Forward 10 seconds">⏩︎</button>
</div>
<div id="toast"></div>

<script>
  var CFG = __CFG__;
  try { if (!CFG.screenId) { var saved = JSON.parse(localStorage.getItem("ytRemoteCfg") || "{}"); if (saved.screenId) CFG = saved; } } catch (e) {}
  if (!CFG.deviceId) CFG.deviceId = "r" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  function saveCfg() { try { localStorage.setItem("ytRemoteCfg", JSON.stringify(CFG)); } catch (e) {} }
  saveCfg();

  var $ = function (id) { return document.getElementById(id); };
  var toastT;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 3000);
  }
  function status(msg, bad) { var s = $("status"); s.textContent = msg; s.className = bad ? "bad" : ""; }

  /* ===================== TALKING TO THE TV (through YouTube) ===================== */

  var API = "/api/lounge";
  var token = "", SID = "", GS = "", rid = 1, ofs = 0, aid = 0, linked = false, listenCtl = null, screenOn = true;
  var st = { time: 0, dur: 0, state: 0, at: Date.now(), vol: null, id: "", title: "", ad: false, canSkip: false, wantSkip: false, adSeen: false };
  var titles = {};

  function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); }
  function post(url, data, headers) {
    var h = { "Content-Type": "application/x-www-form-urlencoded" };
    for (var k in headers || {}) h[k] = headers[k];
    return fetch(url, { method: "POST", headers: h, body: form(data) });
  }

  async function pair(code) {
    var r = await post(API + "/pairing/get_screen", { pairing_code: code });
    if (!r.ok) throw new Error("code");
    var j = await r.json();
    CFG.screenId = j.screen.screenId; CFG.screenName = j.screen.name || "TV";
    token = j.screen.loungeToken; saveCfg();
  }
  async function refreshToken() {
    var r = await post(API + "/pairing/get_lounge_token_batch", { screen_ids: CFG.screenId });
    if (!r.ok) throw new Error("token");
    var j = await r.json();
    token = j.screens[0].loungeToken;
  }

  // YouTube replies in pieces: a length, a newline, then that many bytes of JSON.
  function makeParser(onEvent) {
    var buf = new Uint8Array(0), dec = new TextDecoder();
    return function (bytes) {
      var n = new Uint8Array(buf.length + bytes.length); n.set(buf); n.set(bytes, buf.length); buf = n;
      for (;;) {
        var nl = buf.indexOf(10); if (nl < 0) return;
        var len = parseInt(dec.decode(buf.subarray(0, nl)), 10);
        if (isNaN(len)) { buf = buf.subarray(nl + 1); continue; }
        if (buf.length < nl + 1 + len) return;
        var chunk = dec.decode(buf.subarray(nl + 1, nl + 1 + len)); buf = buf.subarray(nl + 1 + len);
        try { JSON.parse(chunk).forEach(function (e) { aid = e[0]; onEvent(e[1][0], e[1][1], e[1]); }); } catch (e) {}
      }
    };
  }

  function onEvent(name, arg, all) {
    if (name === "c") SID = arg;
    else if (name === "S") GS = arg;
    else if (name === "nowPlaying" || name === "onStateChange") {
      if (arg.videoId !== undefined) { st.id = arg.videoId; st.title = titles[st.id] || ""; }
      if (arg.currentTime !== undefined) { st.time = parseFloat(arg.currentTime) || 0; st.at = Date.now(); }
      if (arg.duration !== undefined) st.dur = parseFloat(arg.duration) || 0;
      if (arg.state !== undefined) st.state = parseInt(arg.state, 10);
      draw();
    } else if (name === "onVolumeChanged") { st.vol = parseInt(arg.volume, 10); draw(); }
    else if (name === "onAdStateChange" || name === "adPlaying") {
      // adState "0" means the advert has finished. isSkipEnabled turns "true" once YouTube allows skipping.
      st.ad = name === "adPlaying" || String(arg.adState) !== "0";
      st.canSkip = st.ad && String(arg.isSkipEnabled) === "true";
      if (!st.ad) st.wantSkip = false;
      st.adSeen = true;
      if (st.canSkip && st.wantSkip) { st.wantSkip = false; trySkip(); }
      draw();
    }
    else if (name === "loungeStatus") {
      // Tells us whether the YouTube app on the TV is actually up right now.
      try { screenOn = JSON.parse(arg.devices).some(function (d) { return d.type === "LOUNGE_SCREEN"; }); } catch (e) {}
      if (!screenOn) status("YouTube is not open on the TV. Tap START.", true);
    }
    else if (name === "loungeScreenConnected") { screenOn = true; status("Linked to " + (CFG.screenName || "TV")); }
    else if (name === "loungeScreenDisconnected") { screenOn = false; status("YouTube closed on the TV. Tap START to open it.", true); }
  }

  async function connect() {
    if (!token) await refreshToken();
    rid = 1; ofs = 0; aid = 0; SID = ""; GS = "";
    var q = form({ RID: rid++, VER: 8, CVER: 1, auth_failure_option: "send_error" });
    var body = { app: "web", "mdx-version": "3", name: "iPhone remote", id: CFG.deviceId, device: "REMOTE_CONTROL",
                 capabilities: "que,dsdtr,atp,vsp", method: "setPlaylist", magnaKey: "cloudPairedDevice", ui: "false", theme: "cl", loungeIdToken: token };
    var r = await post(API + "/bc/bind?" + q, body, { "X-YouTube-LoungeId-Token": token });
    if (r.status === 401) { token = ""; await refreshToken(); body.loungeIdToken = token; r = await post(API + "/bc/bind?" + q, body, { "X-YouTube-LoungeId-Token": token }); }
    if (!r.ok) throw new Error("bind " + r.status);
    makeParser(onEvent)(new Uint8Array(await r.arrayBuffer()));
    if (!SID) throw new Error("no session");
    linked = true;
    if (screenOn) status("Linked to " + (CFG.screenName || "TV"));
    listen();
  }

  // Keeps a line open so the TV can tell us what is playing.
  async function listen() {
    if (listenCtl) listenCtl.abort();
    var ctl = listenCtl = new AbortController(), mySID = SID;
    while (linked && SID === mySID && !ctl.signal.aborted) {
      try {
        var r = await fetch(API + "/bc/bind?" + form({ SID: SID, gsessionid: GS, RID: "rpc", VER: 8, CVER: 1, AID: aid, CI: 0, TYPE: "xmlhttp",
                            auth_failure_option: "send_error" }), { signal: ctl.signal, headers: { "X-YouTube-LoungeId-Token": token } });
        if (!r.ok) { if (SID === mySID) { linked = false; start(); } return; }
        var feed = makeParser(onEvent), reader = r.body.getReader();
        for (;;) { var c = await reader.read(); if (c.done) break; feed(c.value); }
      } catch (e) {
        if (ctl.signal.aborted) return;
        await new Promise(function (ok) { setTimeout(ok, 2000); });
      }
    }
  }

  var chain = Promise.resolve();
  function cmd(name, args) {
    chain = chain.then(async function () {
      if (!CFG.screenId) { toast("Link your TV first (gear button)"); return; }
      try {
        if (!linked) await connect();
        var send = function () {
          var data = { count: 1, ofs: ofs++, req0__sc: name };
          for (var k in args || {}) data["req0_" + k] = args[k];
          return post(API + "/bc/bind?" + form({ SID: SID, gsessionid: GS, RID: rid++, VER: 8, CVER: 1, auth_failure_option: "send_error" }), data,
                      { "X-YouTube-LoungeId-Token": token });
        };
        var r = await send();
        if (!r.ok) { linked = false; token = ""; await connect(); r = await send(); }
        if (!r.ok) toast("The TV did not accept that (" + r.status + ")");
      } catch (e) {
        linked = false;
        toast("Can't reach the TV. Is YouTube open on it?");
      }
    });
    return chain;
  }

  async function start() {
    if (!CFG.screenId) { status("Not linked yet. Tap the gear to link your TV.", true); return; }
    status("Connecting…");
    try { await connect(); }
    catch (e) { status("Can't reach the TV. Open YouTube on it, or link again (gear).", true); }
  }

  /* ===================== CONTROLS ===================== */

  function nowTime() { return st.state === 1 ? st.time + (Date.now() - st.at) / 1000 : st.time; }
  function clock(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
                      return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function seekTo(t) { t = Math.max(0, st.dur ? Math.min(t, st.dur - 1) : t); st.time = t; st.at = Date.now(); draw(); cmd("seekTo", { newTime: Math.floor(t) }); }
  // Volume goes to the TV set itself. The script outside this page collects these and sends them on.
  var tvq = [];
  function home(msg) { if (tvq.length < 3) { tvq.push(JSON.stringify(msg)); window.dispatchEvent(new Event("tvkey")); } }
  function tv(key) { home({ t: "tv", key: key }); }

  // Turn the TV on, open YouTube on the Fire Stick, then wait for it to come up and (if a video was chosen) play it.
  var waking = 0;
  async function wakeTV(id) {
    var run = ++waking;
    home({ t: "wake", fire: CFG.fireIp || "", v: id || "" });
    status("Turning on the TV and opening YouTube…");
    for (var i = 0; i < 15 && run === waking; i++) {
      await new Promise(function (ok) { setTimeout(ok, 3000); });
      if (run !== waking) return;
      try { linked = false; await connect(); } catch (e) {}
      if (linked && screenOn) {
        if (id) cmd("setPlaylist", { videoId: id, currentTime: 0, currentIndex: -1, audioOnly: "false", listId: "" });
        return;
      }
    }
    if (run === waking) status("YouTube did not come up on the TV. Try START again.", true);
  }
  function playVideo(id) {
    st.id = id; st.title = titles[id] || ""; st.time = 0; st.dur = 0; st.at = Date.now(); st.state = 3; draw();
    if (CFG.screenId && CFG.fireIp && !(linked && screenOn)) { wakeTV(id); return; }
    cmd("setPlaylist", { videoId: id, currentTime: 0, currentIndex: -1, audioOnly: "false", listId: "" });
  }

  // Ask YouTube to skip. If the advert is still there shortly after (or the TV tells us nothing about adverts),
  // press OK on the TV instead, which is how its own Skip button is pressed.
  var skipT;
  function trySkip() {
    cmd("skipAd");
    clearTimeout(skipT);
    skipT = setTimeout(function () { if (!st.adSeen || (st.ad && st.canSkip)) cmd("dpadCommand", { key: "ENTER" }); }, 1500);
  }

  var actions = {
    pp: function () { if (st.state === 1) { st.time = nowTime(); st.state = 2; cmd("pause"); } else { st.at = Date.now(); st.state = 1; cmd("play"); } draw(); },
    back10: function () { seekTo(nowTime() - 10); },
    fwd10: function () { seekTo(nowTime() + 10); },
    back5m: function () { seekTo(nowTime() - 300); },
    fwd5m: function () { seekTo(nowTime() + 300); },
    prev: function () { cmd("previous"); },
    next: function () { cmd("next"); },
    skipad: function () {
      // Say what the TV has told us, so it is clear why a skip did or did not happen.
      var info = !st.adSeen ? "the TV has sent no advert info" : !st.ad ? "the TV says no advert is playing"
               : st.canSkip ? "advert can be skipped" : "advert can't be skipped yet, will skip when allowed";
      toast("Skip sent: " + info);
      if (st.ad && !st.canSkip) st.wantSkip = true;
      trySkip(); draw();
    },
    volup: function () { tv("VOLUP"); },
    voldown: function () { tv("VOLDOWN"); },
    mute: function () { tv("MUTE"); },
    power: function () { tv("POWER"); },
    startyt: function () { wakeTV(""); }
  };
  function act(a) {
    if (actions[a]) actions[a]();
    else if (a.charAt(0) === "d") cmd("dpadCommand", { key: a.slice(1) });
  }

  function draw() {
    var t = drag !== null ? drag : nowTime();
    $("tnow").textContent = st.id && st.dur ? clock(t) : "";
    $("tleft").textContent = st.id && st.dur ? clock(Math.max(0, st.dur - t)) + " left" : "";
    $("knob").style.display = st.dur ? "block" : "none";
    $("knob").style.left = (st.dur ? Math.min(100, t / st.dur * 100) : 0) + "%";
    $("nowtitle").textContent = st.id ? (st.title || "Playing on TV") : "Nothing playing";
    $("nowtime").textContent = st.id ? clock(t) + (st.dur ? " / " + clock(st.dur) : "") + (st.ad ? (st.canSkip ? " · Ad, can skip" : st.wantSkip ? " · Ad, skipping when allowed" : " · Ad, can't skip yet") : "") : "";
    var img = $("nowimg"), src = st.id ? "https://i.ytimg.com/vi/" + st.id + "/mqdefault.jpg" : "";
    if (img.getAttribute("src") !== src) { if (src) img.src = src; else img.removeAttribute("src"); }
    $("fill").style.width = (st.dur ? Math.min(100, t / st.dur * 100) : 0) + "%";
    var sym = st.state === 1 ? "⏸︎" : "▶︎";
    document.querySelectorAll(".pp").forEach(function (b) { b.textContent = sym; });
  }
  setInterval(draw, 1000);

  // Drag anywhere along the bar; the video jumps when you let go.
  var drag = null;
  function barTime(x) { var r = $("bar").getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * st.dur; }
  $("bar").addEventListener("touchstart", function (e) { if (!st.dur) return; e.preventDefault(); drag = barTime(e.touches[0].clientX); this.classList.add("drag"); draw(); }, { passive: false });
  $("bar").addEventListener("touchmove", function (e) {
    if (drag === null) return;
    var r = this.getBoundingClientRect(), y = e.touches[0].clientY;
    if (y < r.top - 60 || y > r.bottom + 60) { drag = null; this.classList.remove("drag"); draw(); return; }   // wandered off: a swipe, not a drag
    e.preventDefault(); drag = barTime(e.touches[0].clientX); draw();
  }, { passive: false });
  $("bar").addEventListener("touchend", function () { this.classList.remove("drag"); if (drag === null) return; var t = drag; drag = null; seekTo(t); });
  $("bar").addEventListener("touchcancel", function () { this.classList.remove("drag"); drag = null; draw(); });
  $("bar").addEventListener("click", function (e) { if (st.dur && e.detail) seekTo(barTime(e.clientX)); });

  // Buttons act on a tap: finger down and up in the same place. A swipe or scroll that happens to start on a
  // button does nothing. Holding still on a repeat button repeats it.
  document.querySelectorAll("button[data-a]").forEach(function (b) {
    var a = b.dataset.a, x0 = 0, y0 = 0, live = false, fired = false, holdT = null, repT = null, lastTouch = 0;
    function end() { clearTimeout(holdT); clearInterval(repT); holdT = repT = null; live = false; b.classList.remove("down"); }
    b.addEventListener("touchstart", function (e) {
      end(); live = true; fired = false; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; b.classList.add("down");
      if (b.hasAttribute("data-r")) holdT = setTimeout(function () {
        if (!live) return;
        fired = true; act(a); repT = setInterval(function () { act(a); }, 300);
      }, 500);
    }, { passive: true });
    b.addEventListener("touchmove", function (e) {
      if (live && (Math.abs(e.touches[0].clientX - x0) > 10 || Math.abs(e.touches[0].clientY - y0) > 10)) end();
    }, { passive: true });
    b.addEventListener("touchend", function (e) {
      lastTouch = Date.now();
      if (!live) return;
      e.preventDefault();
      var go = !fired; end();
      if (go) act(a);
    });
    b.addEventListener("touchcancel", end);
    b.addEventListener("click", function (e) { if (e.detail && Date.now() - lastTouch > 800) act(a); });
  });

  /* ===================== SUGGESTIONS, SUBSCRIPTIONS, SEARCH ===================== */

  function txt(o) {
    if (!o) return "";
    if (typeof o === "string") return o;
    if (o.simpleText) return o.simpleText;
    if (o.content) return o.content;
    if (o.runs) return o.runs.map(function (r) { return r.text; }).join("");
    return "";
  }
  // Walk whatever YouTube sent and pull out anything that looks like a video.
  // Look anywhere inside one list item for a piece of text or a number.
  function findText(o, re) {
    var hit = "";
    (function walk(x) {
      if (hit || x === null || x === undefined) return;
      if (typeof x === "string") { if (re.test(x)) hit = x; return; }
      if (typeof x !== "object") return;
      for (var k in x) { if (k === "accessibility" || k === "accessibilityData" || k === "trackingParams") continue; walk(x[k]); }
    })(o);
    return hit;
  }
  function findNumber(o, keys) {
    var hit = null;
    (function walk(x) {
      if (hit !== null || !x || typeof x !== "object") return;
      for (var k in x) { if (keys.indexOf(k) >= 0 && typeof x[k] === "number") { hit = x[k]; return; } walk(x[k]); }
    })(o);
    return hit;
  }
  var RE_LEN = /^\d{1,2}:\d\d(:\d\d)?$/, RE_WHEN = /\bago$|^streamed |^premiered /i;
  function findVideos(data) {
    var out = [], seen = {};
    function add(o, id, title, by, len, when) {
      if (typeof id !== "string" || id.length !== 11 || !title || seen[id]) return;
      var pct = findNumber(o, ["percentDurationWatched", "startPercent"]);
      seen[id] = 1;
      out.push({ id: id, title: title, by: by, len: len || findText(o, RE_LEN), when: when || findText(o, RE_WHEN),
                 pct: pct === null ? (o.isWatched === true ? 100 : 0) : Math.max(0, Math.min(100, pct)) });
    }
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o.videoId === "string" && (o.headline || o.title)) {
        add(o, o.videoId, txt(o.headline || o.title), txt(o.shortBylineText || o.ownerText || o.longBylineText), txt(o.lengthText), txt(o.publishedTimeText));
        return;
      }
      if (typeof o.contentId === "string" && /VIDEO$/.test(o.contentType || "") && o.metadata) {
        var m = o.metadata.lockupMetadataViewModel || {}, by = "";
        try { by = txt(m.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text); } catch (e) {}
        add(o, o.contentId, txt(m.title), by, "", "");
        return;
      }
      for (var k in o) walk(o[k]);
    })(data);
    return out;
  }
  function pageData(html) {
    var m = html.match(/var ytInitialData = '((?:[^'\\]|\\[\s\S])*)'/);
    if (m) return JSON.parse(m[1].replace(/\\x([0-9a-fA-F]{2})|\\([\s\S])/g, function (all, hex, ch) { return hex ? String.fromCharCode(parseInt(hex, 16)) : ch; }));
    m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (m) return JSON.parse(m[1]);
    throw new Error("no data");
  }

  // The "load more" marker YouTube leaves at the end of a list.
  function findMore(data) {
    var found = null;
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.continuationCommand && o.continuationCommand.token) found = o.continuationCommand;
      for (var k in o) walk(o[k]);
    })(data);
    return found;
  }
  function setting(html, key) { var m = html.match(new RegExp('"' + key + '":"([^"]+)"')); return m ? m[1] : ""; }
  // Proves to YouTube that the request comes from your signed-in session, the same way its own pages do.
  async function signedHeader() {
    try {
      var m = document.cookie.match(/(?:^|; )SAPISID=([^;]+)/) || document.cookie.match(/(?:^|; )__Secure-3PAPISID=([^;]+)/);
      if (!m || !window.crypto || !crypto.subtle) return "";
      var ts = Math.floor(Date.now() / 1000), origin = "https://m.youtube.com";
      var hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + m[1] + " " + origin));
      var hex = Array.prototype.map.call(new Uint8Array(hash), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
      return "SAPISIDHASH " + ts + "_" + hex;
    } catch (e) { return ""; }
  }
  async function fetchMore(L) {
    var headers = { "Content-Type": "application/json", "X-Youtube-Client-Name": "2", "X-Youtube-Client-Version": L.ver };
    if (L.visitor) headers["X-Goog-Visitor-Id"] = L.visitor;
    var auth = await signedHeader();
    if (auth) { headers["Authorization"] = auth; headers["X-Origin"] = "https://m.youtube.com"; headers["X-Goog-AuthUser"] = "0"; }
    var kind = /SEARCH/.test(L.more.request || "") ? "search" : "browse";
    var r = await fetch("/youtubei/v1/" + kind + "?prettyPrint=false", { method: "POST", credentials: "include", headers: headers,
      body: JSON.stringify({ context: { client: { clientName: "MWEB", clientVersion: L.ver, hl: L.hl || "en", gl: L.gl || "US", visitorData: L.visitor } },
                             continuation: L.more.token }) });
    if (!r.ok) throw new Error("more " + r.status);
    return r.json();
  }

  var MIN_ITEMS = 20;
  var loaded = {}, lists = {};
  function addVideos(L, vids) {
    var added = 0;
    vids.forEach(function (v) {
      if (L.seen[v.id]) return;
      L.seen[v.id] = 1; added++; L.count++;
      titles[v.id] = v.title;
      var row = document.createElement("div"); row.className = "vid";
      var watched = v.pct >= 90;
      if (v.pct > 0) row.classList.add(watched ? "watched" : "part");
      var th = document.createElement("div"); th.className = "th";
      var img = document.createElement("img"); img.loading = "lazy"; img.alt = ""; img.src = "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg";
      th.appendChild(img);
      if (v.len) { var len = document.createElement("em"); len.textContent = v.len; th.appendChild(len); }
      if (watched) { var tag = document.createElement("strong"); tag.textContent = "WATCHED"; th.appendChild(tag); }
      if (v.pct > 0) { var bar = document.createElement("i"), fill = document.createElement("u"); fill.style.width = v.pct + "%"; bar.appendChild(fill); th.appendChild(bar); }
      var d = document.createElement("div"), b = document.createElement("b"), s = document.createElement("span");
      d.className = "tx";
      b.textContent = v.title; s.textContent = v.by || "";
      var w = document.createElement("span");
      w.textContent = [v.when, v.pct > 0 && !watched ? "Part watched" : ""].filter(Boolean).join(" · ");
      d.appendChild(b); if (v.by) d.appendChild(s); if (w.textContent) d.appendChild(w);
      var add = document.createElement("button"); add.textContent = "+"; add.setAttribute("aria-label", "Add to queue");
      add.addEventListener("click", function (e) { e.stopPropagation(); cmd("addVideo", { videoId: v.id }); toast("Added to the queue"); });
      row.appendChild(th); row.appendChild(d); row.appendChild(add);
      row.addEventListener("click", function () { row.classList.add("sent"); playVideo(v.id); toast("Playing on the TV"); });
      L.box.insertBefore(row, L.foot);
    });
    return added;
  }
  // Keep asking YouTube for the next batch until the list has enough in it.
  async function fill(L, target) {
    if (L.busy) return;
    L.busy = true; L.foot.textContent = "Loading more…"; L.foot.style.display = "";
    try {
      for (var tries = 0; L.more && L.count < target && tries < 6; tries++) {
        var data = await fetchMore(L);
        var before = L.more.token;
        L.more = findMore(data);
        addVideos(L, findVideos(data));
        if (L.more && L.more.token === before) L.more = null;
      }
    } catch (e) { L.more = null; }
    L.busy = false;
    if (L.more) { L.foot.textContent = "Show more"; L.foot.style.display = ""; } else L.foot.style.display = "none";
  }
  async function loadList(key, path, needsSignIn) {
    var box = $("l-" + key);
    box.innerHTML = '<div class="msg">Loading…</div>';
    try {
      var r = await fetch(path, { credentials: "include" });
      var html = await r.text();
      var signedIn = /"LOGGED_IN":\s*true/.test(html);
      var data = pageData(html);
      var foot = document.createElement("button"); foot.className = "morebtn"; foot.style.display = "none";
      var L = lists[key] = { box: box, foot: foot, seen: {}, count: 0, busy: false, more: findMore(data),
                             ver: setting(html, "INNERTUBE_CLIENT_VERSION") || setting(html, "INNERTUBE_CONTEXT_CLIENT_VERSION"),
                             visitor: setting(html, "VISITOR_DATA"), hl: setting(html, "HL"), gl: setting(html, "GL") };
      box.innerHTML = ""; box.appendChild(foot);
      foot.addEventListener("click", function () { fill(L, L.count + MIN_ITEMS); });
      addVideos(L, findVideos(data));
      if (L.ver) await fill(L, MIN_ITEMS); else L.more = null;
      if (!L.count) {
        box.innerHTML = '<div class="msg"></div>';
        box.firstChild.textContent = needsSignIn && !signedIn ? "Sign in to YouTube (gear button) to see this." : "Nothing to show here right now.";
        return;
      }
      loaded[key] = Date.now();
    } catch (e) {
      box.innerHTML = '<div class="msg">Could not load this. Check your connection and try again.</div>';
    }
  }
  function search() { var q = $("q").value.trim(); if (!q) return; $("q").blur(); loadList("search", "/results?search_query=" + encodeURIComponent(q), false); }
  $("go").addEventListener("click", search);
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });

  /* ===================== TABS AND SETTINGS ===================== */

  function show(tab) {
    document.querySelectorAll("nav button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("on", v.id === "v-" + tab); });
    $("mini").classList.toggle("on", tab === "home" || tab === "subs" || tab === "hist" || tab === "search");
    window.scrollTo(0, 0);
    var fresh = function (k) { return loaded[k] && Date.now() - loaded[k] < 5 * 60000; };
    if (tab === "home" && !fresh("home")) loadList("home", "/", true);
    if (tab === "subs" && !fresh("subs")) loadList("subs", "/feed/subscriptions", true);
    if (tab === "hist") loadList("hist", "/feed/history", true);
  }
  document.querySelectorAll("nav button").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.tab); }); });

  $("link").addEventListener("click", async function () {
    var code = $("code").value.replace(/\D/g, "");
    if (code.length < 6) { $("linkmsg").textContent = "That code looks too short. It is the 12-digit code shown on the TV."; return; }
    $("linkmsg").textContent = "Linking…";
    try {
      await pair(code); linked = false; await connect();
      $("linkmsg").textContent = "Linked to " + CFG.screenName + ". You only need to do this once.";
      $("code").value = ""; show("remote");
    } catch (e) {
      $("linkmsg").textContent = "That code was not accepted. Get a fresh code on the TV (YouTube > Settings > Link with TV code) and try again.";
    }
  });
  $("fire").value = CFG.fireIp || "";
  $("firesave").addEventListener("click", function () {
    var v = $("fire").value.trim().replace(/,/g, ".");
    var ok = /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split(".").every(function (n) { return Number(n) <= 255; });
    if (!ok) { $("firemsg").textContent = "That is not a full address. It should look like 192.168.1.50"; return; }
    CFG.fireIp = v; saveCfg();
    $("firemsg").textContent = "Saved. START and tapping a video will now open YouTube on the Fire Stick at " + v + ".";
  });
  $("signin").addEventListener("click", function () {
    location.href = "https://accounts.google.com/ServiceLogin?service=youtube&continue=" + encodeURIComponent("https://m.youtube.com/");
  });
  if (CFG.screenId) $("linkmsg").textContent = "Linked to " + (CFG.screenName || "TV") + ". To link a different TV: on it open YouTube > Settings > Link with TV code, and type the code here.";

  draw();
  start();
</script>
</body></html>`;

if (config.runsInWidget) {
  // A widget can't show the remote itself, so it shows a tile that opens the remote when tapped.
  const w = new ListWidget();
  w.backgroundColor = new Color("#0f0f0f");
  w.url = "scriptable:///run/" + encodeURIComponent(Script.name());
  w.addSpacer();
  const icon = w.addImage(SFSymbol.named("play.rectangle.fill").image);
  icon.imageSize = new Size(44, 44);
  icon.tintColor = new Color("#ff3d33");
  w.addSpacer(8);
  const title = w.addText("YouTube Remote");
  title.font = Font.boldSystemFont(16);
  title.textColor = new Color("#f2f1ee");
  w.addSpacer();
  Script.setWidget(w);
} else {
  for (;;) {
    const cfg = readCfg();
    const wv = new WebView();
    await wv.loadHTML(HTML.replace("__CFG__", () => JSON.stringify(cfg)), ORIGIN);
    const state = { open: true };
    relayVolume(wv, state);
    await wv.present(true);
    state.open = false;

    // After Close: keep the TV link for next time. If the page had gone off to the sign-in screen, reopen the remote.
    let out = "";
    try { out = await wv.evaluateJavaScript("document.title === 'YT Remote' ? JSON.stringify(CFG) : 'away'"); } catch (e) {}
    if (out === "away") continue;
    try { const next = JSON.parse(out); if (next && typeof next === "object") fm.writeString(CFG_PATH, JSON.stringify(next)); } catch (e) {}
    break;
  }
}

Script.complete();
