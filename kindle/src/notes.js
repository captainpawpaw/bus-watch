// The notice board: short notes added from a phone page (/notes) or by email,
// kept in Upstash Redis (Vercel → Storage → Upstash for Redis sets the
// KV_REST_API_URL and KV_REST_API_TOKEN settings) and shown on the energy page
// and the screensaver.
import { tz, localParts } from "./util.js";

const KEY = "dashboard:notes";
const MAX_NOTES = 20, MAX_LENGTH = 200;
const CACHE_MS = 20 * 1000;
let cached = null, cachedAt = 0;

// Vercel may add a prefix to the names (e.g. STORAGE_KV_REST_API_URL), so any
// setting ending in KV_REST_API_URL or REDIS_REST_URL is used, with its token.
const store = env => {
  for (const [urlEnd, tokenEnd] of [["KV_REST_API_URL", "KV_REST_API_TOKEN"], ["REDIS_REST_URL", "REDIS_REST_TOKEN"]]) {
    for (const name of Object.keys(env).filter(n => n.toUpperCase().endsWith(urlEnd)).sort((a, b) => a.length - b.length)) {
      const url = env[name], token = env[name.slice(0, -urlEnd.length) + tokenEnd]
        ?? env[name.slice(0, -urlEnd.length) + tokenEnd.toLowerCase()];
      if (url && token) return { url: String(url).trim().replace(/\/$/, ""), token: String(token).trim() };
    }
  }
  return null;
};
// The names of settings that look like storage, to help when it isn't found.
export const storageNames = env => Object.keys(env).filter(n => /KV|REDIS|UPSTASH/i.test(n)).sort();
export const hasNotes = env => !!store(env);

async function redis(env, ...command) {
  const s = store(env);
  if (!s) throw new Error("notes storage isn't set up (KV_REST_API_URL)");
  const res = await fetch(s.url, {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`notes storage replied ${res.status}${data.error ? `: ${data.error}` : ""}`);
  return data.result;
}

async function load(env) {
  const raw = await redis(env, "GET", KEY);
  try { return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []; } catch { return []; }
}
async function save(env, notes) {
  await redis(env, "SET", KEY, JSON.stringify(notes));
  cached = notes; cachedAt = Date.now();
}

// Notes still showing, newest first.
export async function getNotes(env, now = new Date()) {
  if (!cached || Date.now() - cachedAt > CACHE_MS) { cached = await load(env); cachedAt = Date.now(); }
  return cached.filter(n => !n.until || n.until > now.getTime()).sort((a, b) => b.added - a.added);
}

// Midnight at the end of the day `days` from today, in the dashboard's time zone.
export function endOfDay(env, now, days) {
  const p = localParts(now, tz(env));
  const left = (24 * 60 - (+p.hh * 60 + +p.mm)) * 60000;
  return now.getTime() + left + days * 24 * 3600000;
}

export async function addNote(env, text, { until = null, from = "" } = {}) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  if (!text) return null;
  const now = Date.now();
  const note = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text, added: now, until, from };
  const notes = (await load(env)).filter(n => !n.until || n.until > now);
  await save(env, [note, ...notes].slice(0, MAX_NOTES));
  return note;
}

export async function removeNote(env, id) {
  await save(env, (await load(env)).filter(n => n.id !== id));
}

// ---------- email ----------
// Works with the JSON Postmark sends for inbound email (and the similar
// fields of CloudMailin and Mailgun). The subject becomes the note, plus the
// first line of the message if there is one.
export function noteFromEmail(mail) {
  const h = mail.headers && !Array.isArray(mail.headers) ? mail.headers : {};
  const from = String(mail.FromFull?.Email || mail.envelope?.from || mail.sender || mail.From || mail.from || h.from || h.From || "");
  const email = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
  const subject = String(mail.Subject || mail.subject || h.subject || h.Subject || "")
    .replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  const body = String(mail.StrippedTextReply || mail.TextBody || mail["stripped-text"] || mail["body-plain"] || mail.plain || "");
  const first = body.split(/\r?\n/).map(l => l.trim())
    .find(l => l && !l.startsWith(">") && !/^(sent from|get outlook|--|__)/i.test(l)) || "";
  const text = subject && first && first !== subject ? `${subject}: ${first}` : subject || first;
  return { email, text };
}

