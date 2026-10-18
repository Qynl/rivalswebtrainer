import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { setup } from "./helpers/match.js";
import { GLOVES, gloveLoadout } from "../src/gloves/catalog.js";
import { contactRegion, RECOVERY_WINDOW } from "../src/gloves/balance.js";
import {
  useGloveAbility,
  resolveSlap,
  tickGloves,
  applyImpact,
  beginSlap,
  updateGloveBot,
} from "../src/gloves/combat.js";
import { gloveMoveScale } from "../src/gloves/states.js";
import { gloveReachCue } from "../src/gloves/readability.js";
import { gloveAbilityReadout } from "../src/gloves/status-readout.js";
import { GloveFX } from "../src/gloves/fx.js";
function fixture(id = "glove_default") {
  const s = setup();
  for (const [i, g] of [s.g, s.other].entries()) {
    g.loadout = gloveLoadout(i === 0 ? id : "glove_default");
    g.state = "playing";
    g.clock = 10;
    g.yaw = g.pitch = 0;
    g.world.boxes = [];
    g.hasLOS = () => true;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: i === 0 ? 0 : -2,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      health: 150,
      alive: true,
      ragdollTime: 0,
      slapGrace: 0,
      stoneTime: 0,
      height: 1.9,
      radius: 0.28,
    });
  }
  return s;
}
test("Extended keeps distant reach but cannot slap through its handle, sideways, behind or upward even with pitch aiming", () => {
  const glove = GLOVES.glove_extended;
  assert.equal(contactRegion(glove, { x: 0, y: 0, z: -4.6 }), "contact");
  for (const [delta, pitch] of [
    [{ x: 0, y: 0, z: -1.5 }, 0],
    [{ x: 1.2, y: 0, z: -4 }, 0],
    [{ x: 0, y: 1.5, z: -3 }, 0.5],
    [{ x: 0, y: 0, z: 3 }, Math.PI],
    [{ x: 0, y: 0, z: -5.1 }, 0],
  ])
    assert.notEqual(contactRegion(glove, delta, 0, pitch), "contact");
  assert.equal(
    contactRegion(glove, { x: 4, y: 0, z: 0 }, -Math.PI / 2),
    "contact",
  );
  assert.ok(glove.interval >= 1);
  assert.ok(glove.windup >= 0.2);
});
test("real Extended point-blank misses earn nothing, normal palms can counter inside the handle, and the reach cue agrees with authority", () => {
  const { g, other } = fixture("glove_extended");
  other.player.z = -1.4;
  g.headless = false;
  g.scene = null;
  g.audio = { volume: 0 };
  g.events = { hit() {}, slap() {} };
  assert.equal(resolveSlap(g, g.player, "glove_extended"), 0);
  assert.equal(other.player.health, 150);
  assert.equal(g.matchStats.hits, 0);
  const cue = gloveReachCue(g);
  assert.equal(cue.state, "too-close");
  assert.match(cue.label, /BLIND SPOT/);
  other.yaw = Math.PI;
  assert.equal(resolveSlap(other, other.player, "glove_default"), 1);
  assert.ok(g.player.health < 150);
});
test("the actual distant Extended tip still lands, but cannot hit through a wall", () => {
  const { g, other } = fixture("glove_extended");
  other.player.z = -4.4;
  g.hasLOS = () => false;
  assert.equal(resolveSlap(g, g.player, "glove_extended"), 0);
  g.hasLOS = () => true;
  assert.equal(resolveSlap(g, g.player, "glove_extended"), 1);
  assert.equal(other.player.health, 130);
  assert.equal(other.player.ragdollTime, 0.44);
});
test("every direct glove hit grants a real actionable recovery window rather than an immediate repeated ragdoll", () => {
  const { g, other } = fixture();
  assert.equal(resolveSlap(g, g.player, "glove_default"), 1);
  assert.equal(
    other.player.slapGrace,
    GLOVES.glove_default.ragdoll + RECOVERY_WINDOW,
  );
  tickGloves(other, GLOVES.glove_default.ragdoll + 0.02);
  assert.equal(other.player.ragdollTime, 0);
  assert.ok(other.player.slapGrace > 0.2);
  assert.equal(beginSlap(other), true);
  const hp = other.player.health;
  assert.equal(resolveSlap(g, g.player, "glove_default"), 0);
  assert.equal(other.player.health, hp);
  tickGloves(other, 0.3);
  assert.equal(resolveSlap(g, g.player, "glove_default"), 1);
});
test("Diamond can exit after rearm without refunding cooldown or granting a fresh protection window", () => {
  const { g } = fixture("glove_diamond");
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.player.stoneTime, 4);
  assert.equal(useGloveAbility(g), false);
  assert.equal(
    gloveAbilityReadout(g.player, GLOVES.glove_diamond, "playing").label,
    "REARM",
  );
  tickGloves(g, 0.36);
  assert.equal(
    gloveAbilityReadout(g.player, GLOVES.glove_diamond, "playing").label,
    "EXIT",
  );
  assert.equal(
    gloveAbilityReadout(g.player, GLOVES.glove_diamond, "playing").progress,
    1,
  );
  const cd = g.player.abilityCooldown;
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.player.stoneTime, 0);
  assert.equal(g.player.abilityCooldown, cd);
  assert.equal(useGloveAbility(g), false);
  assert.equal(g.player.health, 150);
  assert.equal(g.matchStats.hits, 0);
});
test("EMP has no instant force; jumping during its warning actually avoids the release", () => {
  const { g, other } = fixture("glove_stun");
  assert.equal(useGloveAbility(g), true);
  assert.ok(g.player.gloveAbilityPending);
  assert.equal(other.player.ragdollTime, 0);
  assert.equal(beginSlap(g), false);
  tickGloves(g, 0.2);
  other.player.grounded = false;
  tickGloves(g, 0.21);
  assert.equal(g.player.gloveAbilityPending, null);
  assert.equal(other.player.ragdollTime, 0);
  assert.equal(other.player.health, 150);
  assert.equal(g.matchStats.hits, 0);
});
test("grounded EMP and Erasure release once, check current sightlines, and never award damage or slaps by themselves", () => {
  for (const [id, wait] of [
    ["glove_stun", 0.41],
    ["glove_za_hando", 0.51],
  ])
    for (const exposed of [true, false]) {
      const { g, other, m } = fixture(id);
      useGloveAbility(g);
      assert.equal(other.player.ragdollTime, 0);
      g.hasLOS = () => exposed;
      tickGloves(g, wait);
      assert.equal(other.player.ragdollTime > 0, exposed);
      assert.equal(other.player.health, 150);
      assert.equal(g.matchStats.hits, 0);
      assert.equal(g.player.gloveAbilityPending, null);
      assert.equal(
        m.events.filter(
          (e) => e.type === "gloveAbility" && e.phase === "release",
        ).length,
        1,
      );
      tickGloves(g, 0.6);
      assert.equal(
        m.events.filter(
          (e) => e.type === "gloveAbility" && e.phase === "release",
        ).length,
        1,
      );
    }
});
test("an actual incoming slap interrupts the cast, and death/round-end cannot release an abandoned ability", () => {
  for (const mode of ["slap", "death", "roundend"]) {
    const { g, other, m } = fixture("glove_za_hando");
    useGloveAbility(g);
    if (mode === "slap")
      applyImpact(other, other.player, g.player, GLOVES.glove_default, true);
    if (mode === "death") g.player.alive = false;
    if (mode === "roundend") g.state = "roundend";
    tickGloves(g, 0.6);
    assert.equal(g.player.gloveAbilityPending, null);
    assert.equal(other.player.health, 150);
    assert.equal(other.player.ragdollTime, 0);
    assert.equal(
      m.events.filter((e) => e.type === "gloveAbility" && e.phase === "release")
        .length,
      0,
    );
    assert.equal(
      m.events.filter((e) => e.type === "gloveAbility" && e.phase === "cancel")
        .length,
      1,
    );
  }
});
test("Golden keeps real protection and stronger launch but cannot stack an extra health-damage multiplier", () => {
  const { g, other } = fixture("glove_golden");
  useGloveAbility(g);
  assert.equal(resolveSlap(g, g.player, "glove_golden"), 1);
  assert.equal(other.player.health, 124);
  assert.ok(
    Math.abs(
      Math.hypot(other.player.vx, other.player.vz) -
        GLOVES.glove_golden.power * 1.3,
    ) < 1e-8,
  );
  assert.equal(
    applyImpact(other, other.player, g.player, GLOVES.glove_default, true),
    false,
  );
});
test("cast warning ownership stays bounded and cancellation cannot erase another caster or an unrelated impact", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene);
  const event = {
    glove: "glove_stun",
    phase: "windup",
    position: [0, 0.6, 0],
    player: 0,
    windup: 0.4,
  };
  fx.ability(event);
  fx.ability({ ...event, player: 1 });
  assert.equal(
    fx.rings.states.filter((s) => s.life > 0 && s.castOwner === 0).length,
    2,
  );
  fx.hit(new THREE.Vector3(), 0xffffff);
  fx.ability({ ...event, phase: "cancel" });
  assert.equal(
    fx.rings.states.filter((s) => s.life > 0 && s.castOwner === 0).length,
    0,
  );
  assert.equal(
    fx.rings.states.filter((s) => s.life > 0 && s.castOwner === 1).length,
    2,
  );
  assert.ok(fx.rings.states.some((s) => s.life > 0 && s.castOwner == null));
  fx.dispose();
  assert.equal(scene.children.length, 0);
});

