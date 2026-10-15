import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CombatFX, FX_LIMITS } from "../src/combat-fx.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { WEAPONS } from "../src/data.js";
import { Game } from "../src/game.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

test("every loadout item has a complete finite detailed model, including a nonempty fists showroom", () => {
  for (const [id, w] of Object.entries(WEAPONS))
    for (const hands of [true, false]) {
      const model = createViewModel(id, w, { hands });
      assert.equal(model.userData.detailed, true, id);
      assert.equal(model.userData.weaponId, id);
      let vertices = 0;
      model.traverse((o) => {
        if (o.isMesh) {
          vertices += o.geometry.attributes.position.count;
          assert.ok(
            [...o.geometry.attributes.position.array].every(Number.isFinite),
            id,
          );
        }
      });
      assert.ok(vertices > 100, id);
      const bounds = new THREE.Box3().setFromObject(model),
        size = bounds.getSize(v());
      assert.ok(size.length() > 0 && size.toArray().every(Number.isFinite), id);
    }
});
test("hit debris, tracers, decals and casings use bounded persistent GPU buffers", () => {
  const scene = new THREE.Scene(),
    fx = new CombatFX(scene),
    objects = [...scene.children],
    geometries = objects.map((o) => o.geometry),
    materials = objects.map((o) => o.material);
  for (let i = 0; i < 600; i++) {
    fx.burst(v(0, 2, 0), 0xffcc88, 10);
    fx.trace(v(0, 1, 0), v(0, 1, -20), 0);
    fx.impact(v(0, 1, -5), v(0, 0, 1));
    fx.eject(v(0, 2, 0), v(1), v(0, 0, -1));
    fx.update(1 / 60, []);
  }
  assert.equal(scene.children.length, 4);
  assert.equal(fx.decals.count, FX_LIMITS.decals);
  assert.ok(fx.active.particles <= FX_LIMITS.particles);
  assert.ok(fx.active.traces <= FX_LIMITS.traces);
  assert.ok(fx.active.casings <= FX_LIMITS.casings);
  scene.children.forEach((o, i) => {
    assert.equal(o.geometry, geometries[i]);
    assert.equal(o.material, materials[i]);
    assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));
  });
  assert.ok([...fx.casings.instanceMatrix.array].every(Number.isFinite));
  for (let i = 0; i < 360; i++) fx.update(1 / 60, []);
  assert.deepEqual(fx.active, { particles: 0, traces: 0, casings: 0 });
  assert.equal(fx.points.geometry.drawRange.count, 0);
  assert.equal(fx.traces.geometry.drawRange.count, 0);
  fx.clear();
  assert.equal(fx.decals.count, 0);
  fx.dispose();
  assert.equal(scene.children.length, 0);
});
test("impact marks face the surface and sit slightly outside it without changing collision", () => {
  const scene = new THREE.Scene(),
    fx = new CombatFX(scene),
    normal = v(1, 1, 0.3).normalize(),
    point = v(2, 3, 4),
    matrix = new THREE.Matrix4();
  fx.impact(point, normal);
  fx.decals.getMatrixAt(0, matrix);
  assert.ok(v(0, 0, 1).transformDirection(matrix).dot(normal) > 0.999999);
  const origin = v().setFromMatrixPosition(matrix);
  assert.ok(origin.clone().sub(point).dot(normal) > 0.006);
  assert.deepEqual(point.toArray(), [2, 3, 4]);
  fx.dispose();
});
test("shell casings bounce on raised cover, never an imaginary y=0-only floor", () => {
  const fx = new CombatFX(new THREE.Scene()),
    box = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 2 };
  fx.eject(v(0, 3, 0), v(), v());
  let minimum = Infinity;
  for (let i = 0; i < 200; i++) {
    fx.update(1 / 120, [box]);
    minimum = Math.min(minimum, fx.casingState[0].p.y);
  }
  assert.ok(minimum >= 2.0169);
  assert.ok(fx.casingState[0].p.y < 2.2);
  fx.dispose();
});
test("custom tracer colors are respected instead of being replaced by team colors", () => {
  const fx = new CombatFX(new THREE.Scene());
  fx.trace(v(), v(0, 0, -10), 0, 0x0000ff);
  const color = fx.traces.geometry.attributes.color;
  assert.equal(color.getX(0), 0);
  assert.equal(color.getY(0), 0);
  assert.ok(color.getZ(0) > 2);
  fx.dispose();
});
test("head accessories, weapon and two-bone legs follow their actual skeleton pivots", () => {
  const model = createCharacter(1),
    p = model.parts;
  assert.equal(p.visor.parent, p.head);
  assert.equal(p.helmet.parent, p.head);
  assert.equal(p.weaponRig.parent, p.upperBody);
  assert.equal(p.leftKnee.parent, p.leftLeg);
  assert.equal(p.rightKnee.parent, p.rightLeg);
  const g = Object.create(Game.prototype);
  g.clock = 2;
  const e = {
    model,
    x: 0,
    y: 0,
    z: 0,
    vx: 5,
    vz: -4,
    yaw: 0,
    grounded: true,
    animationPhase: 2,
    seed: 0,
    reload: 0,
    lastShotAt: 1.98,
    visible: true,
    targetEntity: { alive: true, x: 0, y: 3, z: -5 },
  };
  for (let i = 0; i < 30; i++) g.animateBot(e, 1 / 60);
  assert.equal(p.muzzleFlash.visible, true);
  assert.ok(p.weaponRig.rotation.x > 0.3);
  assert.equal(model.group.scale.y, 1);
  assert.ok(Math.abs(p.upperBody.rotation.z) > 0.01);
  g.clock = 3;
  g.animateBot(e, 1 / 60);
  assert.equal(p.muzzleFlash.visible, false);
});
test("muzzle projection agrees between the weapon and world camera without moving aim", () => {
  const g = Object.create(Game.prototype);
  g.camera = new THREE.PerspectiveCamera(95, 1.6, 0.08, 180);
  g.weaponCamera = new THREE.PerspectiveCamera(70, 1.6, 0.01, 10);
  g.camera.position.set(3, 2, 4);
  g.camera.rotation.set(0.2, 0.4, 0, "YXZ");
  g.camera.updateMatrixWorld();
  g.weaponCamera.updateMatrixWorld();
  const point = v(0.3, -0.2, -1),
    projected = g.weaponPointToWorld(point).project(g.camera),
    expected = point.clone().project(g.weaponCamera);
  assert.ok(Math.abs(projected.x - expected.x) < 1e-10);
  assert.ok(Math.abs(projected.y - expected.y) < 1e-10);
});

