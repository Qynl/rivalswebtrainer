import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { LobbyService } from "../server/lobbies.js";
import {
  cleanInput,
  cleanLoadout,
  cleanName,
  SnapshotBuffer,
  lerpAngle,
} from "../src/net/protocol.js";
import { WEAPONS } from "../src/data.js";
import { createServerWorld } from "../server/world.js";
import { NavGrid, canOccupy, moveBody, verticalStep } from "../src/physics.js";
import { ARENA } from "../src/arena-layout.js";
import { FlameJet, FLAME_LIMIT } from "../src/flame-fx.js";
const defaults = ["rifle", "pistol", "fists", "grenade"];
function setup(loadout = defaults, map = "blockout", count = 2) {
  const packets = new Map(),
    service = new LobbyService();
  const ids = Array.from({ length: count }, () => {
    const received = [];
    const id = service.connect((p) => received.push(p));
    packets.set(id, received);
    return id;
  });
  service.receive(ids[0], { type: "create", name: "HOST", map, loadout });
  const code = service.clients.get(ids[0]).room;
  for (const id of ids.slice(1))
    service.receive(id, { type: "join", name: "RIVAL", code, loadout });
  return { service, ids, packets, room: service.rooms.get(code) };
}
function start(s) {
  for (const id of s.ids.slice(1))
    s.service.receive(id, { type: "ready", ready: true });
  s.service.receive(s.ids[0], { type: "start" });
  assert.ok(s.room.match);
  return s.room.match;
}
function input(seq, rest = {}) {
  return {
    seq,
    yaw: 0,
    pitch: 0,
    keys: 0,
    fire: false,
    aim: false,
    paused: false,
    actions: [],
    ...rest,
  };
}
test("untrusted controls reject malformed numbers, constrain aim and never accept position, HP or damage", () => {
  assert.equal(cleanInput({ seq: 1, yaw: NaN, pitch: 0 }), null);
  assert.equal(cleanInput({ seq: -1, yaw: 0, pitch: 0 }), null);
  const p = cleanInput({
    seq: 1,
    yaw: 999,
    pitch: 99,
    keys: 999,
    fire: 1,
    x: 999,
    health: 999,
    damage: 999,
    actions: [
      { id: 1, type: "kill" },
      { id: 2, type: "reload" },
    ],
  });
  assert.equal(p.pitch, 1.48);
  assert.ok(Math.abs(p.yaw) <= Math.PI);
  assert.equal(p.keys, 7);
  assert.equal(p.fire, false);
  assert.equal(p.x, undefined);
  assert.deepEqual(p.actions, [{ id: 2, type: "reload" }]);
  assert.equal(cleanLoadout(["sniper", "rifle", "knife", "grenade"]), null);
  assert.equal(cleanLoadout([...defaults, "knife"]), null);
  assert.deepEqual(cleanLoadout(defaults), defaults);
  assert.equal(cleanName("<\nB\u202e>"), "B");
});
test("private rooms stay out of discovery; host-only starts enforce equal teams and every ready flag", () => {
  const s = setup();
  try {
    const outsider = s.service.connect(() => {});
    s.room.private = true;
    s.service.receive(outsider, { type: "list" });
    s.service.receive(s.ids[1], { type: "start" });
    assert.equal(s.room.match, null);
    s.service.receive(s.ids[0], { type: "start" });
    assert.equal(s.room.match, null);
    s.service.receive(s.ids[1], { type: "team", team: 0 });
    s.service.receive(s.ids[1], { type: "ready", ready: true });
    s.service.receive(s.ids[0], { type: "start" });
    assert.equal(s.room.match, null);
    s.service.receive(s.ids[1], { type: "team", team: 1 });
    start(s);
    assert.equal(s.room.match.phase, "countdown");
  } finally {
    s.service.dispose();
  }
});
test("lobbies cap teams at three and room membership at six; host migrates on disconnect", () => {
  const s = setup(defaults, "blockout", 6);
  try {
    assert.equal(s.room.members.size, 6);
    assert.deepEqual(
      [0, 1].map(
        (t) => [...s.room.members.values()].filter((m) => m.team === t).length,
      ),
      [3, 3],
    );
    s.service.receive(s.ids[0], { type: "team", team: 1 });
    assert.equal(s.room.members.get(s.ids[0]).team, 0);
    const extra = s.service.connect(() => {});
    s.service.receive(extra, { type: "join", code: s.room.code });
    assert.equal(s.room.members.size, 6);
    s.service.disconnect(s.ids[0]);
    assert.equal(s.room.host, s.ids[1]);
    assert.equal(s.room.members.size, 5);
  } finally {
    s.service.dispose();
  }
});
test("server countdown is five seconds; repeated/stale inputs and duplicate actions cannot amplify movement or abilities", () => {
  const s = setup(["rifle", "pistol", "scythe", "grenade"]);
  try {
    const m = start(s),
      g = m.contexts.get(s.ids[0]),
      z = g.player.z;
    for (let i = 0; i < 599; i++) m.step(1 / 120);
    assert.equal(m.phase, "countdown");
    assert.equal(g.player.z, z);
    for (let i = 0; i < 2; i++) m.step(1 / 120);
    assert.equal(m.phase, "playing");
    m.input(
      s.ids[0],
      input(1, { keys: 8, actions: [{ id: 1, type: "ability" }] }),
    );
    const cooldown = g.dashCooldown;
    assert.ok(cooldown > 0);
    m.input(s.ids[0], input(2, { actions: [{ id: 1, type: "ability" }] }));
    assert.equal(g.lastAction, 1);
    assert.equal(g.dashCooldown, cooldown);
    m.input(s.ids[0], input(1, { yaw: 1 }));
    assert.equal(g.yaw, 0);
    for (let i = 0; i < 80; i++) m.step(1 / 120);
    assert.equal(g.keys.size, 0);
    assert.equal(g.mouseDown, false);
    assert.ok(Number.isFinite(g.player.x));
  } finally {
    s.service.dispose();
  }
});
test("authoritative rifle hits consume ammo, apply damage and cannot friendly fire", () => {
  const s = setup();
  try {
    const m = start(s);
    m.phase = "playing";
    const a = m.contexts.get(s.ids[0]),
      b = m.contexts.get(s.ids[1]);
    Object.assign(a.player, { x: 0, z: 4 });
    Object.assign(b.player, { x: 0, z: -3 });
    m.input(s.ids[0], input(1, { fire: true }));
    m.step(1 / 120);
    assert.equal(a.ammunition[0].mag, 19);
    assert.ok(b.player.health < 150);
    const health = b.player.health;
    m.damage(b.player, 100, b.player);
    assert.ok(b.player.health < health);
    b.player.health = 150;
    b.player.team = a.player.team;
    const hit = a.bullet(
      a.player,
      a.eye(a.player),
      new THREE.Vector3(0, 0, -1),
      WEAPONS.rifle,
    );
    assert.equal(hit, false);
    assert.equal(b.player.health, 150);
    assert.ok(
      m.events.some((e) => e.type === "damage" && e.source === s.ids[0]),
    );
  } finally {
    s.service.dispose();
  }
});
test("knife is forty from the front and lethal only behind; delayed impact is server-owned", () => {
  for (const behind of [false, true]) {
    const s = setup(["rifle", "pistol", "knife", "grenade"]);
    try {
      const m = start(s);
      m.phase = "playing";
      const a = m.contexts.get(s.ids[0]),
        b = m.contexts.get(s.ids[1]);
      a.equip(2);
      a.cooldown = 0;
      Object.assign(a.player, { x: 0, z: 3 });
      Object.assign(b.player, { x: 0, z: 1.2, yaw: behind ? 0 : Math.PI });
      b.yaw = b.player.yaw;
      m.input(s.ids[0], input(1, { fire: true }));
      m.step(1 / 120);
      assert.equal(b.player.health, 150);
      for (let i = 0; i < 14; i++) m.step(1 / 120);
      assert.equal(b.player.health, behind ? 0 : 110);
    } finally {
      s.service.dispose();
    }
  }
});
test("katana deflects a frontal rifle shot back to its shooter without damaging defender", () => {
  const s = setup(["rifle", "pistol", "katana", "grenade"]);
  try {
    const m = start(s);
    m.phase = "playing";
    const a = m.contexts.get(s.ids[0]),
      b = m.contexts.get(s.ids[1]);
    Object.assign(a.player, { x: 0, z: 4 });
    Object.assign(b.player, { x: 0, z: -3, yaw: Math.PI, deflectTime: 0.5 });
    b.yaw = Math.PI;
    b.deflectTime = 0.5;
    const hp = a.player.health;
    a.bullet(
      a.player,
      a.eye(a.player),
      new THREE.Vector3(0, 0, -1),
      WEAPONS.rifle,
    );
    assert.equal(b.player.health, 150);
    assert.ok(a.player.health < hp);
  } finally {
    s.service.dispose();
  }
});
test("all 23 weapons execute on the shared authoritative engine, including delayed utilities and charged bow", () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    const loadout = [...defaults];
    loadout[w.slot] = id;
    const s = setup(loadout);
    try {
      const m = start(s);
      m.phase = "playing";
      const a = m.contexts.get(s.ids[0]);
      a.equip(w.slot);
      a.cooldown = 0;
      Object.assign(a.player, { x: 0, z: 4, health: 100 });
      Object.assign(m.contexts.get(s.ids[1]).player, { x: 0, z: -3 });
      for (let tick = 0; tick < 500; tick++) {
        if (tick % 8 === 0)
          m.input(s.ids[0], input(tick, { fire: tick < 144 }));
        m.step(1 / 120);
      }
      for (const e of m.entities)
        assert.ok([e.x, e.y, e.z, e.health].every(Number.isFinite), id);
      assert.ok(
        a.ammunition[w.slot].mag < w.mag ||
          w.type === "melee" ||
          (id === "bow" && a.ammunition[0].reserve < w.reserve),
        id,
      );
      assert.ok(a.projectiles.length <= 32, id);
    } finally {
      s.service.dispose();
    }
  }
});
test("rounds, first-to-five result and host rematch are authoritative", () => {
  const s = setup();
  try {
    const m = start(s);
    m.phase = "playing";
    m.score = [4, 0];
    m.damage(
      m.contexts.get(s.ids[1]).player,
      150,
      m.contexts.get(s.ids[0]).player,
    );
    m.step(1 / 120);
    assert.deepEqual(m.score, [5, 0]);
    assert.equal(m.phase, "roundend");
    for (let i = 0; i < 380; i++) m.step(1 / 120);
    assert.equal(m.phase, "finished");
    s.service.receive(s.ids[1], { type: "return" });
    assert.equal(s.room.match, m);
    s.service.receive(s.ids[0], { type: "return" });
    assert.equal(s.room.match, null);
    assert.equal(s.room.members.get(s.ids[1]).ready, false);
  } finally {
    s.service.dispose();
  }
});
test("interpolation buffers jitter, rejects out-of-order packets and rotates across the shortest arc", () => {
  const buffer = new SnapshotBuffer(0.075);
  buffer.push(
    {
      time: 1,
      players: [{ id: "a", x: 0, y: 0, z: 0, yaw: 3.1, alive: true }],
    },
    1,
  );
  buffer.push(
    {
      time: 1.1,
      players: [{ id: "a", x: 10, y: 0, z: 0, yaw: -3.1, alive: true }],
    },
    1.1,
  );
  buffer.push({ time: 1.05, players: [] }, 1.12);
  assert.equal(buffer.frames.length, 2);
  const p = buffer.sample(1.125)[0];
  assert.ok(Math.abs(p.x - 5) < 0.001);
  assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 0.01);
  assert.ok(lerpAngle(3.1, -3.1, 0.5) > 3.1);
  for (let i = 0; i < 100; i++)
    buffer.push({ time: i + 2, players: [] }, i + 2);
  assert.equal(buffer.frames.length, 32);
});
test("larger Arena has 200 square metres of reachable upper galleries, and no spawned body intersects geometry", () => {
  const world = createServerWorld();
  try {
    assert.equal(ARENA.width * ARENA.depth, 2000);
    assert.equal(
      ARENA.galleries.reduce((n, d) => n + d.w * d.d, 0),
      200,
    );
    for (const p of Object.values(world.spawns).flat())
      assert.ok(
        canOccupy({ radius: 0.38, height: 1.9 }, p.x, 0, p.z, world.boxes),
      );
    for (const deck of ARENA.galleries)
      for (const side of [-1, 1]) {
        const body = {
          x: deck.x,
          z: side * 16.6,
          y: 0,
          vx: 0,
          vy: 0,
          vz: -side * 10,
          grounded: true,
          height: 1.9,
          radius: 0.38,
        };
        for (let i = 0; i < 120; i++) {
          moveBody(body, 0, -side * 0.08, world.boxes);
          verticalStep(body, 1 / 120, world.boxes);
          assert.ok(canOccupy(body, body.x, body.y, body.z, world.boxes));
        }
        assert.ok(Math.abs(body.y - 3.2) < 0.02);
        assert.ok(Math.abs(body.z) < 10);
      }
  } finally {
    world.dispose();
  }
});
test("sustained flame has a fixed GPU pool, follows aim, respects a wall and fully releases resources", () => {
  const scene = new THREE.Scene(),
    fx = new FlameJet(scene),
    wall = new THREE.Mesh(
      new THREE.BoxGeometry(20, 20, 1),
      new THREE.MeshBasicMaterial(),
    );
  wall.position.z = -3;
  wall.updateMatrixWorld(true);
  try {
    for (let i = 0; i < 240; i++) {
      if (i % 8 === 0)
        fx.emit(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), [
          wall,
        ]);
      fx.update(1 / 120);
    }
    assert.equal(fx.states.length, FLAME_LIMIT);
    assert.equal(fx.mesh.count, FLAME_LIMIT);
    assert.ok(fx.active >= 8 && fx.active <= FLAME_LIMIT);
    assert.ok(fx.states.filter((p) => p.life > 0).every((p) => p.p.z > -2.5));
    for (let i = 0; i < 150; i++) fx.update(1 / 120);
    assert.equal(fx.active, 0);
    assert.equal(fx.mesh.visible, false);
    fx.clear();
    assert.ok(
      fx.mesh.geometry.attributes.flameData.array.every((n) => n === 0),
    );
  } finally {
    fx.dispose();
    wall.geometry.dispose();
    wall.material.dispose();
  }
  assert.equal(scene.children.length, 0);
});