test("Brick lasts long enough to build a four-trap lane with its genuine five-second cooldown, and Ghost gains approach time without immunity", () => {
  const { g, other } = fixture("glove_brick");
  other.player.z = -20;
  useGloveAbility(g);
  for (let i = 0; i < 3; i++) {
    g.clock += 5;
    tickGloves(g, 5);
    assert.equal(useGloveAbility(g), true);
  }
  assert.equal(g.gloveBricks.length, 4);
  assert.ok(g.gloveBricks[0].life > 0);
  tickGloves(g, 19);
  assert.equal(g.gloveBricks.length, 0);
  const s = fixture("glove_ghost");
  useGloveAbility(s.g);
  assert.equal(s.g.player.ghostTime, 4.5);
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
  assert.ok(s.g.player.health < 150);
});

test("Erasure commits to its announced forward lane, not a 360-degree vacuum; sidestepping, flanking and hugging the caster avoid it", () => {
  for (const target of [
    { x: 0, z: -6, hit: true },
    { x: 4, z: -4 },
    { x: 0, z: 3 },
    { x: 0, z: -0.5 },
    { x: 2, z: -5 },
  ]) {
    const { g, other } = fixture("glove_za_hando");
    Object.assign(other.player, target);
    g.player.vx = 8;
    useGloveAbility(g);
    assert.equal(g.player.vx, 0);
    assert.equal(gloveMoveScale(g.player, GLOVES.glove_za_hando), 0);
    g.yaw = Math.PI;
    tickGloves(g, 0.51);
    assert.equal(
      other.player.ragdollTime > 0,
      !!target.hit,
      JSON.stringify(target),
    );
    assert.equal(gloveMoveScale(g.player, GLOVES.glove_za_hando), 1);
    assert.equal(g.matchStats.hits, 0);
  }
  const { g, other } = fixture("glove_za_hando");
  other.player.z = -6;
  useGloveAbility(g);
  other.player.x = 3;
  tickGloves(g, 0.51);
  assert.equal(other.player.ragdollTime, 0);
});
test("Erasure warnings use the actual rotated narrow lane, and cancellation clears only that caster while pooled rays reset their lane mode", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene);
  fx.ability({
    glove: "glove_za_hando",
    player: "erasure",
    phase: "windup",
    position: [0, 0.6, 0],
    yaw: Math.PI / 2,
    windup: 0.5,
  });
  const lane = fx.rays.states.filter((s) => s.castOwner === "erasure");
  assert.equal(lane.length, 4);
  assert.ok(lane.every((s) => s.lane && s.life === 0.5 && s.p.x < -0.9));
  fx.ability({
    glove: "glove_stun",
    player: "emp",
    phase: "windup",
    position: [0, 0.6, 0],
    windup: 0.4,
  });
  fx.update(0.1);
  fx.ability({
    glove: "glove_za_hando",
    player: "erasure",
    phase: "cancel",
    position: [0, 0.6, 0],
  });
  assert.equal(
    lane.some((s) => s.life > 0),
    false,
  );
  assert.ok(fx.rings.states.some((s) => s.castOwner === "emp" && s.life > 0));
  fx.rays.cursor = 0;
  const regular = fx.emit(fx.rays, new THREE.Vector3(), "#fff");
  assert.equal(regular.lane, false);
  assert.equal(regular.castOwner, null);
  fx.dispose();
  assert.equal(scene.children.length, 0);
});