// NOTES_FROM: the email addresses allowed to add notes, separated by commas.
export function senderAllowed(env, email) {
  const list = String(env.NOTES_FROM || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(email);
}

// ---------- the phone page ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function notesPage(env, key, notes, message = "") {
  const zone = tz(env);
  const fmt = t => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(new Date(t));
  const action = `/notes?key=${encodeURIComponent(key)}`;
  const items = notes.map(n => `<li><div><b>${esc(n.text)}</b><small>Added ${fmt(n.added)}${n.from ? ` by email` : ""} · ${n.until ? `until ${fmt(n.until - 1)}` : "until removed"}</small></div>
<form method="post" action="${action}"><input type="hidden" name="remove" value="${esc(n.id)}"><button aria-label="Remove">✕</button></form></li>`).join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notice board</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #111; --muted: #666; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #eee; --muted: #999; --line: #333; } }
  body { margin: 0 auto; max-width: 560px; padding: 16px; font: 18px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  h1 { font-size: 24px; margin: 0 0 12px; }
  textarea, select, button { font: inherit; }
  textarea { width: 100%; box-sizing: border-box; min-height: 80px; padding: 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  select { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  .add { padding: 10px 22px; border: 0; border-radius: 10px; background: var(--fg); color: var(--bg); font-weight: 700; }
  ul { list-style: none; padding: 0; margin: 20px 0 0; }
  li { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
  li div { flex: 1; overflow-wrap: anywhere; }
  small { display: block; color: var(--muted); font-size: 14px; }
  li button { width: 44px; height: 44px; border-radius: 22px; border: 1px solid var(--line); background: none; color: var(--fg); font-size: 18px; }
  .msg { color: var(--muted); }
</style>
</head><body>
<h1>Notice board</h1>
<form method="post" action="${action}">
  <textarea name="text" maxlength="${MAX_LENGTH}" placeholder="Write a note for the Kindle" required></textarea>
  <div class="row">
    <select name="days" aria-label="Show for">
      <option value="0">Today only</option>
      <option value="1">Until tomorrow night</option>
      <option value="6" selected>For a week</option>
      <option value="29">For a month</option>
      <option value="never">Until removed</option>
    </select>
    <button class="add">Add</button>
  </div>
</form>
${message ? `<p class="msg">${esc(message)}</p>` : ""}
${notes.length ? `<ul>${items}</ul>` : `<p class="msg">No notes yet.</p>`}
<p class="msg"><small>The Kindle shows the newest notes on the energy page and the screensaver, within a minute or two.</small></p>
</body></html>`;
}

// Handles /notes: the page (GET), adding or removing a note from it (POST, form),
// and email from Postmark etc. (POST, JSON or form with &email=1).
export async function handleNotes(request, env, key) {
  const html = (body, status = 200) => new Response(body, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
  if (!hasNotes(env)) {
    return html(`<p style="font:18px system-ui;padding:16px">The notice board needs storage: in Vercel open the project → Storage → create an Upstash for Redis database and connect it to this project, then redeploy.</p><p style="font:14px system-ui;padding:0 16px;color:#666">Storage settings found: ${esc(storageNames(env).join(", ") || "none")}</p>`, 500);
  }
  const url = new URL(request.url);
  if (request.method === "POST") {
    const type = request.headers.get("content-type") || "";
    const isEmail = url.searchParams.get("email") === "1" || type.includes("application/json");
    const data = type.includes("application/json")
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.formData().catch(() => new FormData())).entries());
    if (isEmail) {
      const { email, text } = noteFromEmail(data);
      // Always answer 200 so the email service doesn't keep retrying.
      if (!senderAllowed(env, email)) return new Response(`Ignored: ${email || "unknown sender"} isn't in NOTES_FROM.`);
      const days = Number(env.NOTES_EMAIL_DAYS);
      const note = await addNote(env, text, { from: "email", until: endOfDay(env, new Date(), Number.isFinite(days) && days > 0 ? days - 1 : 6) });
      return new Response(note ? "Added." : "Ignored: no subject or text.");
    }
    if (data.remove) await removeNote(env, String(data.remove));
    else if (data.text) {
      const until = data.days === "never" ? null : endOfDay(env, new Date(), Math.max(0, Number(data.days) || 0));
      await addNote(env, data.text, { until });
    }
    // Back to the page, so refreshing doesn't add the note again.
    return new Response(null, { status: 303, headers: { location: `/notes?key=${encodeURIComponent(key)}` } });
  }
  return html(notesPage(env, key, await getNotes(env)));
}
