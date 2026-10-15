import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Spring, reloadPose, WeaponAnimator } from "../src/animation.js";
import { ARENA, HALF_COVER } from "../src/arena-layout.js";
import {
  surfaceHeight,
  rampGradient,
  moveBody,
  verticalStep,
  canOccupy,
  NavGrid,
} from "../src/physics.js";
import { MOVEMENT } from "../src/movement.js";
import { Game } from "../src/game.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { WEAPONS } from "../src/data.js";
const ramp = () => ({
  minX: -2,
  maxX: 2,
  minZ: -3.2,
  maxZ: 3.2,
  minY: 0,
  maxY: 4.4,
  ramp: { axis: "z", direction: 1, rise: 4.4 },
});
const body = (z = -3.4) => ({
  x: 0,
  z,
  y: 0,
  vx: 0,
  vz: 8,
  vy: 0,
  radius: 0.38,
  height: 1.9,
  jumps: 0,
  grounded: true,
  alive: true,
});

test("Arena is compact with tall perimeter and mirrored half-cover definitions", () => {
  assert.equal(ARENA.width * ARENA.depth, 1140);
  assert.equal(ARENA.wallHeight, 14);
  assert.ok(
    Math.abs(ARENA.platformZ + ARENA.platformLength / 2 - ARENA.depth / 2) <
      1e-8,
  );
  assert.ok(
    Math.abs(
      ARENA.platformZ -
        ARENA.platformLength / 2 -
        ARENA.rampZ -
        ARENA.rampLength / 2,
    ) < 1e-8,
  );
  assert.ok(HALF_COVER.every((b) => b.h >= 4.2));
  assert.ok(ARENA.width * ARENA.depth < (48 * 64) / 2);
  assert.ok(ARENA.wallHeight < 16.8);
  assert.equal(HALF_COVER.length, 3);
  assert.ok(HALF_COVER.filter((x) => x.angle).length === 2);
});
test("ramp support and gradients are correct in both travel directions", () => {
  const b = ramp();
  assert.equal(surfaceHeight(b, 0, -3.2), 0);
  assert.equal(surfaceHeight(b, 0, 3.2), 4.4);
  assert.equal(surfaceHeight(b, 0, 0), 2.2);
  assert.ok(Math.abs(rampGradient(b).z - 0.6875) < 1e-8);
  b.ramp.direction = -1;
  assert.equal(surfaceHeight(b, 0, -3.2), 4.4);
  assert.equal(surfaceHeight(b, 0, 3.2), 0);
  assert.ok(rampGradient(b).z < 0);
});
test("players traverse a continuous ramp uphill without stairs or grounded flicker", () => {
  const b = ramp(),
    p = body();
  let last = 0;
  for (let i = 0; i < 40; i++) {
    moveBody(p, 0, 0.16, [b]);
    verticalStep(p, 1 / 60, [b]);
    assert.ok(p.y >= last - 1e-6);
    assert.equal(p.grounded, true);
    last = p.y;
  }
  assert.ok(p.y > 4);
  assert.ok(p.z > 2.9);
});
test("downhill adhesion follows a ramp instead of micro-falling every frame", () => {
  const b = ramp(),
    p = body(3.1);
  p.y = surfaceHeight(b, p.x, p.z);
  p.vz = -8;
  for (let i = 0; i < 40; i++) {
    moveBody(p, 0, -0.16, [b]);
    verticalStep(p, 1 / 60, [b]);
    assert.equal(p.grounded, true);
    assert.ok(Math.abs(p.y - surfaceHeight(b, p.x, p.z)) < 1e-6);
  }
  assert.equal(p.y, 0);
});
test("ramps cannot be entered through their tall side faces", () => {
  const b = ramp(),
    p = body(2);
  p.x = 4;
  moveBody(p, -3, 0, [b]);
  assert.ok(p.x > 2.37);
  assert.equal(p.y, 0);
  assert.equal(canOccupy(p, 0, 0, 2, [b]), false);
});
test("a raised ceiling still blocks stepping onto a ramp", () => {
  const b = ramp(),
    p = body(-3.1),
    ceiling = { minX: -2, maxX: 2, minZ: -3.2, maxZ: 3.2, minY: 2, maxY: 2.2 };
  moveBody(p, 0, 1, [b, ceiling]);
  assert.ok(p.z < -2.6);
  assert.ok(p.y < 0.2);
});
test("jumping uphill launches from the ramp tangent without consuming an extra jump", () => {
  const g = Object.create(Game.prototype),
    p = body();
  p.groundSlope = { x: 0, z: 0.6875 };
  p.vz = 17;
  Object.assign(g, {
    player: p,
    loadout: ["rifle"],
    slot: 0,
    coyoteTime: 0,
    slideTime: 0.3,
    audio: { play() {} },
  });
  assert.equal(g.tryJump(), true);
  assert.ok(p.vy > MOVEMENT.jumpSpeed + 4);
  assert.equal(p.jumps, 1);
  assert.equal(g.slideTime, 0);
  assert.ok(p.vz > 17);
});
test("navigation approaches a ramp from its low end rather than phasing through a high side", () => {
  const b = ramp(),
    nav = new NavGrid([b], 16, 0.4, 16),
    path = nav.path({ x: 5, z: 1.6 }, { x: 0, z: 1.6 });
  assert.ok(path.length > 0);
  const entry = path.find(
    (p) => p.x < 2 && p.x > -2 && p.z > -3.2 && p.z < 3.2,
  );
  assert.ok(entry.y <= 0.45);
  assert.ok(entry.z < -2);
});
test("spring transitions are identical at 30, 60 and 144 render FPS", () => {
  const result = [30, 60, 144].map((fps) => {
    const s = new Spring();
    for (let i = 0; i < fps; i++) s.step(1, 1 / fps, 18);
    return s.value;
  });
  assert.ok(Math.max(...result) - Math.min(...result) < 1e-10);
  assert.ok(result[0] > 0.999);
});
test("spring transitions do not overshoot on a slow render frame", () => {
  const s = new Spring();
  for (const dt of [0.1, 0.2, 0.05, 0.016, 0.1]) {
    s.step(1, dt);
    assert.ok(s.value >= 0 && s.value <= 1);
  }
  s.step(0, 0.2);
  assert.ok(s.value >= 0 && s.value <= 1);
});
test("reload animation has extraction, insertion and a neutral final pose", () => {
  assert.deepEqual(reloadPose(0), { lower: 0, extract: 0, rack: 0 });
  assert.ok(reloadPose(0.5).extract > 0.99);
  assert.equal(reloadPose(1).extract, 0);
  assert.equal(reloadPose(1).lower, 0);
});
test("magazine and bolt animation do not drift after repeated reloads", () => {
  const model = createViewModel("rifle", WEAPONS.rifle),
    anim = new WeaponAnimator(),
    mag = model.userData.magazine,
    bolt = model.userData.bolt;
  assert.ok(mag && bolt);
  const rest = mag.position.clone(),
    boltRest = bolt.position.clone();
  for (let cycle = 0; cycle < 30; cycle++) {
    for (let i = 0; i < 60; i++)
      anim.update(model, { dt: 1 / 60, reloading: true, reload: i / 59 });
    anim.update(model, { dt: 1 / 60, reloading: false });
  }
  assert.ok(mag.position.distanceTo(rest) < 1e-10);
  assert.ok(bolt.position.distanceTo(boltRest) < 1e-10);
  anim.update(model, { dt: 1 / 60, reloading: true, reload: 0.5 });
  assert.ok(mag.position.y < rest.y - 0.27);
});
test("weapon geometry batching retains movable parts with fewer than 25 meshes", () => {
  const g = createViewModel("rifle", WEAPONS.rifle);
  let meshes = 0;
  g.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  assert.ok(meshes < 25);
  assert.ok(g.getObjectById(g.userData.magazine.id));
  assert.ok(g.getObjectById(g.userData.bolt.id));
});
test("camera/weapon animation never rewrites mouse aim or player position", () => {
  const g = Object.create(Game.prototype),
    p = body();
  p.x = 2;
  p.y = 3;
  p.z = 4;
  Object.assign(g, {
    player: p,
    settings: { shake: true, fov: 95 },
    camera: new THREE.PerspectiveCamera(95, 1.6, 0.08, 180),
    viewModel: createViewModel("rifle", WEAPONS.rifle),
    loadout: ["rifle"],
    slot: 0,
    pitch: 0.2,
    yaw: 0.4,
    walkPhase: 1,
    stepOffset: 0,
    landingDip: 0,
    slideTime: 0,
    kick: 0.1,
    clock: 0,
    reloadTime: 0,
    lookSway: { x: 0.018, y: 0.01 },
  });
  for (let i = 0; i < 100; i++) {
    g.clock += 1 / 60;
    g.aiming = i > 50;
    g.updateCamera(1 / 60);
  }
  assert.equal(g.pitch, 0.2);
  assert.equal(g.yaw, 0.4);
  assert.deepEqual([p.x, p.y, p.z], [2, 3, 4]);
  assert.ok(g.camera.projectionMatrix.elements.every(Number.isFinite));
});
test("Bow keeps its limbs, nocked arrow and anchored string through a full draw", () => {
  const m = createViewModel("bow", WEAPONS.bow),
    a = new WeaponAnimator();
  assert.ok(m.userData.limbs);
  assert.ok(m.getObjectById(m.userData.limbs.id));
  assert.ok(m.userData.arrow);
  a.update(m, { dt: 1 / 60, draw: 1.2 });
  const p = m.userData.string.geometry.attributes.position;
  assert.ok(Math.abs(p.getZ(0) + 0.86) < 1e-6);
  assert.ok(p.getZ(1) > -0.42);
  assert.ok(m.userData.arrow.position.z > 0.19);
  a.update(m, { dt: 1 / 60, reloading: true, reload: 0.5 });
  assert.equal(m.userData.arrow.visible, false);
});
test("bot limbs rotate at hip and shoulder joints rather than their centre", () => {
  const { parts } = createCharacter(1);
  assert.equal(parts.leftLeg.type, "Group");
  assert.equal(parts.leftLeg.position.y, 0.73);
  assert.ok(
    Math.abs(parts.leftArm.position.y + parts.upperBody.position.y - 1.37) <
      1e-10,
  );
  assert.ok(parts.leftLeg.children.length >= 2);
});