test("binary 3v3 snapshots stay below one kilobyte and round-trip ammo, abilities and positions", async () => {
  const { encodeSnapshot, decodeSnapshot } = await import(
    "../src/net/snapshot-codec.js"
  );
  const s = setup(defaults, "blockout", 6);
  try {
    const m = start(s),
      snapshot = m.snapshot();
    const first = snapshot.players[0];
    Object.assign(first, {
      x: 1.234567,
      y: 3.2,
      z: -19.876543,
      vx: 12.53,
      vy: -6.4,
      vz: 0.12,
      health: 109.23,
      yaw: 3.14,
      pitch: -1.2,
      slide: 0.31,
      deflect: 0.5,
    });
    const metadata = new Map(snapshot.players.map((p) => [p.index, p])),
      bytes = encodeSnapshot(snapshot),
      decoded = decodeSnapshot(bytes, metadata);
    assert.equal(bytes.byteLength, 587);
    assert.ok(bytes.byteLength < 1024);
    for (const key of [
      "x",
      "y",
      "z",
      "vx",
      "vy",
      "vz",
      "health",
      "yaw",
      "pitch",
      "slide",
      "deflect",
    ])
      assert.ok(Math.abs(decoded.players[0][key] - first[key]) < 0.001, key);
    assert.deepEqual(decoded.players[0].loadout, defaults);
    assert.equal(decoded.players[0].ammo[2].mag, null);
    assert.equal(decoded.players[0].lastSeq, -1);
    assert.throws(() => decodeSnapshot(bytes.slice(1), metadata));
    assert.throws(() => decodeSnapshot(bytes, new Map()));
    const padded = new Uint8Array(bytes.length + 6);
    padded.set(bytes, 3);
    assert.equal(
      decodeSnapshot(padded.subarray(3, -3), metadata).players.length,
      6,
    );
  } finally {
    s.service.dispose();
  }
});
test("server rewind is bounded and restores every live position after a hitscan query", () => {
  const s = setup();
  try {
    const m = start(s);
    m.phase = "playing";
    const a = m.contexts.get(s.ids[0]),
      b = m.contexts.get(s.ids[1]);
    m.time = 2;
    m.history = [
      {
        time: 1.8,
        players: [
          { id: b.player.id, x: 1, y: 0, z: 0, height: 1.9, alive: true },
        ],
      },
      {
        time: 2,
        players: [
          { id: b.player.id, x: 3, y: 0, z: 0, height: 1.9, alive: true },
        ],
      },
    ];
    Object.assign(b.player, { x: 3, y: 0, z: 0 });
    a.latency = 99;
    let rewound;
    m.rewind(a, () => {
      rewound = b.player.x;
      assert.equal(m.rewinding, true);
    });
    assert.ok(rewound >= 1 && rewound < 2);
    assert.equal(b.player.x, 3);
    assert.equal(m.rewinding, false);
    assert.throws(() =>
      m.rewind(a, () => {
        throw Error("test");
      }),
    );
    assert.equal(b.player.x, 3);
    assert.equal(m.rewinding, false);
  } finally {
    s.service.dispose();
  }
});

