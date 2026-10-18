import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  brickPlacement,
  alignBrickModel,
  createBrickModel,
  animateBrick,
} from "../src/gloves/brick.js";
import { useGloveAbility } from "../src/gloves/combat.js";
const floor = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, minY: 0, maxY: 3.4 };
const actor = (y = 0) => ({
  x: 0,
  y,
  z: 0,
  yaw: 0,
  grounded: true,
  alive: true,
  id: "p",
  vx: 0,
  vy: 0,
  vz: 0,
});
function dispose(root) {
  const gs = new Set(),
    ms = new Set();
  root.traverse((o) => {
    if (o.geometry) gs.add(o.geometry);
    if (o.material) ms.add(o.material);
  });
  for (const g of gs) g.dispose();
  for (const m of ms) m.dispose();
}
test("Brick rests on flat/elevated and rotated-ramp support, not the caster height in mid-air", () => {
  assert.equal(brickPlacement(actor(), 0, []).y, 0);
  assert.equal(brickPlacement(actor(3.4), 0, [floor]).y, 3.4);
  const ramp = {
    minX: -2,
    maxX: 2,
    minZ: -3,
    maxZ: 3,
    minY: 0,
    maxY: 3,
    ramp: { axis: "z", direction: 1, rise: 3 },
  };
  const p = brickPlacement(actor(1.5), 0, [ramp]);
  assert.ok(Math.abs(p.y - 1.95) < 1e-9);
  const rotated = { ...ramp, angle: 0.6, cx: 0, cz: 0, halfX: 2, halfZ: 3 };
  const q = brickPlacement(actor(1.5), 0, [rotated]);
  assert.ok(q.y > 1.5);
  assert.ok(q.y < 2);
  const mesh = createBrickModel();
  alignBrickModel(mesh, [ramp], p);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 1, -0.5).normalize()) < 1e-9);
  dispose(mesh);
});
test("unsupported ledges, overhangs, solid obstacles and nonfinite placement are rejected", () => {
  assert.equal(brickPlacement(actor(3.4), 0, []), null);
  assert.equal(brickPlacement(actor(3.4), 0, [{ ...floor, maxZ: 1 }]), null);
  assert.equal(
    brickPlacement(actor(), 0, [
      { minX: -1, maxX: 1, minZ: 0.3, maxZ: 1.5, minY: 0, maxY: 2 },
    ]),
    null,
  );
  assert.equal(brickPlacement(actor(), NaN, []), null);
  assert.equal(
    brickPlacement(actor(), 0, [
      { minX: 0.31, maxX: 1, minZ: 0.5, maxZ: 1.3, minY: 0, maxY: 2 },
    ]),
    null,
  );
});
test("real Brick ability uses sampled support and a failed ledge placement spends no cooldown or trap", () => {
  const p = actor(3.4),
    g = {
      headless: true,
      world: { boxes: [floor] },
      player: p,
      loadout: ["glove_brick"],
      clock: 1,
      yaw: 0,
      state: "playing",
      events: { update() {} },
      emitGlove() {},
    };
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.gloveBricks[0].y, 3.4);
  assert.equal(p.abilityCooldown, 5);
  p.abilityCooldown = 0;
  g.world.boxes = [];
  assert.equal(useGloveAbility(g), false);
  assert.equal(p.abilityCooldown, 0);
  assert.equal(g.gloveBricks.length, 1);
});
test("Brick keeps its full studded silhouette and fixed physical size while its readable signal arms/expires", () => {
  const mesh = createBrickModel();
  assert.equal(mesh.children.filter((o) => o.isMesh).length, 3);
  const size = new THREE.Box3()
    .setFromObject(mesh, true)
    .getSize(new THREE.Vector3());
  assert.ok(size.x > 0.69);
  assert.ok(size.y > 0.19);
  assert.ok(size.z > 0.37);
  animateBrick(mesh, 18, 0);
  assert.equal(mesh.userData.armed, false);
  const arming = mesh.userData.brickRig.signal.color.getHex();
  animateBrick(mesh, 17.5, 0.5);
  assert.equal(mesh.userData.armed, true);
  assert.notEqual(mesh.userData.brickRig.signal.color.getHex(), arming);
  animateBrick(mesh, 0.5, 8.5);
  assert.equal(mesh.scale.x, 1);
  assert.equal(mesh.scale.y, 1);
  dispose(mesh);
});
