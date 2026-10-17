import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  GLOVES,
  gloveLoadout,
  canUseGlove,
  sanitizeSlaps,
} from "../src/gloves/catalog.js";
import { SlapProgression, sanitizeProfile } from "../src/gloves/progression.js";
import {
  beginSlap,
  advanceSlap,
  resolveSlap,
  tickGloves,
  useGloveAbility,
  ragdollStep,
  blocked,
} from "../src/gloves/combat.js";
import {
  createGloveModel,
  slapPose,
  animateGlove,
} from "../src/gloves/model.js";
import { presentRagdoll } from "../src/gloves/ragdoll.js";
import { createCharacter } from "../src/world.js";
import { cleanLoadout } from "../src/net/protocol.js";
import { encodeSnapshot, decodeSnapshot } from "../src/net/snapshot-codec.js";
import { LobbyService } from "../server/lobbies.js";
const noop = () => {};
function setup(id = "glove_default") {
  const service = new LobbyService(),
    received = [];
  const a = service.connect((p) => received.push(p)),
    b = service.connect((p) => received.push(p));
  service.receive(a, {
    type: "create",
    name: "HOST",
    map: "blockout",
    loadout: gloveLoadout(id),
    gloves: true,
    slaps: GLOVES[id].cost,
  });
  const room = service.rooms.get(service.clients.get(a).room);
  service.receive(b, {
    type: "join",
    name: "GUEST",
    code: room.code,
    loadout: gloveLoadout(),
    slaps: 0,
  });
  service.receive(b, { type: "ready", ready: true });
  service.receive(a, { type: "start" });
  const match = room.match;
  match.phase = "playing";
  match.time = 10;
  match.history = [];
  const g = match.contexts.get(a),
    other = match.contexts.get(b);
  for (const ctx of [g, other]) {
    ctx.state = "playing";
    ctx.clock = 10;
    ctx.world.boxes = [];
    ctx.yaw = 0;
    ctx.pitch = 0;
    Object.assign(ctx.player, {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      ragdollTime: 0,
      stoneTime: 0,
      slapGrace: 0,
    });
  }
  other.player.z = -2;
  g.hasLOS = () => true;
  other.hasLOS = () => true;
  return { service, room, match, g, other, a, b, received };
}
test("nine gloves have unique costs, original rigs and valid canonical internal inventory", () => {
  assert.equal(Object.keys(GLOVES).length, 9);
  for (const glove of Object.values(GLOVES)) {
    assert.deepEqual(
      cleanLoadout(gloveLoadout(glove.id)),
      gloveLoadout(glove.id),
    );
    const model = createGloveModel(glove.id);
    assert.equal(model.userData.gloveRig.fingers.length, 5);
    animateGlove(model, {
      gloveSwingAge: glove.windup + 0.05,
      phase: 1,
      speed: 10,
      time: 3,
    });
    assert.ok(model.position.toArray().every(Number.isFinite));
    model.traverse((o) => o.geometry?.dispose());
  }
  assert.equal(
    cleanLoadout(["glove_default", "revolver", "knife", "smoke"]),
    null,
  );
});
test("profiles reject malformed/forged selections and persist milestone unlocks without spending slaps", () => {
  assert.deepEqual(sanitizeProfile({ slaps: -1, selected: "glove_bull" }), {
    version: 1,
    slaps: 0,
    selected: "glove_default",
  });
  assert.equal(sanitizeSlaps(Infinity), 0);
  assert.equal(canUseGlove("__proto__", 100), false);
  let saved;
  const storage = {
    getItem: () => saved,
    setItem: (_, value) => (saved = value),
  };
  const p = new SlapProgression(storage);
  assert.equal(p.select("glove_diamond"), false);
  for (let i = 0; i < 15; i++) assert.equal(p.award(`hit:${i}`), true);
  assert.equal(p.award("hit:14"), false);
  assert.equal(p.profile.slaps, 15);
  assert.equal(p.select("glove_diamond"), true);
  assert.equal(p.profile.slaps, 15);
  assert.deepEqual(new SlapProgression(storage).profile, p.profile);
  assert.equal(p.next().id, "glove_extended");
  const broken = new SlapProgression({
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  });
  assert.equal(broken.award("one"), true);
});
test("slaps have a real windup, exactly one confirmed reward, damage and authoritative launch", () => {
  const s = setup();
  try {
    assert.equal(beginSlap(s.g), true);
    assert.equal(beginSlap(s.g), false);
    advanceSlap(s.g, s.g.player, 0.05);
    assert.equal(s.other.player.health, 150);
    advanceSlap(s.g, s.g.player, 0.046);
    assert.equal(s.other.player.health, 126);
    assert.equal(s.g.matchStats.hits, 1);
    assert.ok(s.other.player.vz < -13);
    assert.ok(s.other.player.vy > 5);
    assert.ok(s.other.player.ragdollTime > 0);
    advanceSlap(s.g, s.g.player, 1);
    assert.equal(s.other.player.health, 126);
    assert.equal(s.match.events.filter((e) => e.type === "gloveHit").length, 1);
    assert.equal(s.match.events.filter((e) => e.type === "impulse").length, 1);
  } finally {
    s.service.dispose();
  }
});
test("melee misses behind you, beyond reach, through walls, on allies and while recovering", () => {
  const s = setup();
  try {
    for (const [key, value] of [
      ["z", 3],
      ["z", -8],
    ]) {
      s.other.player[key] = value;
      assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 0);
    }
    s.other.player.z = -2;
    s.g.hasLOS = () => false;
    assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 0);
    s.g.hasLOS = () => true;
    s.other.player.team = 0;
    assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 0);
    s.other.player.team = 1;
    s.g.player.ragdollTime = 0.4;
    assert.equal(beginSlap(s.g), false);
    assert.equal(useGloveAbility(s.g), false);
    assert.equal(s.g.matchStats.hits, 0);
  } finally {
    s.service.dispose();
  }
});
test("Extended reaches farther; Snow applies a five-second chill; Pull reverses horizontal launch", () => {
  for (const id of ["glove_extended", "glove_snow", "glove_pull"]) {
    const s = setup(id);
    try {
      s.other.player.z = id === "glove_extended" ? -4.4 : -2;
      assert.equal(resolveSlap(s.g, s.g.player, id), 1);
      if (id === "glove_extended") assert.ok(s.other.player.ragdollTime < 0.5);
      if (id === "glove_snow") assert.equal(s.other.player.chillTime, 5);
      if (id === "glove_pull") assert.ok(s.other.player.vz > 0);
    } finally {
      s.service.dispose();
    }
  }
});
test("Diamond protects but immobilizes; Default bursts speed without fake damage/rewards; cooldowns cannot be bypassed", () => {
  const s = setup("glove_diamond");
  try {
    assert.equal(useGloveAbility(s.g), true);
    assert.equal(s.g.player.stoneTime, 2.5);
    assert.equal(beginSlap(s.g), false);
    assert.equal(resolveSlap(s.other, s.other.player, "glove_default"), 0);
    assert.equal(s.g.player.health, 150);
    tickGloves(s.g, 2.6);
    assert.equal(s.g.player.stoneTime, 0);
    assert.equal(useGloveAbility(s.g), false);
  } finally {
    s.service.dispose();
  }
  const t = setup();
  try {
    assert.equal(useGloveAbility(t.g), true);
    assert.equal(t.other.player.health, 150);
    assert.equal(t.g.player.boostTime, 1.35);
    assert.ok(t.g.player.vz < -6);
    assert.equal(t.g.matchStats.hits, 0);
    assert.equal(useGloveAbility(t.g), false);
  } finally {
    t.service.dispose();
  }
});
test("Flash sweeps collision instead of teleporting through walls; Swapper validates aim/range and exchanges both positions", () => {
  const s = setup("glove_flash");
  try {
    s.g.world.boxes = [
      { minX: -3, maxX: 3, minY: 0, maxY: 4, minZ: -3, maxZ: -2 },
    ];
    assert.equal(useGloveAbility(s.g), true);
    assert.ok(s.g.player.z > -1.65);
    assert.ok(s.g.player.z < -0.5);
  } finally {
    s.service.dispose();
  }
  const t = setup("glove_swapper");
  try {
    t.other.player.z = -12;
    assert.equal(useGloveAbility(t.g), true);
    assert.equal(t.g.player.z, -12);
    assert.equal(t.other.player.z, 0);
  } finally {
    t.service.dispose();
  }
});
test("ragdoll physics travels, lands without clipping, recovers and cancels pending slaps", () => {
  const s = setup();
  try {
    resolveSlap(s.g, s.g.player, "glove_default");
    const e = s.other.player,
      z = e.z;
    for (let i = 0; i < 90; i++) {
      tickGloves(s.other, 1 / 120);
      ragdollStep(s.other, e, 1 / 120);
    }
    assert.ok(e.z < z - 5);
    assert.ok(e.y >= 0);
    assert.equal(e.ragdollTime, 0);
    assert.equal(blocked(e), false);
    assert.equal(e.slapPending, null);
    assert.ok([e.x, e.y, e.z, e.vy].every(Number.isFinite));
  } finally {
    s.service.dispose();
  }
});
test("articulated ragdoll is bounded, jointed, reusable and restores the character on recovery", () => {
  const e = {
    team: 1,
    model: createCharacter(1, "TEST"),
    alive: true,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    ragdollTime: 0.7,
    ragdollGeneration: 1,
  };
  const g = { clock: 0 };
  for (let i = 0; i < 90; i++) {
    g.clock += 1 / 120;
    assert.equal(presentRagdoll(g, e, 1 / 120), true);
  }
  const rig = e.model.gloveRagdoll;
  assert.equal(rig.nodes.length, 15);
  assert.equal(rig.constraints.length, 20);
  assert.ok(rig.nodes.every((n) => n.p.toArray().every(Number.isFinite)));
  e.ragdollTime = 0;
  assert.equal(presentRagdoll(g, e, 1 / 120), false);
  assert.equal(rig.root.visible, false);
  e.ragdollTime = 0.6;
  e.ragdollGeneration++;
  presentRagdoll(g, e, 1 / 120);
  assert.equal(e.model.gloveRagdoll, rig);
});
test("glove statuses, IDs, cooldowns and confirmed counts survive compact multiplayer snapshots", () => {
  const s = setup("glove_snow");
  try {
    resolveSlap(s.g, s.g.player, "glove_snow");
    s.g.player.abilityCooldown = 7.5;
    const encoded = encodeSnapshot(s.match.snapshot()),
      decoded = decodeSnapshot(
        encoded,
        new Map(s.match.snapshot().players.map((p) => [p.index, p])),
      );
    assert.equal(
      decoded.players.find((p) => p.id === s.a).weapon,
      "glove_snow",
    );
    assert.equal(decoded.players.find((p) => p.id === s.a).stats.hits, 1);
    const victim = decoded.players.find((p) => p.id === s.b);
    assert.ok(victim.dash > 0.6);
    assert.equal(victim.heal, 5);
  } finally {
    s.service.dispose();
  }
});
test("glove rooms reject locked selection, gun selection, hidden-slot equips and forged direct damage", () => {
  const s = setup();
  try {
    s.match.phase = "countdown";
    s.g.state = "countdown";
    s.service.receive(s.a, {
      type: "loadout",
      loadout: gloveLoadout("glove_bull"),
    });
    assert.equal(s.g.loadout[0], "glove_default");
    s.service.receive(s.a, {
      type: "loadout",
      loadout: ["rifle", "pistol", "fists", "grenade"],
    });
    assert.equal(s.g.loadout[0], "glove_default");
    s.g.equip(1);
    assert.equal(s.g.slot, 0);
    s.g.quickUtility();
    assert.equal(s.g.pendingThrow, undefined);
    s.g.matchStats.hits = 15;
    s.service.receive(s.a, {
      type: "loadout",
      loadout: gloveLoadout("glove_diamond"),
    });
    assert.equal(s.g.loadout[0], "glove_diamond");
  } finally {
    s.service.dispose();
  }
});
test("Bull telegraphs much longer than Default, and swing poses recover instead of snapping", () => {
  assert.ok(GLOVES.glove_bull.windup > GLOVES.glove_default.windup * 3);
  assert.equal(slapPose(5).strike, 0);
  assert.equal(slapPose(0).wind, 0);
  assert.ok(slapPose(0.14).strike > 0);
});

