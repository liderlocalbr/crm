import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config.js";

// Endpoint serverless da Vercel: GET /api/places-search?keyword=...&locality=...
// Submete um job assíncrono (Push-Pull) à Oxylabs usando source: google_maps com
// múltiplas páginas, pra trazer bem mais que os 3 resultados do local_pack da busca
// normal. Quem consulta o resultado é /api/places-search-status.js.

export const config = { maxDuration: 20 };

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
    
    const submitResponse = await fetch("https://data.oxylabs.io/v1/queries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      body: JSON.stringify({ source: "google_maps", query, pages: 1 }),
    });
    const payload = await submitResponse.json().catch(() => null);
    if (!submitResponse.ok || !payload?.id) {
      console.log("oxylabs_submit_error", submitResponse.status, payload?.message || payload?.status);
      res.status(submitResponse.status || 502).json({ message: payload?.message || payload?.status || "Não foi possível iniciar a busca na Oxylabs." });
      return;
    }
    console.log("oxylabs_job_submitted", payload.id, keyword, locality, "→", query);
    res.status(200).json({ jobId: payload.id });
  } catch (error) {
    console.log("oxylabs_submit_exception", error.message);
    res.status(502).json({ message: "Não foi possível se conectar à Oxylabs agora." });
  }
}
