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
      "Access-Control-Allow-Headers": "Content-Type, Range",
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
          "Access-Control-Allow-Headers": "Content-Type, Range",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method === "PUT" || request.method === "POST") {
      return handleUpload(request, env);
    }

    if (path.startsWith("v/")) {
      const res = await handleServe(request, env, decodeURIComponent(path.slice(2)));
      if (request.method === "HEAD") return new Response(null, { status: res.status, headers: res.headers });
      return res;
    }

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
