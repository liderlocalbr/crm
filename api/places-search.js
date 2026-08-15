import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search?keyword=...&locality=...
// Usa a Oxylabs Web Scraper API (Realtime) com source: google_search + parse: true.
// O resultado parseado de uma busca no Google traz um bloco "local_pack" com os
// negócios locais (endereço, nota, telefone) — é esse bloco que extraímos aqui.
// As credenciais (OXYLABS_USERNAME / OXYLABS_PASSWORD) ficam só no servidor.

export const config = { maxDuration: 25 };

function buildGeoLocation(locality) {
  const parts = locality.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]},${parts[1]},Brazil`;
  return `${locality},Brazil`;
}

function safeStringify(value, limit = 1500) {
  try {
    return JSON.stringify(value ?? null).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

// O local_pack vem como uma lista de "grupos", e cada grupo tem os negócios de
// verdade dentro de "items" — por isso extraímos um nível mais fundo do que o óbvio.
function extractListings(content) {
  if (!content || typeof content !== "object") {
    console.log("oxylabs_content_not_object", typeof content, safeStringify(content, 500));
    return [];
  }
  const localPack = content?.results?.local_pack;
  if (Array.isArray(localPack)) {
    const items = localPack.flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
    if (items.length) return items;
  } else if (localPack && Array.isArray(localPack.items) && localPack.items.length) {
    return localPack.items;
  }
  const candidates = [content?.local_pack?.items, content?.results?.organic];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  console.log("oxylabs_unrecognized_shape", safeStringify(content));
  return [];
}

function normalizeListing(item) {
  const name = item.title || item.name || item.business_name;
  if (!name) return null;
  const links = Array.isArray(item.links) ? item.links : [];
  const siteLink = links.find((link) => link.title === "Site" || (link.href && /^https?:\/\//.test(link.href) && !link.href.includes("/maps/")));
  const routeLink = links.find((link) => link.title === "Rotas" || (link.href && link.href.startsWith("/maps/")));
  const mapsUrl = routeLink?.href
    ? (routeLink.href.startsWith("http") ? routeLink.href : `https://www.google.com${routeLink.href}`)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${item.address || ""}`)}`;
  return {
    id: `${name}-${item.pos ?? ""}`,
    name,
    address: item.address || item.formatted_address || "",
    phone: item.phone || item.phone_number || "",
    website: siteLink?.href || item.website || "",
    rating: item.rating ?? null,
    ratingCount: item.rating_count ?? item.reviews_count ?? null,
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
    const oxylabsResponse = await fetch("https://realtime.oxylabs.io/v1/queries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      body: JSON.stringify({
        source: "google_search",
        query: `${keyword} em ${locality}`,
        geo_location: buildGeoLocation(locality),
        parse: true,
      }),
    });

    const payload = await oxylabsResponse.json().catch(() => null);

    if (!oxylabsResponse.ok) {
      const message = payload?.message || payload?.status || "A Oxylabs recusou a busca.";
      console.log("oxylabs_http_error", oxylabsResponse.status, safeStringify(payload, 800));
      res.status(oxylabsResponse.status || 502).json({ message });
      return;
    }

    const content = payload?.results?.[0]?.content;
    const listings = extractListings(content);
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
    res.status(502).json({ message: "Não foi possível se conectar à Oxylabs agora." });
  }
}
