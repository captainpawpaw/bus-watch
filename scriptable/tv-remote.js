// TV Remote for Scriptable (iPhone) — Panasonic Viera (built for the TX-40ES400 series)
// Run it in the Scriptable app while your phone is on the same Wi-Fi as the TV.
// It's set to the TV at 192.168.1.222. Tap the gear to change the address.
// iOS will ask once to let Scriptable find devices on your local network: say Allow.
// Hold volume, channel or the arrows to repeat.

const DEFAULT_IP = "192.168.1.222";
const PORT = 55000;

const fm = FileManager.local();
const CFG = fm.joinPath(fm.documentsDirectory(), "tv-remote-config.json");
const readCfg = () => { try { return fm.fileExists(CFG) ? JSON.parse(fm.readString(CFG)) : {}; } catch (e) { return {}; } };
const validIP = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split(".").every((n) => Number(n) <= 255);

let cfg = readCfg();
if (!validIP(cfg.ip || "")) cfg.ip = DEFAULT_IP;

// The page is loaded as if it came from the TV itself, so its buttons can talk to the TV directly.

const HTML = /*html*/ `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  :root { --bg:#111317; --key:#23262d; --key2:#2e323b; --fg:#f2f1ee; --muted:#9a9ea8; --accent:#ff4a3d; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-touch-callout:none; user-select:none; -webkit-user-select:none; }
  html,body { margin:0; background:var(--bg); color:var(--fg); font:600 17px -apple-system,system-ui,sans-serif; }
  body { padding:max(96px, calc(env(safe-area-inset-top) + 48px)) 16px calc(24px + env(safe-area-inset-bottom)); max-width:440px; margin:0 auto; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  header .name { flex:1; min-width:0; }
  header .name b { display:block; font-size:19px; }
  header .name span { color:var(--muted); font-size:13px; font-weight:500; }
  button { font:inherit; color:var(--fg); background:var(--key); border:0; border-radius:16px; height:66px; padding:0;
           display:flex; align-items:center; justify-content:center; touch-action:manipulation; }
  button:active, button.down { background:var(--key2); transform:scale(.96); }
  button small { font-size:14px; color:var(--muted); font-weight:600; letter-spacing:.04em; }
  .round { width:62px; height:62px; border-radius:50%; flex:none; }
  .power { background:var(--accent); font-size:26px; }
  .power:active { background:#d93a2f; }
  .row { display:grid; gap:10px; margin-top:12px; }
  .c5 button { font-size:22px; }
  .c4 { grid-template-columns:repeat(4,1fr); } .c5 { grid-template-columns:repeat(5,1fr); }
  .pad { margin:16px auto 6px; width:290px; height:290px; display:grid; grid-template:repeat(3,1fr)/repeat(3,1fr); gap:6px;
         background:var(--key); border-radius:50%; padding:8px; }
  .pad button { background:transparent; height:auto; font-size:32px; border-radius:50%; }
  .pad button:active, .pad button.down { background:var(--key2); }
  .pad .ok { background:var(--key2); font-size:20px; }
  .pad .ok:active { background:#3a3f4a; }
  .rockers { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:12px; }
  .rocker { background:var(--key); border-radius:18px; display:flex; flex-direction:column; align-items:stretch; }
  .rocker button { background:transparent; font-size:32px; height:72px; }
  .rocker button:active, .rocker button.down { background:var(--key2); }
  .rocker label { text-align:center; color:var(--muted); font-size:13px; letter-spacing:.06em; }
  .mid { display:flex; flex-direction:column; gap:10px; justify-content:space-between; }
  .mid button { flex:1; height:auto; }
  #toast { position:fixed; left:50%; bottom:calc(20px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:#3a1512; color:#ffb4ad;
           padding:10px 16px; border-radius:12px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; white-space:nowrap; }
  #toast.show { opacity:1; }
  #set { display:none; margin-bottom:14px; background:var(--key); border-radius:14px; padding:12px; }
  #set.open { display:block; }
  #set p { margin:0 0 8px; font-size:12px; color:var(--muted); font-weight:500; }
  #set div { display:flex; gap:8px; }
  #set input { flex:1; min-width:0; height:44px; border-radius:10px; border:0; background:var(--bg); color:var(--fg); font:inherit; padding:0 12px;
               user-select:text; -webkit-user-select:text; }
  #set button { height:44px; font-size:15px; padding:0 16px; background:var(--accent); }
</style></head><body>
<header>
  <button class="round power" data-k="POWER" aria-label="Power">⏻</button>
  <div class="name"><b>Panasonic TV</b><span id="ip">__IP__</span></div>
  <button class="round" data-k="CHG_INPUT"><small>INPUT</small></button>
  <button class="round" data-k="__settings" aria-label="Settings">⚙︎</button>
</header>

<div id="set">
  <p id="setmsg">TV address (on the TV: Menu &gt; Network &gt; Network Status)</p>
  <div><input id="ipin" inputmode="decimal" autocomplete="off" value="__IP__"><button id="save">Save</button></div>
</div>

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

<div class="row c5">
  <button data-k="REW" aria-label="Rewind">⏪︎</button>
  <button data-k="PLAY" aria-label="Play">▶︎</button>
  <button data-k="PAUSE" aria-label="Pause">⏸︎</button>
  <button data-k="STOP" aria-label="Stop">⏹︎</button>
  <button data-k="FF" aria-label="Fast forward">⏩︎</button>
</div>

<div id="toast"></div>

<script>
  var toastT;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2500);
  }

  // Send one key press to the TV. Presses go one at a time, in order.
  var chain = Promise.resolve(), waiting = 0;
  function send(k) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 4000);
    return fetch("/nrc/control_0", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        "SOAPACTION": '"urn:panasonic-com:service:p00NetworkControl:1#X_SendKey"'
      },
      body: '<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        '<s:Body><u:X_SendKey xmlns:u="urn:panasonic-com:service:p00NetworkControl:1">' +
        '<X_KeyEvent>NRC_' + k + '-ONOFF</X_KeyEvent>' +
        '</u:X_SendKey></s:Body></s:Envelope>'
    }).then(function (r) {
      if (!r.ok) toast("TV refused that (" + r.status + ")");
    }).catch(function () {
      toast("Can't reach the TV at __IP__");
    }).then(function () { clearTimeout(timer); });
  }
  function press(k) {
    if (k === "__settings") { document.getElementById("set").classList.toggle("open"); return; }
    if (waiting >= 3) return;
    waiting++;
    chain = chain.then(function () { return send(k); }).then(function () { waiting--; });
  }

  // A new address is picked up by the script when you tap Close; it then reopens the remote.
  window.newIP = "";
  document.getElementById("save").addEventListener("click", function () {
    var v = document.getElementById("ipin").value.trim().replace(/,/g, ".");
    var ok = /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(v) && v.split(".").every(function (n) { return Number(n) <= 255; });
    var msg = document.getElementById("setmsg");
    if (!ok) { msg.textContent = "That's not a full address. It should look like 192.168.1.222"; return; }
    window.newIP = v;
    msg.textContent = "Saved. Tap Close (top left) and the remote reopens on " + v;
  });

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

for (;;) {
  const wv = new WebView();
  await wv.loadHTML(HTML.split("__IP__").join(cfg.ip), "http://" + cfg.ip + ":" + PORT + "/");
  await wv.present(true);

  // After Close: did the address get changed? If so save it and reopen.
  let next = "";
  try { next = await wv.evaluateJavaScript("window.newIP || ''"); } catch (e) {}
  if (!validIP(next || "") || next === cfg.ip) break;
  cfg.ip = next;
  fm.writeString(CFG, JSON.stringify(cfg));
}

Script.complete();
