import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
import { MOVEMENT } from "../src/movement.js";
import { circleBox, moveBody, NavGrid, verticalStep } from "../src/physics.js";
import { createViewModel } from "../src/world.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const actor = (team, z = 0) => ({
  team,
  z,
  x: 0,
  y: 0,
  height: 1.9,
  radius: 0.38,
  health: 100,
  alive: true,
  vx: 0,
  vz: 0,
  vy: 0,
  grounded: true,
  jumps: 0,
  yaw: 0,
});
function game(primary = "bow", utility = "flashbang") {
  const g = Object.create(Game.prototype),
    p = actor(0);
  p.isPlayer = true;
  Object.assign(g, {
    scene: new THREE.Scene(),
    weaponScene: new THREE.Scene(),
    world: { boxes: [], solidMeshes: [] },
    entities: [p],
    player: p,
    loadout: [primary, "pistol", "fists", utility],
    slot: 0,
    keys: new Set(),
    yaw: 0,
    pitch: 0,
    range: false,
    state: "playing",
    clock: 0,
    slideTime: 0,
    slideCooldown: 0,
    dashCooldown: 0,
    jumpBuffer: 0,
    coyoteTime: 0,
    walkPhase: 0,
    stepOffset: 0,
    landingDip: 0,
    cooldown: 0,
    reloadTime: 0,
    deflectTime: 0,
    quickMeleeTime: 0,
    burstCount: 0,
    kick: 0,
    spinTime: 0,
    bowCharge: 0,
    projectiles: [],
    effects: [],
    fires: [],
    smokes: [],
    ray: new THREE.Raycaster(),
    matchStats: { shots: 0, hits: 0, kills: 0 },
    ammunition: [
      { mag: WEAPONS[primary].mag, reserve: 100 },
      { mag: 12, reserve: 60 },
      { mag: Infinity, reserve: Infinity },
      { mag: WEAPONS[utility].mag, reserve: 0 },
    ],
    audio: { play() {}, noiseHit() {} },
    events: { update() {}, hit() {}, hurt() {}, kill() {} },
    particles() {},
    tracer() {},
    damage(e, amount) {
      e.health -= amount;
    },
  });
  return g;
}
function wall(g, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 1),
    new THREE.MeshBasicMaterial(),
  );
  m.position.set(0, 2, z);
  m.updateMatrixWorld(true);
  g.world.solidMeshes.push(m);
  return m;
}
test("diagonal cover does not use its oversized AABB as collision", () => {
  const b = {
    angle: Math.PI / 4,
    cx: 0,
    cz: 0,
    halfX: 6,
    halfZ: 0.5,
    minX: -5,
    maxX: 5,
    minZ: -5,
    maxZ: 5,
    minY: 0,
    maxY: 4,
  };
  assert.equal(circleBox(4, 4, 0.38, b), false);
  assert.equal(circleBox(2, -2, 0.38, b), true);
});
test("a fast dash cannot tunnel through a thin rotated slab and slides along its face", () => {
  const b = {
    angle: Math.PI / 4,
    cx: 0,
    cz: 0,
    halfX: 50,
    halfZ: 0.15,
    minY: 0,
    maxY: 4,
  };
  const p = actor(0, -5);
  p.vz = 28;
  moveBody(p, 0, 20, [b]);
  const localZ = (p.x + p.z) * Math.SQRT1_2;
  assert.ok(localZ <= -0.53 + 1e-5);
  assert.ok(p.x < -5);
  assert.ok(!circleBox(p.x, p.z, 0.38, b));
  assert.ok(Math.abs(p.vx + p.vz) < 1e-6);
});
test("rectangular navigation covers the full 64-metre arena", () => {
  const nav = new NavGrid([], 48, 1.5, 64);
  const start = { x: 0, z: 28.5 },
    end = { x: 0, z: -28.5 };
  assert.notEqual(nav.index(0, 28.5), nav.index(0, 22));
  const path = nav.path(start, end);
  assert.ok(path.length > 30);
  assert.ok(path.at(-1).z < -27);
});
test("a body can land on the top of rotated cover", () => {
  const b = {
    angle: Math.PI / 4,
    cx: 0,
    cz: 0,
    halfX: 6,
    halfZ: 0.5,
    minY: 0,
    maxY: 3,
  };
  const p = actor(0, -2);
  p.x = 2;
  p.y = 4;
  p.vy = -10;
  p.grounded = false;
  for (let i = 0; i < 30; i++) verticalStep(p, 1 / 60, [b]);
  assert.equal(p.y, 3);
  assert.equal(p.grounded, true);
});
test("bow charges without spending ammo, releases an arrow and automatically reloads", () => {
  const g = game();
  g.mouseDown = true;
  for (let i = 0; i < 72; i++) g.updatePlayer(1 / 60);
  assert.equal(g.ammunition[0].mag, 1);
  assert.equal(g.projectiles.length, 0);
  assert.ok(g.bowCharge > 0.79);
  g.mouseDown = false;
  g.bowRelease = true;
  g.updatePlayer(1 / 60);
  assert.equal(g.projectiles.length, 1);
  assert.equal(g.ammunition[0].mag, 0);
  assert.ok(g.reloadTime > 0);
  assert.ok(g.projectiles[0].damage > 59.9);
  for (let i = 0; i < 16; i++) g.updatePlayer(1 / 60);
  assert.equal(g.ammunition[0].mag, 1);
});
test("an arrow applies charged headshot damage with swept collision", () => {
  const g = game(),
    enemy = actor(1, -8);
  g.entities.push(enemy);
  g.spawnProjectile(g.player, v(0, 1.66, 0), v(0, 0, -1), "bow", 1.2);
  for (let i = 0; i < 12 && g.projectiles.length; i++)
    g.updateProjectiles(1 / 60);
  assert.ok(enemy.health <= -19);
  assert.equal(g.matchStats.hits, 1);
  assert.equal(g.projectiles.length, 0);
});
test("solid cover stops arrows before they damage a target", () => {
  const g = game(),
    enemy = actor(1, -8);
  g.entities.push(enemy);
  wall(g, -4);
  g.spawnProjectile(g.player, v(0, 1.66, 0), v(0, 0, -1), "bow", 1.2);
  for (let i = 0; i < 12 && g.projectiles.length; i++)
    g.updateProjectiles(1 / 60);
  assert.equal(enemy.health, 100);
  assert.equal(g.projectiles.length, 0);
});
test("minigun needs spin-up and its six barrels are an animated model part", () => {
  const g = game("minigun");
  g.mouseDown = true;
  for (let i = 0; i < 25; i++) g.updatePlayer(1 / 60);
  assert.equal(g.ammunition[0].mag, 200);
  for (let i = 0; i < 20; i++) g.updatePlayer(1 / 60);
  assert.ok(g.ammunition[0].mag < 200);
  const model = createViewModel("minigun", WEAPONS.minigun);
  assert.ok(model.userData.rotor);
  assert.ok(model.userData.rotor.children.length >= 20);
});
test("new weapon and utility models have distinct, finite geometry", () => {
  for (const id of [
    "bow",
    "minigun",
    "paintball",
    "launcher",
    "flame",
    "medkit",
    "flashbang",
    "rifle",
    "shotgun",
    "sniper",
    "pistol",
  ]) {
    const model = createViewModel(id, WEAPONS[id]);
    const bounds = new THREE.Box3().setFromObject(model);
    assert.ok(model.userData.detailed, id);
    assert.ok(Number.isFinite(bounds.min.x), id);
    assert.ok(bounds.max.z - bounds.min.z > 0.05, id);
  }
});
test("flashbang blinds exposed players and bots, but not enemies behind cover", () => {
  const g = game(),
    exposed = actor(1, -6),
    covered = actor(1, -12);
  g.entities.push(exposed, covered);
  wall(g, -9);
  g.explosion(v(0, 1.6, -4), actor(1, -4), "flashbang");
  assert.ok(g.blindTime > 2);
  assert.ok(exposed.blindedUntil > 2);
  assert.equal(covered.blindedUntil, undefined);
  g.updateSupport(3);
  assert.equal(g.blindTime, 0);
});
test("looking away substantially reduces a flashbang effect", () => {
  const g = game();
  g.yaw = Math.PI;
  g.explosion(v(0, 1.6, -4), actor(1, -4), "flashbang");
  assert.equal(g.blindTime, 0.7);
});
test("medkit has distinct quick and long heals and never overheals", () => {
  const g = game("rifle", "medkit");
  g.slot = 3;
  g.player.health = 40;
  assert.equal(g.beginHeal(true), true);
  assert.equal(g.ammunition[3].mag, 0);
  g.updateSupport(0.9);
  assert.equal(g.player.health, 65);
  g.ammunition[3].mag = 1;
  assert.equal(g.beginHeal(false), true);
  g.updateSupport(2.3);
  assert.equal(g.player.health, 135);
  g.ammunition[3].mag = 1;
  assert.equal(g.beginHeal(true), true);
  g.updateSupport(0.9);
  assert.equal(g.player.health, 150);
  g.ammunition[3].mag = 1;
  assert.equal(g.beginHeal(), false);
  assert.equal(g.ammunition[3].mag, 1);
});
test("taking damage interrupts a medkit channel", () => {
  const g = game("rifle", "medkit");
  g.slot = 3;
  g.player.health = 40;
  g.beginHeal();
  delete g.damage;
  Game.prototype.damage.call(g, g.player, 10, actor(1));
  assert.equal(g.healTime, 0);
  g.updateSupport(3);
  assert.equal(g.player.health, 30);
});
test("flamethrower hits inside its close cone but respects cover and teammates", () => {
  const g = game("flame"),
    front = actor(1, -5),
    behind = actor(1, 5),
    far = actor(1, -15),
    ally = actor(0, -3);
  g.entities.push(front, behind, far, ally);
  g.firePlayer();
  assert.equal(front.health, 86);
  assert.ok(front.burnUntil > 0);
  assert.equal(behind.health, 100);
  assert.equal(far.health, 100);
  assert.equal(ally.health, 100);
  g.cooldown = 0;
  wall(g, -2);
  g.firePlayer();
  assert.equal(front.health, 86);
});
test("grenade launcher lobs an impact explosive instead of firing a hitscan", () => {
  const g = game("launcher");
  g.firePlayer();
  assert.equal(g.ammunition[0].mag, 5);
  assert.equal(g.projectiles[0].id, "launcher");
  assert.equal(g.projectiles[0].rocket, false);
  assert.equal(g.projectiles[0].vel.z, -28);
  assert.ok(g.projectiles[0].vel.y > 0);
});
test("holding jump chains grounded bunny hops without automatically using the extra jump", () => {
  const g = game("bow");
  g.keys.add("Space");
  g.updatePlayer(1 / 60);
  assert.equal(g.player.jumps, 1);
  assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
  let hops = 0;
  for (let i = 0; i < 200; i++) {
    const previous = g.player.vy;
    g.updatePlayer(1 / 60);
    if (previous < 0 && g.player.vy > 0) hops++;
    assert.equal(g.player.jumps, 1);
  }
  assert.ok(hops >= 2);
});

test("ground slide is a short burst with less than six metres of travel", () => {
  const g = game("rifle");
  g.player.vz = -MOVEMENT.runSpeed;
  g.keys.add("KeyW");
  g.slide();
  assert.equal(g.slideTime, MOVEMENT.slideDuration);
  const start = g.player.z;
  for (let i = 0; i < 24; i++) g.updatePlayer(1 / 60);
  assert.ok(g.slideTime < 1e-6);
  assert.ok(start - g.player.z < 6);
  assert.ok(start - g.player.z > 3);
});

test("a projectile cannot spawn on the far side of a wall pressed against its muzzle", () => {
  const g = game("launcher");
  wall(g, -0.9); // One-metre slab: near face is 0.4 m from the eye, just outside the capsule.
  g.firePlayer();
  assert.equal(g.projectiles.length, 1);
  assert.ok(g.projectiles[0].pos.z > -0.4);
});
