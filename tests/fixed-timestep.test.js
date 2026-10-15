import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";
import { SIMULATION_STEP } from "../src/movement.js";

test("30, 60 and 144 render updates all drive exactly 120 physics steps per second", () => {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    for (const fps of [30, 60, 144]) {
      const g = Object.create(Game.prototype),
        steps = [];
      Object.assign(g, {
        last: 0,
        state: "playing",
        frameCount: 0,
        fpsTime: 0,
        accumulator: 0,
        settings: {},
        player: { alive: false },
        events: { fps() {}, tick() {} },
        renderer: {},
        renderWorld() {},
        updateCamera(dt, alpha) {
          assert.ok(alpha >= -1e-8 && alpha <= 1 + 1e-8);
        },
        simulate(dt) {
          steps.push(dt);
        },
      });
      for (let i = 1; i <= fps; i++) g.frame((i * 1000) / fps);
      assert.equal(steps.length, 120, `render FPS ${fps}`);
      assert.ok(steps.every((dt) => dt === SIMULATION_STEP));
      g.state = "paused";
      g.frame(1500);
      assert.equal(steps.length, 120);
      assert.equal(g.accumulator, 0);
    }
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});
