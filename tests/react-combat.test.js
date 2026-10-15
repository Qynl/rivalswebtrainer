import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  MAX_HEALTH,
  ROUND_COUNTDOWN,
  knifeDamage,
  isBackstab,
} from "../src/combat-rules.js";
import { DamageNumbers } from "../src/damage-numbers.js";
import { MOVEMENT } from "../src/movement.js";
import { GRAVITY } from "../src/physics.js";
import { Game } from "../src/game.js";
import { createViewModel } from "../src/world.js";
import { WEAPONS } from "../src/data.js";
import { WeaponAnimator } from "../src/animation.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
test("round rules use 150 health and a five-second preparation window", () => {
  assert.equal(MAX_HEALTH, 150);
  assert.equal(ROUND_COUNTDOWN, 5);
});
test("flat jump apex is about 2.09 rather than 3.41 units; double jump is retained", () => {
  assert.ok(MOVEMENT.jumpSpeed ** 2 / (2 * GRAVITY) > 2);
  assert.ok(MOVEMENT.jumpSpeed ** 2 / (2 * GRAVITY) < 2.15);
  assert.equal(MOVEMENT.doubleJumpSpeed, 10.8);
});
test("knife front and side hits are 40; behind-facing hits are lethal at full health", () => {
  const e = { x: 0, z: 0, yaw: 0 };
  assert.equal(knifeDamage({ x: 0, z: -1 }, e), 40);
  assert.equal(knifeDamage({ x: 1, z: 0 }, e), 40);
  assert.equal(knifeDamage({ x: 0, z: 1 }, e), 150);
  e.yaw = Math.PI;
  assert.equal(knifeDamage({ x: 0, z: -1 }, e), 150);
  assert.equal(isBackstab(e, e), false);
});
test("confirmed damage numbers merge pellets and cap memory", () => {
  const n = new DamageNumbers(),
    e = { x: 0, y: 0, z: -5, alive: true, height: 1.9 };
  n.add(e, 8, false, 0);
  n.add(e, 12, true, 0.04);
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].amount, 20);
  assert.equal(n.items[0].head, true);
  for (let i = 0; i < 40; i++) n.add({ ...e }, 10, false, 0.1);
  assert.equal(n.items.length, 24);
  n.clear();
  assert.equal(n.items.length, 0);
});
test("damage number projection rejects behind-camera, occluded and expired feedback", () => {
  const n = new DamageNumbers(),
    camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.y = 2;
  const e = { x: 0, y: 0, z: -5, alive: true, height: 1.9 };
  n.add(e, 40, false, 0);
  assert.equal(
    n.project(camera, 800, 800, 0.1, null, () => true, v()).length,
    1,
  );
  assert.equal(
    n.project(camera, 800, 800, 0.1, null, () => false, v()).length,
    0,
  );
  e.z = 5;
  assert.equal(n.project(camera, 800, 800, 0.1).length, 0);
  assert.equal(n.project(camera, 800, 800, 1).length, 0);
});
function melee() {
  const g = Object.create(Game.prototype),
    p = {
      x: 0,
      y: 0,
      z: 0,
      height: 1.9,
      yaw: 0,
      alive: true,
      team: 0,
      isPlayer: true,
    },
    e = {
      x: 0,
      y: 0,
      z: -2,
      height: 1.9,
      yaw: Math.PI,
      alive: true,
      health: 150,
      team: 1,
    };
  Object.assign(g, {
    player: p,
    entities: [p, e],
    playerMeleePending: { id: "knife", remaining: 0.105 },
    loadout: ["rifle", "pistol", "knife", "grenade"],
    slot: 2,
    yaw: 0,
    pitch: 0,
    hasLOS: () => true,
    events: { hit() {} },
    audio: { play() {} },
    damage: (e, d) => {
      e.health -= d;
    },
  });
  return { g, e, p };
}
test("melee has a real windup and exactly one impact", () => {
  const { g, e } = melee();
  g.updatePlayerMelee(0.1);
  assert.equal(e.health, 150);
  g.updatePlayerMelee(0.01);
  assert.equal(e.health, 110);
  g.updatePlayerMelee(1);
  assert.equal(e.health, 110);
});
test("melee backstab feedback is triggered by a rear hit, not simply by swinging", () => {
  const { g, e } = melee();
  e.yaw = 0;
  g.updatePlayerMelee(0.11);
  assert.equal(e.health, 0);
  assert.equal(g.backstabTime, 0.26);
});
test("melee resolves current range/LOS and cancels on a weapon change", () => {
  for (const mode of ["wall", "switch", "range", "dead"]) {
    const { g, e, p } = melee();
    if (mode === "wall") g.hasLOS = () => false;
    if (mode === "switch") g.slot = 0;
    if (mode === "range") e.z = -20;
    if (mode === "dead") p.alive = false;
    g.updatePlayerMelee(0.11);
    assert.equal(e.health, 150);
  }
});
test("knife swing directions and backstab thrust have distinct finite poses", () => {
  const m = createViewModel("knife", WEAPONS.knife),
    a = new WeaponAnimator();
  a.update(m, { dt: 1, swing: 0.2, swingSequence: 1 });
  const z = m.rotation.z;
  a.update(m, { dt: 1, swing: 0.2, swingSequence: 2 });
  assert.ok(z * m.rotation.z < 0);
  a.update(m, { dt: 1, swing: 0, backstab: 0.26 });
  assert.ok(m.position.z < -0.3);
  assert.ok(m.rotation.toArray().slice(0, 3).every(Number.isFinite));
  Game.prototype.disposeVisual.call({}, m);
});
test("paintball has an elevated clear sight line and sniper has an explicit eye-box", () => {
  for (const id of ["paintball", "sniper"]) {
    const m = createViewModel(id, WEAPONS[id]);
    assert.ok(m.userData.adsPoint?.isVector3);
    if (id === "paintball")
      assert.ok(Math.abs(m.userData.adsPoint.y - 0.115) < 1e-12);
    Game.prototype.disposeVisual.call({}, m);
  }
});
