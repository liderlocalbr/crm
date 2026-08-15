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

function mapsHtml(count = 55) {
  return Array.from({ length: count }, (_, index) => `
    <div class="VkpGBb">
      <a class="vwVdIc" data-cid="cid-${index}" href="https://www.google.com/maps/place/Empresa+${index}">
        <div class="rllt__details">
          <div class="dbg0pd">Empresa ${index}</div>
          <div>4,${index % 10}(100)</div>
          <div>Rua Central, ${index} — Mogi das Cruzes, SP</div>
        </div>
      </a>
    </div>`).join("");
}

test("extrai até 50 empresas do HTML bruto do Google Maps", async () => {
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
    if (url === "https://data.oxylabs.io/v1/queries/job-123/results") {
      return new Response(JSON.stringify({
        results: [{ page: 1, status_code: 200, content: mapsHtml() }],
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
    assert.equal(result.body.status, "done");
    assert.equal(result.body.places.length, 50);
    assert.equal(result.body.places[0].id, "cid-0");
    assert.equal(result.body.places[0].name, "Empresa 0");
    assert.equal(result.body.places[0].rating, 4);
    assert.equal(result.body.places[0].ratingCount, 100);
    assert.match(result.body.places[0].mapsUrl, /google\.com\/maps\/place/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUsername === undefined) delete process.env.OXYLABS_USERNAME;
    else process.env.OXYLABS_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.OXYLABS_PASSWORD;
    else process.env.OXYLABS_PASSWORD = previousPassword;
  }
});
