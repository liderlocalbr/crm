import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search-status?jobId=...
// Consulta o status de um job submetido via /api/places-search.js e, quando pronto,
// baixa e normaliza os resultados no mesmo formato que o front-end já espera.

export const config = { maxDuration: 20 };

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

  const jobId = String(req.query.jobId || "").trim();
  if (!jobId) {
    res.status(400).json({ message: "jobId ausente." });
    return;
  }

  const username = process.env.OXYLABS_USERNAME;
  const password = process.env.OXYLABS_PASSWORD;
  if (!username || !password) {
    res.status(500).json({ message: "OXYLABS_USERNAME/OXYLABS_PASSWORD não configuradas nas variáveis de ambiente do projeto na Vercel." });
    return;
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  try {
    const statusResponse = await fetch(`https://data.oxylabs.io/v1/queries/${jobId}`, { headers: { Authorization: auth } });
    const statusPayload = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok) {
      res.status(statusResponse.status || 502).json({ message: statusPayload?.message || "Não foi possível checar o status do job." });
      return;
    }

    if (statusPayload.status === "faulted" || statusPayload.status === "failed") {
      res.status(200).json({ status: "error", message: "A Oxylabs não conseguiu concluir essa busca. Tente de novo." });
      return;
    }
    if (statusPayload.status !== "done") {
      res.status(200).json({ status: "pending" });
      return;
    }

    const resultsResponse = await fetch(`https://data.oxylabs.io/v1/queries/${jobId}/results?type=parsed`, { headers: { Authorization: auth } });
    const resultsPayload = await resultsResponse.json().catch(() => null);
    if (!resultsResponse.ok) {
      res.status(200).json({ status: "error", message: resultsPayload?.message || "Não foi possível baixar os resultados." });
      return;
    }

    const content = resultsPayload?.results?.[0]?.content;
    console.log("oxylabs_result_meta", safeStringify({ status_code: resultsPayload?.results?.[0]?.status_code, has_content: Boolean(content) }, 300));
    const listings = extractListings(content);
    const seen = new Set();
    const places = [];
    for (const item of listings) {
      const place = normalizeListing(item);
      if (!place || seen.has(place.name.toLowerCase())) continue;
      seen.add(place.name.toLowerCase());
      places.push(place);
    }
    res.status(200).json({ status: "done", places });
  } catch (error) {
    console.log("oxylabs_status_failed", error?.name, error?.message);
    res.status(502).json({ message: "Não foi possível checar o status da busca agora." });
  }
}
