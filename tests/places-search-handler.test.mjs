import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/places-search.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("consulta Serper Maps e normaliza até 50 lugares", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.SERPER_API_KEY;
  let serperRequest;
  process.env.SERPER_API_KEY = "test-serper-key";

  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/auth/v1/user")) return new Response("{}", { status: 200 });
    if (url === "https://google.serper.dev/maps") {
      serperRequest = { url, options };
      const places = Array.from({ length: 55 }, (_, index) => ({
        title: `Empresa ${index}`,
        address: `Rua Central, ${index} - Mogi das Cruzes - SP`,
        phoneNumber: `(11) 90000-${String(index).padStart(4, "0")}`,
        website: `https://empresa-${index}.test`,
        rating: 4.5,
        ratingCount: 100 + index,
        cid: `cid-${index}`,
      }));
      return new Response(JSON.stringify({ places }), { status: 200 });
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  };

  try {
    const result = response();
    await handler({
      method: "GET",
      headers: { authorization: "Bearer user-token" },
      query: { keyword: "Dentista", locality: "Mogi das Cruzes - SP" },
    }, result);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.provider, "serper");
    assert.equal(result.body.places.length, 50);
    assert.deepEqual(result.body.places[0], {
      id: "cid-0",
      name: "Empresa 0",
      address: "Rua Central, 0 - Mogi das Cruzes - SP",
      phone: "(11) 90000-0000",
      website: "https://empresa-0.test",
      rating: 4.5,
      ratingCount: 100,
      mapsUrl: "https://www.google.com/maps?cid=cid-0",
      category: "",
      latitude: null,
      longitude: null,
      position: 1,
    });
    assert.ok(serperRequest);
    assert.equal(serperRequest.options.headers["X-API-KEY"], "test-serper-key");
    assert.deepEqual(JSON.parse(serperRequest.options.body), {
      q: "Dentista, Mogi das Cruzes - SP",
      gl: "br",
      hl: "pt-br",
      num: 50,
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = previousKey;
  }
});
