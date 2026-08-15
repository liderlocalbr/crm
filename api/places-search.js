import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search?keyword=...&locality=...
// Submete um job assíncrono (Push-Pull) à Oxylabs para Google Maps em HTML.
// O endpoint de status extrai até 50 cards da página e devolve dados normalizados.

export const config = { maxDuration: 20 };

const BRAZILIAN_STATE_NAMES = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

function buildGeoLocation(locality) {
  const parts = locality.split(/\s*(?:-|,)\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[0];
    const state = BRAZILIAN_STATE_NAMES[parts.at(-1).toUpperCase()] || parts.at(-1);
    return `${city},${state},Brazil`;
  }
  return `${parts[0] || locality},Brazil`;
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
    // Normaliza a query removendo caracteres especiais que causam erro na Oxylabs
    // Formato esperado: "dentista em São Paulo" (sem hífen, sem vírgula)
    const normalizedLocality = locality
      .replace(/\s*-\s*/g, " ")  // Remove hífens: "Mogi das Cruzes - SP" → "Mogi das Cruzes SP"
      .replace(/\s*,\s*/g, " "); // Remove vírgulas: "São Paulo, SP" → "São Paulo SP"
    
    const query = `${keyword} em ${normalizedLocality}`;
    const geoLocation = buildGeoLocation(locality);

    const submitResponse = await fetch("https://data.oxylabs.io/v1/queries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      body: JSON.stringify({
        // Alvo oficial de Local Search; 5 páginas x 10 resultados = até 50 empresas.
        source: "google_maps",
        query,
        geo_location: geoLocation,
        locale: "pt-BR",
        render: "html",
        xhr: true,
        pages: 5,
        limit: 10,
      }),
    });
    const payload = await submitResponse.json().catch(() => null);
    if (!submitResponse.ok || !payload?.id) {
      console.log("oxylabs_submit_error", submitResponse.status, payload?.message || payload?.status);
      res.status(submitResponse.status || 502).json({ message: payload?.message || payload?.status || "Não foi possível iniciar a busca na Oxylabs." });
      return;
    }
    console.log("oxylabs_job_submitted", payload.id, keyword, locality, "→", query, "geo:", geoLocation, "source: google_maps pages:5 limit:10");
    res.status(200).json({ jobId: payload.id });
  } catch (error) {
    console.log("oxylabs_submit_exception", error.message);
    res.status(502).json({ message: "Não foi possível se conectar à Oxylabs agora." });
  }
}
