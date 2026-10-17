import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { packet } from "./helpers/match.js";
import { setup } from "./helpers/match.js";
import {
  MOVEMENT,
  accelerate,
  steerSlide,
  rampJumpBoost,
} from "../src/movement.js";
import { botJump, initBotActions } from "../src/bot-actions.js";
const dt = 1 / 120;
function flat(run) {
  const { m, g, other } = setup();
  m.world.boxes = [];
  m.world.bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
  Object.assign(g.player, {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    jumps: 0,
  });
  try {
    run(g, other.player);
  } finally {
    m.dispose();
  }
}
test("responsive run reaches speed in 110ms and releasing input stops in under 90ms", () =>
  flat((g) => {
    g.keys.add("KeyD");
    for (let i = 0; i < 14; i++) g.updatePlayer(dt);
    assert.equal(g.player.vx, 10.6);
    const start = g.player.x;
    g.keys.clear();
    for (let i = 0; i < 11; i++) g.updatePlayer(dt);
    assert.equal(g.player.vx, 0);
    assert.ok(g.player.x - start < 0.45);
  }));
test("running slide lasts 1.5 seconds and can restart as soon as it finishes", () =>
  flat((g) => {
    g.keys.add("KeyD");
    g.player.vx = MOVEMENT.runSpeed;
    g.slide();
    assert.equal(g.player.vx, 13);
    for (let i = 0; i < 120; i++) g.updatePlayer(dt);
    assert.ok(g.slideTime > 0.49 && g.player.vx > 9);
    for (let i = 0; i < 61; i++) g.updatePlayer(dt);
    assert.equal(g.slideTime, 0);
    assert.ok(g.player.x > 15.6 && g.player.x < 15.9);
    assert.equal(g.slideCooldown, 0);
    g.slide();
    assert.equal(g.slideTime, MOVEMENT.slideDuration);
  }));
test("standing and slow-moving slide taps start immediately without a speed buffer", () =>
  flat((g) => {
    for (const speed of [0, 0.5, 2.5]) {
      g.slideTime = 0;
      g.slideCooldown = 1;
      g.player.vx = speed;
      g.player.vz = 0;
      g.keys.add("KeyD");
      g.slide();
      assert.equal(g.slideTime, 1.5);
      assert.equal(g.slideBuffer, 0);
      assert.equal(g.player.vx, 10.4);
      assert.equal(g.player.vz, 0);
      assert.equal(g.player.height, 1.15);
    }
  }));
test("repeated slide jumps preserve their launch speed without stacking extra jump boosts", () =>
  flat((g) => {
    g.player.vx = MOVEMENT.runSpeed;
    for (let i = 0; i < 20; i++) {
      g.player.grounded = true;
      g.player.jumps = 0;
      g.slideCooldown = 0;
      g.slide();
      const speed = g.player.vx;
      g.jump();
      assert.equal(g.player.vx, speed);
      assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
      assert.ok(speed <= MOVEMENT.slideMaxSpeed);
      assert.equal(g.slideTime, 0);
    }
  }));
test("restored flat jump peaks at 1.57m and holding Space cannot trigger unattended bunny hopping", () =>
  flat((g) => {
    g.keys.add("Space");
    g.jump();
    let apex = 0,
      airtime = 0;
    for (let i = 0; i < 240; i++) {
      g.updatePlayer(dt);
      apex = Math.max(apex, g.player.y);
      if (!g.player.grounded) airtime += dt;
    }
    assert.ok(apex > 1.56 && apex < 1.58);
    assert.ok(airtime > 0.63 && airtime < 0.67);
    assert.equal(g.player.y, 0);
    assert.equal(g.player.jumps, 0);
    g.jump();
    assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
  }));
