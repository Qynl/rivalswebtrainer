import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { LobbyService } from "../server/lobbies.js";
import { MultiplayerSession } from "../src/net/session.js";
import { PredictionHistory } from "../src/net/prediction-history.js";
import { setup, packet } from "./helpers/match.js";
import { moveBody, canOccupy } from "../src/physics.js";
import { MOVEMENT } from "../src/movement.js";
import { encodeSnapshot, decodeSnapshot } from "../src/net/snapshot-codec.js";

const dt = 1 / 120;
test("historical comparison never pulls a moving guest back toward a delayed current snapshot", () => {
  const h = new PredictionHistory();
  for (let i = 0; i <= 120; i++) {
    const t = i * dt,
      p = { x: t * 8, y: 0, z: 0 };
    h.record(t, p);
    if (i % 2 === 0) h.sent(i, t, p);
  }
  // Authority accepted seq 80 (local .6667), held it for one tick. The client is
  // already at x=8 today, but comparison belongs at x=5.4, not today's position.
  const error = h.error(
    { lastSeq: 80, inputTime: 5, x: 5.4, y: 0, z: 0 },
    5 + dt,
  );
  assert.deepEqual(error, { x: 0, y: 0, z: 0 });
  assert.equal(h.error({ lastSeq: -1 }, 5), null);
});
test("applied corrections rebase retained history instead of applying the same error repeatedly", () => {
  const h = new PredictionHistory();
  h.sent(1, 0, { x: 2, y: 0, z: 0 });
  h.record(dt, { x: 2, y: 0, z: 0 });
  const state = { lastSeq: 1, inputTime: 10, x: 1, y: 0, z: 0 };
  assert.equal(h.error(state, 10).x, -1);
  h.applied(-1, 0, 0);
  assert.equal(h.error(state, 10).x, 0);
  for (let i = 0; i < 2000; i++) h.sent(i + 2, i * dt, { x: i, y: 0, z: 0 });
  assert.ok(h.frames.length <= 256);
  assert.ok(h.inputs.size <= 192);
  h.clear();
  assert.equal(h.frames.length, 0);
  assert.equal(h.inputs.size, 0);
});
test("wire snapshots preserve authority-measured input age, never a client-supplied timestamp", () => {
  const { m, g } = setup();
  try {
    m.time = 12;
    m.input("p0", packet(3, [], { keys: 8, inputTime: -999 }));
    m.step(dt);
    const s = m.snapshot(),
      metadata = new Map(s.players.map((p) => [p.index, p]));
    const bytes = encodeSnapshot(s),
      decoded = decodeSnapshot(bytes, metadata);
    assert.equal(decoded.players[0].inputTime, 12);
    assert.equal(decoded.players[0].lastSeq, 3);
    assert.equal(g.lastInputAt, 12);
  } finally {
    m.dispose();
  }
});
test("late reliable action recovery never rolls held movement back or duplicates an action", () => {
  const { m, g } = setup();
  try {
    m.input("p0", packet(10, [], { keys: 8, yaw: 0.4 }));
    m.input("p0", packet(8, [{ id: 1, type: "jump" }], { keys: 1, yaw: -0.8 }));
    assert.equal(g.lastSeq, 10);
    assert.equal(g.yaw, 0.4);
    assert.ok(g.keys.has("KeyD"));
    assert.ok(!g.keys.has("KeyW"));
    assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
    assert.equal(g.lastAction, 1);
    g.player.vy = 3;
    m.input("p0", packet(8, [{ id: 1, type: "jump" }]));
    assert.equal(g.player.vy, 3);
    m.input("p0", packet(11, [], { paused: true }));
    m.input("p0", packet(9, [{ id: 2, type: "slide" }]));
    assert.equal(g.slideTime, 0);
  } finally {
    m.dispose();
  }
});