test("Scythe dash preserves upward jump momentum instead of flattening the jump", () => {
  const g = Object.create(Game.prototype),
    p = body();
  p.vy = 12;
  p.grounded = false;
  Object.assign(g, {
    player: p,
    dashCooldown: 0,
    yaw: 0,
    slideTime: 0,
    keys: new Set(),
    audio: { play() {} },
  });
  assert.equal(g.dash(), true);
  assert.equal(p.vy, 12);
  assert.equal(Math.hypot(p.vx, p.vz), 28);
});

test("blade trails follow the cut and disappear on recovery; fists use a straight jab", () => {
  const katana = createViewModel("katana", WEAPONS.katana),
    a = new WeaponAnimator();
  a.update(katana, { dt: 1 / 60, swing: 0.14 });
  assert.equal(katana.userData.slashTrail.visible, true);
  assert.ok(katana.userData.slashTrail.material.opacity > 0);
  a.update(katana, { dt: 1 / 60, swing: 0 });
  assert.equal(katana.userData.slashTrail.visible, false);
  const fists = createViewModel("fists", WEAPONS.fists),
    b = new WeaponAnimator();
  b.update(fists, { dt: 1 / 60, swing: 0.14 });
  assert.ok(fists.position.z + fists.userData.hands[0].position.z < -0.7);
  assert.ok(Math.abs(fists.rotation.z) < 0.01);
});
test("equip starts below the frame and recovers without drifting weapon parts", () => {
  const m = createViewModel("rifle", WEAPONS.rifle),
    a = new WeaponAnimator();
  a.equip();
  assert.ok(a.y.value < -0.4);
  for (let i = 0; i < 180; i++)
    a.update(m, {
      dt: 1 / 60,
      swap: Math.max(0, 0.22 - i / 60),
      reloading: i < 60,
      reload: i / 60,
      shotAge: 10,
    });
  assert.ok(Math.abs(m.position.y + 0.1) < 1e-6);
  const h = m.userData.hands[1];
  assert.ok(h.position.distanceTo(h.userData.restPosition) < 1e-10);
  assert.ok(Math.abs(h.rotation.x) < 1e-10);
  assert.equal(h.userData.sleeve.rotation.x, 0);
});
test("bot death collapse is eased over time and respects the platform height", () => {
  const g = Object.create(Game.prototype),
    e = { y: 4.4, deathRoll: 0, model: { group: new THREE.Group() } };
  g.animateDeath(e, 0.1);
  assert.ok(e.model.group.rotation.z > 0 && e.model.group.rotation.z < 1.45);
  g.animateDeath(e, 0.2);
  assert.equal(e.model.group.rotation.z, 1.45);
  assert.ok(Math.abs(e.model.group.position.y - 4.6) < 1e-10);
});

