import test from "node:test";
import assert from "node:assert/strict";
import {
  duelBotIntent,
  duelBotSkill,
  turnBotYaw,
} from "../src/gloves/bot-dueling.js";
import { GLOVES } from "../src/gloves/catalog.js";
const glove = GLOVES.glove_default;
const fixture = () => ({
  bot: { x: 0, y: 0, z: 0, yaw: 0, team: 1, alive: true, strafe: 1, seed: 0 },
  target: { x: 0, y: 0, z: -2.2, vx: 0, vz: 0, team: 0, alive: true },
});
const plan = (bot, target, now, extra = {}) =>
  duelBotIntent(bot, target, glove, {
    now,
    dt: 1 / 120,
    difficulty: "regular",
    visible: true,
    ...extra,
  });
test("offline difficulties change actual reaction, turn limits and speed rather than hit damage", () => {
  assert.ok(duelBotSkill("easy").reaction > duelBotSkill("regular").reaction);
  assert.ok(duelBotSkill("regular").reaction > duelBotSkill("elite").reaction);
  assert.ok(duelBotSkill("easy").speed < duelBotSkill("elite").speed);
  assert.equal(duelBotSkill("unknown"), duelBotSkill("regular"));
  for (const skill of Object.values({
    a: duelBotSkill("easy"),
    b: duelBotSkill("elite"),
  }))
    assert.equal(skill.damage, undefined);
});
test("bots acquire a visible target before attacking and lose reaction readiness through cover", () => {
  const { bot, target } = fixture();
  assert.equal(plan(bot, target, 0).attack, false);
  assert.equal(plan(bot, target, 0.16).attack, false);
  assert.equal(plan(bot, target, 0.18).attack, true);
  assert.equal(plan(bot, target, 0.2, { visible: false }).attack, false);
  assert.equal(plan(bot, target, 0.3).attack, false);
  assert.equal(plan(bot, target, 0.4).attack, true);
});
test("changing opponents does not inherit instantaneous reaction readiness", () => {
  const { bot, target } = fixture();
  plan(bot, target, 0);
  assert.equal(plan(bot, target, 1).attack, true);
  assert.equal(plan(bot, { ...target }, 1.01).attack, false);
});
test("turning takes the shortest wraparound path, is frame-rate bounded, and cannot snap backwards", () => {
  assert.ok(
    Math.abs(
      turnBotYaw(Math.PI - 0.01, -Math.PI + 0.01, 0.005) - (Math.PI - 0.005),
    ) < 1e-10,
  );
  const { bot, target } = fixture();
  target.z = 2;
  const p = plan(bot, target, 0);
  assert.ok(Math.abs(p.yaw) <= duelBotSkill("regular").turn / 120 + 1e-10);
  assert.equal(p.attack, false);
  assert.equal(turnBotYaw(1, 2, 0), 1);
});
test("protected and reflecting opponents trigger readable disengagement, without cancelling a committed slap", () => {
  for (const status of ["goldTime", "stoneTime", "reverseTime"]) {
    const { bot, target } = fixture();
    target[status] = 1;
    bot.slapPending = { remaining: 0.12 };
    plan(bot, target, 0);
    const p = plan(bot, target, 0.2);
    assert.equal(p.tactic, "disengage");
    assert.ok(p.wish.z > 0);
    assert.equal(p.attack, false);
    assert.equal(bot.slapPending.remaining, 0.12);
  }
});
test("bots circle during recovery and avoid crowding allied bodies using normal movement wishes", () => {
  const { bot, target } = fixture();
  target.z = -2;
  bot.gloveCooldown = 0.7;
  plan(bot, target, 0);
  const p = plan(bot, target, 0.2);
  assert.equal(p.tactic, "circle");
  assert.ok(Math.abs(p.wish.x) > 0.5);
  const ally = { alive: true, team: bot.team, x: 0.4, z: 0 };
  target.z = -10;
  const separated = plan(bot, target, 0.3, { entities: [bot, target, ally] });
  assert.ok(separated.wish.x < 0);
  assert.ok(Math.hypot(separated.wish.x, separated.wish.z) <= 1.000001);
  assert.equal(bot.x, 0);
  assert.equal(ally.x, 0.4);
});
test("anticipation is bounded and never grants a melee contact outside the real reach", () => {
  const { bot, target } = fixture();
  plan(bot, target, 0);
  target.z = -20;
  target.vx = 999999;
  const p = plan(bot, target, 1);
  assert.equal(p.attack, false);
  assert.ok(Number.isFinite(p.yaw));
  assert.ok(Math.abs(p.yaw) < 0.1);
});

test("turning away slows the advance instead of perfect full-speed backward tracking", () => {
  const { bot, target } = fixture();
  target.z = 10;
  const turning = plan(bot, target, 0);
  bot.yaw = Math.PI;
  const facing = plan(bot, target, 0.2);
  assert.ok(turning.speed < facing.speed);
});
