import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/places-search.js";

function response(statusCode = 200) {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("submete busca local com parser estruturado do Google Search", async () => {
  const previousFetch = globalThis.fetch;
  const previousUsername = process.env.OXYLABS_USERNAME;
  const previousPassword = process.env.OXYLABS_PASSWORD;
  let oxylabsRequest;

  process.env.OXYLABS_USERNAME = "test-user";
  process.env.OXYLABS_PASSWORD = "test-password";
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/auth/v1/user")) return new Response("{}", { status: 200 });
    if (url === "https://data.oxylabs.io/v1/queries") {
      oxylabsRequest = { url, options };
      return new Response(JSON.stringify({ id: "job-123" }), { status: 200 });
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
    assert.deepEqual(result.body, { jobId: "job-123" });
    assert.ok(oxylabsRequest);

    const payload = JSON.parse(oxylabsRequest.options.body);
    assert.deepEqual(payload, {
      source: "google_maps",
      query: "Dentista em Mogi das Cruzes SP",
      geo_location: "Mogi das Cruzes,São Paulo,Brazil",
      locale: "pt-BR",
      render: "html",
      pages: 1,
      limit: 50,
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUsername === undefined) delete process.env.OXYLABS_USERNAME;
    else process.env.OXYLABS_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.OXYLABS_PASSWORD;
    else process.env.OXYLABS_PASSWORD = previousPassword;
  }
});