test("a Diamond opponent exits after blocking the visible attack, but never reads a hidden enemy windup to decide", () => {
  const { g, other } = fixture("glove_diamond"),
    bot = other.player;
  Object.assign(bot, {
    isPlayer: false,
    target: false,
    activeWeapon: "glove_diamond",
    stoneTime: 3.2,
    abilityCooldown: 11.2,
    yaw: Math.PI,
  });
  g.animateBot = () => {};
  g.player.slapPending = { remaining: 0.1, id: "glove_default" };
  updateGloveBot(g, bot, 1 / 120);
  assert.ok(bot.stoneTime > 0);
  g.player.slapPending = null;
  updateGloveBot(g, bot, 1 / 120);
  assert.equal(bot.stoneTime, 0);
  assert.equal(bot.abilityCooldown, 11.2);
  bot.stoneTime = 3.2;
  g.hasLOS = () => false;
  Object.defineProperty(g.player, "slapPending", {
    configurable: true,
    get() {
      throw new Error("hidden attack read");
    },
  });
  updateGloveBot(g, bot, 1 / 120);
  assert.equal(bot.stoneTime, 0);
});

test("charge warnings follow a moving caster instead of promising a pulse at an abandoned location, without moving any body", () => {
  const actor = { x: 0, y: 0, z: 0 },
    scene = new THREE.Scene(),
    fx = new GloveFX(scene, (id) => (id === "moving" ? actor : null));
  fx.ability({
    glove: "glove_stun",
    player: "moving",
    phase: "windup",
    position: [0, 0.6, 0],
    windup: 0.4,
  });
  actor.x = 2;
  actor.z = -1;
  fx.update(0.1);
  const rings = fx.rings.states.filter((s) => s.castOwner === "moving");
  assert.equal(rings.length, 2);
  assert.ok(
    rings.every(
      (s) => s.p.x === 2 && s.p.z === -1 && Math.abs(s.p.y - 0.08) < 1e-8,
    ),
  );
  assert.deepEqual(actor, { x: 2, y: 0, z: -1 });
  fx.ability({
    glove: "glove_za_hando",
    player: "moving",
    phase: "windup",
    position: [2, 0.6, -1],
    yaw: 0,
    windup: 0.5,
  });
  actor.x = 3;
  fx.update(0.05);
  const lane = fx.rays.states.filter((s) => s.castOwner === "moving");
  assert.equal(lane.length, 4);
  assert.ok(lane.every((s) => Math.abs(s.p.x - (3 + s.offsetX)) < 1e-8));
  fx.dispose();
});
