import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search-status?jobId=...
// Consulta o status de um job submetido via /api/places-search.js e, quando pronto,
// baixa e normaliza os resultados de todas as páginas.

export const config = { maxDuration: 20 };

function safeStringify(value, limit = 1500) {
  try {
    return JSON.stringify(value ?? null).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

// Tenta os formatos já conhecidos: local_pack (busca normal, aninhado em grupos
// com "items"), e formatos mais diretos que a busca dedicada de Maps pode usar.
function extractListingsFromContent(content) {
  if (!content || typeof content !== "object") return [];
  const localPack = content?.results?.local_pack;
  if (Array.isArray(localPack)) {
    const items = localPack.flatMap((group) => (Array.isArray(group?.items) ? group.items : (group?.title ? [group] : [])));
    if (items.length) return items;
  } else if (localPack && Array.isArray(localPack.items) && localPack.items.length) {
    return localPack.items;
  }
  const candidates = [
    content?.local_pack?.items,
    Array.isArray(content?.results) ? content.results : null,
    content?.results?.organic,
    content?.results?.paid,
    content?.local_results,
    content?.listings,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function normalizeListing(item) {
  const name = item.title || item.name || item.business_name;
  if (!name) return null;
  const links = Array.isArray(item.links) ? item.links : [];
  const siteLink = links.find((link) => link.title === "Site" || (link.href && /^https?:\/\//.test(link.href) && !link.href.includes("/maps/")));
  const routeLink = links.find((link) => link.title === "Rotas" || (link.href && link.href.startsWith("/maps/")));
  const rawMapsUrl = item.url || item.link || routeLink?.href || null;
  const mapsUrl = rawMapsUrl
    ? (rawMapsUrl.startsWith("http") ? rawMapsUrl : `https://www.google.com${rawMapsUrl}`)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${item.address || ""}`)}`;
  return {
    id: item.place_id || item.data_id || item.cid || `${name}-${item.pos ?? item.position ?? ""}`,
    name,
    address: item.address || item.formatted_address || "",
    phone: item.phone || item.phone_number || "",
    website: siteLink?.href || item.website || "",
    rating: item.rating ?? null,
    ratingCount: item.rating_count ?? item.reviews_count ?? item.reviews ?? null,
    mapsUrl,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
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

    const pages = Array.isArray(resultsPayload?.results) ? resultsPayload.results : [];
    console.log("oxylabs_pages_meta", safeStringify(pages.map((p) => ({ page: p.page, status_code: p.status_code, has_content: Boolean(p.content) })), 500));

    const allListings = pages.flatMap((page) => extractListingsFromContent(page.content));
    if (!allListings.length && pages[0]?.content) {
      console.log("oxylabs_unrecognized_shape", safeStringify(pages[0].content));
    } else if (allListings.length) {
      console.log("oxylabs_first_listing_raw", safeStringify(allListings[0], 1000));
    }

    const seen = new Set();
    const places = [];
    for (const item of allListings) {
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
