import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLOVE_ROSTER, GLOVES, gloveLoadout } from "../src/gloves/catalog.js";
import { abilityPose, ABILITY_GESTURES } from "../src/gloves/ability-motion.js";
import { createStatusRig, animateStatusRig } from "../src/gloves/status-rig.js";
import { GloveLinks, LINK_LIMIT, LINK_SEGMENTS } from "../src/gloves/links.js";
import { createGloveModel, animateGlove } from "../src/gloves/model.js";
import { createCharacter } from "../src/world.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
import { gloveReachCue, denyGloveAbility } from "../src/gloves/readability.js";
import { useGloveAbility, applyImpact } from "../src/gloves/combat.js";
import { MAP_ART } from "../src/map-art.js";
import { setup } from "./helpers/match.js";
import { exerciseEpoch } from "../scripts/glove-endurance.mjs";
function dispose(root) {
  const geos = new Set(),
    mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) mats.add(o.material);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

test("all active gloves have individually authored cast gestures, passive gloves never invent E motion", () => {
  const active = GLOVE_ROSTER.filter((g) => g.activation === "active");
  assert.equal(Object.keys(ABILITY_GESTURES).length, active.length);
  const signatures = new Set();
  for (const g of active) {
    assert.ok(ABILITY_GESTURES[g.key]);
    signatures.add(JSON.stringify(abilityPose(g.key, 0.2)));
  }
  assert.equal(signatures.size, active.length);
  for (const g of GLOVE_ROSTER.filter((g) => g.activation === "passive"))
    assert.equal(abilityPose(g.key, 0.2).weight, 0);
});
test("cast gestures have finite curves and exactly settle without mutating authority state", () => {
  for (const key of Object.keys(ABILITY_GESTURES)) {
    for (const age of [-1, 0, 0.7, 1, Infinity, NaN])
      assert.ok(Object.values(abilityPose(key, age)).every((x) => x === 0));
    for (let i = 0; i < 200; i++)
      assert.ok(
        Object.values(abilityPose(key, i / 200)).every(Number.isFinite),
      );
  }
  const model = createGloveModel("glove_stun"),
    state = { gloveCastAge: 0.2, gloveSwingAge: 10, yaw: 0.7, pitch: 0.5 };
  animateGlove(model, state);
  const position = model.position.clone(),
    rotation = model.rotation.toArray();
  for (let i = 0; i < 60; i++) animateGlove(model, state);
  assert.ok(model.position.equals(position));
  assert.deepEqual(model.rotation.toArray(), rotation);
  assert.equal(state.yaw, 0.7);
  assert.equal(state.pitch, 0.5);
  dispose(model);
});
test("third-person glove socket and fingers actually animate the same cast, then return to rest", () => {
  const m = createCharacter(1),
    e = { activeWeapon: "glove_space", gloveCastTime: 10, lastSlapAt: -10 };
  updateBotWeapon(m, e, 9);
  const rest = m.parts.onlineSocket.userData.weapon.position.clone();
  updateBotWeapon(m, e, 10.2);
  const cast = m.parts.onlineSocket.userData.weapon.position.clone();
  assert.ok(cast.distanceTo(rest) > 0.1);
  const finger =
    m.parts.onlineSocket.userData.weapon.userData.gloveRig.fingers[0];
  assert.ok(finger.rotation.x < 0.16);
  updateBotWeapon(m, e, 11);
  assert.ok(m.parts.onlineSocket.userData.weapon.position.equals(rest));
  dispose(m.group);
});
test("Golden, Reverse and Space have distinct pooled silhouettes, deterministic motion and no actor mutation", () => {
  const root = createStatusRig(),
    actor = { goldTime: 3, reverseTime: 0, spaceTime: 0, x: 3, y: 1, z: 2 },
    before = { ...actor };
  animateStatusRig(root, actor, 1);
  assert.equal(root.userData.systems.gold.visible, true);
  assert.equal(root.userData.systems.reverse.visible, false);
  assert.equal(root.userData.systems.space.visible, false);
  assert.deepEqual(actor, before);
  actor.goldTime = 0;
  actor.reverseTime = 2;
  animateStatusRig(root, actor, 2);
  assert.equal(root.userData.systems.reverse.visible, true);
  assert.equal(root.userData.systems.gold.visible, false);
  actor.reverseTime = 0;
  actor.spaceTime = 2;
  animateStatusRig(root, actor, 3);
  assert.equal(root.userData.systems.space.visible, true);
  assert.ok(
    root.userData.systems.space.children.some((o) => o.name === "orbit-star"),
  );
  actor.spaceTime = 0;
  animateStatusRig(root, actor, 4);
  assert.equal(root.visible, false);
  dispose(root);
});
test("tether pool stays bounded, follows launched bodies, expires, clears references and disposes", () => {
  const scene = new THREE.Scene(),
    fx = new GloveLinks(scene),
    a = { x: 0, y: 0, z: 0 },
    b = { x: 2, y: 0, z: 2 };
  for (let i = 0; i < 100; i++) fx.emit(a, b, "#aaccff", 0.4);
  fx.update(0.1);
  assert.equal(scene.children.length, 1);
  assert.equal(fx.mesh.count, LINK_LIMIT * LINK_SEGMENTS);
  assert.ok(fx.mesh.instanceMatrix.array.every(Number.isFinite));
  const matrix = fx.mesh.instanceMatrix.array.slice();
  b.x = 6;
  b.y = 2;
  fx.update(0.01);
  assert.notDeepEqual(fx.mesh.instanceMatrix.array, matrix);
  fx.update(1);
  assert.ok(fx.states.every((s) => !s.life && !s.source && !s.target));
  fx.emit(a, b, "#ffffff");
  fx.clear();
  assert.ok(fx.states.every((s) => !s.life && !s.source));
  fx.dispose();
  assert.equal(scene.children.length, 0);
});
function cueFixture() {
  const player = { alive: true, team: 0, x: 0, y: 0, z: 0 },
    target = { alive: true, team: 1, x: 0, y: 0, z: -2.5, radius: 0.28 };
  return {
    g: {
      player,
      entities: [player, target],
      loadout: gloveLoadout(),
      state: "playing",
      yaw: 0,
      pitch: 0,
      eye: (e) => new THREE.Vector3(e.x, e.y + 1.6, e.z),
      hasLOS: () => true,
    },
    target,
  };
}
test("reach cue detects range and public protection/reflection, without changing aim or granting hits", () => {
  const { g, target } = cueFixture();
  assert.equal(gloveReachCue(g).state, "ready");
  target.z = -4.2;
  assert.equal(gloveReachCue(g).state, "approach");
  target.z = -2;
  target.goldTime = 1;
  assert.equal(gloveReachCue(g).state, "protected");
  target.goldTime = 0;
  target.reverseTime = 1;
  assert.equal(gloveReachCue(g).state, "reflecting");
  assert.equal(g.yaw, 0);
  assert.equal(g.pitch, 0);
  assert.equal(g.matchStats, undefined);
});
test("reach cue never discloses invisible, occluded, allied, off-reticle or dead enemies", () => {
  for (const patch of [
    { ghostTime: 1 },
    { alive: false },
    { team: 0 },
    { x: 3, z: 0 },
    { z: -15 },
  ]) {
    const { g, target } = cueFixture();
    Object.assign(target, patch);
    assert.equal(gloveReachCue(g), null);
  }
  const { g } = cueFixture();
  g.hasLOS = () => false;
  assert.equal(gloveReachCue(g), null);
  g.hasLOS = () => true;
  g.player.ragdollTime = 1;
  assert.equal(gloveReachCue(g), null);
});
test("failed abilities explain authority rejection without fake cooldown, FX, damage or rewards", () => {
  const { m, g, other } = setup();
  try {
    g.loadout = gloveLoadout("glove_magnet");
    Object.assign(other.player, { x: 0, z: -40 });
    assert.equal(useGloveAbility(g), false);
    const denied = m.events.find((e) => e.type === "gloveDenied");
    assert.equal(denied.reason, "NO VISIBLE TARGET · 14 m");
    assert.equal(denied.round, m.round);
    assert.equal(g.player.abilityCooldown || 0, 0);
    assert.equal(g.matchStats.hits, 0);
    assert.equal(
      m.events.some((e) => e.type === "gloveAbility"),
      false,
    );
  } finally {
    m.dispose();
  }
});
test("client-side rejection helper cannot impersonate authority or reveal other players failures", () => {
  let emitted = 0;
  const p = { id: "a" },
    g = {
      player: p,
      clock: 5,
      round: 1,
      network: {},
      emitGlove: () => emitted++,
    };
  denyGloveAbility(g, p, "NO");
  assert.equal(emitted, 0);
  g.network = null;
  denyGloveAbility(g, { id: "b" }, "NO");
  assert.equal(emitted, 0);
  denyGloveAbility(g, p, "NO");
  denyGloveAbility(g, p, "NO");
  assert.equal(emitted, 1);
});
test("failed short blink restores its entire position instead of silently moving 15cm on rejection", () => {
  const { m, g } = setup();
  try {
    g.loadout = gloveLoadout("glove_flash");
    g.yaw = 0;
    Object.assign(g.player, { x: 0, y: 0, z: 0 });
    g.world.boxes = [
      { minX: -3, maxX: 3, minY: 0, maxY: 4, minZ: -0.5, maxZ: -0.45 },
    ];
    assert.equal(useGloveAbility(g), false);
    assert.equal(g.player.x, 0);
    assert.equal(g.player.z, 0);
    assert.ok(
      m.events.some(
        (e) => e.type === "gloveDenied" && e.reason === "BLINK PATH BLOCKED",
      ),
    );
  } finally {
    m.dispose();
  }
});
test("test-drive hits retain real damage and hit confirmation but award no persistent or match slaps", () => {
  const { m, g, other } = setup();
  try {
    g.testDrive = true;
    Object.assign(g.player, { x: 0, y: 0, z: 0 });
    Object.assign(other.player, { x: 0, y: 0, z: -2 });
    assert.equal(
      applyImpact(g, g.player, other.player, GLOVES.glove_dual, true),
      true,
    );
    assert.equal(other.player.health, 130);
    assert.equal(g.matchStats.hits, 1);
    assert.equal(g.matchStats.slaps, 0);
    const event = m.events.find((e) => e.type === "gloveHit");
    assert.equal(event.direct, true);
    assert.equal(event.earned, false);
  } finally {
    m.dispose();
  }
});
test("arena finishing exposes distinct mid-value floor palettes rather than a universal gray", () => {
  assert.equal(
    new Set(Object.values(MAP_ART).map((p) => p.floor)).size,
    Object.keys(MAP_ART).length,
  );
  assert.notEqual(MAP_ART.foundry.floor, MAP_ART.courtyard.floor);
  for (const p of Object.values(MAP_ART)) {
    const c = new THREE.Color(p.floor);
    assert.ok(c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 < 0.4);
  }
});
test("seeded endurance epochs exercise real authority gameplay and produce reproducible nontrivial checks", () => {
  const a = exerciseEpoch(20261017, 0, 2400),
    b = exerciseEpoch(20261017, 0, 2400);
  assert.deepEqual(a, b);
  assert.ok(a.assertions > 1000);
  assert.ok(a.hits > 0);
  assert.ok(a.snapshots > 20);
  assert.equal(a.players, 2);
  assert.equal(a.ticks, 2400);
});