test("countdown weapon selection can finish after FIGHT but cannot refresh ammunition or be opened during combat", () => {
  const s = setup();
  try {
    const m = start(s),
      id = s.ids[0],
      g = m.contexts.get(id);
    s.service.receive(id, { type: "selection", selecting: true });
    assert.equal(g.selectingLoadout, true);
    for (let i = 0; i < 602; i++) m.step(1 / 120);
    assert.equal(m.phase, "playing");
    const z = g.player.z;
    m.input(id, input(1, { keys: 1, fire: true }));
    m.step(1 / 120);
    assert.equal(g.player.z, z);
    assert.equal(g.ammunition[0].mag, 20);
    s.service.receive(id, {
      type: "loadout",
      loadout: ["sniper", "pistol", "knife", "molotov"],
    });
    assert.equal(g.loadout[0], "sniper");
    assert.equal(g.selectingLoadout, false);
    g.ammunition[0].mag = 1;
    s.service.receive(id, { type: "loadout", loadout: defaults });
    assert.equal(g.loadout[0], "sniper");
    assert.equal(g.ammunition[0].mag, 1);
    s.service.receive(id, { type: "selection", selecting: true });
    assert.equal(g.selectingLoadout, false);
  } finally {
    s.service.dispose();
  }
});

test("a rising capsule cannot clip the corner of a tall cover slab in the last centimetres before clearing its top", () => {
  const boxes = [
      { minX: 5.5, maxX: 8.5, minY: 0, maxY: 4.2, minZ: -6, maxZ: 0 },
    ],
    body = {
      x: 5.430286348869188,
      y: 4.163333333333333,
      z: -6.373560713868591,
      height: 1.9,
      radius: 0.38,
      vx: -4.285493698758051,
      vy: 4,
      vz: 1.4098556752194698,
      grounded: false,
    };
  moveBody(body, body.vx / 120, body.vz / 120, boxes);
  verticalStep(body, 1 / 120, boxes);
  assert.ok(canOccupy(body, body.x, body.y, body.z, boxes));
  assert.ok(body.vy > 0);
  assert.equal(body.grounded, false);
});

