import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { setup, packet } from "./helpers/match.js";
import { Game } from "../src/game.js";
import {
  visibleHazards,
  hazardEscape,
  evadeHazards,
} from "../src/bot-hazards.js";
import {
  createSmokeCloud,
  animateSmoke,
  smokeImmersion,
  SMOKE_PUFFS,
} from "../src/smoke-fx.js";
import {
  updateProjectileTrail,
  PROJECTILE_TRAILS,
} from "../src/projectile-feedback.js";
import { createThrownModel, animateThrown } from "../src/throwables.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const actor = () => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  radius: 0.38,
  height: 1.9,
  team: 1,
});
const projectile = (rest = {}) => ({
  id: "grenade",
  owner: { team: 0 },
  pos: v(2, 0.2, 0),
  vel: v(),
  fuse: 0.6,
  ...rest,
});
test("a single semi-auto click 80ms before recovery ends fires once, not zero or twice", () => {
  const { m, g } = setup();
  try {
    g.equip(1);
    g.cooldown = 0.08;
    const ammo = g.ammunition[1].mag;
    g.queueFire();
    for (let i = 0; i < 25; i++) {
      g.clock += 1 / 120;
      g.updatePlayer(1 / 120);
    }
    assert.equal(g.ammunition[1].mag, ammo - 1);
    assert.equal(g.fireBufferedUntil, 0);
    assert.equal(g.matchStats.shots, 1);
    assert.equal(g.pitch, 0);
  } finally {
    m.dispose();
  }
});
test("a click far ahead of recovery expires; there is no delayed surprise shot", () => {
  const { m, g } = setup();
  try {
    g.equip(1);
    g.cooldown = 0.4;
    const ammo = g.ammunition[1].mag;
    g.queueFire();
    for (let i = 0; i < 60; i++) {
      g.clock += 1 / 120;
      g.updatePlayer(1 / 120);
    }
    assert.equal(g.ammunition[1].mag, ammo);
  } finally {
    m.dispose();
  }
});
test("switching weapons cancels a buffered tap instead of firing the new slot", () => {
  const { m, g } = setup();
  try {
    g.cooldown = 0.08;
    g.queueFire();
    g.equip(1);
    for (let i = 0; i < 30; i++) {
      g.clock += 1 / 120;
      g.updatePlayer(1 / 120);
    }
    assert.equal(g.matchStats.shots, 0);
  } finally {
    m.dispose();
  }
});
test("G clears an old gun request, but a fresh tap near the end of its animation can fire on return", () => {
  const { m, g } = setup();
  try {
    g.equip(1);
    g.cooldown = 0;
    g.queueFire();
    g.quickUtility();
    assert.equal(g.fireBufferedUntil, 0);
    g.updateThrow(0.2);
    g.updateSupport(0.4);
    g.clock = 0.4;
    g.queueFire();
    for (let i = 0; i < 30; i++) {
      g.clock += 1 / 120;
      g.updateSupport(1 / 120);
      g.updatePlayer(1 / 120);
    }
    assert.equal(g.matchStats.shots, 2); // one utility and one actual revolver shot
    assert.equal(g.ammunition[1].mag, 5);
    assert.equal(g.slot, 1);
  } finally {
    m.dispose();
  }
});
test("server buffers an early reliable fire action and cancels it on a pause packet", () => {
  for (const paused of [false, true]) {
    const { m, g } = setup();
    try {
      g.equip(1);
      g.cooldown = 0.08;
      m.input("p0", packet(1, [{ id: 1, type: "fire" }]));
      if (paused) m.input("p0", packet(2, [], { paused: true }));
      for (let i = 0; i < 15; i++) m.step(1 / 120);
      assert.equal(g.ammunition[1].mag, paused ? 6 : 5);
    } finally {
      m.dispose();
    }
  }
});
test("a queued burst cannot start/consume phantom bullets during a quick utility animation", () => {
  const { m, g } = setup();
  try {
    g.loadout[1] = "burstpistol";
    g.ammunition[1] = { mag: 18, reserve: 36 };
    g.equip(1);
    g.cooldown = 0;
    g.quickUtility();
    g.queueFire();
    g.updatePlayer(1 / 120);
    assert.equal(g.burstCount, 0);
    assert.equal(g.ammunition[1].mag, 18);
  } finally {
    m.dispose();
  }
});
test("bots perceive only dangerous, visible hostile utilities, never smoke/flash or friendly fire", () => {
  const a = actor(),
    base = projectile();
  assert.equal(visibleHazards(a, [base], [], () => true).length, 1);
  assert.equal(visibleHazards(a, [base], [], () => false).length, 0);
  for (const p of [
    projectile({ owner: { team: 1 } }),
    projectile({ fuse: 1.8 }),
    projectile({ id: "smoke" }),
    projectile({ id: "flashbang" }),
    projectile({ pos: v(2, 9, 0) }),
  ])
    assert.equal(visibleHazards(a, [p], [], () => true).length, 0);
});
test("bots do not turn around and chase departing rockets", () => {
  const a = actor(),
    departing = projectile({
      id: "rpg",
      rocket: true,
      pos: v(6, 1, 0),
      vel: v(40, 0, 0),
    });
  assert.equal(visibleHazards(a, [departing], [], () => true).length, 0);
  departing.vel.x = -40;
  assert.equal(visibleHazards(a, [departing], [], () => true).length, 1);
});
test("hazard escape increases distance and finds a legal alternative near a wall", () => {
  const a = actor(),
    threats = visibleHazards(a, [projectile()], [], () => true),
    world = { boxes: [], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } };
  assert.ok(hazardEscape(a, threats, world).x < -0.9);
  const tight = {
      ...world,
      bounds: { minX: -0.1, maxX: 10, minZ: -10, maxZ: 10 },
    },
    escape = hazardEscape(a, threats, tight);
  assert.ok(!escape || escape.x >= -0.1 / 1.4);
});
test("hazard steering respects difficulty reaction and clears after the visible threat ends", () => {
  const a = actor(),
    p = projectile(),
    opts = {
      projectiles: [p],
      fires: [],
      world: { boxes: [] },
      canSee: () => true,
      reaction: 0.2,
    };
  assert.equal(evadeHazards(a, { ...opts, clock: 1 }), null);
  assert.equal(evadeHazards(a, { ...opts, clock: 1.12 }), null);
  assert.ok(evadeHazards(a, { ...opts, clock: 1.25 }).x < 0);
  assert.equal(evadeHazards(a, { ...opts, projectiles: [], clock: 1.4 }), null);
  assert.equal(a.hazardSeen, null);
});
test("fire hazards do not reveal safe/friendly/expired or different-floor pools", () => {
  const a = actor(),
    fire = { owner: { team: 0 }, pos: v(1, 0, 0), effect: { life: 4 } };
  assert.equal(visibleHazards(a, [], [fire], () => true).length, 1);
  fire.pos.y = 4;
  assert.equal(visibleHazards(a, [], [fire], () => true).length, 0);
  fire.pos.y = 0;
  fire.owner.team = 1;
  assert.equal(visibleHazards(a, [], [fire], () => true).length, 0);
});
test("smoke uses one bounded instanced volume and animates growth/dissipation without geometry churn", () => {
  const mesh = createSmokeCloud(),
    geometry = mesh.geometry,
    material = mesh.material;
  assert.equal(mesh.count, SMOKE_PUFFS);
  assert.equal(material.depthWrite, false);
  assert.equal(material.depthTest, true);
  assert.equal(material.transparent, true);
  const u = mesh.userData.smokeUniforms;
  animateSmoke(mesh, 0, 7);
  assert.equal(u.growth.value, 0.06);
  animateSmoke(mesh, 1, 6);
  assert.equal(u.growth.value, 1);
  for (let i = 0; i < 1000; i++)
    animateSmoke(mesh, i / 60, Math.max(0, 7 - i / 60));
  assert.equal(u.fade.value, 0);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  Game.prototype.disposeVisual.call({}, mesh);
});
test("smoke immersion is bounded, respects volume/lifetime and never mistakes fire for smoke", () => {
  const zone = { type: "smoke", mesh: { position: v() }, life: 6 };
  assert.ok(smokeImmersion(v(), [zone]) > 0.9);
  assert.equal(smokeImmersion(v(5, 0, 0), [zone]), 0);
  assert.ok(smokeImmersion(v(3.8, 0, 0), [zone]) < 0.5);
  zone.life = 0.2;
  assert.ok(smokeImmersion(v(), [zone]) < 0.1);
  zone.type = "fire";
  assert.equal(smokeImmersion(v(), [zone]), 0);
});
test("all projectile travel traces are rate-limited, reuse state and reject long correction jumps", () => {
  for (const weapon of Object.keys(PROJECTILE_TRAILS)) {
    const calls = [],
      fx = { trace: (...args) => calls.push(args) },
      p = { weapon, mesh: { position: v() } };
    updateProjectileTrail(p, fx, 0.01);
    const from = p.trailFrom;
    p.mesh.position.x = 1;
    updateProjectileTrail(p, fx, 0.1);
    assert.equal(calls.length, 1);
    p.mesh.position.x = 2;
    updateProjectileTrail(p, fx, 0.001);
    assert.equal(calls.length, 1);
    p.mesh.position.x = 20;
    updateProjectileTrail(p, fx, 0.1);
    assert.equal(calls.length, 1);
    assert.equal(p.trailFrom, from);
  }
});
test("thrown fuse markers and Molotov flame animate online without a local spin simulation", () => {
  for (const id of ["grenade", "flashbang", "smoke", "molotov"]) {
    const mesh = createThrownModel(id),
      p = { mesh, fuse: 0.4 };
    animateThrown(p, 0, 0.1);
    if (id !== "molotov") {
      const led = mesh.userData.fuseLight;
      assert.ok(
        led && led.material.opacity >= 0.25 && led.material.opacity <= 1,
      );
    } else assert.notEqual(mesh.userData.item.userData.pilotFlame.scale.y, 1);
    Game.prototype.disposeVisual.call({}, mesh);
  }
});

