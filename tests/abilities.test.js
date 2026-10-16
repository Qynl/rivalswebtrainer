import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Game } from "../src/game.js";
import { MouseLook } from "../src/input.js";
import { WEAPONS } from "../src/data.js";
import { accelerate } from "../src/movement.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const actor = (team, z, isPlayer = false) => ({
  x: 0,
  y: 0,
  z,
  team,
  name: isPlayer ? "YOU" : "BOT",
  height: 1.9,
  health: 100,
  alive: true,
  isPlayer,
  yaw: 0,
  vx: 0,
  vz: 0,
  vy: 0,
  jumps: 0,
  grounded: true,
  radius: 0.38,
});
function game(melee = "scythe") {
  const g = Object.create(Game.prototype),
    p = actor(0, 0, true);
  const viewModel = new THREE.Group();
  Object.assign(g, {
    state: "playing",
    player: p,
    entities: [p],
    loadout: ["rifle", "pistol", melee, "grenade"],
    slot: 0,
    weaponScene: new THREE.Scene(),
    viewModel,
    keys: new Set(),
    yaw: 0,
    pitch: 0,
    aiming: false,
    crouched: false,
    dashCooldown: 0,
    deflectCooldown: 0,
    deflectTime: 0,
    quickMeleeTime: 0,
    cooldown: 0,
    reloadTime: 0,
    burstCount: 0,
    kick: 0,
    slideTime: 0,
    slideCooldown: 0,
    jumpBuffer: 0,
    coyoteTime: 0,
    walkPhase: 0,
    stepOffset: 0,
    landingDip: 0,
    ammunition: [
      { mag: 20, reserve: 100 },
      { mag: 12, reserve: 60 },
      { mag: Infinity, reserve: Infinity },
    ],
    range: true,
    clock: 0,
    world: { boxes: [], solidMeshes: [] },
    ray: new THREE.Raycaster(),
    matchStats: { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 },
    smokes: [],
    audio: { play() {}, noiseHit() {} },
    events: {
      update() {},
      hit() {},
      hurt() {},
      kill() {},
      banner() {},
      toast() {},
    },
    effects: [],
    particles() {},
    tracer() {},
    damage(e, amount) {
      e.health = Math.max(0, e.health - amount);
    },
    updateEffects() {},
    updateProjectiles() {},
  });
  g.weaponScene.add(viewModel);
  return g;
}
test("normal mouse input is immediate; capture and isolated vertical spikes are ignored", () => {
  const look = new MouseLook();
  look.reset(100);
  assert.equal(look.accept(0, -900, 110), null);
  assert.deepEqual(look.accept(12, -8, 120), { x: 12, y: -8 });
  assert.equal(look.accept(1, -340, 2000), null);
  assert.equal(look.accept(NaN, 5, 2010), null);
  assert.deepEqual(look.accept(180, 20, 2020), { x: 180, y: 20 });
});
test("a fresh pointer capture re-arms mouse spike protection", () => {
  const look = new MouseLook();
  look.reset(0);
  assert.deepEqual(look.accept(140, 0, 1000), { x: 140, y: 0 });
  look.reset(1200);
  assert.equal(look.accept(140, 0, 1201), null);
});
test("shooting never permanently changes mouse pitch", () => {
  const g = game();
  g.pitch = -0.2;
  g.bullet = () => false;
  g.firePlayer();
  assert.equal(g.pitch, -0.2);
  assert.equal(g.ammunition[0].mag, 19);
  assert.ok(g.kick > 0);
});
test("air movement can reverse, not just drift sideways", () => {
  const p = actor(0, 0);
  p.grounded = false;
  p.vx = 14;
  for (let i = 0; i < 48; i++) accelerate(p, { x: -1, z: 0 }, 7.8, 1 / 60);
  assert.ok(p.vx < -13);
  assert.ok(Math.abs(p.vz) < 0.001);
  assert.ok(Math.hypot(p.vx, p.vz) > 13);
});
test("air movement can steer through both lateral directions", () => {
  const p = actor(0, 0);
  p.grounded = false;
  p.vz = -14;
  for (let i = 0; i < 10; i++) accelerate(p, { x: 1, z: 0 }, 7.8, 1 / 60);
  assert.ok(p.vx > 13);
  for (let i = 0; i < 48; i++) accelerate(p, { x: -1, z: 0 }, 7.8, 1 / 60);
  assert.ok(p.vx < -13);
});
test("F triggers Scythe dash without switching slots, shooting or consuming ammo", () => {
  const g = game();
  assert.equal(g.meleeAbility(true), true);
  assert.equal(g.slot, 0);
  assert.equal(g.ammunition[0].mag, 20);
  assert.equal(g.matchStats.shots, 0);
  assert.ok(Math.abs(g.player.vz + 28) < 0.001);
  assert.equal(g.dashCooldown, 3);
  assert.ok(g.quickModel);
  assert.equal(g.viewModel.visible, false);
  assert.equal(g.meleeAbility(true), false);
  g.clearQuickMelee();
  assert.equal(g.viewModel.visible, true);
  assert.equal(g.quickModel, null);
});
test("RMB Scythe dash and LMB strike are separate actions", () => {
  const g = game();
  g.slot = 2;
  g.entities.push(actor(1, -2));
  assert.equal(g.meleeAbility(false), true);
  assert.equal(g.entities[1].health, 100);
  g.firePlayer();
  assert.equal(g.entities[1].health, 100); // Actual windup, not an instant hit.
  g.updatePlayerMelee(0.11);
  assert.equal(g.entities[1].health, 65);
  assert.ok(g.swingTime > 0);
  assert.equal(g.ammunition[2].mag, Infinity);
});
test("F only invokes a melee secondary ability, never an unwanted Fists punch", () => {
  const g = game("fists");
  assert.equal(g.meleeAbility(true), false);
  assert.equal(g.slot, 0);
  assert.equal(g.matchStats.shots, 0);
  assert.equal(g.dashCooldown, 0);
});
test("Katana reflects frontal bullets back to the shooter, protecting player health", () => {
  const g = game("katana"),
    bot = actor(1, -8);
  g.entities.push(bot);
  g.meleeAbility(true);
  g.bullet(bot, v(0, 1, -8), v(0, 0, 1), WEAPONS.rifle);
  assert.equal(g.player.health, 100);
  assert.ok(bot.health < 100);
  assert.equal(g.matchStats.deflections, 1);
  assert.equal(g.slot, 0);
});
test("Katana does not protect from behind or after the guard expires", () => {
  const g = game("katana"),
    bot = actor(1, 8);
  g.entities.push(bot);
  g.meleeAbility(true);
  g.bullet(bot, v(0, 1, 8), v(0, 0, -1), WEAPONS.rifle);
  assert.equal(g.player.health, 87);
  g.deflectTime = 0;
  bot.z = -8;
  g.bullet(bot, v(0, 1, -8), v(0, 0, 1), WEAPONS.rifle);
  assert.equal(g.player.health, 74);
});
test("Katana blocks shooting during guard and cannot ignore its cooldown", () => {
  const g = game("katana");
  g.meleeAbility(true);
  g.firePlayer();
  assert.equal(g.ammunition[0].mag, 20);
  assert.equal(g.meleeAbility(true), false);
  g.deflectTime = 0;
  assert.equal(g.meleeAbility(true), false);
});
test("reflecting guards cannot cause an infinite ricochet recursion", () => {
  const g = game("katana"),
    bot = actor(1, -8);
  bot.yaw = Math.PI;
  bot.deflectTime = 1;
  g.entities.push(bot);
  g.meleeAbility(true);
  g.bullet(bot, v(0, 1, -8), v(0, 0, 1), WEAPONS.rifle);
  assert.equal(g.player.health, 100);
  assert.equal(bot.health, 100);
});
