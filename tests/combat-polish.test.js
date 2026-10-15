import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BotLocomotion } from "../src/bot-animation.js";
import { WeaponAnimator } from "../src/animation.js";
import { HitConfirmation } from "../src/combat-feedback.js";
import { Game } from "../src/game.js";
import { createCharacter } from "../src/world.js";
const actor = (extra = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  height: 1.9,
  grounded: true,
  ...extra,
});
const settle = (e, phase = Math.PI / 2) => {
  const p = new BotLocomotion();
  for (let i = 0; i < 120; i++) p.update(e, phase, 1 / 120);
  return p;
};

test("stationary bot knees and root bob no longer cycle on the idle clock", () => {
  for (const phase of [0, 1, 2, 4, 6]) {
    const p = settle(actor(), phase);
    assert.equal(p.bob, 0);
    assert.equal(p.leftX, 0);
    assert.equal(p.rightX, 0);
    assert.equal(p.leftKnee, -0.05);
    assert.equal(p.rightKnee, -0.05);
  }
});
test("strafe poses swing laterally rather than marching forward and mirror left/right", () => {
  const right = settle(actor({ vx: 11.5 })),
    left = settle(actor({ vx: -11.5 }));
  assert.equal(right.leftX, 0);
  assert.equal(right.rightX, 0);
  assert.ok(right.leftZ > 0.25);
  assert.ok(right.rightZ < -0.25);
  assert.equal(right.leftZ, -left.leftZ);
  assert.equal(right.rightZ, -left.rightZ);
});
test("backpedal reverses stride and velocity is transformed into the rendered body frame", () => {
  const forward = settle(actor({ vz: -11.5 })),
    back = settle(actor({ vz: 11.5 }));
  assert.ok(forward.leftX > 0.6);
  assert.equal(forward.leftX, -back.leftX);
  const rotated = settle(actor({ vx: -11.5, yaw: Math.PI / 2 }));
  assert.ok(Math.abs(rotated.leftX - forward.leftX) < 1e-9);
  assert.ok(Math.abs(rotated.leftZ) < 1e-9);
});
test("stance and airborne transitions are eased without changing actor simulation data", () => {
  const e = actor(),
    p = new BotLocomotion();
  p.update(e, 0, 1 / 60);
  e.height = 1.15;
  const before = { ...e };
  p.update(e, 0, 1 / 120);
  assert.ok(p.leftX > 0 && p.leftX < 0.3);
  assert.ok(p.bodyY < 1 && p.bodyY > 0.8);
  assert.deepEqual(e, before);
  for (let i = 0; i < 120; i++) p.update(e, 0, 1 / 120);
  assert.ok(Math.abs(p.bodyY - 0.3) < 1e-7);
  e.height = 1.9;
  e.grounded = false;
  e.vy = 9;
  for (let i = 0; i < 120; i++) p.update(e, 0, 1 / 120);
  assert.ok(Math.abs(p.leftKnee + 0.95) < 1e-7);
  assert.ok(Math.abs(p.rightKnee + 1.15) < 1e-7);
});
test("landing compression uses previous falling speed, stays bounded and decays", () => {
  const p = new BotLocomotion(),
    e = actor({ grounded: false, vy: -25 });
  p.update(e, 0, 1 / 120);
  e.grounded = true;
  e.vy = 0;
  p.update(e, 0, 1 / 120);
  assert.ok(p.landing > 0 && p.landing <= 0.045);
  assert.ok(p.bodyY < 1);
  for (let i = 0; i < 240; i++) p.update(e, 0, 1 / 120);
  assert.ok(p.landing < 1e-10);
  assert.ok(Math.abs(p.bodyY - 1) < 1e-7);
  const zero = new BotLocomotion();
  zero.update(actor({ grounded: false, vy: -20 }), 0, 0);
  zero.update(e, 0, 0);
  assert.equal(zero.landing, 0);
});
test("constant locomotion targets converge equally at 60 and 144 Hz", () => {
  const a = new BotLocomotion(),
    b = new BotLocomotion(),
    e = actor({ vx: 6, vz: -9 });
  for (let i = 0; i < 60; i++) a.update(e, 1.2, 1 / 60);
  for (let i = 0; i < 144; i++) b.update(e, 1.2, 1 / 144);
  for (const k of [
    "leftX",
    "rightX",
    "leftZ",
    "rightZ",
    "leftKnee",
    "rightKnee",
    "hipY",
    "bodyY",
  ])
    assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k);
});
const carryState = {
  dt: 1 / 120,
  speed: 12,
  forwardSpeed: 12,
  grounded: true,
  carryAllowed: true,
  shotAge: 10,
  shake: true,
};
const model = () => new THREE.Group();
const run = (a, m, s) => {
  for (let i = 0; i < 180; i++) a.update(m, s);
};
test("forward running has a bounded lowered carry, without touching aim inputs", () => {
  const a = new WeaponAnimator(),
    m = model(),
    s = { ...carryState };
  run(a, m, s);
  assert.ok(a.carry.value > 0.99);
  const neutral = model();
  run(new WeaponAnimator(), neutral, { ...s, carryAllowed: false });
  assert.ok(Math.abs(m.position.y - neutral.position.y + 0.035) < 1e-8);
  assert.ok(m.rotation.x < -0.1);
  assert.deepEqual(s, carryState);
});
test("carry recovers for ADS, fire, reload, melee actions and accessibility setting", () => {
  for (const extra of [
    { aim: true },
    { shotAge: 0 },
    { reloading: true },
    { swap: 0.2 },
    { slide: true },
    { guard: true },
    { swing: 0.14 },
    { dash: 0.12 },
    { heal: 1 },
    { throwing: 0.2 },
    { inspect: 1 },
    { shake: false },
    { carryAllowed: false },
    { grounded: false },
    { forwardSpeed: 0 },
    { forwardSpeed: -12 },
  ]) {
    const a = new WeaponAnimator(),
      m = model();
    run(a, m, carryState);
    run(a, m, { ...carryState, ...extra });
    assert.ok(a.carry.value < 1e-10, JSON.stringify(extra));
  }
});
test("running carry settles completely to the original neutral weapon pose", () => {
  const a = new WeaponAnimator(),
    m = model();
  run(a, m, carryState);
  run(a, m, { ...carryState, speed: 0, forwardSpeed: 0 });
  assert.ok(m.position.distanceTo(new THREE.Vector3(0.09, -0.1, -0.16)) < 1e-9);
  assert.ok(Math.abs(m.rotation.z) < 1e-9);
});
test("elimination confirmation survives later head/body pellet events without extending its timer", () => {
  const h = new HitConfirmation();
  h.add(false, false, 1000);
  assert.equal(h.kind, 1);
  h.add(true, false, 1010);
  assert.equal(h.kind, 2);
  h.add(false, true, 1020);
  assert.equal(h.kind, 3);
  h.add(false, false, 1100);
  h.add(true, false, 1200);
  assert.equal(h.kind, 3);
  assert.equal(h.until, 1320);
  assert.equal(h.sample(1319), 3);
  assert.equal(h.sample(1320), 0);
  h.add(false, false, 1321);
  assert.equal(h.kind, 1);
});
test("head confirmations are not overwritten by body pellets; clear removes stale priority", () => {
  const h = new HitConfirmation();
  h.add(true, false, 0);
  h.add(false, false, 10);
  assert.equal(h.kind, 2);
  assert.equal(h.until, 210);
  h.clear();
  assert.equal(h.kind, 0);
  assert.equal(h.until, 0);
  h.add(false, false, 20);
  assert.equal(h.kind, 1);
  assert.equal(h.sample(180), 0);
});
test("only genuine player enemy kills award stats and emit one centralized confirmation", () => {
  const g = Object.create(Game.prototype),
    confirm = [];
  Object.assign(g, {
    clock: 2,
    range: true,
    config: { mode: 1 },
    matchStats: { kills: 0, deaths: 0 },
    audio: { play() {} },
    events: {
      confirmKill: (h) => confirm.push(h),
      kill() {},
      hurt() {},
      banner() {},
      update() {},
    },
    particles() {},
  });
  const p = actor({ isPlayer: true, team: 0, health: 100, alive: true }),
    enemy = actor({ team: 1, health: 30, alive: true });
  g.damage(enemy, 15, p);
  assert.equal(confirm.length, 0);
  g.damage(enemy, 20, p, true);
  g.damage(enemy, 20, p, true);
  assert.equal(g.matchStats.kills, 1);
  assert.deepEqual(confirm, [true]);
  g.damage(p, 100, p);
  assert.equal(p.health, 100);
  assert.equal(g.matchStats.deaths, 0);
  assert.equal(g.matchStats.kills, 1);
  assert.equal(confirm.length, 1);
  const ally = actor({ team: 0, health: 5, alive: true });
  g.damage(ally, 10, p);
  assert.equal(g.matchStats.kills, 1);
  assert.equal(confirm.length, 1);
});
test("real rig uses cached locomotion, keeps bones finite and does not mutate actor pose", () => {
  const g = Object.create(Game.prototype),
    m = createCharacter(1),
    e = actor({
      model: m,
      seed: 0.3,
      visible: false,
      activeWeapon: "rifle",
      meleeId: "katana",
      reload: 0,
    });
  g.clock = 10;
  const geometries = new Set();
  m.group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
  });
  g.animateBot(e, 1 / 120);
  const cached = m.parts.locomotion;
  for (let i = 0; i < 180; i++) {
    e.vx = Math.sin(i * 0.1) * 12;
    e.vz = Math.cos(i * 0.1) * 12;
    e.height = i < 60 ? 1.9 : 1.15;
    e.animationPhase = i * 0.2;
    const before = {
      x: e.x,
      y: e.y,
      z: e.z,
      vx: e.vx,
      vz: e.vz,
      height: e.height,
    };
    g.animateBot(e, 1 / 120);
    m.group.updateMatrixWorld(true);
    assert.deepEqual(
      { x: e.x, y: e.y, z: e.z, vx: e.vx, vz: e.vz, height: e.height },
      before,
    );
    m.group.traverse((o) => {
      assert.ok(o.matrixWorld.elements.every(Number.isFinite));
      if (o.geometry) assert.ok(geometries.has(o.geometry));
    });
  }
  assert.equal(m.parts.locomotion, cached);
  Object.assign(e, {
    animationPhase: 0,
    vx: 12,
    vz: 0,
    height: 1.9,
    grounded: true,
  });
  for (let i = 0; i < 120; i++) g.animateBot(e, 1 / 120);
  assert.ok(
    Math.abs(m.parts.leftLeg.rotation.z) < 1e-8,
    "zero is a valid locomotion phase, not the idle clock fallback",
  );
  g.disposeVisual(m.group);
});

test("equipping another weapon discards the previous running carry spring", () => {
  const a = new WeaponAnimator(),
    m = model();
  run(a, m, carryState);
  a.equip();
  assert.equal(a.carry.value, 0);
  assert.equal(a.carry.velocity, 0);
});
