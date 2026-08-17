import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

export const config = { maxDuration: 20 };
const MAX_BATCHES = 10;
const BATCH_SIZE = 20;

function clampBatch(value) {
  const batch = Number.parseInt(value, 10);
  return Number.isFinite(batch) ? Math.max(0, Math.min(MAX_BATCHES - 1, batch)) : 0;
}

function shiftedCenter(center, batch) {
  if (!center || batch <= 0) return "";
  const match = String(center).match(/@?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?)z)?/);
  if (!match) return "";
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const zoom = Number(match[3] || 14);
  const offsets = [[0, 0], [0.075, 0], [-0.075, 0], [0, 0.105], [0, -0.105], [0.075, 0.105], [0.075, -0.105], [-0.075, 0.105], [-0.075, -0.105], [0.15, 0]];
  const [latOffset, lngOffset] = offsets[batch] || offsets[offsets.length - 1];
  return `@${(latitude + latOffset).toFixed(6)},${(longitude + lngOffset).toFixed(6)},${Math.min(16, Math.max(12, zoom))}z`;
}

function normalizePlace(place, position) {
  if (!place || typeof place !== "object") return null;
  const name = String(place.title || place.name || "").trim();
  const address = String(place.address || place.fullAddress || place.full_address || "").trim();
  if (!name) return null;

  const rawId = place.placeId || place.place_id || place.dataId || place.data_id || place.cid || place.fid;
  const id = String(rawId || `${name}-${address || position}`).trim();
  const mapsUrl = place.placeUrl || place.locationLink || place.location_link || place.mapsUrl || (place.cid
    ? `https://www.google.com/maps?cid=${encodeURIComponent(place.cid)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`);

  return {
    id,
    name,
    address,
    phone: String(place.phoneNumber || place.phone || "").trim(),
    website: String(place.website || place.site || "").trim(),
    cnpj: String(place.cnpj || place.CNPJ || place.taxId || place.tax_id || place.registrationNumber || "").trim(),
    rating: place.rating == null ? null : Number(place.rating),
    ratingCount: Number(place.ratingCount ?? place.reviewsCount ?? place.reviews ?? 0) || 0,
    mapsUrl,
    category: String(place.category || place.type || "").trim(),
    latitude: place.latitude ?? place.location?.latitude ?? null,
    longitude: place.longitude ?? place.location?.longitude ?? null,
    position,
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

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ message: "SERPER_API_KEY não está configurada nas variáveis de ambiente da Vercel." });
    return;
  }

  const batch = clampBatch(req.query.batch);
  const center = String(req.query.center || "").trim();
  const query = `${keyword}, ${locality}`;
  const body = { q: query, gl: "br", hl: "pt-br", num: BATCH_SIZE };
  const ll = shiftedCenter(center, batch);
  if (ll) body.ll = ll;

  try {
    const response = await fetch("https://google.serper.dev/maps", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.log("serper_maps_error", response.status, payload?.message || payload?.error || "unknown");
      res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        message: payload?.message || payload?.error || "A Serper não conseguiu concluir essa busca.",
      });
      return;
    }

    const places = (Array.isArray(payload?.places) ? payload.places : [])
      .map((place, index) => normalizePlace(place, batch * BATCH_SIZE + index + 1))
      .filter(Boolean)
      .slice(0, BATCH_SIZE);
    const responseCenter = payload?.ll || payload?.searchParameters?.ll || payload?.searchParameters?.location || center || null;
    console.log("serper_maps_done", JSON.stringify({ query, batch, count: places.length, requestedCenter: body.ll || null, responseCenter }));
    res.status(200).json({ places, provider: "serper", batch, center: responseCenter, hasMore: places.length > 0 && batch < MAX_BATCHES - 1 });
  } catch (error) {
    console.log("serper_maps_exception", error.message);
    res.status(502).json({ message: "Não foi possível se conectar à Serper agora." });
  }
}
