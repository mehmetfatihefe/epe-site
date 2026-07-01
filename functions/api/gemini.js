// Cloudflare Pages Function — Gemini aracısı (gizli anahtarı sunucuda tutar).
// Cloudflare Pages panelinde GEMINI_API_KEY ortam değişkenini ayarla.
// Bu fonksiyon /api/gemini adresinde yayınlanır.
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return json({ error: { message: "Yalnızca POST." } }, 405);
  }
  const KEY = env.GEMINI_API_KEY;
  if (!KEY) {
    return json({ error: { message: "Sunucuda GEMINI_API_KEY tanımlı değil. Cloudflare Pages > Settings > Environment variables'a ekle." } }, 500);
  }
  let model, payload;
  try {
    const b = await request.json();
    model = b.model;
    payload = b.payload;
  } catch (e) {
    return json({ error: { message: "Geçersiz istek gövdesi." } }, 400);
  }
  if (!model || !payload) {
    return json({ error: { message: "Eksik parametre (model/payload)." } }, 400);
  }
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/"
      + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(KEY);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    // Google'ın yanıtını (hata dahil) olduğu gibi geri ver; istemci kendi mantığıyla işler.
    return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return json({ error: { message: "Sunucu Gemini'ye ulaşamadı." } }, 502);
  }
}
