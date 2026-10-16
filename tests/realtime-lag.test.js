import test from "node:test";
import { setup } from "./helpers/match.js";
import assert from "node:assert/strict";
import { SnapshotBuffer } from "../src/net/protocol.js";
import { BrowserPeerNetwork } from "../src/net/peer-network.js";
import { MultiplayerClient } from "../src/net/client.js";
import { MultiplayerSession } from "../src/net/session.js";
import {
  SnapshotInbox,
  splitCombatEvents,
  EFFECT_PACKET_BYTES,
} from "../src/net/realtime-delivery.js";

const trace = (id) => ({
  id,
  type: "trace",
  owner: "other",
  a: [0, 1, 0],
  b: [2, 1, 0],
  team: 1,
});
const impact = (id) => ({
  id,
  type: "impact",
  position: [2, 1, 0],
  normal: [0, 0, 1],
});
function transport() {
  const client = new MultiplayerClient(),
    received = [];
  client.activeMatchId = 7;
  client.packet = async (p) => {
    received.push(p);
  };
  const net = new BrowserPeerNetwork(client, client.generation);
  const fast = [],
    reliable = [];
  const conn = {
    open: true,
    close() {},
    metadata: { effectsLane: 1 },
    stateReady: true,
    stateLane: {
      readyState: "open",
      bufferedAmount: 0,
      send: (p) => fast.push(p),
    },
    dataChannel: { bufferedAmount: 0 },
    send: (p) => reliable.push(p),
  };
  return { net, conn, fast, reliable, client, received };
}
function eventSession() {
  const s = Object.create(MultiplayerSession.prototype),
    calls = [];
  Object.assign(s, {
    id: "me",
    round: 1,
    lastEvent: 0,
    latest: { time: 1 },
    client: { rtt: 0 },
    entities: new Map(),
    game: {
      player: { alive: true },
      clock: 1,
      tracer: () => calls.push("trace"),
      combatFX: { impact: () => calls.push("impact") },
      events: {
        kill: () => calls.push("kill"),
        toast: () => calls.push("forfeit"),
      },
    },
  });
  return { s, calls };
}
function movingFrame(time) {
  return {
    time,
    players: [
      {
        id: "p",
        x: time * 8,
        y: 0,
        z: 0,
        vx: 8,
        vy: 0,
        vz: 0,
        alive: true,
        grounded: true,
        yaw: 0,
      },
    ],
  };
}
function playoutTrace(Buffer) {
  const b = new Buffer(0.06, { adaptive: true });
  const queue = [];
  let minStep = 0,
    maxStep = 0,
    previous = null,
    reverse = 0;
  // 144 Hz presentation, 30 Hz state, one-way 40ms, variable jitter, 20%
  // loss and 180ms packet holds. These are actual arrival times, not timestamps
  // spuriously in the future. Release each held batch in authority order.
  for (let frame = 0; frame < 144 * 12; frame++) {
    const now = frame / 144;
    while (queue.length && queue[0].arrival <= now) {
      const p = queue.shift();
      b.push(movingFrame(p.time), 100 + now);
    }
    if (frame % 24 === 0) {
      for (let i = 0; i < 5; i++) {
        const time = now + i / 30;
        if (Math.round(time * 30) % 5 === 0) continue;
        const hold = Math.floor(time * 2) % 5 === 2 ? 0.18 : 0;
        queue.push({
          time,
          arrival: time + 0.04 + (Math.sin(time * 23) + 1) * 0.025 + hold,
        });
      }
      queue.sort((a, b) => a.arrival - b.arrival || a.time - b.time);
    }
    const p = b.sample(100 + now)?.[0];
    if (p && previous !== null) {
      const step = p.x - previous;
      minStep = Math.min(minStep, step);
      maxStep = Math.max(maxStep, step);
      if (step < -1e-8) reverse++;
      assert.ok(Number.isFinite(p.x));
    }
    if (p) previous = p.x;
  }
  return { minStep, maxStep, reverse, b };
}