test("a quick trigger tap survives a dropped press-state packet and never bypasses server fire rate", () => {
  const s = setup();
  try {
    const m = start(s);
    m.phase = "playing";
    const g = m.contexts.get(s.ids[0]);
    m.input(
      s.ids[0],
      input(1, {
        fire: false,
        actions: [
          { id: 1, type: "fire" },
          { id: 2, type: "release" },
        ],
      }),
    );
    m.step(1 / 120);
    assert.equal(g.ammunition[0].mag, 19);
    m.input(
      s.ids[0],
      input(2, {
        fire: false,
        actions: [
          { id: 1, type: "fire" },
          { id: 2, type: "release" },
        ],
      }),
    );
    m.step(1 / 120);
    assert.equal(g.ammunition[0].mag, 19);
    m.input(
      s.ids[0],
      input(3, { fire: false, actions: [{ id: 3, type: "fire" }] }),
    );
    m.step(1 / 120);
    assert.equal(g.ammunition[0].mag, 19);
  } finally {
    s.service.dispose();
  }
});
test("remote dead reckoning stops after fifty milliseconds rather than running away during packet loss", () => {
  const b = new SnapshotBuffer();
  b.push(
    {
      time: 1,
      players: [
        {
          id: "a",
          x: 0,
          y: 0,
          z: 0,
          vx: 10,
          vy: 4,
          vz: -5,
          alive: true,
          grounded: false,
        },
      ],
    },
    1,
  );
  const a = b.sample(2)[0],
    late = b.sample(20)[0];
  assert.ok(Math.abs(a.x - 0.5) < 1e-6);
  assert.ok(Math.abs(a.y - 0.2) < 1e-6);
  assert.deepEqual(a, late);
});

