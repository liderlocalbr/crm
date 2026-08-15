import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search?keyword=...&locality=...
// A GOOGLE_MAPS_API_KEY fica só aqui no servidor (variável de ambiente da Vercel),
// nunca é enviada ao navegador — evita expor a chave e problemas de restrição de referrer.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Método não permitido." });
    return;
  }

  const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    res.status(401).json({ message: "Sessão não encontrada. Faça login novamente." });
    return;
  }

  // Confirma que quem está chamando é um usuário autenticado do CRM
  // (evita que qualquer pessoa use este endpoint e consuma sua cota do Google).
  const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userCheck.ok) {
    res.status(401).json({ message: "Sessão expirada. Faça login novamente." });
    return;
  }

  const keyword = String(req.query.keyword || "").trim();
  const locality = String(req.query.locality || "").trim();
  if (keyword.length < 2 || locality.length < 2) {
    res.status(400).json({ message: "Informe uma palavra-chave e uma cidade válidas (mín. 2 caracteres)." });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ message: "GOOGLE_MAPS_API_KEY não está configurada nas variáveis de ambiente do projeto na Vercel." });
    return;
  }

  try {
    const googleResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.nationalPhoneNumber",
          "places.internationalPhoneNumber",
          "places.websiteUri",
          "places.rating",
          "places.userRatingCount",
          "places.googleMapsUri",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: `${keyword} em ${locality}`, languageCode: "pt-BR", regionCode: "BR" }),
    });

    const payload = await googleResponse.json().catch(() => null);

    if (!googleResponse.ok) {
      const message = payload?.error?.message || "O Google recusou a busca de lugares.";
      const status = payload?.error?.status || "";
      // Deixa o motivo explícito pro front — ajuda a diagnosticar rápido:
      // API não habilitada, billing ausente, key com restrição errada, etc.
      res.status(googleResponse.status || 502).json({ message: status ? `${message} [${status}]` : message });
      return;
    }

    const places = (payload.places || []).map((place) => ({
      id: place.id,
      name: place.displayName?.text || "Sem nome",
      address: place.formattedAddress || "",
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
      website: place.websiteUri || "",
      rating: place.rating ?? null,
      ratingCount: place.userRatingCount ?? null,
      mapsUrl: place.googleMapsUri || "",
    }));

    res.status(200).json({ places });
  } catch (error) {
    res.status(502).json({ message: "Não foi possível se conectar ao Google Places." });
  }
}
