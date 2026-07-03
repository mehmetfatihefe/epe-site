// Cloudflare Pages Function — kelime görseli (edge'de çalışır, Türkiye kısıtını aşar).
// /api/img?w=<ingilizce>&t=<turkce>[&s=<seed>][&debug=1] → görsel bytes döner.
// Ana yol: GERÇEK FOTOĞRAF (Openverse + Wikipedia, anahtarsız, ücretsiz).
// Yedek: Nano Banana (GEMINI_API_KEY + faturalandırma varsa) → Pollinations.

// Pexels: temiz, ilgili stok fotoğraflar (ücretsiz anahtar gerekir → env PEXELS_KEY).
async function pexelsUrls(env, term, dbg) {
  const key = env.PEXELS_KEY;
  if (!key) { if (dbg) dbg.push("no PEXELS_KEY"); return []; }
  try {
    const api = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(term) + "&per_page=6&orientation=square";
    const r = await fetch(api, { headers: { "Authorization": key } });
    if (!r.ok) { if (dbg) dbg.push("pexels http " + r.status); return []; }
    const d = await r.json();
    const out = [];
    for (const p of (d.photos || [])) {
      const s = p.src || {};
      if (s.large) out.push(s.large); else if (s.medium) out.push(s.medium);
    }
    if (dbg) dbg.push("pexels " + out.length + " aday");
    return out;
  } catch (e) { if (dbg) dbg.push("pexels threw: " + (e && e.message)); return []; }
}

// Openverse: anahtarsız CC fotoğraf araması. Aday küçük-resim URL'leri döndürür.
async function openverseUrls(term, dbg) {
  try {
    const api = "https://api.openverse.org/v1/images/?q=" + encodeURIComponent(term) +
      "&page_size=6&mature=false&license_type=all";
    const r = await fetch(api, { headers: { "User-Agent": "epe-site/1.0 (vocabulary app)", "Accept": "application/json" } });
    if (!r.ok) { if (dbg) dbg.push("openverse http " + r.status); return []; }
    const d = await r.json();
    const out = [];
    for (const it of (d.results || [])) {
      if (it.thumbnail) out.push(it.thumbnail);
      else if (it.url) out.push(it.url);
    }
    if (dbg) dbg.push("openverse " + out.length + " aday");
    return out;
  } catch (e) { if (dbg) dbg.push("openverse threw: " + (e && e.message)); return []; }
}

// Wikipedia sayfa görseli (anahtarsız).
async function wikiUrls(term, dbg) {
  try {
    const api = "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
      encodeURIComponent(term) + "&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=500&format=json&origin=*";
    const r = await fetch(api, { headers: { "User-Agent": "epe-site/1.0 (vocabulary app)" } });
    if (!r.ok) { if (dbg) dbg.push("wiki http " + r.status); return []; }
    const d = await r.json();
    const pages = (d.query && d.query.pages) || {};
    const out = [];
    for (const k in pages) {
      const th = pages[k].thumbnail;
      if (th && th.source) out.push(th.source);
    }
    if (dbg) dbg.push("wiki " + out.length + " aday");
    return out;
  } catch (e) { if (dbg) dbg.push("wiki threw: " + (e && e.message)); return []; }
}

// base64 → Uint8Array (edge'de atob mevcut)
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Nano Banana = Google Gemini görsel modeli (faturalandırma gerektirir).
async function imageFromGemini(env, prompt, dbg) {
  const key = env.GEMINI_API_KEY;
  if (!key) { if (dbg) dbg.push("no GEMINI_API_KEY"); return null; }
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
  };
  try {
    const m = "gemini-2.5-flash-image";
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) { if (dbg) dbg.push(m + " ERROR: " + (d.error.message || "").slice(0, 160)); return null; }
    const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
    for (const p of (parts || [])) {
      if (p.inlineData && p.inlineData.data) return { bytes: b64ToBytes(p.inlineData.data), mime: p.inlineData.mimeType || "image/png" };
    }
  } catch (e) { if (dbg) dbg.push("gemini threw: " + (e && e.message)); }
  return null;
}