test("online and offline projectile models retain recognizable rockets, arrows and detailed utilities", async () => {
  const { createProjectileModel } = await import("../src/projectile-model.js");
  for (const id of [
    "rpg",
    "bow",
    "launcher",
    "grenade",
    "molotov",
    "smoke",
    "flashbang",
  ]) {
    const model = createProjectileModel(id);
    if (id === "bow") {
      assert.equal(model.geometry.type, "CylinderGeometry");
      assert.equal(model.children[0].geometry.type, "ConeGeometry");
    }
    if (id === "rpg") assert.equal(model.geometry.type, "CylinderGeometry");
    if (["grenade", "molotov", "smoke", "flashbang"].includes(id))
      assert.ok(model.children.length > 0);
    model.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
});

test("authoritative slot switching resets ability state and same-packet actions use the new weapon", () => {
  const s = setup(["bow", "pistol", "katana", "medkit"]);
  try {
    const m = start(s),
      g = m.contexts.get(s.ids[0]);
    m.phase = "playing";
    g.state = "playing";
    for (const key of [
      "deflectTime",
      "bowCharge",
      "spinTime",
      "healTime",
      "reloadTime",
      "throwTime",
    ])
      g[key] = 1;
    g.bowRelease = true;
    g.equip(1);
    for (const key of [
      "deflectTime",
      "bowCharge",
      "spinTime",
      "healTime",
      "reloadTime",
      "throwTime",
    ])
      assert.equal(g[key], 0, key);
    assert.equal(g.bowRelease, false);
    assert.equal(g.viewModel, undefined);
    g.player.health = 100;
    m.input(
      s.ids[0],
      input(1, {
        actions: [
          { id: 1, type: "slot3" },
          { id: 2, type: "secondary" },
        ],
      }),
    );
    assert.equal(g.slot, 3);
    assert.equal(g.healTime, 0.8);
    assert.equal(g.healAmount, 25);
  } finally {
    s.service.dispose();
  }
});

test("synthetic 3v3 jitter, 25% loss, duplicates and reordering keep authority valid and jump edges idempotent", () => {
  const s = setup(defaults, "blockout", 6);
  let clock = 10000,
    seed = 91753;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  s.service.now = () => clock;
  try {
    const m = start(s),
      queue = [],
      frames = [],
      buffer = new SnapshotBuffer(),
      actions = s.ids.map(() => []),
      next = s.ids.map(() => 0);
    let delivered = 0,
      sampled = 0;
    m.phase = "playing";
    for (const g of m.contexts.values()) {
      const jump = g.jump,
        seen = new Set();
      g.jump = () => {
        assert.ok(!seen.has(g.lastAction), "duplicate jump edge");
        seen.add(g.lastAction);
        jump.call(g);
      };
    }
    for (let tick = 0; tick < 3600; tick++) {
      clock = 10000 + (tick * 1000) / 120;
      if (tick % 4 === 0)
        s.ids.forEach((id, i) => {
          if (tick % 120 === 0) {
            actions[i].push({ id: ++next[i], type: "jump" });
            actions[i] = actions[i].slice(-8);
          }
          const packet = {
            type: "input",
            input: input(tick, {
              yaw: i % 2 ? Math.PI : 0,
              keys: [1, 8, 2, 0][(Math.floor(tick / 90) + i) % 4],
              actions: actions[i],
            }),
          };
          if (random() > 0.25) {
            queue.push({ at: tick + Math.floor(random() * 19), id, packet });
            if (random() < 0.2)
              queue.push({ at: tick + Math.floor(random() * 19), id, packet });
          }
        });
      queue.sort((a, b) => a.at - b.at);
      while (queue[0]?.at <= tick) {
        const p = queue.shift();
        s.service.receive(p.id, p.packet);
        delivered++;
      }
      s.service.step(1 / 120);
      if (tick % 6 === 0 && random() > 0.25)
        frames.push({
          at: tick + Math.floor(random() * 19),
          snapshot: m.snapshot(),
        });
      frames.sort((a, b) => a.at - b.at);
      while (frames[0]?.at <= tick)
        buffer.push(frames.shift().snapshot, tick / 120);
      for (const e of m.entities) {
        assert.ok([e.x, e.y, e.z, e.health].every(Number.isFinite));
        if (e.alive)
          assert.ok(
            canOccupy(e, e.x, e.y, e.z, m.world.boxes),
            "jitter cannot change server collision",
          );
      }
      for (const e of buffer.sample(tick / 120) || []) {
        assert.ok([e.x, e.y, e.z].every(Number.isFinite));
        assert.ok(Math.abs(e.x) < 21 && Math.abs(e.z) < 26);
        sampled++;
      }
      assert.ok(buffer.frames.length <= 32);
    }
    assert.ok(delivered > 3000);
    assert.ok(sampled > 10000);
  } finally {
    s.service.dispose();
  }
});

test("rocket jumping delivers a server-owned, duplicate-safe and round-bound impulse to the predicting client", async () => {
  const s = setup();
  try {
    const m = start(s);
    m.phase = "playing";
    const g = m.contexts.get(s.ids[0]);
    Object.assign(g.player, { x: 0, y: 0, z: 4, health: 150 });
    g.explosion(new THREE.Vector3(0, 0.1, 3.5), g.player, "rpg");
    const impulse = m.events.find((e) => e.type === "impulse");
    assert.ok(impulse);
    assert.equal(impulse.velocity[1], 15);
    const { MultiplayerSession } = await import("../src/net/session.js");
    const local = {
      id: g.player.id,
      round: m.round,
      lastEvent: 0,
      latest: { time: m.time },
      client: { rtt: 0 },
      game: { player: { alive: true, vx: 0, vy: 0, vz: 0, grounded: true } },
    };
    MultiplayerSession.prototype.processEvents.call(local, [impulse]);
    assert.equal(local.game.player.vy, 15);
    assert.equal(local.game.player.grounded, false);
    local.game.player.vy = 3;
    MultiplayerSession.prototype.processEvents.call(local, [impulse]);
    assert.equal(local.game.player.vy, 3);
    MultiplayerSession.prototype.processEvents.call(local, [
      { ...impulse, id: impulse.id + 1, round: m.round - 1 },
    ]);
    assert.equal(local.game.player.vy, 3);
  } finally {
    s.service.dispose();
  }
});