test("adaptive playout never rewinds through burst loss and jitter at 144 Hz", () => {
  const result = playoutTrace(SnapshotBuffer);
  assert.equal(result.reverse, 0);
  assert.ok(result.minStep >= -1e-8);
  assert.ok(result.maxStep <= (8 / 144) * 1.151);
  assert.ok(result.b.frames.length <= 32);
  console.log(
    JSON.stringify({
      jitterPlayout: {
        reverse: result.reverse,
        minStep: result.minStep,
        maxStep: result.maxStep,
      },
    }),
  );
});
test("playout catches up after a suspended frame, resets for a round and caps extrapolation", () => {
  const b = new SnapshotBuffer(0.06, { adaptive: true });
  b.push(movingFrame(0), 100);
  b.push(movingFrame(0.1), 100.1);
  const first = b.sample(100.15)[0].x;
  for (let i = 2; i <= 30; i++) b.push(movingFrame(i / 10), 100 + i / 10);
  const after = b.sample(103.05)[0].x;
  assert.ok(after >= first && after > 23);
  assert.ok(b.sample(110)[0].x <= 24.4 + 1e-9);
  assert.equal(b.sample(110.1)[0].x, b.sample(110)[0].x);
  b.clear();
  assert.equal(b.sample(120), null);
  assert.equal(b.playhead, null);
  b.push(movingFrame(0), 120);
  assert.equal(b.sample(120)[0].x, 0);
});
test("cosmetics cannot skip delayed critical events, even across reliable fallback duplicates", () => {
  const { s, calls } = eventSession();
  s.processEvents([trace(100), impact(99)]);
  s.processEvents([
    {
      id: 2,
      type: "impulse",
      player: "me",
      round: 1,
      time: 1,
      velocity: [3, 12, 4],
    },
    { id: 3, type: "kill", killer: "OTHER", victim: "ENEMY", source: "other" },
  ]);
  s.processEvents([impact(99), trace(100), { id: 3, type: "kill" }]);
  assert.equal(s.game.player.vy, 12);
  assert.deepEqual(calls, ["trace", "impact", "kill"]);
  assert.equal(s.lastEvent, 3);
  for (let i = 101; i < 2000; i++) s.processEvents([trace(i)]);
  assert.equal(s.effectIds.size, 256);
});
test("new cosmetic packet IDs cannot suppress a delayed forfeit", () => {
  const { s, calls } = eventSession();
  s.processEvents([trace(9)]);
  s.processEvents([{ id: 1, type: "forfeit" }]);
  assert.deepEqual(calls, ["trace", "forfeit"]);
});
test("bounded effects use unordered state while every critical event stays reliable", () => {
  const { net, conn, fast, reliable } = transport();
  const critical = ["damage", "kill", "impulse", "round", "forfeit"].map(
    (type, i) => ({ id: i + 1, type }),
  );
  const packet = {
    type: "events",
    matchId: 7,
    events: [
      ...critical,
      ...Array.from({ length: 120 }, (_, i) => trace(i + 10)),
    ],
  };
  net.safeSend(conn, packet);
  assert.deepEqual(reliable[0].events, critical);
  assert.equal(fast.length, 1);
  const effect = JSON.parse(fast[0]);
  assert.equal(effect.type, "effects");
  assert.equal(effect.matchId, 7);
  assert.ok(effect.events.length <= 12);
  assert.ok(
    new TextEncoder().encode(fast[0]).byteLength <= EFFECT_PACKET_BYTES,
  );
  assert.equal(effect.events.at(-1).id, 129);
  assert.ok(net.metrics.effectsDropped > 0);
  net.close();
});
test("effects have a 12KB/s refill budget and never spill to reliable under congestion", () => {
  const { net, conn, fast, reliable } = transport();
  const packet = {
    type: "events",
    matchId: 7,
    events: [trace(1), impact(2), { id: 3, type: "damage" }],
  };
  conn.stateLane.bufferedAmount = 1025;
  net.safeSend(conn, packet);
  assert.equal(fast.length, 0);
  assert.equal(reliable.length, 1);
  assert.deepEqual(reliable[0].events, [{ id: 3, type: "damage" }]);
  conn.stateLane.bufferedAmount = 0;
  conn.effectBudget = 0;
  conn.effectBudgetAt = performance.now();
  net.safeSend(conn, packet);
  assert.equal(fast.length, 0);
  conn.effectBudgetAt = performance.now() - 1000;
  net.safeSend(conn, packet);
  assert.equal(fast.length, 1);
  conn.stateLane.bufferedAmount = 2049;
  assert.equal(net.sendState(conn, new Uint8Array(611)), true);
  assert.equal(
    fast.length,
    1,
    "a stalled lane must not queue another stale state frame",
  );
  net.close();
});
for (const mode of ["old build", "lane closed", "fallback"]) {
  test(`reliable compatibility retains effects and critical events for ${mode}`, () => {
    const { net, conn, fast, reliable } = transport();
    if (mode === "old build") delete conn.metadata.effectsLane;
    if (mode === "lane closed") conn.stateLane.readyState = "closed";
    if (mode === "fallback") conn.stateReady = false;
    const p = {
      type: "events",
      matchId: 7,
      events: [trace(1), { id: 2, type: "kill" }],
    };
    net.safeSend(conn, p);
    assert.deepEqual(reliable, [p]);
    assert.deepEqual(fast, []);
    net.close();
  });
}
test("failed disposable sends do not move cosmetics into the reliable gameplay queue", () => {
  const { net, conn, reliable } = transport();
  conn.stateLane.send = () => {
    throw Error("closed during send");
  };
  net.safeSend(conn, {
    type: "events",
    matchId: 7,
    events: [trace(1), { id: 2, type: "damage" }],
  });
  assert.deepEqual(reliable[0].events, [{ id: 2, type: "damage" }]);
  net.close();
});
test("effects packet parsing rejects foreign matches, oversized batches and non-cosmetic gameplay", async () => {
  const { net, conn, client } = transport();
  net.remote = conn;
  conn.stateLane = null;
  conn.peerConnection = { createDataChannel: () => ({ readyState: "open" }) };
  net.setupStateLane(conn);
  const seen = [];
  client.packet = MultiplayerClient.prototype.packet.bind(client);
  client.session = { processEvents: (p) => seen.push(...p) };
  const send = (p) => conn.stateLane.onmessage({ data: JSON.stringify(p) });
  send({
    type: "effects",
    matchId: 7,
    events: [trace(1), { id: 2, type: "damage" }, impact(3)],
  });
  send({ type: "effects", matchId: 99, events: [trace(4)] });
  send({
    type: "effects",
    matchId: 7,
    events: Array.from({ length: 13 }, (_, i) => ({ id: i, type: "trace" })),
  });
  send({
    type: "effects",
    matchId: 7,
    events: [trace(5)],
    padding: "x".repeat(1001),
  });
  conn.stateLane.onmessage({ data: "{" });
  await Promise.resolve();
  assert.deepEqual(seen, [trace(1), impact(3)]);
  assert.equal(net.metrics.effectsReceived, 1);
  net.close();
});
test("coalescing keeps only the newest snapshot and flushes it before critical events", async () => {
  const { net, received } = transport();
  for (let time = 0; time < 30; time++)
    net.deliver({ type: "snapshot", snapshot: { matchId: 7, time } });
  net.deliver({ type: "snapshot", snapshot: { matchId: 99, time: 40 } });
  net.deliver({ type: "snapshot", snapshot: { matchId: 7, time: 4 } });
  assert.deepEqual(received, []);
  net.deliver({
    type: "events",
    matchId: 7,
    events: [{ id: 1, type: "damage" }],
  });
  assert.equal(received.length, 2);
  assert.equal(received[0].snapshot.time, 29);
  assert.equal(received[1].type, "events");
  assert.equal(net.inbox.coalesced, 29);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 2);
  net.close();
});
test("snapshot inbox schedules one task and never applies queued data after close or generation change", async () => {
  const { net, client, received } = transport();
  net.deliver({ type: "snapshot", snapshot: { matchId: 7, time: 1 } });
  client.generation++;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 0);
  client.generation = net.generation;
  net.deliver({ type: "snapshot", snapshot: { matchId: 7, time: 2 } });
  net.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 0);
  assert.equal(net.inbox.pending, null);
  const callbacks = [],
    calls = [];
  const box = new SnapshotInbox(
    (p) => calls.push(p.snapshot.time),
    (fn) => {
      callbacks.push(fn);
      return callbacks.length;
    },
    () => {},
  );
  box.push({ snapshot: { time: 1 } });
  box.push({ snapshot: { time: 2 } });
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.deepEqual(calls, [2]);
});
test("a delayed multi-shot acknowledgement retires all confirmed predictions without duplicate feedback or ammo edits", () => {
  const s = Object.create(MultiplayerSession.prototype),
    calls = [];
  const self = {
    id: "me",
    slot: 0,
    weapon: "rifle",
    shot: 1,
    stats: { shots: 0 },
    ammo: [{ mag: 30 }],
  };
  const game = {
    clock: 10,
    loadout: ["rifle"],
    slot: 0,
    state: "playing",
    player: { alive: true },
    presentShot: (id) => calls.push(id),
  };
  Object.assign(s, {
    game,
    id: "me",
    latest: { players: [self] },
    predictedShots: [],
    lastReceived: performance.now() / 1000,
    lastSelfShot: 1,
    lastSelfShotCount: 0,
  });
  for (let i = 0; i < 6; i++) {
    assert.equal(s.predictShot(), true);
    game.clock += 0.11;
  }
  assert.equal(s.predictedShots.length, 6);
  s.confirmShot({ ...self, shot: 1.6, stats: { shots: 6 } }, { time: 1.61 });
  assert.equal(s.predictedShots.length, 0);
  assert.equal(calls.length, 6);
  s.confirmShot({ ...self, shot: 1.6, stats: { shots: 6 } }, { time: 1.62 });
  assert.equal(calls.length, 6);
  assert.equal(self.ammo[0].mag, 30);
  assert.equal(
    s.predictShot(),
    true,
    "firing feedback must not wait for phantom pending shots",
  );
});
test("coalesced firing confirmations retire across weapon switches but preserve unconfirmed shots", () => {
  const s = Object.create(MultiplayerSession.prototype);
  Object.assign(s, {
    game: {
      clock: 2,
      loadout: ["rifle", "pistol"],
      slot: 1,
      presentShot() {
        throw Error("double presentation");
      },
    },
    lastSelfShot: 0,
    lastSelfShotCount: 10,
    predictedShots: [
      { weapon: "rifle", time: 1.6 },
      { weapon: "rifle", time: 1.7 },
      { weapon: "pistol", time: 1.9 },
    ],
  });
  s.confirmShot(
    { weapon: "pistol", shot: 1.8, stats: { shots: 12 } },
    { time: 1.85 },
  );
  assert.deepEqual(s.predictedShots, [{ weapon: "pistol", time: 1.9 }]);
});

