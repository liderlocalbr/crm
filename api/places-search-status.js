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

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function attribute(block, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*[\\\"']([^\\\"']+)`, "i");
  return decodeHtml(block.match(pattern)?.[1] || "");
}

function extractHtmlListings(html) {
  if (typeof html !== "string" || !html.includes("<")) return [];
  const blocks = [];
  const blockPattern = /<div[^>]+class=[\"'][^\"']*\bVkpGBb\b[^\"']*[\"'][^>]*>[\s\S]*?(?=<div[^>]+class=[\"'][^\"']*\bVkpGBb\b|$)/gi;
  let match;
  while ((match = blockPattern.exec(html)) && blocks.length < 50) blocks.push(match[0]);
  if (!blocks.length) {
    const articlePattern = /<div[^>]+role=[\"']article[\"'][^>]*>[\s\S]*?(?=<div[^>]+role=[\"']article[\"']|$)/gi;
    while ((match = articlePattern.exec(html)) && blocks.length < 50) blocks.push(match[0]);
  }

  return blocks.map((block, index) => {
    const nameMatch = block.match(/class=[\"'][^\"']*\bdbg0pd\b[^\"']*[\"'][^>]*>\s*([^<]+)\s*<\/[^>]+>/i);
    const name = decodeHtml(nameMatch?.[1] || attribute(block, "aria-label")).trim();
    if (!name) return null;
    const textParts = [...block.matchAll(/<div[^>]*>([^<]{2,})<\/div>/gi)].map((item) => stripHtml(item[1])).filter(Boolean);
    const metadata = textParts.find((part) => /\d[.,]\d\s*\(\d/.test(part)) || "";
    const ratingMatch = metadata.match(/(\d(?:[.,]\d)?)\s*\((\d[.\d]*)\)/);
    const address = textParts.find((part) => part !== name && part !== metadata && !/[€$]\s*[€$]/.test(part)) || "";
    const website = [...block.matchAll(/href=[\"']([^\"']+)[\"']/gi)]
      .map((item) => decodeHtml(item[1]))
      .find((href) => /^https?:\/\//i.test(href) && !href.includes("google.")) || "";
    const mapsHref = [...block.matchAll(/href=[\"']([^\"']+)[\"']/gi)]
      .map((item) => decodeHtml(item[1]))
      .find((href) => href.includes("google.") || href.startsWith("/maps/")) || "";
    const cid = attribute(block, "data-cid") || attribute(block, "data-place-id");
    return {
      title: name,
      address,
      website,
      rating: ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : null,
      reviews_count: ratingMatch ? Number(ratingMatch[2].replace(/\./g, "")) : null,
      place_id: cid || `html-${index}-${name}`,
      link: mapsHref,
    };
  }).filter(Boolean);
}

function parseEmbeddedJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^\)\]\}'[,\n]?/, "").trim();
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectStructuredListings(value, output = [], seenNodes = new Set(), depth = 0) {
  if (depth > 14 || output.length >= 100 || value == null) return output;
  if (typeof value === "string") {
    const parsed = parseEmbeddedJson(value);
    if (parsed) collectStructuredListings(parsed, output, seenNodes, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  if (seenNodes.has(value)) return output;
  seenNodes.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredListings(item, output, seenNodes, depth + 1);
    return output;
  }

  if (typeof value.response_body === "string") {
    const parsed = parseEmbeddedJson(value.response_body);
    if (parsed) collectStructuredListings(parsed, output, seenNodes, depth + 1);
    else if (value.response_body.includes("<")) output.push(...extractHtmlListings(value.response_body));
  }

  const name = value.title || value.name || value.business_name;
  const hasBusinessField = value.address || value.formatted_address || value.phone || value.phone_number || value.website || value.url || value.link || value.rating != null;
  if (name && hasBusinessField) output.push(value);

  for (const [key, child] of Object.entries(value)) {
    if (key !== "response_body") collectStructuredListings(child, output, seenNodes, depth + 1);
  }
  return output;
}

// Tenta HTML, XHR JSON, local_pack parseado e formatos alternativos.
function extractListingsFromContent(content) {
  if (typeof content === "string") {
    const parsed = parseEmbeddedJson(content);
    return parsed ? collectStructuredListings(parsed) : extractHtmlListings(content);
  }
  if (Array.isArray(content)) return collectStructuredListings(content);
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
      const faultDetails = safeStringify({ status: statusPayload.status, message: statusPayload.message, error: statusPayload.error, details: statusPayload.details }, 1200);
      console.log("oxylabs_job_faulted", jobId, faultDetails);
      const rawFaultMessage = [statusPayload.message, statusPayload.error, statusPayload.details].filter(Boolean).join(" ");
      const isQuotaError = /too many requests|render dynamic|quota|rate limit/i.test(rawFaultMessage);
      const message = isQuotaError
        ? "A quota de Render Dynamic da Oxylabs foi atingida. A busca foi interrompida para não gerar novas cobranças; aguarde a renovação da quota ou desative Render Dynamic no plano da Oxylabs."
        : (statusPayload.message || "A Oxylabs não conseguiu concluir essa busca. Tente de novo.");
      res.status(200).json({ status: isQuotaError ? "quota" : "error", message });
      return;
    }
    if (statusPayload.status !== "done") {
      res.status(200).json({ status: "pending" });
      return;
    }

    const resultsResponse = await fetch(`https://data.oxylabs.io/v1/queries/${jobId}/results`, { headers: { Authorization: auth } });
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
      if (places.length >= 50) break;
    }
    res.status(200).json({ status: "done", places: places.slice(0, 50) });
  } catch (error) {
    console.log("oxylabs_status_failed", error?.name, error?.message);
    res.status(502).json({ message: "Não foi possível checar o status da busca agora." });
  }
}
