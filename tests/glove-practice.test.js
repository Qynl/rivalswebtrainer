import test from "node:test";
import assert from "node:assert/strict";
import {
  practiceOptions,
  freshPracticeStats,
  recordPracticeImpact,
  configurePractice,
  resetPractice,
  resetPracticeTarget,
} from "../src/gloves/practice.js";
function game() {
  return {
    range: true,
    network: null,
    player: {},
    state: "paused",
    loadout: ["glove_default"],
    config: {},
    round: 0,
    events: { update() {} },
    startRound() {
      this.round++;
      this.state = "playing";
      this.practiceStats = freshPracticeStats();
    },
  };
}
test("practice mode/count/opponent are bounded and default to the original five strafing targets", () => {
  assert.deepEqual(practiceOptions(), {
    mode: "strafe",
    count: 5,
    opponent: "glove_default",
  });
  assert.deepEqual(
    practiceOptions({ mode: "cheat", count: 200, opponent: "rifle" }),
    practiceOptions(),
  );
  assert.deepEqual(
    practiceOptions({ mode: "sparring", count: 1, opponent: "glove_reverse" }),
    { mode: "sparring", count: 1, opponent: "glove_reverse" },
  );
});
test("sandbox setup borrows a glove and remains paused without touching profile selection or currency", () => {
  const g = game();
  g.profile = { selected: "glove_default", slaps: 0 };
  assert.equal(
    configurePractice(g, {
      glove: "glove_golden",
      mode: "stationary",
      count: 1,
    }),
    true,
  );
  assert.equal(g.testDrive, true);
  assert.equal(g.loadout[0], "glove_golden");
  assert.equal(g.state, "paused");
  assert.equal(g.previousState, "playing");
  assert.equal(g.round, 1);
  assert.deepEqual(g.profile, { selected: "glove_default", slaps: 0 });
  assert.equal(g.config.testDrive, true);
  assert.equal(g.config.practiceOptions.count, 1);
});
test("practice commands cannot borrow gloves, reset health or change equipment in an online match or ordinary rounds", () => {
  for (const patch of [
    { network: {} },
    { range: false },
    { state: "lobby" },
    { player: null },
  ]) {
    const g = Object.assign(game(), patch);
    assert.equal(configurePractice(g, { glove: "glove_reverse" }), false);
    assert.equal(resetPractice(g), false);
    assert.equal(g.round, 0);
    assert.equal(g.loadout[0], "glove_default");
  }
  const g = game();
  assert.equal(configurePractice(g, { glove: "rifle" }), false);
});
test("resetting practice resets run metrics but normal practice does not silently become a no-reward trial", () => {
  const g = game();
  g.testDrive = false;
  g.practiceStats = { damage: 99 };
  assert.equal(resetPractice(g), true);
  assert.equal(g.testDrive, false);
  assert.deepEqual(g.practiceStats, freshPracticeStats());
});
test("training metrics count actual removed health rather than overkill, with real launch speed and no fake currency", () => {
  const g = game();
  const target = { health: 0 };
  recordPracticeImpact(g, g.player, 12, target, [3, 4, 0], true);
  assert.deepEqual(g.practiceStats, {
    damage: 12,
    contacts: 1,
    launches: 1,
    peak: 5,
  });
  recordPracticeImpact(g, g.player, 0, target, [0, 2, 0], false);
  assert.equal(g.practiceStats.contacts, 1);
  assert.equal(g.practiceStats.launches, 2);
  assert.equal(g.practiceStats.peak, 5);
  assert.equal(g.practiceStats.slaps, undefined);
  const before = { ...g.practiceStats };
  recordPracticeImpact(g, {}, 150, target, [100, 0, 0], true);
  assert.deepEqual(g.practiceStats, before);
  g.network = {};
  recordPracticeImpact(g, g.player, 150, target, [100, 0, 0], true);
  assert.deepEqual(g.practiceStats, before);
});
test("respawn removes old ability/boomerang locks, restores the configured spawn and keeps the chosen opponent glove", () => {
  const e = {
    activeWeapon: "glove_reverse",
    health: 0,
    maxHealth: 150,
    alive: false,
    practiceSpawn: { x: 7, z: -14 },
    ghostTime: 3,
    goldTime: 3,
    reverseTime: 2,
    stoneTime: 2,
    ragdollTime: 3,
    boostTime: 2,
    boomerangAt: 2,
    boomerangOwner: {},
    gloveDuel: {},
    slapPending: {},
    vx: 50,
    vy: 50,
    vz: 50,
  };
  resetPracticeTarget(e);
  assert.equal(e.alive, true);
  assert.equal(e.health, 150);
  assert.equal(e.activeWeapon, "glove_reverse");
  assert.equal(e.x, 7);
  assert.equal(e.z, -14);
  assert.equal(e.boomerangOwner, null);
  assert.equal(e.gloveDuel, null);
  assert.equal(e.goldTime, 0);
  assert.equal(e.reverseTime, 0);
  assert.equal(e.vx, 0);
});
