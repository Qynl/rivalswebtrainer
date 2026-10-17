import test from "node:test";
import assert from "node:assert/strict";
import { NavGrid } from "../src/physics.js";
import {
  gloveEnemyVisible,
  glovePerceivedTarget,
  selectGloveOpponent,
} from "../src/gloves/bot-awareness.js";
function actor(extra = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    seed: 0,
    team: 1,
    radius: 0.38,
    height: 1.9,
    ...extra,
  };
}
function context() {
  return {
    clock: 0,
    world: { boxes: [], spawns: [[{ x: 0, z: -10 }], [{ x: 0, z: 10 }]] },
    hasLOS: () => false,
    eye: () => ({}),
  };
}
function conceal(target) {
  for (const key of [
    "x",
    "y",
    "z",
    "vx",
    "vz",
    "slapPending",
    "goldTime",
    "reverseTime",
    "stoneTime",
  ])
    Object.defineProperty(target, key, {
      get() {
        throw new Error(`hidden ${key} read`);
      },
      configurable: true,
    });
  return target;
}
test("hidden targets provide only remembered aim/navigation coordinates, not current motion or windup", () => {
  const g = context(),
    bot = actor(),
    target = actor({
      id: "target",
      team: 0,
      x: 2,
      z: -5,
      vx: 4,
      slapPending: { remaining: 0.1 },
      goldTime: 2,
    });
  const seen = glovePerceivedTarget(g, bot, target, true);
  assert.equal(seen.x, 2);
  assert.equal(seen.vx, 4);
  assert.ok(seen.slapPending);
  conceal(target);
  g.clock = 1;
  const hidden = glovePerceivedTarget(g, bot, target, false);
  assert.equal(hidden, seen, "stable identity preserves reaction state");
  assert.deepEqual([hidden.x, hidden.z], [2, -5]);
  assert.equal(hidden.vx, 0);
  assert.equal(hidden.slapPending, null);
  assert.equal(hidden.goldTime, 0);
});
test("an opponent not yet seen uses its public starting spawn without consulting hidden positions", () => {
  const g = context(),
    bot = actor(),
    target = conceal({
      id: "covered",
      team: 0,
      spawnPoint: { x: 8, y: 0, z: -9 },
    });
  assert.deepEqual(glovePerceivedTarget(g, bot, target, false).x, 8);
  assert.equal(bot.gloveAwareness.seenAt, null);
});
test("covered opponent selection retains its known target and does not rank private live positions", () => {
  const g = context(),
    a = conceal({ id: "a", team: 0, spawnPoint: { x: 0, z: -9 } }),
    b = conceal({ id: "b", team: 0, spawnPoint: { x: 0, z: -5 } }),
    bot = actor();
  assert.equal(selectGloveOpponent(g, bot, [a, b]), b);
  bot.targetEntity = a;
  assert.equal(selectGloveOpponent(g, bot, [a, b]), a);
});
test("a visible opponent takes priority over a covered remembered target", () => {
  const g = context(),
    a = actor({ id: "a", team: 0, z: -2 }),
    b = actor({ id: "b", team: 0, z: -8 }),
    bot = actor({ targetEntity: a });
  g.eye = (e) => e;
  g.hasLOS = (_, other) => other === b;
  assert.equal(selectGloveOpponent(g, bot, [a, b]), b);
});
test("arriving at an empty remembered location starts bounded nav-valid searching, not stationary omniscience", () => {
  const g = context(),
    bot = actor(),
    target = actor({ id: "target", team: 0 });
  g.world.nav = new NavGrid([], 24, 0.75);
  glovePerceivedTarget(g, bot, target, true);
  conceal(target);
  g.clock = 1;
  const goal = glovePerceivedTarget(g, bot, target, false);
  assert.ok(Math.hypot(goal.x, goal.z) > 1.5);
  assert.ok(bot.gloveAwareness.searchStep <= 8);
  const previous = { ...goal };
  g.clock = 1.1;
  assert.deepEqual(glovePerceivedTarget(g, bot, target, false), previous);
});
test("Ghost is not exposed at ordinary melee range, through cover or on another level; physical contact can be sensed", () => {
  const g = context(),
    bot = actor(),
    ghost = actor({ team: 0, ghostTime: 3, z: -1.8 });
  g.hasLOS = () => true;
  assert.equal(gloveEnemyVisible(g, bot, ghost), false);
  ghost.z = -0.5;
  assert.equal(gloveEnemyVisible(g, bot, ghost), true);
  ghost.y = 3;
  assert.equal(gloveEnemyVisible(g, bot, ghost), false);
  ghost.y = 0;
  g.hasLOS = () => false;
  assert.equal(gloveEnemyVisible(g, bot, ghost), false);
});

test("exhausted local search expands into public map patrol, without consulting hidden target state", () => {
  const g = context(),
    bot = actor(),
    target = actor({ id: "target", team: 0 });
  g.world.nav = new NavGrid([], 24, 0.75);
  glovePerceivedTarget(g, bot, target, true);
  conceal(target);
  bot.gloveAwareness.searchStep = 16;
  g.clock = 2;
  const goal = glovePerceivedTarget(g, bot, target, false);
  assert.ok(Math.hypot(goal.x, goal.z) > 6.5);
  assert.ok(bot.gloveAwareness.searchStep <= 24);
});

test("unreachable search candidates use at most two path searches and never replace the known goal", () => {
  const g = context(),
    bot = actor(),
    target = actor({ id: "target", team: 0 });
  g.world.nav = new NavGrid([], 24, 0.75);
  let searches = 0;
  g.world.nav.path = () => {
    searches++;
    return [];
  };
  glovePerceivedTarget(g, bot, target, true);
  conceal(target);
  g.clock = 1;
  const goal = glovePerceivedTarget(g, bot, target, false);
  assert.equal(searches, 2);
  assert.equal(goal.x, 0);
  assert.equal(goal.z, 0);
  assert.ok(bot.gloveAwareness.nextSearch > g.clock);
});

test("hard crowd control drops instantaneous reaction readiness before recovery", async () => {
  const { updateGloveBot } = await import("../src/gloves/combat.js");
  const g = context(),
    bot = actor({
      alive: true,
      health: 150,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      ragdollTime: 0.2,
      gloveDuel: { seenAt: -10 },
    });
  g.clock = 4;
  g.animateBot = () => {};
  updateGloveBot(g, bot, 0.01);
  assert.equal(bot.gloveDuel.seenAt, 4);
  assert.equal(bot.slapPending, null);
});