test("two-tone court paint keeps shared shader ownership and distinguishes maps without geometry or light changes", async () => {
  const { paintCourtMaterial, COURT_PAINT } =
    await import("../src/court-finishes.js");
  const base = new THREE.MeshStandardMaterial({ color: 0xa4a6a5 });
  base.onBeforeCompile = (s) => (s.fragmentShader += "\n// base panel detail");
  base.customProgramCacheKey = () => "base-panels";
  const material = paintCourtMaterial(base, "foundry", 0x859398),
    shader = {
      uniforms: {},
      fragmentShader: "#include <common>\n#include <color_fragment>",
    };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.courtPaint.value.getHex(), COURT_PAINT.foundry);
  assert.match(shader.fragmentShader, /base panel detail/);
  assert.match(shader.fragmentShader, /courtVertical/);
  assert.equal(base.color.getHex(), 0xa4a6a5);
  assert.equal(base.userData.courtPaint, undefined);
  assert.equal(material.transparent, false);
  assert.match(material.customProgramCacheKey(), /painted/);
  material.dispose();
  base.dispose();
});

test("rigid glove batches retain exact posed bounds and reduce submissions for all 24 gloves", () => {
  for (const glove of GLOVE_ROSTER) {
    const raw = createGloveModel(glove.id, { batch: false });
    const batched = createGloveModel(glove.id);
    assert.ok(
      batched.userData.batching.after < batched.userData.batching.before,
      glove.key,
    );
    for (const time of [0, 0.07, 0.19, 0.38, 1]) {
      for (const model of [raw, batched]) {
        animateGlove(model, {
          gloveSwingAge: time,
          gloveCastAge: time,
          gloveSequence: 1,
          shake: false,
        });
        model.updateMatrixWorld(true);
      }
      const a = new THREE.Box3().setFromObject(raw, true);
      const b = new THREE.Box3().setFromObject(batched, true);
      assert.ok(
        a.min.distanceTo(b.min) < 0.00001,
        `${glove.key} ${time}: minimum`,
      );
      assert.ok(
        a.max.distanceTo(b.max) < 0.00001,
        `${glove.key} ${time}: maximum`,
      );
    }
    dispose(raw);
    dispose(batched);
  }
});
test("unarmed actor construction skips the obsolete rifle but preserves attachment handles", () => {
  const { group, parts } = createCharacter(1, "BATCH TEST", { unarmed: true });
  assert.equal(parts.onlineSocket.children.length, 0);
  assert.equal(parts.onlineSocket.userData.weapon, undefined);
  assert.equal(parts.muzzleFlash, parts.baseMuzzleFlash);
  assert.equal(parts.gun.visible, false);
  const actor = {
    model: { group, parts },
    activeWeapon: "glove_default",
    team: 1,
  };
  updateBotWeapon(actor.model, actor, 0);
  assert.equal(parts.onlineSocket.userData.id, "glove_default");
  assert.ok(parts.onlineSocket.userData.weapon.userData.gloveRig);
  dispose(group);
});