test("static arena batching retains exact ray surfaces while reducing visible fixed meshes", async () => {
  const { batchFixedMeshes } = await import("../src/batching.js"),
    group = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material),
    b = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material);
  group.position.x = 5;
  b.position.x = 2;
  group.add(a, b);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(v(5, 0, 3), v(0, 0, -1));
  const before = ray.intersectObjects([a, b], false)[0];
  const stats = batchFixedMeshes(group, { rayMeshes: [a, b] });
  assert.deepEqual(stats, { before: 2, after: 1, retainedRayMeshes: 2 });
  const after = ray.intersectObjects([a, b], false)[0];
  assert.equal(before.distance, after.distance);
  assert.ok(before.point.distanceTo(after.point) < 1e-10);
  assert.equal(a.parent.visible, false);
  assert.ok(group.children.some((o) => o.name === "static-batch"));
});

test("RPG loses its visible rocket after firing and inserts it from the front during reload", async () => {
  const { WeaponAnimator } = await import("../src/animation.js"),
    model = createViewModel("rpg", WEAPONS.rpg),
    anim = new WeaponAnimator();
  anim.update(model, { dt: 1 / 60, ammo: 0 });
  assert.equal(model.userData.rocket.visible, false);
  anim.update(model, { dt: 1 / 60, ammo: 0, reloading: true, reload: 0.5 });
  assert.equal(model.userData.rocket.visible, true);
  assert.ok(model.userData.rocket.position.z < -0.3);
  anim.update(model, { dt: 1 / 60, ammo: 1 });
  assert.equal(model.userData.rocket.visible, true);
  assert.equal(model.userData.rocket.position.z, 0);
});