const steepRamp = () => ({
  ...ramp(),
  maxY: 6.2,
  ramp: { axis: "z", direction: 1, rise: 6.2 },
});
const summit = () => ({
  minX: -2,
  maxX: 2,
  minZ: 3.2,
  maxZ: 4.8,
  minY: 0,
  maxY: 6.2,
  walkable: true,
});
test("steep ramp summit joins remain grounded when the capsule clears the platform lip", () => {
  const boxes = [steepRamp(), summit()],
    p = body(4);
  p.y = 6.2;
  p.vz = -8;
  for (let i = 0; i < 58; i++) {
    moveBody(p, 0, -0.14, boxes);
    verticalStep(p, 1 / 60, boxes);
    assert.equal(p.grounded, true);
  }
  assert.equal(p.y, 0);
});
test("navigation can reach a marked summit through the ramp without climbing a tall side", () => {
  const boxes = [steepRamp(), summit()],
    nav = new NavGrid(boxes, 16, 0.4, 20);
  const path = nav.path({ x: 5, z: 1.6 }, { x: 0, z: 4 });
  assert.ok(path.length > 10);
  assert.ok(Math.abs(path.at(-1).y - 6.2) < 1e-5);
  const entry = path.find((p) => Math.abs(p.x) < 2 && p.z > -3.2 && p.z < 3.2);
  assert.ok(entry.y <= 0.4);
  assert.ok(entry.z < -2.7);
});
test("an overhead solid blocks the marked summit and airborne actors never snap to a steep slope", () => {
  const b = steepRamp(),
    pad = summit(),
    ceiling = { ...pad, minY: 7, maxY: 8, walkable: false };
  const nav = new NavGrid([b, pad, ceiling], 16, 0.4, 20);
  assert.equal(nav.blocked[nav.index(0, 4)], 1);
  const p = body(3);
  p.y = 6.2;
  p.grounded = false;
  p.vy = 5;
  moveBody(p, 0, -0.14, [b, pad]);
  assert.equal(p.y, 6.2);
  verticalStep(p, 1 / 60, [b, pad]);
  assert.ok(p.y > 6.2);
  assert.equal(p.grounded, false);
});

test("Arena lobby camera stays inside the high walls without changing gameplay FOV settings", () => {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
      last: 0,
      state: "lobby",
      frameCount: 0,
      fpsTime: 0,
      settings: { fov: 95 },
      world: { mapId: "blockout" },
      camera: new THREE.PerspectiveCamera(95, 1.6, 0.08, 180),
      events: { fps() {} },
      renderer: {},
      renderWorld() {},
    });
    for (const t of [0, 10000, 100000, 500000]) {
      g.frame(t);
      assert.ok(Math.abs(g.camera.position.x) < ARENA.width / 2);
      assert.ok(Math.abs(g.camera.position.z) < ARENA.depth / 2);
      assert.ok(g.camera.position.y > Math.max(...HALF_COVER.map((b) => b.h)));
      assert.ok(g.camera.position.y < ARENA.wallHeight);
      assert.ok(g.camera.getWorldDirection(new THREE.Vector3()).y < -0.5);
    }
    assert.equal(g.settings.fov, 95);
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});
