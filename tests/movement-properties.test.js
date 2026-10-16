import test from "node:test";
import assert from "node:assert/strict";
import {
  circleBox,
  moveBody,
  verticalStep,
  surfaceHeight,
} from "../src/physics.js";
import { MOVEMENT, steerSlide } from "../src/movement.js";
const body = () => ({
  x: -5,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  radius: 0.38,
  height: 1.9,
  grounded: true,
  jumps: 0,
});
let seed = 0x731acd;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

test("seeded high-speed angled wall approaches never end penetrating the cover", () => {
  for (let i = 0; i < 500; i++) {
    const angle = (random() - 0.5) * 2.8,
      c = Math.cos(angle),
      s = Math.sin(angle),
      ex = Math.abs(c) * 0.5 + Math.abs(s) * 2,
      ez = Math.abs(s) * 0.5 + Math.abs(c) * 2;
    const obstacle = {
        cx: 0,
        cz: 0,
        angle,
        halfX: 0.5,
        halfZ: 2,
        minX: -ex,
        maxX: ex,
        minZ: -ez,
        maxZ: ez,
        minY: 0,
        maxY: 4,
      },
      p = body();
    p.z = (random() - 0.5) * 8;
    const dx = random() * 12,
      dz = (random() - 0.5) * 12;
    p.vx = dx * 60;
    p.vz = dz * 60;
    moveBody(p, dx, dz, [obstacle]);
    assert.equal(
      circleBox(p.x, p.z, p.radius, obstacle),
      false,
      JSON.stringify({ i, p, angle }),
    );
    assert.ok([p.x, p.y, p.z, p.vx, p.vz].every(Number.isFinite));
  }
});
test("repeated ramp direction changes keep support without accumulating vertical error", () => {
  const ramp = {
      minX: -2,
      maxX: 2,
      minZ: -3.2,
      maxZ: 3.2,
      minY: 0,
      maxY: 4.4,
      ramp: { axis: "z", direction: 1, rise: 4.4 },
    },
    p = body();
  p.x = 0;
  p.z = -3;
  p.y = surfaceHeight(ramp, p.x, p.z);
  for (let cycle = 0; cycle < 30; cycle++)
    for (const direction of [1, -1])
      for (let i = 0; i < 60; i++) {
        moveBody(p, 0, direction * 0.1, [ramp]);
        verticalStep(p, 1 / 120, [ramp]);
        assert.equal(p.grounded, true);
        assert.ok(Math.abs(p.y - surfaceHeight(ramp, p.x, p.z)) < 1e-8);
      }
  assert.ok(Math.abs(p.z + 3) < 1e-8);
  assert.ok(Math.abs(p.y - 0.1375) < 1e-8);
});
test("slide decay and steering agree at 30, 60 and 144 controller updates per second", () => {
  const results = [30, 60, 144].map((fps) => {
    const p = body();
    p.vx = 24;
    let elapsed = 0;
    while (elapsed < MOVEMENT.slideDuration - 1e-9) {
      const dt = Math.min(1 / fps, MOVEMENT.slideDuration - elapsed);
      steerSlide(p, { x: 0, z: 1 }, dt);
      elapsed += dt;
    }
    return [p.vx, p.vz];
  });
  for (const value of results)
    assert.ok(
      Math.hypot(value[0] - results[0][0], value[1] - results[0][1]) < 1e-8,
      JSON.stringify(results),
    );
});

test("a full airborne reversal crosses zero without entering a sideways orbit at low speed", async () => {
  const { accelerate } = await import("../src/movement.js");
  for (const fps of [60, 120, 600]) {
    const p = body();
    p.x = 0;
    p.z = 0;
    p.vx = 14;
    p.grounded = false;
    for (let i = 0; i < fps * 0.8; i++) {
      accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, 1 / fps);
      p.x += p.vx / fps;
      p.z += p.vz / fps;
    }
    assert.ok(p.vx < -13.9);
    assert.ok(Math.abs(p.z) < 1e-8, JSON.stringify({ fps, p }));
  }
});

test("a fresh round clears forced head clearance, dash pose and accumulated camera motion", async () => {
  const { Game } = await import("../src/game.js");
  for (const range of [false, true]) {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
      range,
      round: 0,
      score: [0, 0],
      config: { mode: 1 },
      world: { spawns: [[{}], [{}]] },
      loadout: ["rifle", "pistol", "fists", "grenade"],
      keys: new Set(["KeyW"]),
      forcedCrouch: true,
      crouched: true,
      dashTime: 0.2,
      stepOffset: -0.18,
      landingDip: 0.4,
      slideBuffer: 0.15,
      jumpBuffer: 0.1,
      clearQuickMelee() {},
      cleanEntities() {},
      createEntity: body,
      equip() {},
      updateCamera() {},
      camera: { updateMatrixWorld() {} },
      events: Object.fromEntries(
        ["banner", "round", "update", "feedClear"].map((k) => [k, () => {}]),
      ),
    });
    g.startRound();
    for (const key of ["forcedCrouch", "crouched"])
      assert.equal(g[key], false, key);
    for (const key of [
      "dashTime",
      "stepOffset",
      "landingDip",
      "slideBuffer",
      "jumpBuffer",
    ])
      assert.equal(g[key], 0, key);
    assert.equal(g.keys.size, 0);
    assert.equal(g.eyeHeight, 1.66);
  }
});

test("seeded high-speed approaches cannot tunnel across long thin rotated slabs", () => {
  for (let i = 0; i < 500; i++) {
    const angle = (random() - 0.5) * Math.PI * 2,
      c = Math.cos(angle),
      s = Math.sin(angle),
      offset = (random() - 0.5) * 40,
      travel = 1 + random() * 14,
      lateral = (random() - 0.5) * 8;
    const ex = Math.abs(c) * 0.15 + Math.abs(s) * 100,
      ez = Math.abs(s) * 0.15 + Math.abs(c) * 100;
    const obstacle = {
        cx: 0,
        cz: 0,
        angle,
        halfX: 0.15,
        halfZ: 100,
        minX: -ex,
        maxX: ex,
        minZ: -ez,
        maxZ: ez,
        minY: 0,
        maxY: 4,
      },
      p = body();
    // Three.js positive Y rotation maps local +X to (cos, -sin).
    p.x = -5 * c + offset * s;
    p.z = 5 * s + offset * c;
    const dx = travel * c + lateral * s,
      dz = -travel * s + lateral * c;
    p.vx = dx * 60;
    p.vz = dz * 60;
    moveBody(p, dx, dz, [obstacle]);
    assert.ok(
      p.x * c - p.z * s <= -0.53 + 1e-8,
      JSON.stringify({ i, p, angle, travel }),
    );
    if (travel > 4.48)
      assert.ok(
        Math.abs(p.vx * c - p.vz * s) < 1e-7,
        JSON.stringify({ i, p, angle }),
      );
  }
});