test("air strafing bends momentum progressively, not a near-instant right-angle turn", () => {
  const p = { grounded: false, vx: MOVEMENT.runSpeed, vz: 0 };
  for (let i = 0; i < 6; i++)
    accelerate(p, { x: 0, z: 1 }, MOVEMENT.runSpeed, dt);
  const angle = Math.atan2(p.vz, p.vx);
  assert.ok(angle > 0.37 && angle < 0.38);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vz) - MOVEMENT.runSpeed) < 1e-8);
});
test("reversing in air first brakes and eventually reverses, without sideways drift", () => {
  const p = { grounded: false, vx: 21, vz: 0 };
  for (let i = 0; i < 12; i++)
    accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, dt);
  assert.ok(p.vx > 13.4 && p.vx < 13.6);
  for (let i = 0; i < 180; i++)
    accelerate(p, { x: -1, z: 0 }, MOVEMENT.runSpeed, dt);
  assert.ok(p.vx < -20);
  assert.ok(Math.abs(p.vz) < 1e-8);
});
test("releasing movement coasts while opposite input brakes without a sideways orbit", () => {
  const coast = { vx: 13, vz: 0 },
    move = { ...coast },
    brake = { ...coast };
  for (let i = 0; i < 20; i++) {
    steerSlide(coast, { x: 0, z: 0 }, dt);
    steerSlide(move, { x: 1, z: 0 }, dt);
    steerSlide(brake, { x: -1, z: 0 }, dt);
  }
  assert.ok(coast.vx > 9 && coast.vx < move.vx);
  assert.ok(brake.vx < coast.vx * 0.5);
  assert.equal(brake.vz, 0);
});
test("explosive/dash air momentum is not truncated by the lower ordinary movement cap", () => {
  const p = { grounded: false, vx: 45, vz: 0 };
  accelerate(p, { x: 0, z: 0 }, MOVEMENT.runSpeed, dt);
  assert.equal(p.vx, 45);
  accelerate(p, { x: 1, z: 0 }, MOVEMENT.runSpeed, dt);
  assert.ok(p.vx > 44 && p.vx < 45);
});
test("ramp assistance is capped and shared by human and bot jump code", () =>
  flat((g, bot) => {
    initBotActions(bot);
    for (const p of [g.player, bot])
      Object.assign(p, {
        grounded: true,
        vx: 25,
        vz: 0,
        groundSlope: { x: 1, z: 0 },
        jumpCooldown: 0,
      });
    assert.equal(rampJumpBoost(g.player), 1.5);
    g.jump();
    assert.equal(botJump(bot, g.world), true);
    assert.equal(g.player.vy, bot.vy);
    assert.equal(bot.vy, 11.2);
    assert.equal(
      rampJumpBoost({ vx: -25, vz: 0, groundSlope: { x: 1, z: 0 } }),
      0,
    );
  }));
test("slide FOV stays within one degree while yaw/pitch remain untouched", () =>
  flat((g) => {
    g.settings = { shake: true, dynamicFov: true, fov: 95 };
    g.camera = new THREE.PerspectiveCamera(95, 1.6, 0.08, 180);
    g.weaponCamera = new THREE.PerspectiveCamera();
    g.yaw = 0.4;
    g.pitch = 0.1;
    g.slideTime = 0.2;
    for (let i = 0; i < 120; i++) g.updateCamera(dt);
    assert.ok(g.camera.fov > 95.7 && g.camera.fov <= 95.8);
    assert.equal(g.yaw, 0.4);
    assert.equal(g.pitch, 0.1);
    assert.equal(g.camera.rotation.y, 0.4);
    assert.equal(g.camera.rotation.x, 0.1);
  }));

test("authoritative network input uses the new speed and does not auto-jump from held Space bits", () => {
  const { m, g } = setup();
  m.world.boxes = [];
  try {
    let seq = 0;
    for (let i = 0; i < 15; i++) {
      m.input("p0", packet(++seq, [], { keys: 8 }));
      m.step(dt);
    }
    assert.equal(g.player.vx, MOVEMENT.runSpeed);
    m.input("p0", packet(++seq, [{ id: 1, type: "slide" }], { keys: 8 }));
    assert.equal(g.player.vx, 13);
    m.input("p0", packet(++seq, [{ id: 2, type: "jump" }], { keys: 16 }));
    assert.equal(g.player.vy, 9.7);
    let apex = 0;
    for (let i = 0; i < 180; i++) {
      m.input("p0", packet(++seq, [{ id: 2, type: "jump" }], { keys: 16 }));
      m.step(dt);
      apex = Math.max(apex, g.player.y);
    }
    assert.ok(apex > 1.56 && apex < 1.58);
    assert.equal(g.player.grounded, true);
    assert.equal(g.player.jumps, 0);
    assert.equal(g.lastAction, 2);
  } finally {
    m.dispose();
  }
});

test("a no-input running slide coasts nine metres instead of stopping at 800ms", () =>
  flat((g) => {
    g.player.vx = MOVEMENT.runSpeed;
    g.slide();
    for (let i = 0; i < 24; i++) g.updatePlayer(dt);
    assert.ok(g.slideTime > 0.59);
    assert.ok(g.player.vx > 10.2 && g.player.vx < 10.3);
    for (let i = 0; i < 72; i++) g.updatePlayer(dt);
    assert.ok(g.slideTime > 0.69);
    assert.ok(g.player.vx > 4.2);
    for (let i = 0; i < 96; i++) g.updatePlayer(dt);
    assert.equal(g.slideTime, 0);
    assert.equal(g.player.vx, 0);
    assert.ok(g.player.x > 9 && g.player.x < 9.2);
  }));
