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
  assert.equal(g.player.vx, 7.8 + MOVEMENT.slideBoost);
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

test("counter-strafing reverses promptly while diagonal input remains normalized", () => {
  const p = player();
  p.vx = MOVEMENT.runSpeed;
  for (let i = 0; i < 5; i++)
    accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(p.vx < 0);
  for (let i = 0; i < 120; i++)
    accelerate(p, { x: 1, z: 1 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vz) - MOVEMENT.runSpeed) < 1e-8);
});
test("brief landing grace preserves carried momentum, but releasing input brakes it", () => {
  const p = player();
  p.vx = 24;
  p.landingGrace = 0.08;
  accelerate(p, { x: 1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.equal(p.vx, 24);
  accelerate(p, { x: 0, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(p.vx < 24);
  p.landingGrace = 0;
  for (let i = 0; i < 20; i++)
    accelerate(p, { x: 1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.equal(p.vx, MOVEMENT.runSpeed);
});
test("downhill slides gain more speed than flat slides; uphill momentum pays for elevation", () => {
  const flat = player(),
    down = player(),
    up = player();
  flat.vz = down.vz = -20;
  up.vz = 20;
  down.groundSlope = up.groundSlope = { x: 0, z: 0.6875 };
  steerSlide(flat, { x: 0, z: 0 }, 1 / 60);
  steerSlide(down, { x: 0, z: 0 }, 1 / 60);
  steerSlide(up, { x: 0, z: 0 }, 1 / 60);
  assert.ok(-down.vz > -flat.vz);
  assert.ok(up.vz < -flat.vz);
});
test("reverse air control brakes along the input axis instead of orbiting sideways", () => {
  const p = player();
  p.grounded = false;
  p.vx = 21;
  accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(p.vx < 21 && p.vx > 18);
  assert.ok(Math.abs(p.vz) < 1e-10);
  for (let i = 0; i < 60; i++)
    accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(p.vx < -20);
});
test("an airborne slide press is buffered into a grounded slide", () => {
  const g = harness();
  Object.assign(g.player, {
    y: 0.04,
    vy: -2,
    grounded: false,
    jumps: 1,
    vx: 12,
  });
  g.keys.add("KeyD");
  g.slide();
  assert.ok(g.slideBuffer > 0);
  assert.equal(g.slideTime, 0);
  for (let i = 0; i < 3; i++) g.updatePlayer(1 / 60);
  assert.ok(g.slideTime > 0);
  assert.equal(g.crouched, true);
});
test("short descending stairs stay grounded, but genuine ledges retain coyote falls", () => {
  const steps = Array.from({ length: 6 }, (_, i) => ({
    minX: i * 0.8,
    maxX: (i + 1) * 0.8,
    minZ: -2,
    maxZ: 2,
    minY: 0,
    maxY: (6 - i) * 0.36,
  }));
  const p = player();
  p.x = 0.4;
  p.y = 2.16;
  for (let i = 0; i < 43; i++) {
    moveBody(p, 0.1, 0, steps);
    verticalStep(p, 1 / 60, steps);
    assert.equal(p.grounded, true);
  }
  const edge = player();
  edge.x = 0.5;
  edge.y = 2;
  moveBody(edge, 1, 0, [
    { minX: 0, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 2 },
  ]);
  verticalStep(edge, 1 / 60, []);
  assert.equal(edge.grounded, false);
  assert.ok(edge.y > 1.9);
});
test("rendered camera direction matches the actual shot even during recoil and sliding", () => {
  // Reuse the complete camera harness from the refinement suite through real methods.
  const g = harness();
  g.settings = { shake: true, fov: 95 };
  return import("three").then((THREE) => {
    g.camera = new THREE.PerspectiveCamera(95, 1.6, 0.08, 180);
    g.weaponCamera = new THREE.PerspectiveCamera();
    g.pitch = 0.2;
    g.yaw = 0.4;
    g.kick = 0.3;
    g.slideTime = 0.2;
    g.updateCamera(1 / 60);
    const direction = g.camera.getWorldDirection(new THREE.Vector3());
    const expected = new THREE.Vector3(
      -Math.sin(g.yaw) * Math.cos(g.pitch),
      Math.sin(g.pitch),
      -Math.cos(g.yaw) * Math.cos(g.pitch),
    );
    assert.ok(direction.distanceTo(expected) < 1e-10);
  });
});

test("a wall collision spends the blocked air momentum instead of allowing a free re-acceleration", () => {
  const p = player();
  Object.assign(p, { grounded: false, y: 1, vx: 25, vz: 0, airCarrySpeed: 25 });
  moveBody(p, 2, 0, [
    { minX: 1, maxX: 2, minZ: -3, maxZ: 3, minY: 0, maxY: 4 },
  ]);
  assert.equal(p.vx, 0);
  assert.equal(p.airCarrySpeed, 0);
  for (let i = 0; i < 60; i++)
    accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, 1 / 60);
  assert.ok(Math.hypot(p.vx, p.vz) <= MOVEMENT.runSpeed + 1e-8);
});
test("forced crouch keeps the rendered eye below the low ceiling even while stance is easing", async () => {
  const THREE = await import("three"),
    g = harness();
  g.settings = { shake: true, fov: 95 };
  g.camera = new THREE.PerspectiveCamera(95, 1.6, 0.08, 180);
  g.eyeHeight = 1.66;
  g.pitch = 0;
  g.kick = 0;
  g.world.boxes = [
    { minX: -3, maxX: 3, minZ: -3, maxZ: 3, minY: 1.3, maxY: 2 },
  ];
  g.updatePlayer(1 / 60);
  g.updateCamera(1 / 60);
  assert.equal(g.forcedCrouch, true);
  assert.equal(g.player.height, 1.15);
  assert.ok(g.camera.position.y <= 1.02 + 1e-10);
});
