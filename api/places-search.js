import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search?keyword=...&locality=...
// Usa a Oxylabs Web Scraper API (source: google_maps) para buscar estabelecimentos
// reais do Google Maps. As credenciais (OXYLABS_USERNAME / OXYLABS_PASSWORD) ficam
// só aqui no servidor, nunca são enviadas ao navegador.

export const config = { maxDuration: 45 };

function safeStringify(value, limit = 1500) {
  try {
    return JSON.stringify(value ?? null).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

// A doc pública da Oxylabs não expõe o schema completo da resposta parseada para
// source=google_maps, então tentamos os formatos mais comuns e, se nenhum bater,
// logamos as chaves recebidas para ajustarmos com base nos logs reais da Vercel.
function extractListings(content) {
  if (!content || typeof content !== "object") {
    console.log("oxylabs_content_not_object", typeof content, safeStringify(content, 500));
    return [];
  }
  const candidates = [
    content?.results?.local_pack,
    content?.local_pack,
    content?.results?.organic,
    Array.isArray(content?.results) ? content.results : null,
    content?.local_results,
    content?.listings,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  console.log("oxylabs_unrecognized_shape", safeStringify(content));
  return [];
}

function normalizeListing(item) {
  const name = item.title || item.name || item.business_name;
  if (!name) return null;
  const placeId = item.place_id || item.data_id || item.cid || null;
  return {
    id: placeId || name,
    name,
    address: item.address || item.formatted_address || "",
    phone: item.phone || item.phone_number || "",
    website: item.website || item.url || "",
    rating: item.rating ?? null,
    ratingCount: item.reviews_count ?? item.rating_count ?? item.reviews ?? null,
    mapsUrl: item.link || item.url || (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`),
  };
}

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

  const username = process.env.OXYLABS_USERNAME;
  const password = process.env.OXYLABS_PASSWORD;
  if (!username || !password) {
    res.status(500).json({ message: "OXYLABS_USERNAME/OXYLABS_PASSWORD não configuradas nas variáveis de ambiente do projeto na Vercel." });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);
    let oxylabsResponse;
    try {
      oxylabsResponse = await fetch("https://realtime.oxylabs.io/v1/queries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        },
        body: JSON.stringify({
          source: "google_maps",
          query: `${keyword} em ${locality}, Brasil`,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await oxylabsResponse.json().catch(() => null);

    if (!oxylabsResponse.ok) {
      const message = payload?.message || payload?.status || "A Oxylabs recusou a busca.";
      console.log("oxylabs_http_error", oxylabsResponse.status, safeStringify(payload, 800));
      res.status(oxylabsResponse.status || 502).json({ message });
      return;
    }

    const result = payload?.results?.[0];
    console.log("oxylabs_result_meta", safeStringify({ status_code: result?.status_code, url: result?.job?.url || result?.url, has_content: Boolean(result?.content) }, 500));
    const listings = extractListings(result?.content);
    const seen = new Set();
    const places = [];
    for (const item of listings) {
      const place = normalizeListing(item);
      if (!place || seen.has(place.name.toLowerCase())) continue;
      seen.add(place.name.toLowerCase());
      places.push(place);
    }

    res.status(200).json({ places });
  } catch (error) {
    console.log("oxylabs_request_failed", error?.name, error?.message);
    const timedOut = error?.name === "AbortError";
    res.status(502).json({ message: timedOut ? "A Oxylabs demorou demais para responder. Tente novamente." : "Não foi possível se conectar à Oxylabs agora." });
  }
}

