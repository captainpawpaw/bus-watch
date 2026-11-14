// TV Remote for Scriptable (iPhone) — Panasonic Viera (built for the TX-40ES400 series)
// Run it in the Scriptable app while your phone is on the same Wi-Fi as the TV.
// It's set to the TV at 192.168.1.222. Tap the gear to change that, or to find the TV for you.
// iOS will ask once to let Scriptable find devices on your local network: say Allow.
// Hold volume, channel or the arrows to repeat.

const DEFAULT_IP = "192.168.1.222";
const DEFAULT_PREFIX = "192.168.1.";
const PORT = 55000;

const fm = FileManager.local();
const CFG = fm.joinPath(fm.documentsDirectory(), "tv-remote-config.json");
const readCfg = () => { try { return fm.fileExists(CFG) ? JSON.parse(fm.readString(CFG)) : {}; } catch (e) { return {}; } };
const writeCfg = (v) => fm.writeString(CFG, JSON.stringify(v));
const validIP = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split(".").every((n) => Number(n) <= 255);

let cfg = readCfg();
if (!cfg.ip) cfg.ip = DEFAULT_IP;

/* ===================== TALKING TO THE TV ===================== */

async function sendKey(ip, key) {
  const req = new Request("http://" + ip + ":" + PORT + "/nrc/control_0");
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
  try {
    await req.loadString();
  } catch (e) {
    return "Can't reach the TV at " + ip;
  }
  const code = req.response && req.response.statusCode;
  if (code && code !== 200) return "TV refused that (" + code + ")";
  return "";
}

// Is there a Panasonic TV answering at this address?
async function isTV(ip) {
  const req = new Request("http://" + ip + ":" + PORT + "/nrc/ddd.xml");
  req.timeoutInterval = 2;
  try {
    const body = await req.loadString();
    return req.response.statusCode === 200 && /panasonic|viera|urn:schemas-upnp-org/i.test(body);
  } catch (e) {
    return false;
  }
}

async function scan(prefix) {
  const found = [];
  for (let start = 1; start < 255; start += 32) {
    const batch = [];
    for (let i = start; i < Math.min(start + 32, 255); i++) {
      const ip = prefix + i;
      batch.push(isTV(ip).then((ok) => { if (ok) found.push(ip); }));
    }
    await Promise.all(batch);
    if (found.length) break;
  }
  return found;
}

/* ===================== SETUP ===================== */

async function say(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.present();
}

async function setup() {
  for (;;) {
    const a = new Alert();
    a.title = "TV address";
    a.message = "Type the TV's IP address, or let me look for it on your Wi-Fi.\n(On the TV: Menu > Network > Network Status.)";
    a.addTextField("192.168.1.x", cfg.ip || DEFAULT_PREFIX);
    a.addAction("Save");
    a.addAction("Find it for me");
    a.addCancelAction("Cancel");
    const pick = await a.present();
    if (pick === -1) return false;
    const typed = a.textFieldValue(0).trim();

    if (pick === 0) {
      if (!validIP(typed)) { await say("That's not a full address", "It should look like 192.168.1.222"); continue; }
      cfg.ip = typed;
      writeCfg(cfg);
      return true;
    }

    const m = typed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)/);
    const prefix = m ? m[1] : DEFAULT_PREFIX;
    const found = await scan(prefix);
    if (!found.length) {
      await say("No TV found", "Nothing answered on " + prefix + "x. Check the TV is on and on the same Wi-Fi, and that Scriptable is allowed under Settings > Privacy & Security > Local Network.");
      continue;
    }
    cfg.ip = found[0];
    writeCfg(cfg);
    await say("Found your TV", "It's at " + cfg.ip);
    return true;
  }
}

/* ===================== THE REMOTE ===================== */

