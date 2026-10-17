import {
  gloveMoveScale,
  committedWish,
  lowGravity,
  receiveGloveState,
} from "../src/gloves/states.js";
import { presentGloveStates } from "../src/gloves/visual-effects.js";
import { createBrickModel } from "../src/gloves/brick.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  GLOVES,
  GLOVE_ROSTER,
  gloveLoadout,
  canUseGlove,
  sanitizeSlaps,
} from "../src/gloves/catalog.js";
import { SlapProgression, sanitizeProfile } from "../src/gloves/progression.js";
import {
  applyImpact,
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
test("24 gloves have unique costs, original rigs and valid canonical internal inventory", () => {
  assert.equal(Object.keys(GLOVES).length, 24);
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

test("expanded roster preserves the original nine wire IDs, saves and sorted milestones", () => {
  assert.deepEqual(Object.keys(GLOVES).slice(0, 9), [
    "glove_default",
    "glove_diamond",
    "glove_extended",
    "glove_snow",
    "glove_pull",
    "glove_flash",
    "glove_spring",
    "glove_swapper",
    "glove_bull",
  ]);
  assert.equal(new Set(GLOVE_ROSTER.map((g) => g.cost)).size, 24);
  assert.deepEqual(
    GLOVE_ROSTER.slice(0, 7).map((g) => g.cost),
    [0, 15, 30, 40, 65, 85, 110],
  );
  for (const g of GLOVE_ROSTER) {
    assert.equal(canUseGlove(g.id, g.cost), true);
    if (g.cost) assert.equal(canUseGlove(g.id, g.cost - 1), false);
    assert.equal(
      sanitizeProfile({ slaps: g.cost, selected: g.id }).selected,
      g.id,
    );
  }
  const p = new SlapProgression({
    getItem: () => JSON.stringify({ slaps: 30, selected: "glove_extended" }),
    setItem: noop,
  });
  assert.equal(p.next().id, "glove_dual");
  assert.equal(p.profile.selected, "glove_extended");
});

test("Dual has a real second animated hand, a wider two-target sweep and two rewards per enemy", () => {
  const s = setup("glove_dual");
  try {
    const e = s.other.player;
    Object.assign(e, { x: 2.5, z: -1 });
    s.match.entities.push(
      { ...e, id: "dual-side", x: -2.5 },
      { ...e, id: "dual-third", x: 0, z: -3 },
    );
    assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 1); // only the central enemy is in the narrow cone
    for (const target of s.match.entities.slice(1)) {
      target.health = 150;
      target.slapGrace = 0;
      target.ragdollTime = 0;
    }
    s.g.matchStats.hits = 0;
    delete s.g.matchStats.slaps;
    assert.equal(resolveSlap(s.g, s.g.player, "glove_dual"), 2);
    assert.equal(s.g.matchStats.hits, 2);
    assert.equal(s.g.matchStats.slaps, 4);
    const model = createGloveModel("glove_dual"),
      left = model.userData.secondGlove;
    assert.ok(left);
    assert.equal(left.userData.gloveRig.fingers.length, 5);
    assert.equal(left.userData.secondGlove, undefined);
    animateGlove(model, { gloveSwingAge: 0.2 });
    assert.notEqual(left.position.x, -1.25);
  } finally {
    s.service.dispose();
  }
});

for (let roll = 1; roll <= 6; roll++)
  test(`Dice authority produces balanced outcome ${roll}, not client-provided damage`, () => {
    const s = setup("glove_dice");
    try {
      s.g.gloveRandom = () => (roll - 1 + 0.5) / 6;
      assert.equal(resolveSlap(s.g, s.g.player, "glove_dice"), 1);
      assert.equal(s.other.player.health, 150 - (12 + roll * 4));
      assert.ok(Math.abs(s.other.player.vz + (7 + roll * 3.1)) < 0.0001);
      assert.equal(
        s.match.events.find((e) => e.type === "gloveHit").roll,
        roll,
      );
      assert.equal(s.g.matchStats.slaps, 1);
    } finally {
      s.service.dispose();
    }
  });

test("Brick traps are bounded, expire, have no damage/reward, and can be jumped or avoided by allies", () => {
  const s = setup("glove_brick");
  try {
    assert.equal(useGloveAbility(s.g), true);
    const brick = s.g.gloveBricks[0];
    assert.ok(brick.z > 0);
    assert.equal(s.g.player.abilityCooldown, 5);
    Object.assign(s.other.player, { x: brick.x, z: brick.z, grounded: false });
    s.g.clock += 0.5;
    tickGloves(s.g, 0.01);
    assert.equal(s.other.player.ragdollTime, 0);
    s.other.player.grounded = true;
    s.other.player.team = 0;
    tickGloves(s.g, 0.01);
    assert.equal(s.g.gloveBricks.length, 1);
    s.other.player.team = 1;
    tickGloves(s.g, 0.01);
    assert.equal(s.g.gloveBricks.length, 0);
    assert.ok(s.other.player.ragdollTime > 0.7);
    assert.equal(s.other.player.health, 150);
    assert.equal(s.g.matchStats.hits, 0);
    s.other.player.z = -20;
    for (let i = 0; i < 7; i++) {
      s.g.player.abilityCooldown = 0;
      assert.equal(useGloveAbility(s.g), true);
    }
    assert.equal(s.g.gloveBricks.length, 4);
    const zones = s.match.snapshot().zones;
    assert.equal(zones.length, 4);
    assert.equal(new Set(zones.map((z) => z.id)).size, 4);
    assert.ok(zones.every((z) => z.type === "brick" && z.id > 0));
    tickGloves(s.g, 10);
    assert.equal(s.g.gloveBricks.length, 0);
    const model = createBrickModel();
    assert.equal(model.children.length, 5);
    model.traverse((o) => o.geometry?.dispose());
  } finally {
    s.service.dispose();
  }
});

test("Brick cannot be placed in the air or inside world geometry, without wasting a cooldown", () => {
  const s = setup("glove_brick");
  try {
    s.g.player.grounded = false;
    assert.equal(useGloveAbility(s.g), false);
    assert.ok(!s.g.player.abilityCooldown);
    s.g.player.grounded = true;
    s.g.world.boxes = [
      { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: 0.2, maxZ: 1.5 },
    ];
    assert.equal(useGloveAbility(s.g), false);
    assert.equal(s.g.gloveBricks, undefined);
  } finally {
    s.service.dispose();
  }
});

test("Acrobat commits a forward dodge, clears falling velocity and never rotates the camera", () => {
  const s = setup("glove_acrobat");
  try {
    s.g.yaw = 0.3;
    s.g.pitch = 0.2;
    s.g.player.vy = -18;
    assert.equal(useGloveAbility(s.g), true);
    assert.equal(s.g.player.boostTime, 0.5);
    assert.equal(s.g.player.vy, 0);
    assert.ok(Math.abs(Math.hypot(s.g.player.vx, s.g.player.vz) - 18) < 0.0001);
    assert.equal(s.g.yaw, 0.3);
    assert.equal(s.g.pitch, 0.2);
    const wish = committedWish(s.g.player, GLOVES.glove_acrobat, {
      x: 1,
      z: 0,
    });
    assert.ok(wish.z < -0.9);
    tickGloves(s.g, 0.51);
    assert.deepEqual(
      committedWish(s.g.player, GLOVES.glove_acrobat, { x: 1, z: 0 }),
      { x: 1, z: 0 },
    );
  } finally {
    s.service.dispose();
  }
});

test("Ghost really hides enemies and names, remains hittable, and breaks invisibility when slapping", () => {
  const s = setup("glove_ghost");
  try {
    assert.equal(useGloveAbility(s.g), true);
    assert.equal(s.g.player.ghostTime, 3.2);
    const target = {
      team: 1,
      ghostTime: 3.2,
      model: createCharacter(1, "GHOST"),
      activeWeapon: "glove_ghost",
    };
    const scene = { clock: 1, player: { team: 0 } };
    presentGloveStates(scene, target);
    assert.equal(target.model.group.visible, false);
    target.team = 0;
    presentGloveStates(scene, target);
    assert.equal(target.model.group.visible, true);
    assert.equal(
      applyImpact(
        s.other,
        s.other.player,
        s.g.player,
        GLOVES.glove_default,
        true,
      ),
      true,
    );
    assert.equal(s.g.player.health, 126);
    s.g.player.ragdollTime = 0;
    s.g.player.slapGrace = 0;
    assert.equal(beginSlap(s.g), true);
    assert.equal(s.g.player.ghostTime, 0);
  } finally {
    s.service.dispose();
  }
});

test("Thanos mark/return is authoritative, collision-validated, cooldown-limited and does not heal", () => {
  const s = setup("glove_thanos");
  try {
    s.g.player.health = 78;
    assert.equal(useGloveAbility(s.g), true);
    assert.deepEqual(s.g.player.gloveMark, { x: 0, y: 0, z: 0 });
    assert.equal(s.g.player.markTime, 12);
    s.g.player.x = 5;
    assert.equal(useGloveAbility(s.g), false);
    tickGloves(s.g, 0.41);
    s.g.world.boxes = [
      { minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -1, maxZ: 1 },
    ];
    assert.equal(useGloveAbility(s.g), false);
    assert.equal(s.g.player.x, 5);
    s.g.world.boxes = [];
    assert.equal(useGloveAbility(s.g), true);
    assert.equal(s.g.player.x, 0);
    assert.equal(s.g.player.health, 78);
    assert.equal(s.g.player.gloveMark, null);
    assert.equal(s.g.player.abilityCooldown, 14);
  } finally {
    s.service.dispose();
  }
});

test("Expired Thanos marks cannot bypass the return cooldown", () => {
  const s = setup("glove_thanos");
  try {
    useGloveAbility(s.g);
    tickGloves(s.g, 12.1);
    assert.equal(s.g.player.gloveMark, null);
    assert.equal(s.g.player.abilityCooldown, 14);
    assert.equal(useGloveAbility(s.g), false);
  } finally {
    s.service.dispose();
  }
});

test("Stun EMP only affects grounded visible enemies, without damage or slap rewards", () => {
  const s = setup("glove_stun");
  try {
    s.other.player.grounded = false;
    useGloveAbility(s.g);
    assert.equal(s.other.player.ragdollTime, 0);
    s.other.player.grounded = true;
    s.g.player.abilityCooldown = 0;
    s.g.hasLOS = () => false;
    useGloveAbility(s.g);
    assert.equal(s.other.player.ragdollTime, 0);
    s.g.hasLOS = () => true;
    s.g.player.abilityCooldown = 0;
    useGloveAbility(s.g);
    assert.equal(s.other.player.ragdollTime, 1.1);
    assert.equal(s.other.player.slapGrace, 0);
    assert.equal(s.other.player.health, 150);
    assert.equal(s.g.matchStats.hits, 0);
  } finally {
    s.service.dispose();
  }
});

test("Za Hando pulls nearby enemies, never allies or targets behind walls", () => {
  const s = setup("glove_za_hando");
  try {
    s.g.hasLOS = () => false;
    useGloveAbility(s.g);
    assert.equal(s.other.player.vz, 0);
    s.g.hasLOS = () => true;
    s.g.player.abilityCooldown = 0;
    useGloveAbility(s.g);
    assert.equal(s.other.player.vz, 13);
    assert.equal(s.other.player.health, 150);
    assert.equal(s.g.matchStats.hits, 0);
  } finally {
    s.service.dispose();
  }
});

test("Magnet rushes the user rather than teleporting or pulling the enemy, with no invalid-target cooldown", () => {
  const s = setup("glove_magnet");
  try {
    s.other.player.ragdollTime = 1;
    assert.equal(useGloveAbility(s.g), false);
    assert.ok(!s.g.player.abilityCooldown);
    s.other.player.ragdollTime = 0;
    s.other.player.ghostTime = 1;
    assert.equal(useGloveAbility(s.g), false);
    s.other.player.ghostTime = 0;
    assert.equal(useGloveAbility(s.g), true);
    assert.equal(s.g.player.z, 0);
    assert.equal(s.g.player.vz, -22);
    assert.equal(s.other.player.vz, 0);
    assert.equal(s.g.player.boostTime, 0.55);
  } finally {
    s.service.dispose();
  }
});

test("Anchor redirects confirmed knockback toward the placed dock, not away from the attacker", () => {
  const s = setup("glove_anchor");
  try {
    useGloveAbility(s.g);
    s.g.player.x = 3;
    Object.assign(s.other.player, { x: 5, z: 0 });
    s.g.yaw = -Math.PI / 2;
    assert.equal(resolveSlap(s.g, s.g.player, "glove_anchor"), 1);
    assert.equal(s.other.player.vx, -17);
    assert.equal(s.other.player.vz, 0);
    assert.equal(s.g.player.markTime, 10);
    assert.equal(s.g.matchStats.slaps, 1);
  } finally {
    s.service.dispose();
  }
});

test("Space is a timed low-gravity lift, not flight or a permanent physics mutation", () => {
  const s = setup("glove_space");
  try {
    useGloveAbility(s.g);
    assert.equal(s.g.player.vy, 7);
    assert.equal(s.g.player.grounded, false);
    assert.equal(s.g.player.spaceTime, 2.6);
    lowGravity(s.g.player, 0.1);
    assert.ok(Math.abs(s.g.player.vy - 9.16) < 0.00001);
    tickGloves(s.g, 2.7);
    const speed = s.g.player.vy;
    lowGravity(s.g.player, 0.1);
    assert.equal(s.g.player.vy, speed);
  } finally {
    s.service.dispose();
  }
});

test("Boomerang has a delayed stronger return impulse and only one damage/reward event", () => {
  const s = setup("glove_boomerang");
  try {
    resolveSlap(s.g, s.g.player, "glove_boomerang");
    assert.equal(s.other.player.vz, -15);
    assert.equal(s.other.player.health, 125);
    s.other.clock = 10.27;
    tickGloves(s.other, 0.001);
    assert.equal(s.other.player.vz, -15);
    s.other.clock = 10.29;
    tickGloves(s.other, 0.001);
    assert.equal(s.other.player.vz, 24);
    assert.equal(s.g.matchStats.hits, 1);
    assert.equal(s.g.matchStats.slaps, 1);
    assert.equal(s.other.player.health, 125);
    assert.equal(s.match.events.filter((e) => e.type === "impulse").length, 2);
    tickGloves(s.other, 1);
    assert.equal(s.match.events.filter((e) => e.type === "impulse").length, 2);
  } finally {
    s.service.dispose();
  }
});

test("Speedrun gains permanent running speed and chill resistance without changing default movement", () => {
  assert.equal(gloveMoveScale({}, GLOVES.glove_default), 1);
  assert.equal(gloveMoveScale({}, GLOVES.glove_speedrun), 1.4);
  assert.equal(gloveMoveScale({ chillTime: 5 }, GLOVES.glove_default), 0.55);
  assert.ok(gloveMoveScale({ chillTime: 5 }, GLOVES.glove_speedrun) > 1);
});

test("Golden really protects, enhances outgoing hits and then expires with a long cooldown", () => {
  const s = setup("glove_golden");
  try {
    useGloveAbility(s.g);
    assert.equal(s.g.player.goldTime, 3);
    assert.equal(s.g.player.abilityCooldown, 24);
    assert.equal(
      applyImpact(
        s.other,
        s.other.player,
        s.g.player,
        GLOVES.glove_default,
        true,
      ),
      false,
    );
    s.match.damage(s.g.player, 50, s.other.player);
    assert.equal(s.g.player.health, 150);
    assert.equal(resolveSlap(s.g, s.g.player, "glove_golden"), 1);
    assert.equal(s.other.player.health, 117.5);
    tickGloves(s.g, 3.1);
    assert.equal(s.g.player.goldTime, 0);
    assert.ok(s.g.player.abilityCooldown > 20);
    assert.equal(
      applyImpact(
        s.other,
        s.other.player,
        s.g.player,
        GLOVES.glove_default,
        true,
      ),
      true,
    );
  } finally {
    s.service.dispose();
  }
});

test("Reverse reflects actual damage/launch and credits the defender; double Reverse never recurses", () => {
  const s = setup("glove_default");
  try {
    s.other.player.reverseTime = 2;
    s.other.loadout = gloveLoadout("glove_reverse");
    assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 1);
    assert.equal(s.other.player.health, 150);
    assert.equal(s.g.player.health, 126);
    assert.ok(s.g.player.ragdollTime > 0);
    assert.equal(s.g.matchStats.hits, 0);
    assert.equal(s.other.matchStats.hits, 1);
    assert.equal(s.other.matchStats.slaps, 1);
    const event = s.match.events.find((e) => e.type === "gloveHit");
    assert.equal(event.source, s.b);
    assert.equal(event.victim, s.a);
    assert.equal(event.reflected, true);
    Object.assign(s.g.player, { ragdollTime: 0, slapGrace: 0, reverseTime: 2 });
    assert.equal(resolveSlap(s.g, s.g.player, "glove_default"), 0);
    assert.equal(s.other.matchStats.hits, 1);
  } finally {
    s.service.dispose();
  }
});

test("all new status timers, private presentation marks, brick zones and Dual earned counts round-trip over version 4", () => {
  const s = setup("glove_thanos");
  try {
    useGloveAbility(s.g);
    Object.assign(s.g.player, {
      ghostTime: 3.2,
      goldTime: 2.9,
      reverseTime: 1.7,
      spaceTime: 2.6,
      boostTime: 0.5,
    });
    s.g.matchStats.hits = 2;
    s.g.matchStats.slaps = 4;
    s.g.gloveBricks = [{ x: 1, y: 0, z: 3, life: 8, owner: s.g.player }];
    const snap = s.match.snapshot(),
      encoded = encodeSnapshot(snap);
    assert.equal(encoded[2], 4);
    assert.equal(encoded.length, 23 + 2 * 113 + 19);
    const result = decodeSnapshot(
        encoded,
        new Map(snap.players.map((p) => [p.index, p])),
      ),
      self = result.players.find((p) => p.id === s.a),
      body = {};
    receiveGloveState(body, self);
    assert.equal(body.ghostTime, 3.2);
    assert.equal(body.goldTime, 2.9);
    assert.equal(body.reverseTime, 1.7);
    assert.equal(body.spaceTime, 2.6);
    assert.equal(body.boostTime, 0.5);
    assert.equal(body.markTime, 12);
    assert.deepEqual(body.gloveMark, { x: 0, y: 0, z: 0 });
    assert.equal(self.stats.slaps, 4);
    assert.equal(self.stats.hits, 2);
    assert.equal(result.zones[0].type, "brick");
    assert.throws(() =>
      decodeSnapshot(
        encoded.slice(0, -1),
        new Map(snap.players.map((p) => [p.index, p])),
      ),
    );
    s.match.newRound();
    assert.equal(s.match.snapshot().zones.length, 0);
    assert.ok(
      s.match
        .snapshot()
        .players.every(
          (p) =>
            !p.gloveMark && !p.reload && !p.blind && !p.paint && !p.quickMelee,
        ),
    );
  } finally {
    s.service.dispose();
  }
});

for (const glove of GLOVE_ROSTER.filter(
  (g) => g.cost >= 40 && g.activation === "active",
))
  test(`${glove.name} active ability has a real authority branch and cannot execute client-side`, () => {
    const s = setup(glove.id);
    try {
      const before = s.other.player.health;
      assert.equal(useGloveAbility(s.g), true);
      assert.ok(s.g.player.abilityCooldown > 0);
      const event = s.match.events.find((e) => e.type === "gloveAbility");
      assert.equal(event.glove, glove.id);
      assert.equal(event.round, s.match.round);
      assert.equal(s.other.player.health, before);
      assert.equal(s.g.matchStats.hits, 0);
      assert.equal(useGloveAbility(s.g), false);
      s.g.player.abilityCooldown = 0;
      s.g.network = {};
      assert.equal(useGloveAbility(s.g), false);
      assert.equal(resolveSlap(s.g, s.g.player, glove.id), 0);
    } finally {
      s.service.dispose();
    }
  });

test("Space snapshots recover the initial lift without a presentation event or ragdoll", async () => {
  const { MultiplayerSession } = await import("../src/net/session.js");
  const self = {
    id: "space-recovery",
    weapon: "glove_space",
    loadout: gloveLoadout("glove_space"),
    stats: { hits: 0, slaps: 0 },
    alive: true,
    health: 150,
    dash: 0,
    throw: 0,
    quickMelee: 2.4,
    vx: 1,
    vy: 6,
    vz: 2,
    grounded: false,
  };
  const snapshot = {
    matchId: 99,
    round: 1,
    time: 20,
    phase: "finished",
    score: [5, 0],
    players: [self],
    roundTime: 0,
    countdown: 0,
  };
  const g = {
    state: "playing",
    loadout: gloveLoadout("glove_space"),
    player: { alive: true, vy: 0, grounded: true },
    finish() {
      this.state = "results";
    },
  };
  const n = {
    game: g,
    id: self.id,
    round: 1,
    latest: { time: 19 },
    buffer: { push: noop },
    entities: new Map(),
    confirmShot: noop,
    earnedHits: 0,
  };
  MultiplayerSession.prototype.receive.call(n, snapshot);
  assert.equal(g.player.vy, 6);
  assert.equal(g.player.grounded, false);
  assert.equal(g.player.spaceTime, 2.4);
});

test("network impulse aging respects active Space gravity instead of applying normal gravity", async () => {
  const { MultiplayerSession } = await import("../src/net/session.js");
  for (const [space, expected] of [
    [0, 4],
    [2.4, 8.32],
  ]) {
    const g = { player: { alive: true, spaceTime: space }, clock: 10 };
    const n = {
      game: g,
      id: "space-impulse",
      round: 1,
      lastEvent: 0,
      client: { rtt: 0 },
      latest: { time: 10.2 },
    };
    MultiplayerSession.prototype.processEvents.call(n, [
      {
        id: 1,
        type: "impulse",
        player: n.id,
        round: 1,
        time: 10,
        velocity: [0, 10, 0],
      },
    ]);
    assert.ok(Math.abs(g.player.vy - expected) < 0.00001);
    assert.equal(g.player.grounded, false);
  }
});

test("Default burst commits real movement from rest, releases steering after the launch, and never adds damage/slaps", () => {
  const t = setup();
  try {
    Object.assign(t.g.player, { vx: 0, vz: 0 });
    assert.equal(useGloveAbility(t.g), true);
    const wish = committedWish(t.g.player, GLOVES.glove_default, {
      x: 0,
      z: 0,
    });
    assert.ok(wish.z < -0.99);
    assert.equal(t.g.player.vz, -14);
    const event = t.match.events.find((e) => e.type === "gloveAbility");
    assert.equal(event.round, t.match.round);
    assert.equal(event.yaw, t.g.yaw);
    assert.equal(t.other.player.health, 150);
    assert.equal(t.g.matchStats.hits, 0);
    t.g.player.boostTime = 0.99;
    assert.deepEqual(
      committedWish(t.g.player, GLOVES.glove_default, { x: 1, z: 0 }),
      { x: 1, z: 0 },
    );
  } finally {
    t.service.dispose();
  }
});