test("transparent Ghost surfaces keep separate sortable meshes rather than changing alpha layering", () => {
  const raw = createGloveModel("glove_ghost", { batch: false });
  const batched = createGloveModel("glove_ghost");
  const count = (model) => {
    let n = 0;
    model.traverse((o) => {
      if (o.isMesh && o.material.transparent) n++;
    });
    return n;
  };
  assert.equal(count(batched), count(raw));
  dispose(raw);
  dispose(batched);
});

test("tethers do not track a Ghost who becomes invisible mid-effect, nor submit malformed endpoints", () => {
  const scene = new THREE.Scene(),
    fx = new GloveLinks(scene);
  const a = { x: 0, y: 0, z: 0 },
    b = { x: 2, y: 0, z: -2 };
  fx.emit(a, b, "#ffffff", Infinity);
  assert.equal(fx.cursor, 0);
  fx.emit(a, b, "#ffffff", 9);
  assert.equal(fx.states[0].life, 0.65);
  fx.update(0.01);
  b.ghostTime = 1;
  fx.update(0.01);
  assert.equal(fx.states[0].source, null);
  assert.ok(fx.mesh.instanceMatrix.array.every(Number.isFinite));
  b.ghostTime = 0;
  b.x = NaN;
  fx.emit(a, b, "#ffffff");
  fx.update(0);
  assert.ok(fx.states.every((s) => !s.life));
  assert.ok(fx.mesh.instanceMatrix.array.every(Number.isFinite));
  fx.dispose();
});
