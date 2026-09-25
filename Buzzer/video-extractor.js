/**
 * Buzzer — Cloudflare Worker: video URL extractor + local-video cast host.
 *
 * Two jobs in one worker:
 *   1. EXTRACT  GET  ?url=<page>      -> fetch a video page for you (bypassing
 *      CORS) and return the direct .mp4 / .m3u8 stream URL, as before.
 *   2. HOST     PUT  /upload/<name>   -> store a local video in R2 so it gets a
 *      public https URL that a Chromecast can fetch.
 *               GET  /v/<id>/<name>   -> stream it back with Range support
 *      (needed for seeking). This is what lets "Load Video" (a local file) cast.
 *
 * Deploy (once):
 *   1. Create a free Cloudflare R2 bucket: dash.cloudflare.com → R2 → Create.
 *   2. Bind it to this worker with variable name BUCKET:
 *      Workers & Pages → your worker → Settings → Bindings → Add → R2 bucket
 *      → Variable name: BUCKET.
 *   3. npx wrangler deploy video-extractor.js
 *   4. Paste the worker URL into the "Your extractor URL" field in Funscript mode.
 *
 *   Extractor usage : https://<worker>/?url=<encoded page url>
 *   Upload usage    : PUT https://<worker>/upload/<filename>   (body = video)
 *                     -> { "url": "https://<worker>/v/<id>/<filename>" }
 *
 * Note: an open upload endpoint accepts anything — fine for personal use, but if
 * you share the URL widely, add a check against a secret env var (e.g. UPLOAD_KEY).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function sanitizeName(name) {
  const n = String(name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return n || "video.mp4";
}

function parseRange(header) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  if (m[1] === "" && m[2] === "") return null;
  if (m[1] === "") {
    const n = parseInt(m[2], 10);
    return isFinite(n) && n > 0 ? { suffix: n } : null;
  }
  const start = parseInt(m[1], 10);
  if (m[2] === "") return isFinite(start) ? { offset: start } : null;
  const end = parseInt(m[2], 10);
  if (!isFinite(start) || !isFinite(end) || end < start) return null;
  return { offset: start, length: end - start + 1 };
}

async function handleUpload(request, env) {
  if (!env || !env.BUCKET) {
    return json({ error: "R2 bucket not bound. Bind an R2 bucket with variable name BUCKET and redeploy." }, 501);
  }
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+/, "").split("/");
  const name = sanitizeName(parts[1] ? decodeURIComponent(parts[1]) : "video.mp4");
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const key = "uploads/" + id + "/" + name;
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  try {
    await env.BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { name },
    });
  } catch (e) {
    return json({ error: "Upload failed: " + ((e && e.message) || e) }, 500);
  }
  return json({ url: new URL(request.url).origin + "/v/" + id + "/" + encodeURIComponent(name) }, 201);
}

async function handleServe(request, env, key) {
  if (!env || !env.BUCKET) return json({ error: "R2 bucket not bound." }, 501);
  const range = parseRange(request.headers.get("Range"));
  try {
    let obj;
    if (range) {
      const r = {};
      if (range.offset !== undefined) { r.offset = range.offset; if (range.length) r.length = range.length; }
      else if (range.suffix) r.suffix = range.suffix;
      obj = await env.BUCKET.get(key, { range: r });
    } else {
      obj = await env.BUCKET.get(key);
    }
    if (!obj) return json({ error: "Video not found." }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    if (range) {
      const total = obj.size || 0;
      let start, end;
      if (range.offset !== undefined) {
        start = range.offset;
        end = range.length ? Math.min(start + range.length - 1, total - 1) : total - 1;
      } else {
        start = Math.max(0, total - range.suffix);
        end = total - 1;
      }
      headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
      headers.set("Content-Length", String(Math.max(0, end - start + 1)));
      return new Response(obj.body, { status: 206, headers });
    }
    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function extractVideo(html) {
  // 0) Xvideos: html5player.setVideoUrlHigh('...mp4') / setVideoHLS('...m3u8')
  let m =
    html.match(/setVideoUrlHigh\s*\(\s*['"]([^'"]+\.mp4[^'"]*)['"]/i) ||
    html.match(/setVideoHLS\s*\(\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
    html.match(/setVideoUrlLow\s*\(\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
  if (m) return { url: m[1], type: /m3u8/i.test(m[1]) ? "hls" : "mp4" };

  // Normalize JSON-escaped slashes (xhamster, Pornhub mediaDefinitions, …)
  const flat = html.replace(/\\\//g, "/");

  // 1) <source src / <video src>  (icegay.tv and similar)
  m =
    flat.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i) ||
    flat.match(/<video[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
  if (m) return { url: m[1], type: /m3u8/i.test(m[1]) ? "hls" : "mp4" };

  // 2) "videoUrl" / generic JSON stream keys (Pornhub, xhamster, …)
  m =
    flat.match(/"videoUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/i) ||
    flat.match(/"(?:mp4|src|hls|video_url|videoHLS|streams)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i);
  if (m) return { url: m[1], type: /m3u8/i.test(m[1]) ? "hls" : "mp4" };

  // 3) Any absolute mp4/m3u8 URL anywhere in the page
  m = flat.match(/https?:\/\/[^"'\\\s<>]+\.(?:mp4|m3u8)[^"'\\\s<>]*/i);
  if (m) return { url: m[0], type: /m3u8/i.test(m[0]) ? "hls" : "mp4" };

  return { error: "No direct video URL found in this page." };
}