function replay(delay, jitter = false, legacy = false, wall = false) {
  const authority = setup(),
    local = setup(),
    h = new PredictionHistory();
  const g = local.g,
    m = authority.m,
    inputs = [],
    snapshots = [];
  let seq = 0,
    correction = { x: 0, y: 0, z: 0 },
    travel = 0,
    maxCorrection = 0,
    reverseSteps = 0;
  for (const state of [authority, local]) {
    state.m.world.boxes = wall
      ? [{ minX: 3, maxX: 4, minY: 0, maxY: 4, minZ: -5, maxZ: 5 }]
      : [];
    state.m.world.bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
    Object.assign(state.g.player, {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
  }
  try {
    for (let tick = 0; tick < 960; tick++) {
      const time = tick * dt,
        direction = Math.floor(time / 0.8) % 3;
      g.clock = time;
      g.keys.clear();
      if (direction !== 2) g.keys.add(direction === 0 ? "KeyD" : "KeyA");
      if (tick % 2 === 0) {
        const next = ++seq;
        h.sent(next, time, g.player);
        if (!jitter || next % 17 !== 0)
          inputs.push({
            at: time + delay + (jitter ? Math.sin(next * 0.7) * 0.012 : 0),
            data: packet(next, [], {
              keys: direction === 2 ? 0 : direction === 0 ? 8 : 2,
            }),
          });
      }
      inputs.sort((a, b) => a.at - b.at);
      while (inputs[0]?.at <= time) m.input("p0", inputs.shift().data);
      m.step(dt);
      const old = g.player.x;
      g.updatePlayer(dt);
      const amount = correction.x * (1 - Math.exp(-9 * dt));
      const beforeCorrection = g.player.x;
      moveBody(g.player, amount, 0, g.world.boxes);
      correction.x -= amount;
      h.applied(g.player.x - beforeCorrection, 0, 0);
      assert.ok(
        canOccupy(g.player, g.player.x, g.player.y, g.player.z, g.world.boxes),
      );
      assert.ok(
        canOccupy(
          authority.g.player,
          authority.g.player.x,
          authority.g.player.y,
          authority.g.player.z,
          authority.m.world.boxes,
        ),
      );
      h.record(time + dt, g.player);
      if (Math.abs(g.player.vx) > 3 && (g.player.x - old) * g.player.vx < -1e-6)
        reverseSteps++;
      travel += Math.abs(g.player.x - old);
      if (tick % 4 === 0)
        snapshots.push({
          at: time + delay + (jitter ? Math.cos(tick) * 0.01 : 0),
          s: m.snapshot(),
        });
      snapshots.sort((a, b) => a.at - b.at);
      while (snapshots[0]?.at <= time) {
        const s = snapshots.shift().s,
          self = s.players[0],
          lead = Math.min(0.08, delay + 0.015),
          error = legacy
            ? { x: self.x + self.vx * lead - g.player.x, y: 0, z: 0 }
            : h.error(self, s.time);
        if (error) {
          correction = error;
          maxCorrection = Math.max(maxCorrection, Math.hypot(error.x, error.z));
        }
      }
    }
    return { travel, maxCorrection, reverseSteps };
  } finally {
    authority.m.dispose();
    local.m.dispose();
  }
}
test("host and delayed guest retain comparable travel with direction changes, jitter and dropped inputs", () => {
  const host = replay(0),
    guest = replay(0.08, true),
    slow = replay(0.16, true),
    previousGuest = replay(0.16, true, true);
  console.log(
    JSON.stringify({ movementEquality: { host, guest, slow, previousGuest } }),
  );
  assert.ok(slow.travel > previousGuest.travel * 1.15);
  for (const sample of [guest, slow]) {
    assert.ok(
      sample.travel / host.travel > 0.94 && sample.travel / host.travel < 1.06,
    );
    assert.ok(sample.maxCorrection < 0.4);
    assert.equal(sample.reverseSteps, 0);
  }
});

test("sustained 60 Hz input plus reliable action copies fits the rate budget without removing flood limits", () => {
  let now = 0,
    received = 0,
    lastSeq = 0;
  const service = new LobbyService({ now: () => now });
  const id = service.connect(() => {});
  service.clients.get(id).room = "test";
  service.rooms.set("test", {
    match: {
      input: (_, input) => {
        received++;
        lastSeq = input.seq;
      },
    },
  });
  for (let seq = 1; seq <= 600; seq++) {
    now += 1000 / 60;
    const message = { type: "input", input: packet(seq, []) };
    service.receive(id, message);
    if (seq % 6 === 0) service.receive(id, message);
  }
  assert.equal(lastSeq, 600);
  assert.equal(received, 700);
  const before = received;
  for (let i = 0; i < 1000; i++)
    service.receive(id, { type: "input", input: packet(601 + i, []) });
  assert.ok(received - before <= 160);
  service.rooms.clear();
  service.dispose();
});
test("hitscan compensates measured round-trip travel plus interpolation, with a hard rewind cap", () => {
  const { m, g, other } = setup();
  try {
    m.time = 1;
    m.history = [0, 1].map((time) => ({
      time,
      players: [
        { id: other.player.id, x: time, y: 0, z: 0, height: 1.9, alive: true },
      ],
    }));
    g.latency = 0.16;
    let x;
    m.rewind(g, () => {
      x = other.player.x;
    });
    assert.ok(Math.abs(x - 0.785) < 1e-9);
    g.latency = 100;
    m.rewind(g, () => {
      x = other.player.x;
    });
    assert.equal(x, 0.75);
  } finally {
    m.dispose();
  }
});
test("remote skeleton and effects presentation is not repeated by fixed simulation ticks", () => {
  const { m, g } = setup();
  try {
    let poses = 0,
      effects = 0;
    const session = Object.create(MultiplayerSession.prototype),
      remote = { alive: true, model: { group: new THREE.Group() } };
    Object.assign(session, {
      game: g,
      client: {},
      correction: new THREE.Vector3(),
      sendTime: 0,
      prediction: new PredictionHistory(),
      sendInput() {},
      entities: new Map([["remote", remote]]),
      projectiles: new Map(),
      zones: new Map(),
      buffer: {
        sample: () => [
          {
            id: "remote",
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            pitch: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            height: 1.9,
            grounded: true,
            loadout: g.loadout,
          },
        ],
      },
    });
    g.animateBot = () => poses++;
    g.updateEffects = () => effects++;
    for (let i = 0; i < 12; i++) session.step(dt);
    assert.equal(poses, 0);
    assert.equal(effects, 0);
    session.present(1 / 60);
    assert.equal(poses, 1);
    assert.equal(effects, 1);
  } finally {
    m.dispose();
  }
});

test("acknowledged history follows jumps, stops and turns without treating elapsed travel as error", () => {
  const h = new PredictionHistory();
  const position = (t) => ({
    x: Math.min(t, 0.25) * 8 - Math.max(0, t - 0.4) * 8,
    y: Math.max(0, 7.8 * t - 15 * t * t),
    z: t > 0.4 ? (t - 0.4) * 3 : 0,
  });
  for (let tick = 0; tick <= 120; tick++) {
    h.record(tick * dt, position(tick * dt));
    if (tick % 2 === 0) h.sent(tick, tick * dt, position(tick * dt));
  }
  for (const ack of [12, 36, 54, 60]) {
    const t = ack * dt + 0.025;
    const error = h.error(
      { ...position(t), lastSeq: ack, inputTime: 10 },
      10.025,
    );
    assert.deepEqual(error, { x: 0, y: 0, z: 0 });
  }
  h.applied(-0.2, 0.1, 0.3);
  const rebased = h.error(
    { ...position(0.325), lastSeq: 36, inputTime: 10 },
    10.025,
  );
  for (const [key, expected] of Object.entries({ x: 0.2, y: -0.1, z: -0.3 }))
    assert.ok(Math.abs(rebased[key] - expected) < 1e-9);
});
test("missing, expired and future history cannot cause a stale correction or leak through reset", () => {
  const h = new PredictionHistory(),
    p = { x: 0, y: 0, z: 0 };
  h.sent(1, 0, p);
  h.record(0.01, p);
  for (const [inputTime, serverTime] of [
    [undefined, 1],
    [1, NaN],
    [1, Infinity],
    [1, 0.99],
    [1, 1.26],
    [1, 1.1],
  ])
    assert.equal(h.error({ ...p, lastSeq: 1, inputTime }, serverTime), null);
  // A two-centimetre wire/tick disagreement is intentionally not camera motion.
  assert.deepEqual(
    h.error({ ...p, x: 0.02, y: 0.03, lastSeq: 1, inputTime: 1 }, 1),
    p,
  );
  h.applied(3, 4, 5);
  h.clear();
  assert.deepEqual(h.offset, p);
  assert.equal(h.error({ ...p, lastSeq: 1, inputTime: 1 }, 1), null);
});

test("delayed turn/stop reconciliation stays outside solid cover on both prediction and authority", () => {
  const host = replay(0, false, false, true),
    guest = replay(0.08, true, false, true);
  assert.ok(
    guest.travel / host.travel > 0.94 && guest.travel / host.travel < 1.06,
  );
  assert.ok(guest.maxCorrection < 0.4);
  assert.equal(guest.reverseSteps, 0);
});
