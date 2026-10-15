import test from "node:test";
import assert from "node:assert/strict";
import { moveBody, verticalStep, NavGrid, circleBox } from "../src/physics.js";
import { MOVEMENT } from "../src/movement.js";
import { WEAPONS, DIFFICULTIES } from "../src/data.js";
const wall = { minX: 1, maxX: 2, minZ: -3, maxZ: 3, minY: 0, maxY: 4 };
const body = () => ({
  x: 0,
  z: 0,
  y: 0,
  vy: 0,
  height: 1.9,
  radius: 0.38,
  grounded: true,
  jumps: 0,
});
test("large movement cannot tunnel through walls", () => {
  const p = body();
  moveBody(p, 15, 0, [wall]);
  assert.ok(p.x <= 0.620001);
});
test("wall collision permits sliding along its face", () => {
  const p = body();
  moveBody(p, 2, 2, [wall]);
  assert.ok(p.x <= 0.620001);
  assert.ok(Math.abs(p.z - 2) < 1e-10);
});
test("players can move over boxes when above their top", () => {
  const p = body();
  p.y = 5;
  moveBody(p, 3, 0, [wall]);
  assert.ok(Math.abs(p.x - 3) < 1e-6);
});
test("jump returns to the ground and resets double jumps", () => {
  const p = body();
  p.vy = MOVEMENT.jumpSpeed;
  p.jumps = 1;
  let max = 0;
  for (let i = 0; i < 120; i++) {
    verticalStep(p, 1 / 120, []);
    max = Math.max(max, p.y);
  }
  assert.ok(max > 3 && max < 3.6);
  assert.equal(p.y, 0);
  assert.equal(p.grounded, true);
  assert.equal(p.jumps, 0);
});
test("falling bodies land on raised cover", () => {
  const p = body();
  p.x = 1.5;
  p.y = 5;
  for (let i = 0; i < 90; i++) verticalStep(p, 1 / 120, [wall]);
  assert.equal(p.y, 4);
});
test("A* routes around solid cover", () => {
  const obstacle = { minX: -2, maxX: 2, minZ: -4, maxZ: 4, minY: 0, maxY: 3 };
  const nav = new NavGrid([obstacle], 24, 1.5);
  const path = nav.path({ x: -8, z: 0 }, { x: 8, z: 0 });
  assert.ok(path.length > 0);
  for (const p of path) assert.ok(!circleBox(p.x, p.z, 0.4, obstacle));
  assert.ok(path.some((p) => Math.abs(p.z) > 4));
});
test("navigation returns empty when no route exists", () => {
  const nav = new NavGrid(
    [{ minX: -1, maxX: 1, minZ: -15, maxZ: 15, minY: 0, maxY: 5 }],
    24,
    1,
  );
  assert.deepEqual(nav.path({ x: -8, z: 0 }, { x: 8, z: 0 }), []);
});
test("all loadout weapons have complete, valid combat data", () => {
  for (const w of Object.values(WEAPONS)) {
    assert.ok(w.slot >= 0 && w.slot <= 3);
    assert.ok(w.interval > 0);
    assert.ok(w.range > 0);
    assert.ok(w.damage >= 0);
    assert.equal(w.stats.length, 3);
    if (w.slot < 2) assert.ok(w.mag > 0 && w.reload > 0);
  }
  assert.ok(DIFFICULTIES.elite.reaction < DIFFICULTIES.rookie.reaction);
  assert.ok(DIFFICULTIES.elite.spread < DIFFICULTIES.rookie.spread);
});
test("grounded players walk up shallow stairs without jumping", () => {
  const p = body();
  const steps = Array.from({ length: 6 }, (_, i) => ({
    minX: 1 + i * 0.6,
    maxX: 1.6 + i * 0.6,
    minZ: -2,
    maxZ: 2,
    minY: 0,
    maxY: 0.36 * (i + 1),
  }));
  for (let i = 0; i < 50; i++) {
    moveBody(p, 0.1, 0, steps);
    verticalStep(p, 0.016, steps);
  }
  assert.ok(p.x > 4);
  assert.ok(p.y > 1.8);
});
test("players cannot auto-step onto tall cover", () => {
  const p = body();
  moveBody(p, 2, 0, [{ ...wall, maxY: 1 }]);
  assert.ok(p.x < 0.63);
  assert.equal(p.y, 0);
});
