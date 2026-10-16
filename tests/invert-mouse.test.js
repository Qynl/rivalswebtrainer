import test from "node:test";
import assert from "node:assert/strict";
import { MouseLook } from "../src/input.js";
import { DEFAULT_SETTINGS } from "../src/data.js";

test("invert mouse Y defaults off and normal mouse deltas are unchanged", () => {
  assert.equal(DEFAULT_SETTINGS.invertMouseY, false);
  assert.deepEqual(new MouseLook().accept(12, 8, 1000), { x: 12, y: 8 });
});
test("invert mouse Y flips vertical movement only and toggles without resetting aim", () => {
  const mouse = new MouseLook();
  assert.deepEqual(mouse.accept(12, 8, 1000, 1000, true), { x: 12, y: -8 });
  assert.deepEqual(mouse.accept(-4, -6, 1008, 1008, true), { x: -4, y: 6 });
  assert.deepEqual(mouse.accept(12, 8, 1016, 1016, false), { x: 12, y: 8 });
});
test("inverted look keeps raw spike rejection and never replays a rejected packet", () => {
  const mouse = new MouseLook();
  mouse.reset(1000);
  assert.equal(mouse.accept(0, 200, 1008, 1008, true), null);
  assert.deepEqual(mouse.accept(2, 3, 1016, 1016, true), { x: 2, y: -3 });
});
