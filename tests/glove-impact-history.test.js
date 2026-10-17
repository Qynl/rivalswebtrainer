import test from "node:test";
import assert from "node:assert/strict";
import { recordIncomingImpact } from "../src/gloves/impact-history.js";
const hit = (extra = {}) => ({
  glove: "glove_default",
  damage: 24,
  healthAfter: 126,
  velocity: [0, 4, -14],
  round: 1,
  ...extra,
});
test("recap uses actual removed health on a final overkill slap, not nominal glove damage", () => {
  const p = {},
    g = { player: p, round: 1 };
  recordIncomingImpact(g, hit(), { name: "RIVAL" }, p);
  recordIncomingImpact(
    g,
    hit({ damage: 10, healthAfter: 0 }),
    { name: "FINAL" },
    p,
  );
  assert.equal(g.deathRecap.source, "FINAL");
  assert.equal(g.deathRecap.damage, 10);
  assert.equal(g.deathRecap.total, 34);
  assert.equal(g.deathRecap.hits, 2);
  assert.equal(g.deathRecap.launch, Math.hypot(0, 4, -14));
  assert.equal(g.deathRecap.x, undefined);
});
test("incoming history is bounded, zero-damage trips are not counted as damaging hits, and reflection stays explicit", () => {
  const p = {},
    g = { player: p, round: 1 };
  for (let i = 0; i < 100; i++)
    recordIncomingImpact(g, hit({ damage: 0 }), {}, p);
  assert.equal(g.incomingImpacts.length, 8);
  assert.equal(g.deathRecap, undefined);
  recordIncomingImpact(
    g,
    hit({ damage: 20, healthAfter: 0, reflected: true }),
    { name: "DEFENDER" },
    p,
  );
  assert.equal(g.deathRecap.hits, 1);
  assert.equal(g.deathRecap.total, 20);
  assert.equal(g.deathRecap.reflected, true);
});
test("authority contexts, older rounds, other victims and incomplete legacy effects never fabricate a personal recap", () => {
  const p = {};
  for (const [patch, event, target] of [
    [{ headless: true }, hit(), p],
    [{}, hit({ round: 0 }), p],
    [{}, hit(), {}],
    [{}, hit({ damage: undefined }), p],
    [{}, hit({ damage: -1 }), p],
    [{}, hit({ glove: "bad" }), p],
  ]) {
    const g = { round: 1, player: p, ...patch };
    recordIncomingImpact(g, event, { name: "RIVAL" }, target);
    assert.equal(g.incomingImpacts, undefined);
  }
});