// Kelimeyi en iyi anlatan KISA fotoğraf-arama sorgusu (2-5 kelime).
// Somut kelimeler için kelimenin kendisi; soyut kelimeler için somut sahne.
async function searchQueryFromGemini(env, w, t, dbg) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const body = {
    contents: [{ parts: [{ text:
      "You pick a stock-photo search query that best teaches the meaning of an English word.\n" +
      "Word: \"" + w + "\"" + (t ? (" (Turkish: " + t + ")") : "") + "\n" +
      "Return ONLY a 2-5 word English search phrase of CONCRETE, photographable things that clearly show this word's meaning. " +
      "If the word is already a concrete object, return the word itself. " +
      "If it is abstract/adjective/verb, return a concrete scene that depicts it (e.g. comfortable -> person relaxing on cozy sofa; honest -> friendly handshake). " +
      "No quotes, no punctuation, no explanation."
    }] }],
    generationConfig: { temperature: 0.3 }
  };
  for (const m of ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"]) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) continue;
      let txt = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts &&
        d.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("").trim();
      if (txt) { txt = txt.replace(/["'.\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); if (dbg) dbg.push("query('" + w + "') -> " + txt + " [" + m + "]"); return txt; }
    } catch (e) {}
  }
  return null;
}

// Somut sahne cümlesi (Pollinations yedeği için).
async function sceneFromGemini(env, w, t) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const body = {
    contents: [{ parts: [{ text:
      "Describe, in at most 12 English words, a single clear concrete VISUAL SCENE that represents the meaning of the English word \"" + w + "\"" + (t ? (" (Turkish: " + t + ")") : "") +
      ". Only the scene, concrete objects/people/action. Do NOT mention the word itself or any text/letters. Reply with the scene only."
    }] }],
    generationConfig: { temperature: 0.4 }
  };
  for (const m of ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"]) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) continue;
      const txt = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts &&
        d.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("").trim();
      if (txt) return txt.replace(/["\n]/g, " ").slice(0, 160);
    } catch (e) {}
  }
  return null;
}

// Bir URL'yi çekip görselse edge cache'e koyarak döndürür.
async function serveImage(u, context, cacheKey) {
  const r = await fetch(u, { cf: { cacheTtl: 31536000, cacheEverything: true }, headers: { "User-Agent": "epe-site/1.0" } });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || ct.indexOf("image") !== 0) return null;
  const resp = new Response(r.body, { status: 200, headers: {
    "Content-Type": ct,
    "Cache-Control": "public, max-age=31536000, immutable"
  } });
  context.waitUntil(caches.default.put(cacheKey, resp.clone()));
  return resp;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const w = (url.searchParams.get("w") || "").slice(0, 60).trim();
  const t = (url.searchParams.get("t") || "").slice(0, 60).trim();
  if (!w) return new Response("missing w", { status: 400 });

  const debug = url.searchParams.get("debug") === "1";
  const dbg = debug ? [] : null;

  // Edge cache
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (!debug) { const c = await cache.match(cacheKey); if (c) return c; }

  let seed = 0;
  const sParam = url.searchParams.get("s");
  if (sParam && /^\d+$/.test(sParam)) { seed = parseInt(sParam, 10) % 100000; }
  else { for (let i = 0; i < w.length; i++) seed = (seed * 31 + w.charCodeAt(i)) >>> 0; seed = seed % 100000; }

  // Gemini kelimeyi en iyi anlatan somut arama sorgusuna çevirir (soyut kelimeler için kritik).
  let q = w;
  try { const gq = await searchQueryFromGemini(env, w, t, dbg); if (gq) q = gq; } catch (e) {}

  // 1) GERÇEK FOTOĞRAF — ana yol. Kalite sırası: Pexels → Wikipedia → Openverse.
  // Önce akıllı sorgu (q); Pexels'te sonuç boşsa ham kelimeye (w) düşülür.
  let pex = await pexelsUrls(env, q, dbg);
  if (!pex.length && q !== w) pex = await pexelsUrls(env, w, dbg);
  const photoCandidates = [].concat(
    pex,
    await wikiUrls(w, dbg),
    await openverseUrls(q, dbg)
  );
  // Seed'e göre biraz çeşitlilik (aynı kelimeye "farklı görsel" için)
  if (seed && photoCandidates.length > 1) {
    const shift = seed % photoCandidates.length;
    for (let i = 0; i < shift; i++) photoCandidates.push(photoCandidates.shift());
  }
  for (const u of photoCandidates) {
    try {
      const resp = await serveImage(u, context, cacheKey);
      if (resp) { if (dbg) return new Response(JSON.stringify({ source: "photo", url: u, log: dbg }, null, 2), { headers: { "Content-Type": "application/json" } }); return resp; }
    } catch (e) {}
  }
  if (dbg) dbg.push("no photo worked");

  // 2) Nano Banana (faturalandırma açıksa) — somut kelime için sahne.
  let scene = null;
  try { scene = await sceneFromGemini(env, w, t); } catch (e) {}
  const subject = scene || (t ? (t + ", " + w) : w);
  try {
    const gimg = await imageFromGemini(env,
      subject + ". Clean modern flat vector illustration, single clear composition, correct anatomy, soft colors, plain white background. No text, no letters.", dbg);
    if (dbg) return new Response(JSON.stringify({ source: gimg ? "gemini" : "none", scene: subject, log: dbg }, null, 2), { headers: { "Content-Type": "application/json" } });
    if (gimg) {
      const resp = new Response(gimg.bytes, { status: 200, headers: { "Content-Type": gimg.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
  } catch (e) {}

  // 3) Pollinations yedeği (flux)
  const prompt = subject + ". Clean flat vector illustration, plain white background. No text, no letters.";
  const enc = encodeURIComponent(prompt);
  const qs = "width=512&height=512&seed=" + seed;
  try {
    const resp = await serveImage("https://image.pollinations.ai/prompt/" + enc + "?" + qs + "&model=flux&nologo=true", context, cacheKey);
    if (resp) return resp;
  } catch (e) {}

  return new Response("no image", { status: 502 });
}
