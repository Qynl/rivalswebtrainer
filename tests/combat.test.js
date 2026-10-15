import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const entity = (team, x = 0, z = 0) => ({
  team,
  x,
  z,
  y: 0,
  height: 1.9,
  alive: true,
  health: 100,
  name: "BOT",
  isPlayer: false,
});
function harness() {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    world: { solidMeshes: [] },
    ray: new THREE.Raycaster(),
    entities: [],
    smokes: [],
    slideTime: 0,
    state: "playing",
    range: false,
    score: [0, 0],
    round: 1,
    matchStats: { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 },
    audio: { play() {} },
    events: {
      update() {},
      round() {},
      banner() {},
      kill() {},
      hit() {},
      hurt() {},
    },
    particles() {},
    tracer() {},
    damage(e, damage) {
      e.health -= damage;
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
  m.updateMatrixWorld();
  g.world.solidMeshes.push(m);
}
test("a clear shot applies the rifle damage", () => {
  const g = harness(),
    p = entity(0, 0, 4),
    e = entity(1);
  g.entities = [p, e];
  assert.equal(g.bullet(p, v(0, 1, 4), v(0, 0, -1), WEAPONS.rifle), true);
  assert.equal(e.health, 87);
});
test("headshots apply the weapon multiplier", () => {
  const g = harness(),
    p = entity(0, 0, 4),
    e = entity(1);
  g.entities = [p, e];
  g.bullet(p, v(0, 1.66, 4), v(0, 0, -1), WEAPONS.sniper);
  assert.equal(e.health, 0);
});
test("solid cover stops shots and bot line of sight", () => {
  const g = harness(),
    p = entity(0, 0, 8),
    e = entity(1);
  g.entities = [p, e];
  wall(g, 4);
  assert.equal(g.hasLOS(v(0, 1.66, 8), v(0, 1.66, 0)), false);
  assert.equal(g.bullet(p, v(0, 1.66, 8), v(0, 0, -1), WEAPONS.rifle), false);
  assert.equal(e.health, 100);
});
test("the nearest actor absorbs a shot, without friendly damage", () => {
  const g = harness(),
    p = entity(0, 0, 8),
    ally = entity(0, 0, 4),
    e = entity(1);
  g.entities = [p, ally, e];
  assert.equal(g.bullet(p, v(0, 1.66, 8), v(0, 0, -1), WEAPONS.rifle), false);
  assert.equal(ally.health, 100);
  assert.equal(e.health, 100);
});
test("smoke blocks AI perception but not an unrelated sightline", () => {
  const g = harness();
  g.smokes = [{ pos: v(0, 1, 4), radius: 2 }];
  assert.equal(g.hasLOS(v(0, 1, 8), v(0, 1, 0)), false);
  assert.equal(g.hasLOS(v(8, 1, 8), v(8, 1, 0)), true);
});
test("eliminating the last rival awards exactly one round", () => {
  const g = harness();
  g.entities = [entity(0), { ...entity(1), alive: false, health: 0 }];
  g.checkRound();
  assert.deepEqual(g.score, [1, 0]);
  assert.equal(g.state, "roundend");
  g.checkRound();
  assert.deepEqual(g.score, [1, 0]);
});
test("teammates keep a round alive after the player dies", () => {
  const g = harness();
  g.entities = [
    { ...entity(0), alive: false, health: 0 },
    entity(0),
    entity(1),
  ];
  g.checkRound();
  assert.equal(g.state, "playing");
  assert.deepEqual(g.score, [0, 0]);
});
test("shotgun damage falls off over distance", () => {
  const g = harness(),
    p = entity(0, 0, 25),
    e = entity(1);
  g.entities = [p, e];
  g.bullet(p, v(0, 1, 25), v(0, 0, -1), WEAPONS.shotgun);
  assert.ok(e.health > 95);
});
