// Cloudflare Pages Function — kelime görseli üretir/getirir (edge'de çalışır,
// Türkiye'de engelli görsel servislerini sunucu tarafından çağırır).
// /api/img?w=<ingilizce>&t=<turkce> → görsel bytes döner.
// İsteğe bağlı: POLLINATIONS_KEY ortam değişkeni (enter.pollinations.ai'den ücretsiz).
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const w = (url.searchParams.get("w") || "").slice(0, 60).trim();
  const t = (url.searchParams.get("t") || "").slice(0, 60).trim();
  if (!w) return new Response("missing w", { status: 400 });

  const prompt = "clean simple educational flashcard illustration of the English word '" + w + "'"
    + (t ? (" meaning " + t) : "")
    + ", single clear subject centered, flat modern vector, soft colors, plain light background, no text, no letters";

  let seed;
  const sParam = url.searchParams.get("s");
  if (sParam && /^\d+$/.test(sParam)) {
    seed = parseInt(sParam, 10) % 100000;
  } else {
    seed = 0;
    for (let i = 0; i < w.length; i++) seed = (seed * 31 + w.charCodeAt(i)) >>> 0;
    seed = seed % 100000;
  }

  const key = env.POLLINATIONS_KEY;
  const enc = encodeURIComponent(prompt);
  const candidates = [];
  if (key) {
    candidates.push("https://gen.pollinations.ai/image/" + enc + "?width=384&height=384&seed=" + seed + "&model=flux&key=" + encodeURIComponent(key));
  }
  // anahtarsız CDN uç noktası (edge'den çalışabilir)
  candidates.push("https://image.pollinations.ai/prompt/" + enc + "?width=384&height=384&seed=" + seed + "&nologo=true");

  for (const c of candidates) {
    try {
      const r = await fetch(c, { cf: { cacheTtl: 31536000, cacheEverything: true } });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.indexOf("image") === 0) {
        return new Response(r.body, {
          status: 200,
          headers: {
            "Content-Type": ct || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
    } catch (e) { /* sıradaki adayı dene */ }
  }
  return new Response("no image", { status: 502 });
}
