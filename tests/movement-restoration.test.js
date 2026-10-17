import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVEMENT, accelerate } from "../src/movement.js";
import { movementReplay } from "./helpers/movement-replay.js";
const earlier = JSON.parse(
  readFileSync(new URL("./fixtures/earlier-movement.json", import.meta.url)),
);
test("normal movement restores the actual bf18246 constants, not another compromise preset", () => {
  for (const [key, value] of Object.entries(earlier.constants))
    assert.equal(MOVEMENT[key], value, key);
});
for (const { fps, samples } of earlier.trajectories) {
  test(`restored ground starts/stops/reversals and air steering match the earlier build at ${fps} Hz`, () => {
    const actual = movementReplay(accelerate, fps, MOVEMENT.runSpeed);
    assert.equal(actual.length, samples.length);
    for (let i = 0; i < samples.length; i++)
      for (const key of ["x", "z", "vx", "vz"])
        assert.ok(
          Math.abs(actual[i][key] - samples[i][key]) < 1e-8,
          `sample ${i} ${key}`,
        );
  });
}
test("slide restoration preserves the requested immediate long glide and anti-stacking path", () => {
  assert.equal(MOVEMENT.slideDuration, 1.5);
  assert.equal(MOVEMENT.slideCooldown, 0);
  assert.equal(MOVEMENT.slideMinSpeed, 10.4);
  assert.equal(MOVEMENT.slideBoost, 2.4);
  assert.equal(MOVEMENT.slideMaxSpeed, 16.5);
});