const HTML = /*html*/ `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  :root { --bg:#111317; --key:#23262d; --key2:#2e323b; --fg:#f2f1ee; --muted:#9a9ea8; --accent:#ff4a3d; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-touch-callout:none; user-select:none; -webkit-user-select:none; }
  html,body { margin:0; background:var(--bg); color:var(--fg); font:600 15px -apple-system,system-ui,sans-serif; }
  body { padding:14px 16px calc(24px + env(safe-area-inset-bottom)); max-width:440px; margin:0 auto; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  header .name { flex:1; min-width:0; }
  header .name b { display:block; font-size:17px; }
  header .name span { color:var(--muted); font-size:12px; font-weight:500; }
  button { font:inherit; color:var(--fg); background:var(--key); border:0; border-radius:14px; height:52px; padding:0;
           display:flex; align-items:center; justify-content:center; touch-action:manipulation; }
  button:active, button.down { background:var(--key2); transform:scale(.96); }
  button small { font-size:11px; color:var(--muted); font-weight:600; letter-spacing:.04em; }
  .round { width:52px; border-radius:50%; flex:none; }
  .power { background:var(--accent); font-size:22px; }
  .power:active { background:#d93a2f; }
  .row { display:grid; gap:10px; margin-top:10px; }
  .c4 { grid-template-columns:repeat(4,1fr); } .c5 { grid-template-columns:repeat(5,1fr); }
  .pad { margin:18px auto 8px; width:236px; height:236px; display:grid; grid-template:repeat(3,1fr)/repeat(3,1fr); gap:6px;
         background:var(--key); border-radius:50%; padding:8px; }
  .pad button { background:transparent; height:auto; font-size:24px; border-radius:50%; }
  .pad button:active, .pad button.down { background:var(--key2); }
  .pad .ok { background:var(--key2); font-size:16px; }
  .pad .ok:active { background:#3a3f4a; }
  .rockers { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:14px; }
  .rocker { background:var(--key); border-radius:18px; display:flex; flex-direction:column; align-items:stretch; }
  .rocker button { background:transparent; font-size:24px; height:54px; }
  .rocker button:active, .rocker button.down { background:var(--key2); }
  .rocker label { text-align:center; color:var(--muted); font-size:11px; letter-spacing:.06em; }
  .mid { display:flex; flex-direction:column; gap:10px; justify-content:center; }
  #toast { position:fixed; left:50%; bottom:calc(20px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:#3a1512; color:#ffb4ad;
           padding:10px 16px; border-radius:12px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; white-space:nowrap; }
  #toast.show { opacity:1; }
</style></head><body>
<header>
  <button class="round power" data-k="POWER" aria-label="Power">⏻</button>
  <div class="name"><b>Panasonic TV</b><span id="ip"></span></div>
  <button class="round" data-k="CHG_INPUT"><small>INPUT</small></button>
  <button class="round" data-k="__settings" aria-label="Settings">⚙︎</button>
</header>

<div class="pad">
  <span></span><button data-k="UP" data-r aria-label="Up">▲</button><span></span>
  <button data-k="LEFT" data-r aria-label="Left">◀</button><button class="ok" data-k="ENTER">OK</button><button data-k="RIGHT" data-r aria-label="Right">▶</button>
  <span></span><button data-k="DOWN" data-r aria-label="Down">▼</button><span></span>
</div>

<div class="row c4">
  <button data-k="RETURN"><small>BACK</small></button>
  <button data-k="HOME"><small>HOME</small></button>
  <button data-k="MENU"><small>MENU</small></button>
  <button data-k="CANCEL"><small>EXIT</small></button>
</div>

<div class="rockers">
  <div class="rocker"><button data-k="VOLUP" data-r aria-label="Volume up">+</button><label>VOL</label><button data-k="VOLDOWN" data-r aria-label="Volume down">−</button></div>
  <div class="mid">
    <button data-k="MUTE"><small>MUTE</small></button>
    <button data-k="TV"><small>TV</small></button>
  </div>
  <div class="rocker"><button data-k="CH_UP" data-r aria-label="Channel up">⌃</button><label>CH</label><button data-k="CH_DOWN" data-r aria-label="Channel down">⌄</button></div>
</div>

<div class="row c4">
  <button data-k="APPS"><small>APPS</small></button>
  <button data-k="EPG"><small>GUIDE</small></button>
  <button data-k="INFO"><small>INFO</small></button>
  <button data-k="SUBMENU"><small>OPTION</small></button>
</div>

<div class="row c5">
  <button data-k="REW" aria-label="Rewind">⏪︎</button>
  <button data-k="PLAY" aria-label="Play">▶︎</button>
  <button data-k="PAUSE" aria-label="Pause">⏸︎</button>
  <button data-k="STOP" aria-label="Stop">⏹︎</button>
  <button data-k="FF" aria-label="Fast forward">⏩︎</button>
</div>

<div id="toast"></div>

<script>
  // Presses queue here; the Scriptable side collects them one at a time through next().
  var q = [], pending = null;
  function press(k) {
    if (pending) { var d = pending; pending = null; d(k); }
    else if (q.length < 3) q.push(k);
  }
  function next(done) {
    if (q.length) done(q.shift()); else pending = done;
  }
  function setIP(ip) { document.getElementById("ip").textContent = ip; }
  var toastT;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2500);
  }

  var holdT, repT;
  function stop(b) { clearTimeout(holdT); clearInterval(repT); if (b) b.classList.remove("down"); }
  document.querySelectorAll("button[data-k]").forEach(function (b) {
    var k = b.dataset.k;
    b.addEventListener("touchstart", function (e) {
      e.preventDefault();
      b.classList.add("down");
      press(k);
      if (b.hasAttribute("data-r")) holdT = setTimeout(function () { repT = setInterval(function () { press(k); }, 220); }, 450);
    }, { passive: false });
    b.addEventListener("touchend", function () { stop(b); });
    b.addEventListener("touchcancel", function () { stop(b); });
    b.addEventListener("click", function (e) { if (e.detail) press(k); }); // mouse / pointer, when not on a touch screen
  });
</script>
</body></html>`;

async function run() {
  if (!validIP(cfg.ip || "")) {
    if (!(await setup())) return;
  }

  const wv = new WebView();
  await wv.loadHTML(HTML);
  await wv.evaluateJavaScript("setIP(" + JSON.stringify(cfg.ip) + ")");

  const CLOSED = {};
  const closed = wv.present(true).then(() => CLOSED);

  for (;;) {
    const key = await Promise.race([closed, wv.evaluateJavaScript("next(completion)", true)]);
    if (key === CLOSED) break;
    if (key === "__settings") {
      if (await setup()) await wv.evaluateJavaScript("setIP(" + JSON.stringify(cfg.ip) + ")");
      continue;
    }
    const err = await sendKey(cfg.ip, key);
    if (err) await wv.evaluateJavaScript("toast(" + JSON.stringify(err) + ")");
  }
}

await run();
Script.complete();
