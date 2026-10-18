import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
import { createTrainingAnalytics, getTrainingAnalyticsRows } from "../src/training-analytics.js";
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
function trainingHarness(loadout = ["rifle", "pistol", "knife", "grenade"]) {
  const g = harness();
  Object.assign(g, {
    headless: true,
    scene: new THREE.Scene(),
    projectiles: [],
    effects: [],
    fires: [],
    smokes: [],
    activeDrill: { id: "precision" },
    trainingEventSequence: 0,
    trainingAnalytics: createTrainingAnalytics(loadout),
    clock: 1,
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

test("training action IDs advance only after a valid event and snapshot its fire-time context", () => {
  const g = harness();
  g.trainingEventSequence = 0;
  assert.equal(g.recordTrainingAction("rifle"), null);
  assert.equal(g.trainingEventSequence, 0);

  g.activeDrill = { id: "tracking" };
  g.trainingAnalytics = createTrainingAnalytics(["rifle"]);
  g.player = { vx: 1, vz: 0 };
  g.aiming = true;
  assert.equal(g.recordTrainingAction("unknown-weapon"), null);
  assert.equal(g.trainingEventSequence, 0);
  const first = g.recordTrainingAction("rifle");
  assert.deepEqual(first, {
    id: 1,
    weaponId: "rifle",
    hit: false,
    head: false,
    aiming: true,
    moving: true,
  });
  assert.equal(g.trainingEventSequence, 1);
  const second = g.recordTrainingAction("rifle");
  assert.equal(second.id, 2);
  assert.equal(g.trainingEventSequence, 2);
});

test("training analytics count a shotgun fire event once and keep pellet/head contacts separate", () => {
  const g = harness(),
    p = { ...entity(0, 0, 4), isPlayer: true, vx: 2, vz: 0 },
    target = entity(1);
  g.player = p;
  g.entities = [p, target];
  g.aiming = true;
  g.activeDrill = { id: "tracking" };
  g.trainingAnalytics = createTrainingAnalytics([
    "shotgun",
    "pistol",
    "knife",
    "grenade",
  ]);
  const action = g.recordTrainingAction("shotgun");
  for (let pellet = 0; pellet < WEAPONS.shotgun.pellets; pellet++)
    g.bullet(p, v(0, 1.66, 4), v(0, 0, -1), WEAPONS.shotgun, false, "shotgun", action);

  const [shotgun] = getTrainingAnalyticsRows(g.trainingAnalytics);
  assert.equal(shotgun.actions, 1);
  assert.equal(shotgun.hitActions, 1);
  assert.equal(shotgun.headHitActions, 1);
  assert.equal(shotgun.aimedHitActions, 1);
  assert.equal(shotgun.movingHitActions, 1);
  assert.equal(shotgun.aimedActions, 1);
  assert.equal(shotgun.movingActions, 1);
  assert.equal(shotgun.directContacts, WEAPONS.shotgun.pellets);
  assert.equal(shotgun.headContacts, WEAPONS.shotgun.pellets);
  assert.ok(shotgun.averageDistance > 3.5 && shotgun.averageDistance < 4);
  assert.equal("accuracy" in shotgun, false);
});

test("a real player rifle action populates local drill analytics without altering match shot semantics", () => {
  const g = harness(),
    p = { ...entity(0, 0, 4), isPlayer: true, vx: 0, vz: 1 },
    target = entity(1);
  Object.assign(g, {
    player: p,
    entities: [p, target],
    loadout: ["rifle", "pistol", "knife", "grenade"],
    slot: 0,
    ammunition: [
      { mag: 20, reserve: 100 },
      { mag: 12, reserve: 60 },
      { mag: Infinity, reserve: Infinity },
      { mag: 1, reserve: 0 },
    ],
    yaw: 0,
    pitch: 0,
    aiming: true,
    crouched: false,
    cooldown: 0,
    reloadTime: 0,
    deflectTime: 0,
    quickMeleeTime: 0,
    quickUtilityTime: 0,
    healTime: 0,
    pendingThrow: null,
    clock: 0,
    kick: 0,
    flash: 0,
    activeDrill: { id: "tracking" },
    trainingAnalytics: createTrainingAnalytics([
      "rifle",
      "pistol",
      "knife",
      "grenade",
    ]),
  });
  assert.equal(g.firePlayer(), true);
  const [rifle] = getTrainingAnalyticsRows(g.trainingAnalytics);
  assert.equal(g.matchStats.shots, 1);
  assert.equal(g.matchStats.hits, 1);
  assert.equal(g.matchStats.headshots, 1);
  assert.equal(rifle.actions, 1);
  assert.equal(rifle.hitActions, 1);
  assert.equal(rifle.headHitActions, 1);
  assert.equal(rifle.aimedHitActions, 1);
  assert.equal(rifle.movingHitActions, 1);
  assert.equal(rifle.aimedActions, 1);
  assert.equal(rifle.movingActions, 1);
  assert.equal(rifle.directContacts, 1);
  assert.equal(rifle.headContacts, 1);
});

test("delayed Bow impacts retain their fire-time context and count one head-hit event", () => {
  const g = trainingHarness(["bow"]),
    p = { ...entity(0, 0, 4), isPlayer: true, vx: 1, vz: 0 },
    target = entity(1);
  g.player = p;
  g.entities = [p, target];
  g.aiming = true;
  const action = g.recordTrainingAction("bow");
  p.vx = 0;
  g.aiming = false;
  g.spawnProjectile(p, v(0, 1.66, 4), v(0, 0, -1), "bow", 1, action);
  g.updateProjectiles(0.08);
  const [bow] = getTrainingAnalyticsRows(g.trainingAnalytics);
  assert.equal(target.health < 100, true);
  assert.deepEqual(
    [
      bow.actions,
      bow.aimedActions,
      bow.movingActions,
      bow.hitActions,
      bow.headHitActions,
      bow.aimedHitActions,
      bow.movingHitActions,
      bow.directContacts,
      bow.headContacts,
    ],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  );
});

test("delayed explosive and Molotov outcomes are attributed to their initiating actions", () => {
  const g = trainingHarness(["grenade", "molotov"]),
    p = { ...entity(0, 0, 4), isPlayer: true, vx: 0, vz: 0 },
    target = entity(1);
  g.player = p;
  g.entities = [p, target];
  const grenadeAction = g.recordTrainingAction("grenade");
  g.explosion(v(0, 0.8, 0), p, "grenade", grenadeAction);
  const molotovAction = g.recordTrainingAction("molotov");
  g.explosion(v(0, 1, 0), p, "molotov", molotovAction);
  g.updateProjectiles(0.1);
  const [grenade, molotov] = getTrainingAnalyticsRows(g.trainingAnalytics);
  assert.deepEqual(
    [grenade.actions, grenade.hitActions, grenade.splashContacts],
    [1, 1, 1],
  );
  assert.deepEqual(
    [molotov.actions, molotov.hitActions, molotov.areaTicks],
    [1, 1, 1],
  );
  assert.equal(grenadeAction.hit, true);
  assert.equal(molotovAction.hit, true);
});
