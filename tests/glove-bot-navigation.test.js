import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { NavGrid, canOccupy } from "../src/physics.js";
import { updateGloveBot, tickGloves } from "../src/gloves/combat.js";
import {
  recordGloveBotTravel,
  gloveBotWish,
} from "../src/gloves/bot-navigation.js";
import { GLOVES } from "../src/gloves/catalog.js";
function body(extra = {}) {
  return {
    id: "bot",
    team: 1,
    alive: true,
    health: 150,
    maxHealth: 150,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 0.28,
    height: 1.9,
    grounded: true,
    seed: 0,
    strafe: 1,
    activeWeapon: "glove_default",
    abilityCooldown: 99,
    ...extra,
  };
}
test("bots route around waist-high cover despite a clear eye-level sightline and land a genuine slap", () => {
  const wall = {
      minX: -4,
      maxX: 4,
      minY: 0,
      maxY: 1.2,
      minZ: -4.5,
      maxZ: -3.5,
    },
    boxes = [wall],
    nav = new NavGrid(boxes, 24, 0.75);
  let searches = 0;
  const find = nav.path.bind(nav);
  nav.path = (...args) => {
    searches++;
    return find(...args);
  };
  const e = body(),
    p = body({ id: "player", team: 0, isPlayer: true, z: -9 });
  const g = {
    clock: 0,
    state: "playing",
    player: p,
    entities: [p, e],
    loadout: ["glove_default"],
    config: { difficulty: "regular" },
    world: { boxes, nav },
    audio: { volume: 0 },
    events: { update() {}, hit() {}, slap() {} },
    eye: (a) => new THREE.Vector3(a.x, a.y + 1.6, a.z),
    hasLOS: () => true,
    animateBot() {},
    damage(target, amount) {
      target.health = Math.max(0, target.health - amount);
      target.alive = target.health > 0;
    },
  };
  let sideways = 0,
    hitAt = null;
  for (let i = 0; i < 960; i++) {
    g.clock += 1 / 120;
    tickGloves(g, 1 / 120);
    updateGloveBot(g, e, 1 / 120);
    sideways = Math.max(sideways, Math.abs(e.x));
    assert.ok(canOccupy(e, e.x, e.y, e.z, boxes));
    if (p.health < 150) {
      hitAt = g.clock;
      break;
    }
  }
  assert.ok(searches > 0, "visible cover must still request a route");
  assert.ok(sideways > 4, "must physically pass the cover end");
  assert.ok(
    hitAt !== null && hitAt < 8,
    `no hit after detour: ${JSON.stringify({ x: e.x, z: e.z, searches })}`,
  );
  assert.ok(
    searches <= 1 + Math.ceil(hitAt / 0.6),
    "route searches stay cooldown-bounded",
  );
  assert.ok(p.ragdollTime > 0);
  assert.ok(e.animationPhase > 10);
});
test("blocked motion adds no fake gait/footstep travel; actual grounded travel emits bounded steps", () => {
  const calls = [],
    e = body(),
    g = {
      clock: 0,
      state: "playing",
      player: body({ id: "player", team: 0 }),
      audio: { volume: 1, playAt: (...args) => calls.push(args) },
      eye: (a) => new THREE.Vector3(a.x, a.y + 1.6, a.z),
      hasLOS: () => true,
    };
  for (let i = 0; i < 5; i++) {
    g.clock += 0.1;
    recordGloveBotTravel(g, e, 0, 0, 0.1, 0.1, GLOVES.glove_default);
  }
  assert.ok(e.gloveBlockedFor > 0.4);
  assert.equal(e.animationPhase, 0);
  assert.equal(calls.length, 0);
  e.x = 3.4;
  g.clock += 0.2;
  recordGloveBotTravel(g, e, 0, 0, 3.4, 0.1, GLOVES.glove_default);
  assert.ok(e.animationPhase > 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "step");
  e.grounded = false;
  e.x = 6.8;
  recordGloveBotTravel(g, e, 3.4, 0, 3.4, 0.1, GLOVES.glove_default);
  assert.equal(calls.length, 1);
});
test("guard disengagement is not overridden by a latched pursuit route and target changes discard old waypoints", () => {
  const e = body(),
    target = body({ id: "other", team: 0, z: -4 }),
    g = {
      clock: 1,
      world: { boxes: [], nav: { path: () => [{ x: 0, z: -4 }] } },
    };
  const retreat = { tactic: "disengage", wish: { x: 0, z: 1 } };
  e.gloveNavigation = { target, until: 5 };
  e.path = [{ x: 0, z: -4 }];
  assert.ok(gloveBotWish(g, e, target, retreat, true, 4, 3.2, 1 / 120).z > 0);
  const next = { ...target, id: "next" };
  gloveBotWish(
    g,
    e,
    next,
    { tactic: "approach", wish: { x: 0, z: -1 } },
    true,
    4,
    3.2,
    1 / 120,
  );
  assert.equal(e.gloveNavigation.target, next);
  assert.equal(e.path.length, 0);
});