// ---- Funscripthub proxy (free JSON API, no auth) ----
const HUB_OPENAPI = "https://www.funscripthub.com/app/openapi/";
async function handleHub(url) {
  const action = url.searchParams.get("hub");
  const api = new URL(HUB_OPENAPI + action);
  for (const [k, v] of url.searchParams) {
    if (k !== "hub") api.searchParams.set(k, v);
  }
  try {
    const res = await fetch(api.toString(), { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return json({ error: "Funscripthub status " + res.status }, 502);
    const text = await res.text();
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ---- Gofile resolver (best effort; folder listings require Premium) ----
async function handleGofile(code) {
  if (!code) return json({ error: "Missing gofile code" }, 400);
  try {
    const acct = await fetch("https://api.gofile.io/accounts", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: "{}",
    });
    let token = "";
    try { const aj = await acct.json(); token = (aj && aj.data && aj.data.token) || ""; } catch (e) {}
    if (!token) return json({ error: "gofile-token" }, 502);
    const c = await fetch("https://api.gofile.io/contents/" + encodeURIComponent(code), {
      headers: { "User-Agent": UA, Authorization: "Bearer " + token },
    });
    const cj = await c.json().catch(() => ({}));
    if (cj && cj.status === "error-notPremium") return json({ error: "gofile-premium" }, 402);
    if (cj && cj.status && cj.status !== "ok") return json({ error: String(cj.status) }, 502);
    const data = (cj && cj.data) || {};
    const files = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "file") files.push({ name: node.name || "", size: node.size || 0, link: node.link || node.directLink || "" });
      if (node.children && typeof node.children === "object") for (const k in node.children) walk(node.children[k]);
    };
    walk(data);
    if (!files.length) return json({ error: "gofile-empty" }, 404);
    return json({ files }, 200);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ---- DeepSeek chat proxy: forwards to api.deepseek.com with YOUR key ----
// The app sends POST /?deepseek=1 with "Authorization: Bearer <deepseek-key>" and an
// OpenAI-style body. This worker relays it server-side (DeepSeek blocks browser CORS),
// so your DeepSeek API key bills your DeepSeek account directly — no extra account.
async function handleDeepSeek(request) {
  const key = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!key) return json({ error: "Missing DeepSeek API key." }, 400);
  let payload;
  try { payload = await request.json(); } catch (e) { return json({ error: "Invalid JSON body." }, 400); }
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key, "User-Agent": UA },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// ---- Free cloud voice proxy: browsers are CORS-blocked from translate.google.com,
// so this worker fetches the voice server-side (no key) and returns the MP3 with CORS. ----
async function handleTts(url) {
  const tl = (url.searchParams.get("tl") || "en").replace(/[^a-z-]/gi, "");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 500);
  if (!q) return json({ error: "Missing text." }, 400);
  try {
    const res = await fetch("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + encodeURIComponent(tl) + "&q=" + encodeURIComponent(q), {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return json({ error: "TTS upstream " + res.status }, 502);
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+$/, "").replace(/^\//, "");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.searchParams.get("deepseek")) return handleDeepSeek(request);
    if (url.searchParams.get("tts")) return handleTts(url);

    if (request.method === "PUT" || request.method === "POST") {
      return handleUpload(request, env);
    }

    if (path.startsWith("v/")) {
      const res = await handleServe(request, env, decodeURIComponent(path.slice(2)));
      if (request.method === "HEAD") return new Response(null, { status: res.status, headers: res.headers });
      return res;
    }

    if (url.searchParams.get("hub")) return handleHub(url);
    if (url.searchParams.get("gofile")) return handleGofile(url);

    const target = url.searchParams.get("url");
    if (!target) return json({ error: "Missing ?url= for extraction, or use PUT /upload/<name> to host a local video." }, 400);
    if (!/^https?:\/\//i.test(target)) return json({ error: "Invalid URL" }, 400);

    try {
      const res = await fetch(target, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
      if (!res.ok) return json({ error: "Upstream status " + res.status }, 502);
      const html = await res.text();
      const out = extractVideo(html);
      if (out.error) return json(out, 404);
      return json(out, 200);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
