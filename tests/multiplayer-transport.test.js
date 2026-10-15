import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createMultiplayerServer } from "../server/index.js";
import { MultiplayerClient } from "../src/net/client.js";
import { decodeSnapshot } from "../src/net/snapshot-codec.js";
async function listen(app) {
  app.server.listen(0, "0.0.0.0");
  await once(app.server, "listening");
  return app.server.address().port;
}
function receive(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", message);
      reject(Error("Timed out waiting for packet"));
    }, 3000);
    function message(data, binary) {
      if (binary) return;
      const p = JSON.parse(data.toString());
      if (predicate(p)) {
        clearTimeout(timer);
        ws.off("message", message);
        resolve(p);
      }
    }
    ws.on("message", message);
  });
}
test("real same-origin WebSocket handshake, private lobby, binary match frames and denied cross-origin upgrades", async () => {
  const app = await createMultiplayerServer({ geckos: false });
  let a, b;
  try {
    const port = await listen(app),
      origin = "http://localhost:5173";
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(
      (r) => r.json(),
    );
    assert.equal(health.websocket, true);
    assert.equal(health.geckos, false);
    a = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { origin });
    const helloA = await receive(a, (p) => p.type === "hello");
    b = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { origin });
    const helloB = await receive(b, (p) => p.type === "hello");
    assert.notEqual(helloA.id, helloB.id);
    const roomPacket = receive(a, (p) => p.type === "room");
    a.send(JSON.stringify({ type: "create", name: "A", private: true }));
    const { room } = await roomPacket;
    const joined = receive(b, (p) => p.type === "room");
    b.send(JSON.stringify({ type: "join", code: room.code, name: "B" }));
    await joined;
    const ready = receive(
      a,
      (p) => p.type === "room" && p.room.players.every((p) => p.ready),
    );
    b.send(JSON.stringify({ type: "ready", ready: true }));
    await ready;
    const started = receive(a, (p) => p.type === "start");
    a.send(JSON.stringify({ type: "start" }));
    const start = await started,
      metadata = new Map(start.snapshot.players.map((p) => [p.index, p]));
    const bytes = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("No binary snapshots")),
        2000,
      );
      a.on("message", (data, binary) => {
        if (binary) {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });
    assert.equal(decodeSnapshot(bytes, metadata).matchId, start.matchId);
    assert.equal(decodeSnapshot(bytes, metadata).players.length, 2);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/api/live`, {
      origin: "https://evil.invalid",
    });
    const status = await new Promise((resolve) => {
      bad.on("unexpected-response", (_req, res) => {
        res.resume();
        bad.terminate();
        resolve(res.statusCode);
      });
      bad.on("error", () => {});
    });
    assert.equal(status, 403);
  } finally {
    a?.terminate();
    b?.terminate();
    await app.close();
  }
});
test("geckos adapter uses the actual channel API: reliable controls/events and unreliable raw binary snapshots (mock native boundary)", async () => {
  let connection;
  const factory = () => ({
      addServer() {},
      onConnection(fn) {
        connection = fn;
      },
    }),
    app = await createMultiplayerServer({
      geckos: true,
      geckosFactory: factory,
    });
  await listen(app);
  const channels = [];
  function channel() {
    const messages = [],
      raw = [],
      handlers = new Map(),
      c = {
        emit: (event, data, options) => messages.push({ event, data, options }),
        raw: { emit: (data) => raw.push(data) },
        on: (event, fn) => handlers.set(event, fn),
        onDisconnect() {},
        close: async () => {},
      };
    connection(c);
    channels.push(c);
    return { messages, raw, send: (p) => handlers.get("packet")(p) };
  }
  try {
    assert.equal(app.geckos(), true);
    const a = channel(),
      b = channel();
    a.send({ type: "create", name: "A" });
    const room = a.messages.find((p) => p.data.type === "room").data.room;
    b.send({ type: "join", code: room.code, name: "B" });
    b.send({ type: "ready", ready: true });
    a.send({ type: "start" });
    for (let i = 0; i < 10; i++) app.service.step(1 / 120);
    assert.ok(a.raw[0] instanceof Uint8Array);
    assert.ok(
      a.messages.some(
        (p) => p.data.type === "start" && p.options.reliable === true,
      ),
    );
    assert.ok(
      a.messages.some(
        (p) => p.data.type === "events" && p.options.reliable === true,
      ),
    );
    assert.ok(!a.messages.some((p) => p.data.type === "snapshot"));
  } finally {
    await app.close();
  }
});
test("out-of-order room/membership updates and old-match snapshots cannot reset or resurrect a lobby", async () => {
  const c = new MultiplayerClient();
  c.generation = 1;
  c.membership = 4;
  c.matchRevision = 10;
  c.activeMatchId = 123;
  c.patch({
    id: "a",
    room: { code: "AAAAAA", revision: 10, phase: "playing" },
  });
  let received = 0;
  c.session = {
    receive() {
      received++;
    },
  };
  await c.packet(
    {
      type: "room",
      membership: 4,
      room: { code: "AAAAAA", revision: 9, phase: "lobby" },
    },
    1,
  );
  assert.equal(c.state.room.phase, "playing");
  await c.packet({ type: "left", membership: 3 }, 1);
  assert.equal(c.state.room.code, "AAAAAA");
  await c.packet({ type: "snapshot", snapshot: { matchId: 122 } }, 1);
  assert.equal(received, 0);
  await c.packet({ type: "snapshot", snapshot: { matchId: 123 } }, 1);
  assert.equal(received, 1);
  c.seenMatches.add(120);
  await c.packet({ type: "start", membership: 4, matchId: 120 }, 1);
  assert.equal(c.started, false);
});

test("losing an idle multiplayer connection does not interrupt a separate offline game", () => {
  const c = new MultiplayerClient();
  let closed = 0;
  c.connection = {
    close() {
      closed++;
    },
  };
  c.patch({ status: "connected", open: false });
  c.disconnected("Server stopped");
  assert.equal(closed, 1);
  assert.equal(c.state.open, false);
  assert.equal(c.state.status, "error");
  assert.equal(c.activeMatchId, null);
});

test("production serving keeps assets cacheable, SPA navigation working and unknown APIs out of the HTML fallback", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "arena-static-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<html>arena</html>");
  await writeFile(join(root, "assets", "game.js"), "export {}");
  const app = await createMultiplayerServer({
    geckos: false,
    staticRoot: root,
  });
  await listen(app);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const asset = await fetch(base + "/assets/game.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.match(asset.headers.get("cache-control"), /immutable/);
    const nav = await fetch(base + "/invite/AAAAAA");
    assert.match(await nav.text(), /arena/);
    assert.equal((await fetch(base + "/api/missing")).status, 404);
    assert.equal((await fetch(base + "/.wrtc/missing")).status, 404);
    assert.equal(
      (await fetch(base + "/assets/game.js", { method: "POST" })).status,
      405,
    );
    assert.equal(
      await (await fetch(base + "/assets/game.js", { method: "HEAD" })).text(),
      "",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