test("disposing instanced smoke releases mesh-owned instance buffers as well as geometry/material", () => {
  const mesh = createSmokeCloud(),
    disposed = { mesh: 0, geometry: 0, material: 0 };
  mesh.addEventListener("dispose", () => disposed.mesh++);
  mesh.geometry.addEventListener("dispose", () => disposed.geometry++);
  mesh.material.addEventListener("dispose", () => disposed.material++);
  Game.prototype.disposeVisual.call({}, mesh);
  assert.deepEqual(disposed, { mesh: 1, geometry: 1, material: 1 });
});

test("a pause arriving before the next server tick cancels a ready fire pulse, not just its buffer", () => {
  const { m, g } = setup();
  try {
    g.equip(1);
    g.cooldown = 0;
    m.input("p0", packet(1, [{ id: 1, type: "fire" }]));
    m.input("p0", packet(2, [], { paused: true }));
    m.step(1 / 120);
    assert.equal(g.ammunition[1].mag, 6);
    assert.equal(g.matchStats.shots, 0);
  } finally {
    m.dispose();
  }
});
test("empty burst weapons start a real reload on the first click", () => {
  const { m, g } = setup();
  try {
    g.loadout[1] = "burstpistol";
    g.ammunition[1] = { mag: 0, reserve: 36 };
    g.equip(1);
    g.cooldown = 0;
    g.queueFire();
    g.updatePlayer(1 / 120);
    assert.ok(g.reloadTime > 0);
    assert.equal(g.burstCount, 0);
    assert.equal(g.matchStats.shots, 0);
  } finally {
    m.dispose();
  }
});

test("performance smoke halves the instance/shader workload without rebuilding resources", () => {
  const mesh = createSmokeCloud(),
    geometry = mesh.geometry,
    material = mesh.material;
  animateSmoke(mesh, 1, 6, 7, true);
  assert.equal(mesh.count, 16);
  assert.equal(mesh.userData.smokeUniforms.detail.value, 0);
  animateSmoke(mesh, 1.01, 5.99, 7, false);
  assert.equal(mesh.count, 32);
  assert.equal(mesh.userData.smokeUniforms.detail.value, 1);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  Game.prototype.disposeVisual.call({}, mesh);
});
