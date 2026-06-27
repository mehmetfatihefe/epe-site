// Gemini aracısı — gizli anahtarı sunucuda tutar, kullanıcıya göstermez.
// Netlify panelinde GEMINI_API_KEY ortam değişkenini ayarla.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: { message: "Yalnızca POST." } }) };
  }
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: { message: "Sunucuda GEMINI_API_KEY tanımlı değil. Netlify > Site settings > Environment variables'a ekle." } }) };
  }
  let model, payload;
  try {
    const b = JSON.parse(event.body || "{}");
    model = b.model;
    payload = b.payload;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Geçersiz istek gövdesi." } }) };
  }
  if (!model || !payload) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Eksik parametre (model/payload)." } }) };
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
    return { statusCode: r.status, headers: { "Content-Type": "application/json" }, body: text };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: { message: "Sunucu Gemini'ye ulaşamadı." } }) };
  }
};