test("30/60/144 Hz presentation sends fresh held input at most once per frame, capped at 60 Hz", () => {
  for (const fps of [30, 60, 144]) {
    const { m, g } = setup();
    try {
      let sends = 0,
        accumulator = 0;
      const s = Object.create(MultiplayerSession.prototype);
      Object.assign(s, {
        game: g,
        client: {},
        sendTime: 0,
        buffer: { sample: () => null },
        projectiles: new Map(),
        zones: new Map(),
        sendInput() {
          this.inputDue = false;
          sends++;
        },
      });
      g.player.alive = false;
      g.updateEffects = () => {};
      for (let i = 0; i < fps * 2; i++) {
        accumulator += 1 / fps;
        const before = sends;
        while (accumulator >= 1 / 120 - 1e-9) {
          s.step(1 / 120);
          accumulator -= 1 / 120;
        }
        assert.equal(
          sends,
          before,
          "catch-up simulation must not burst intermediate input packets",
        );
        s.present(1 / fps);
        assert.ok(sends - before <= 1);
      }
      assert.equal(sends, Math.min(60, fps) * 2);
    } finally {
      m.dispose();
    }
  }
});
test("a stalled frame coalesces held input but jump/action edges still send immediately", () => {
  const { m, g } = setup();
  try {
    let sends = 0;
    const s = Object.create(MultiplayerSession.prototype);
    Object.assign(s, {
      game: g,
      client: {},
      actionId: 0,
      actions: [],
      sendTime: 0,
      buffer: { sample: () => null },
      projectiles: new Map(),
      zones: new Map(),
      sendInput() {
        this.inputDue = false;
        sends++;
      },
    });
    g.player.alive = false;
    g.updateEffects = () => {};
    for (let i = 0; i < 24; i++) s.step(1 / 120);
    assert.equal(sends, 0);
    s.present(0.2);
    assert.equal(sends, 1);
    s.action("jump");
    assert.equal(sends, 2);
    assert.deepEqual(s.actions, [{ id: 1, type: "jump" }]);
    s.present(1 / 60);
    assert.equal(sends, 2);
  } finally {
    m.dispose();
  }
});
test("non-shot statistics updates cannot retire a future firing prediction", () => {
  const s = Object.create(MultiplayerSession.prototype);
  Object.assign(s, {
    game: {
      clock: 2,
      loadout: ["rifle"],
      slot: 0,
      presentShot() {
        throw Error("double shot");
      },
    },
    lastSelfShot: 1,
    lastSelfShotCount: 1,
    predictedShots: [],
  });
  // Quick utility increments match shots without changing the gun-shot timestamp.
  s.confirmShot(
    { weapon: "rifle", shot: 1, stats: { shots: 2 } },
    { time: 1.1 },
  );
  s.predictedShots.push(
    { weapon: "rifle", time: 1.8 },
    { weapon: "rifle", time: 1.9 },
  );
  s.confirmShot(
    { weapon: "rifle", shot: 1.85, stats: { shots: 3 } },
    { time: 1.9 },
  );
  assert.deepEqual(s.predictedShots, [{ weapon: "rifle", time: 1.9 }]);
});
test("cosmetic packet cap counts UTF-8 bytes and rejects malformed vectors", async () => {
  const p = splitCombatEvents({
    matchId: 7,
    events: Array.from({ length: 12 }, (_, i) => ({
      ...trace(i + 1),
      owner: "界".repeat(45),
    })),
  });
  assert.ok(new TextEncoder().encode(p.data).byteLength <= EFFECT_PACKET_BYTES);
  const client = new MultiplayerClient(),
    seen = [];
  client.activeMatchId = 7;
  client.session = { processEvents: (events) => seen.push(...events) };
  await client.packet(
    {
      type: "effects",
      matchId: 7,
      events: [
        trace(1),
        { id: 2, type: "trace" },
        { ...impact(3), position: [null, 0, 0] },
        { ...trace(4), a: [1e9, 0, 0] },
      ],
    },
    client.generation,
  );
  assert.deepEqual(seen, [trace(1)]);
});

test("snapshot timer cancellation never binds browser globals to the inbox instance", () => {
  const previous = globalThis.clearTimeout;
  let cancelled = 0;
  globalThis.clearTimeout = function (id) {
    assert.equal(
      this,
      undefined,
      "WebIDL timers cannot be called as inbox methods",
    );
    assert.equal(id, 42);
    cancelled++;
  };
  try {
    const box = new SnapshotInbox(
      () => {},
      () => 42,
    );
    box.push({ snapshot: { time: 1 } });
    box.flush();
    box.push({ snapshot: { time: 2 } });
    box.clear();
    assert.equal(cancelled, 2);
  } finally {
    globalThis.clearTimeout = previous;
  }
});
