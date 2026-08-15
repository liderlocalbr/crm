import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/places-search-status.js";

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

test("normaliza local_pack parseado em empresas para a interface", async () => {
  const previousFetch = globalThis.fetch;
  const previousUsername = process.env.OXYLABS_USERNAME;
  const previousPassword = process.env.OXYLABS_PASSWORD;

  process.env.OXYLABS_USERNAME = "test-user";
  process.env.OXYLABS_PASSWORD = "test-password";
  globalThis.fetch = async (url) => {
    if (url.includes("/auth/v1/user")) return new Response("{}", { status: 200 });
    if (url === "https://data.oxylabs.io/v1/queries/job-123") {
      return new Response(JSON.stringify({ status: "done" }), { status: 200 });
    }
    if (url === "https://data.oxylabs.io/v1/queries/job-123/results?type=parsed") {
      return new Response(JSON.stringify({
        results: [{
          page: 1,
          status_code: 200,
          content: {
            results: {
              local_pack: [{
                items: [{
                  title: "Clínica Exemplo",
                  address: "Rua Central, 100 — Mogi das Cruzes, SP",
                  phone: "+55 11 99999-0000",
                  rating: 4.8,
                  reviews_count: 120,
                  place_id: "place-1",
                  links: [{ title: "Site", href: "https://clinica-exemplo.test" }],
                }],
              }],
            },
          },
        }],
      }), { status: 200 });
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  };

  try {
    const result = response();
    await handler({
      method: "GET",
      headers: { authorization: "Bearer user-token" },
      query: { jobId: "job-123" },
    }, result);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      status: "done",
      places: [{
        id: "place-1",
        name: "Clínica Exemplo",
        address: "Rua Central, 100 — Mogi das Cruzes, SP",
        phone: "+55 11 99999-0000",
        website: "https://clinica-exemplo.test",
        rating: 4.8,
        ratingCount: 120,
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Cl%C3%ADnica%20Exemplo%20Rua%20Central%2C%20100%20%E2%80%94%20Mogi%20das%20Cruzes%2C%20SP",
      }],
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUsername === undefined) delete process.env.OXYLABS_USERNAME;
    else process.env.OXYLABS_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.OXYLABS_PASSWORD;
    else process.env.OXYLABS_PASSWORD = previousPassword;
  }
});