test("ability input is validated and executed by authority, not by an arbitrary client damage claim", () => {
  const s = setup("glove_flash");
  try {
    s.service.receive(s.a, {
      type: "input",
      input: {
        seq: 1,
        yaw: 0,
        pitch: 0,
        keys: 0,
        fire: false,
        aim: false,
        paused: false,
        actions: [{ id: 1, type: "ability" }],
      },
    });
    assert.ok(s.g.player.z < -6);
    assert.ok(s.g.player.abilityCooldown > 0);
    const z = s.g.player.z;
    s.service.receive(s.a, {
      type: "input",
      input: {
        seq: 2,
        yaw: 0,
        pitch: 0,
        keys: 0,
        fire: false,
        aim: false,
        paused: false,
        actions: [{ id: 2, type: "ability" }],
      },
    });
    assert.equal(s.g.player.z, z);
    assert.equal(s.other.player.health, 150);
    s.service.receive(s.a, { type: "gloveHit", victim: s.b, damage: 99999 });
    assert.equal(s.other.player.health, 150);
  } finally {
    s.service.dispose();
  }
});

test("the final multiplayer snapshot settles the last earned slap before showing results", async () => {
  const { MultiplayerSession } = await import("../src/net/session.js");
  const { progression } = await import("../src/gloves/progression.js");
  const before = progression.profile.slaps;
  const self = {
    id: "final-hit-test",
    weapon: "glove_default",
    loadout: gloveLoadout(),
    stats: { shots: 1, hits: 1, kills: 1, deaths: 0, headshots: 0 },
    health: 150,
    alive: true,
    dash: 0,
    deflect: 0,
    heal: 0,
    throw: 0,
    dashCooldown: 0,
  };
  const snapshot = {
    matchId: 0x7ffffffe,
    round: 1,
    time: 20,
    phase: "finished",
    score: [5, 0],
    players: [self],
    roundTime: 10,
    countdown: 0,
  };
  const g = {
    state: "playing",
    loadout: gloveLoadout(),
    player: { alive: true },
    finish() {
      assert.equal(progression.profile.slaps, before + 1);
      assert.equal(this.matchStats.hits, 1);
      this.state = "results";
    },
  };
  const net = {
    game: g,
    id: self.id,
    round: 1,
    latest: { time: 19 },
    buffer: { push: noop },
    entities: new Map(),
    confirmShot: noop,
    earnedHits: 0,
  };
  MultiplayerSession.prototype.receive.call(net, snapshot);
  assert.equal(g.state, "results");
  assert.equal(net.earnedHits, 1);
  MultiplayerSession.prototype.receive.call(net, { ...snapshot, time: 21 });
  assert.equal(progression.profile.slaps, before + 1);
});

