// Cloudflare Pages Function — kelime görseli (edge'de çalışır, Türkiye kısıtını aşar).
// /api/img?w=<ingilizce>&t=<turkce>[&s=<seed>] → görsel bytes döner.
// GEMINI_API_KEY: 1) Nano Banana (Gemini görsel modeli) ile görseli DOĞRUDAN üretir;
//                 2) olmazsa kelimeyi anlatan sahne metnini üretip Pollinations'a verir.
// POLLINATIONS_KEY: isteğe bağlı yedek (yoksa anahtarsız CDN denenir).

// base64 → Uint8Array (edge'de atob mevcut)
function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Nano Banana = Google Gemini görsel modeli. Görseli DOĞRUDAN üretir.
// dbg (varsa) her modelin sonucunu/hatasını kaydeder (teşhis için).
async function imageFromGemini(env, prompt, dbg) {
  const key = env.GEMINI_API_KEY;
  if (!key) { if (dbg) dbg.push("no GEMINI_API_KEY"); return null; }
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    // Bazı modeller yalnız IMAGE kabul etmez; TEXT+IMAGE her ikisinde de çalışır.
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
  };
  const models = ["gemini-2.5-flash-image", "gemini-2.5-flash-image-preview", "gemini-2.0-flash-preview-image-generation"];
  for (const m of models) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) { if (dbg) dbg.push(m + " ERROR: " + (d.error.message || JSON.stringify(d.error)).slice(0, 200)); continue; }
      const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      if (!parts) { if (dbg) dbg.push(m + " no parts: " + JSON.stringify(d).slice(0, 200)); continue; }
      for (const p of parts) {
        if (p.inlineData && p.inlineData.data) {
          if (dbg) dbg.push(m + " OK image " + (p.inlineData.mimeType || "?"));
          return { bytes: b64ToBytes(p.inlineData.data), mime: p.inlineData.mimeType || "image/png" };
        }
      }
      if (dbg) dbg.push(m + " parts had no image");
    } catch (e) { if (dbg) dbg.push(m + " threw: " + (e && e.message)); }
  }
  return null;
}

// Görseli Pollinations metin-görsel modelinden üretmek için somut sahne cümlesi.
async function sceneFromGemini(env, w, t) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const body = {
    contents: [{ parts: [{ text:
      "Describe, in at most 12 English words, a single clear concrete VISUAL SCENE that instantly represents the meaning of the English word \"" + w + "\"" + (t ? (" (Turkish: " + t + ")") : "") +
      ". Only the scene, concrete objects/people/action, no abstract words. Do NOT mention the word itself or any text/letters. Reply with the scene only."
    }] }],
    generationConfig: { temperature: 0.4 }
  };
  const models = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
  for (const m of models) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) continue;
      const txt = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts &&
        d.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("").trim();
      if (txt) return txt.replace(/["\n]/g, " ").slice(0, 160);
    } catch (e) { /* sıradaki model */ }
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const w = (url.searchParams.get("w") || "").slice(0, 60).trim();
  const t = (url.searchParams.get("t") || "").slice(0, 60).trim();
  if (!w) return new Response("missing w", { status: 400 });

  // Edge cache: aynı görsel bir kez üretilir, sonra herkese anında gelir
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let seed;
  const sParam = url.searchParams.get("s");
  if (sParam && /^\d+$/.test(sParam)) { seed = parseInt(sParam, 10) % 100000; }
  else { seed = 0; for (let i = 0; i < w.length; i++) seed = (seed * 31 + w.charCodeAt(i)) >>> 0; seed = seed % 100000; }

  const debug = url.searchParams.get("debug") === "1";
  const dbg = debug ? [] : null;

  // Kelimeyi anlatan somut sahne (yoksa kavram)
  let scene = null;
  try { scene = await sceneFromGemini(env, w, t); } catch (e) {}
  const subject = scene || (t ? (t + ", " + w) : w);
  if (dbg) dbg.push("scene: " + subject);

  // 1) EN İYİ: Nano Banana (Gemini) görseli doğrudan üretir — edge'de, kısıt yok.
  try {
    const gimg = await imageFromGemini(env,
      subject + ". A clean modern flat vector illustration, single clear composition, distinct well-separated subjects with correct anatomy, soft friendly colors, plain white background. No text, no words, no letters, no captions.",
      dbg
    );
    if (dbg) return new Response(JSON.stringify({ hasGeminiKey: !!env.GEMINI_API_KEY, geminiImage: !!gimg, log: dbg }, null, 2), { headers: { "Content-Type": "application/json" } });
    if (gimg) {
      const resp = new Response(gimg.bytes, { status: 200, headers: {
        "Content-Type": gimg.mime,
        "Cache-Control": "public, max-age=31536000, immutable"
      } });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
  } catch (e) { /* Pollinations'a düş */ }

  // 2) YEDEK: Pollinations metin-görsel modelleri
  const prompt = subject + ". Clean modern flat vector illustration, clear composition, distinct well-separated subjects with correct anatomy, soft colors, plain white background. No text, no words, no letters, no captions.";
  const enc = encodeURIComponent(prompt);
  const qs = "width=512&height=512&seed=" + seed;
  const key = env.POLLINATIONS_KEY;
  const candidates = [];
  if (key) {
    // güçlü modeller (anahtarlı): nanobanana en iyisi; erişilemezse sıradaki denenir
    const models = (env.POLLINATIONS_MODEL || "nanobanana,seedream,gptimage,flux").split(",");
    for (let i = 0; i < models.length; i++) {
      candidates.push("https://gen.pollinations.ai/image/" + enc + "?" + qs + "&model=" + models[i].trim() + "&key=" + encodeURIComponent(key));
    }
  }
  // anahtarsız yedek (flux)
  candidates.push("https://image.pollinations.ai/prompt/" + enc + "?" + qs + "&model=flux&nologo=true");

  for (const c of candidates) {
    try {
      const r = await fetch(c, { cf: { cacheTtl: 31536000, cacheEverything: true } });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.indexOf("image") === 0) {
        const resp = new Response(r.body, { status: 200, headers: {
          "Content-Type": ct || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable"
        } });
        context.waitUntil(cache.put(cacheKey, resp.clone()));
        return resp;
      }
    } catch (e) { /* sıradaki aday */ }
  }
  return new Response("no image", { status: 502 });
}
