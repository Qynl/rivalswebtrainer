import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";
import { MOVEMENT, accelerate, steerSlide } from "../src/movement.js";
import { moveBody, verticalStep } from "../src/physics.js";
const player = () => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vz: 0,
  vy: 0,
  height: 1.9,
  radius: 0.38,
  grounded: true,
  jumps: 0,
  alive: true,
});
function harness() {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    player: player(),
    world: { boxes: [] },
    loadout: ["rifle", "pistol", "fists", "grenade"],
    slot: 0,
    keys: new Set(),
    yaw: 0,
    aiming: false,
    range: true,
    slideTime: 0,
    slideCooldown: 0,
    dashCooldown: 0,
    jumpBuffer: 0,
    coyoteTime: 0,
    walkPhase: 0,
    stepOffset: 0,
    landingDip: 0,
    crouched: false,
    cooldown: 0,
    reloadTime: 0,
    burstCount: 0,
    mouseDown: false,
    trigger: false,
    ammunition: [{ mag: 20, reserve: 100 }],
    audio: { play() {}, noiseHit() {} },
    events: { update() {} },
  });
  return g;
}
test("ground controls reach full speed quickly and stop without drifting", () => {
  const p = player();
  for (let i = 0; i < 9; i++)
    accelerate(p, { x: 1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.equal(p.vx, MOVEMENT.runSpeed);
  for (let i = 0; i < 8; i++)
    accelerate(p, { x: 0, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.equal(p.vx, 0);
});
test("diagonal movement is not faster than forward movement", () => {
  const g = harness();
  g.keys.add("KeyW");
  g.keys.add("KeyD");
  for (let i = 0; i < 30; i++) g.updatePlayer(1 / 60);
  assert.ok(
    Math.abs(Math.hypot(g.player.vx, g.player.vz) - MOVEMENT.runSpeed) < 1e-6,
  );
});
test("no input in air preserves horizontal momentum", () => {
  const p = player();
  p.grounded = false;
  p.vx = 14;
  for (let i = 0; i < 30; i++) accelerate(p, { x: 0, z: 0 }, 7.8, 1 / 60);
  assert.equal(p.vx, 14);
});
test("air control steers without erasing a dash impulse", () => {
  const p = player();
  p.grounded = false;
  p.vx = 21;
  accelerate(p, { x: 0, z: 1 }, 7.8, 1 / 60);
  assert.ok(Math.hypot(p.vx, p.vz) >= 21 - 1e-6);
  assert.ok(p.vx > 19);
  assert.ok(p.vz > 0);
  assert.ok(Math.hypot(p.vx, p.vz) <= 21.000001);
});
test("slide jump keeps boosted speed after leaving the ground", () => {
  const g = harness();
  g.player.vx = 7.8;
  g.slide();
  assert.ok(g.player.vx >= 12.8);
  g.jump();
  const speed = g.player.vx;
  g.updatePlayer(1 / 60);
  assert.equal(g.slideTime, 0);
  assert.equal(g.player.vx, speed);
  assert.ok(g.player.y > 0);
});
test("slide drag and steering are smooth, not a forced velocity reset", () => {
  const p = player();
  p.vx = 14;
  steerSlide(p, { x: 0, z: 1 }, 1 / 60);
  assert.ok(p.vx > 13);
  assert.ok(p.vz > 0);
  assert.ok(Math.hypot(p.vx, p.vz) < 14);
});
test("coyote time allows a jump immediately after walking off cover", () => {
  const g = harness();
  g.player.y = 1;
  g.updatePlayer(1 / 60);
  assert.equal(g.player.grounded, false);
  g.jump();
  assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
  assert.equal(g.coyoteTime, 0);
  g.jump();
  assert.equal(g.player.jumps, 1);
});
test("a slightly early jump is buffered until landing", () => {
  const g = harness();
  Object.assign(g.player, { y: 0.04, vy: -1, grounded: false, jumps: 1 });
  g.jump();
  assert.ok(g.jumpBuffer > 0);
  for (let i = 0; i < 3; i++) g.updatePlayer(1 / 60);
  assert.ok(g.player.vy > 0);
  assert.equal(g.player.grounded, false);
  assert.equal(g.jumpBuffer, 0);
});
test("walking at the edge of a step stays supported instead of vibrating", () => {
  const p = player();
  const box = { minX: 1, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 0.36 };
  moveBody(p, 0.7, 0, [box]);
  assert.equal(p.y, 0.36);
  for (let i = 0; i < 120; i++) {
    verticalStep(p, 1 / 60, [box]);
    assert.equal(p.y, 0.36);
    assert.equal(p.grounded, true);
  }
});
test("auto-step respects overhead clearance", () => {
  const p = player();
  const step = { minX: 1, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 0.36 };
  const ceiling = { minX: 1, maxX: 2, minZ: -2, maxZ: 2, minY: 2, maxY: 2.5 };
  moveBody(p, 2, 0, [step, ceiling]);
  assert.equal(p.y, 0);
  assert.ok(p.x < 0.63);
});
test("wall collisions cancel blocked velocity, preserving motion along the wall", () => {
  const p = player();
  p.vx = 10;
  p.vz = 3;
  moveBody(p, 2, 1, [
    { minX: 1, maxX: 2, minZ: -3, maxZ: 3, minY: 0, maxY: 4 },
  ]);
  assert.equal(p.vx, 0);
  assert.equal(p.vz, 3);
  assert.ok(Math.abs(p.z - 1) < 1e-10);
});
test("fixed simulation is consistent at 30, 60 and 144 render FPS", () => {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const run = (fps) => {
      const g = harness();
      Object.assign(g, {
        state: "playing",
        last: 0,
        accumulator: 0,
        frameCount: 0,
        fpsTime: 0,
        renderer: { render() {} },
        updateCamera() {},
        events: { fps() {}, tick() {} },
        simulate(dt) {
          accelerate(this.player, { x: 1, z: 0 }, 7.8, dt);
          moveBody(this.player, this.player.vx * dt, 0, []);
        },
      });
      for (let i = 1; i <= fps; i++) g.frame((i * 1000) / fps);
      return g.player.x;
    };
    const positions = [30, 60, 144].map(run);
    assert.ok(
      Math.max(...positions) - Math.min(...positions) < 1e-6,
      JSON.stringify(positions),
    );
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
});