test("Spring changes actual launch height, Snow reduces jumping, and Default clears chill", () => {
  const s = setup("glove_spring");
  try {
    s.g.tryJump();
    assert.equal(s.g.player.vy, 13.4);
    Object.assign(s.g.player, { grounded: true, jumps: 0, chillTime: 5 });
    s.g.tryJump();
    assert.equal(s.g.player.vy, 13.4 * 0.65);
  } finally {
    s.service.dispose();
  }
  const t = setup();
  try {
    t.g.player.chillTime = 5;
    useGloveAbility(t.g);
    assert.equal(t.g.player.chillTime, 0);
    assert.equal(t.g.player.boostTime, 1.35);
  } finally {
    t.service.dispose();
  }
});
test("Bull hits at most three valid enemies in one heavy slap, awarding one slap per target", () => {
  const s = setup("glove_bull");
  try {
    for (let i = 0; i < 3; i++)
      s.match.entities.push({
        ...s.other.player,
        id: `bull-target-${i}`,
        x: (i - 1) * 0.45,
        z: -2.1,
        health: 150,
      });
    assert.equal(resolveSlap(s.g, s.g.player, "glove_bull"), 3);
    assert.equal(s.match.entities.filter((e) => e.health === 112).length, 3);
    assert.equal(s.g.matchStats.hits, 3);
  } finally {
    s.service.dispose();
  }
});
