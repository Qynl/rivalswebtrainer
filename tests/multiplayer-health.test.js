import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { readMultiplayerHealth } from "../src/net/health.js";
import { createMultiplayerServer } from "../server/index.js";
test("valid health JSON is accepted", async () => {
  assert.deepEqual(
    await readMultiplayerHealth(
      new Response(JSON.stringify({ protocol: 2, websocket: true })),
    ),
    { protocol: 2, websocket: true },
  );
});
for (const type of ["text/html", "application/json"])
  test(`HTTP 200 index.html fallback (${type}) produces actionable error, never a JSON parser exception`, async () => {
    await assert.rejects(
      () =>
        readMultiplayerHealth(
          new Response("<!doctype html><title>app</title>", {
            headers: { "content-type": type },
          }),
        ),
      (e) =>
        /web page instead of the multiplayer API/.test(e.message) &&
        !/Unexpected token/.test(e.message),
    );
  });
for (const [body, status, message] of [
  ["not JSON", 200, /invalid JSON/],
  ["{}", 503, /HTTP 503/],
  ["null", 200, /invalid health/],
  ["[]", 200, /invalid health/],
])
  test(`invalid health response ${body}/${status} is explained safely`, async () => {
    await assert.rejects(
      () => readMultiplayerHealth(new Response(body, { status })),
      message,
    );
  });
test("production API routes never fall through to the HTML SPA", async () => {
  const app = await createMultiplayerServer({
    geckos: false,
    staticRoot: resolve("dist"),
  });
  try {
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const base = `http://127.0.0.1:${app.server.address().port}`;
    for (const path of ["/api", "/api/missing"]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 404);
      assert.match(r.headers.get("content-type"), /application\/json/);
      assert.equal((await r.json()).error, "Unknown multiplayer API route");
    }
    assert.equal(
      (await (await fetch(base + "/api/health")).json()).protocol,
      3,
    );
  } finally {
    await app.close();
  }
});