test("jump cancels a coasting slide halfway through without stopping its horizontal momentum", () =>
  flat((g) => {
    g.player.vx = MOVEMENT.runSpeed;
    g.slide();
    for (let i = 0; i < 36; i++) g.updatePlayer(dt);
    assert.ok(g.slideTime > 0);
    const speed = g.player.vx;
    g.jump();
    assert.equal(g.slideTime, 0);
    assert.equal(g.slideBuffer, 0);
    assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
    for (let i = 0; i < 12; i++) g.updatePlayer(dt);
    assert.equal(g.player.vx, speed);
    assert.ok(g.player.y > 0);
  }));
test("counter-steering exits a slide quickly and returns control to ordinary movement", () =>
  flat((g) => {
    g.player.vx = MOVEMENT.runSpeed;
    g.slide();
    g.keys.add("KeyA");
    for (let i = 0; i < 30; i++) g.updatePlayer(dt);
    assert.equal(g.slideTime, 0);
    assert.ok(g.player.vx < 0);
    assert.ok(Math.abs(g.player.vz) < 1e-8);
  }));
test("slide steering cannot create free uphill momentum below cruise speed", () => {
  const p = { vx: 3, vz: 0, groundSlope: { x: 0.5, z: 0 } };
  steerSlide(p, { x: 1, z: 0 }, dt);
  assert.ok(p.vx < 3 && p.vx > 0);
});

test("authority lets a no-input slide coast and a later jump cancels it exactly once", () => {
  const { m, g } = setup();
  m.world.boxes = [];
  try {
    g.player.vx = MOVEMENT.runSpeed;
    m.input("p0", packet(1, [{ id: 1, type: "slide" }], { keys: 0 }));
    const start = g.player.x;
    for (let i = 0; i < 30; i++) m.step(dt);
    assert.ok(g.slideTime > 0.54);
    assert.ok(g.player.x - start > 1.7);
    assert.ok(g.player.vx > 5.6);
    const speed = g.player.vx;
    m.input("p0", packet(2, [{ id: 2, type: "jump" }], { keys: 0 }));
    assert.equal(g.slideTime, 0);
    assert.equal(g.player.vy, MOVEMENT.jumpSpeed);
    m.step(dt);
    assert.equal(g.player.vx, speed);
    assert.equal(g.lastAction, 2);
  } finally {
    m.dispose();
  }
});

test("standing with no WASD slides in the look direction without NaN velocity", () =>
  flat((g) => {
    g.yaw = 0.73;
    g.slide();
    assert.equal(g.slideTime, 1.5);
    assert.ok(Math.abs(g.player.vx + Math.sin(g.yaw) * 10.4) < 1e-8);
    assert.ok(Math.abs(g.player.vz + Math.cos(g.yaw) * 10.4) < 1e-8);
  }));
test("pressing both slide bindings cannot refresh the timer or stack speed", () =>
  flat((g) => {
    g.keys.add("KeyD");
    g.slide();
    g.updatePlayer(dt);
    const remaining = g.slideTime,
      speed = g.player.vx;
    for (let i = 0; i < 100; i++) g.slide();
    assert.equal(g.slideTime, remaining);
    assert.equal(g.player.vx, speed);
  }));
test("jump-cancel can buffer an immediate new slide on landing without a cooldown", () =>
  flat((g) => {
    g.keys.add("KeyD");
    g.slide();
    g.jump();
    assert.equal(g.slideTime, 0);
    assert.equal(g.slideCooldown, 0);
    while (g.player.vy >= 0 || g.player.y > 0.12) g.updatePlayer(dt);
    g.slide();
    assert.ok(g.slideBuffer > 0);
    for (let i = 0; i < 8; i++) g.updatePlayer(dt);
    assert.ok(g.player.grounded);
    assert.ok(g.slideTime > 1.4);
    assert.ok(g.player.vx <= MOVEMENT.slideMaxSpeed);
  }));
test("a slide requested too early in the air expires rather than starting much later", () =>
  flat((g) => {
    Object.assign(g.player, { y: 3, grounded: false, vy: 0, jumps: 1 });
    g.slide();
    for (let i = 0; i < 120; i++) g.updatePlayer(dt);
    assert.equal(g.slideTime, 0);
    assert.equal(g.slideBuffer, 0);
  }));
test("authority starts a standing slide on the action edge and ignores repeated action copies", () => {
  const { m, g } = setup();
  m.world.boxes = [];
  try {
    Object.assign(g.player, { vx: 0, vz: 0, grounded: true });
    m.input("p0", packet(1, [{ id: 1, type: "slide" }], { keys: 8 }));
    assert.equal(g.slideTime, 1.5);
    assert.equal(g.player.vx, 10.4);
    m.step(dt);
    const remaining = g.slideTime,
      speed = g.player.vx;
    m.input("p0", packet(2, [{ id: 1, type: "slide" }], { keys: 8 }));
    assert.equal(g.slideTime, remaining);
    assert.equal(g.player.vx, speed);
  } finally {
    m.dispose();
  }
});
