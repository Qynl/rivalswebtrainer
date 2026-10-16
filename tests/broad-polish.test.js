import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CombatFX, FX_LIMITS } from "../src/combat-fx.js";
import { WeaponClearance } from "../src/weapon-clearance.js";
import { WeaponAnimator } from "../src/animation.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { createOperator } from "../src/character-model.js";
import { WEAPONS } from "../src/data.js";
import { HealthTrail, magazineFraction } from "../src/vitals-presentation.js";
import {
  OPERATOR_KITS,
  operatorIdentity,
  callsignTexture,
} from "../src/operator-kit.js";
import { artColor, surfaceFinish } from "../src/graphics.js";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
test("ribbons use one fixed indexed quad per tracer and persistent partner/edge buffers", () => {
  const fx = new CombatFX(new THREE.Scene()),
    geometry = fx.traces.geometry;
  assert.equal(fx.traces.isMesh, true);
  assert.equal(geometry.attributes.position.count, FX_LIMITS.traces * 4);
  assert.equal(geometry.index.count, FX_LIMITS.traces * 6);
  const partner = geometry.attributes.partner.array;
  for (let i = 0; i < 500; i++) {
    fx.trace(v(1, 2, 0), v(2, 3, -30), 0, 0x00ccff);
    fx.update(0.01);
  }
  assert.equal(fx.traces.geometry, geometry);
  assert.equal(geometry.attributes.partner.array, partner);
  assert.ok([...partner].every(Number.isFinite));
  assert.ok(
    [...geometry.index.array].every(
      (i) => i < geometry.attributes.position.count,
    ),
  );
  const p = geometry.attributes.position,
    q = geometry.attributes.partner;
  for (let i = 0; i < FX_LIMITS.traces; i++) {
    assert.equal(p.getX(i * 4), p.getX(i * 4 + 1));
    assert.equal(q.getZ(i * 4), p.getZ(i * 4 + 2));
    assert.equal(q.getZ(i * 4 + 2), p.getZ(i * 4));
  }
  fx.clear();
  assert.equal(geometry.drawRange.count, 0);
  assert.ok([...geometry.attributes.alpha.array].every((x) => x === 0));
  fx.dispose();
});
test("degenerate and invalid visual trails never enter the GPU pool", () => {
  const fx = new CombatFX(new THREE.Scene());
  fx.trace(v(), v());
  fx.trace(v(NaN), v(0, 0, -2));
  fx.trace(v(), v(Infinity));
  assert.equal(fx.cursor.trace, 0);
  assert.equal(fx.traces.geometry.drawRange.count, 0);
  fx.dispose();
});

function wall(x = 0, z = -0.6, width = 4) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 4, 0.1),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.set(x, 1.66, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}
function camera() {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.08, 100);
  camera.position.y = 1.66;
  return camera;
}
test("clearance sees actual geometry, returns to neutral, and preserves camera/mesh transforms", () => {
  const c = camera(),
    mesh = wall(),
    query = new WeaponClearance(),
    meshes = [mesh];
  const position = c.position.clone(),
    rotation = c.rotation.clone(),
    matrix = mesh.matrixWorld.clone();
  assert.ok(query.sample(c, meshes, 0, "rifle") > 0.5);
  assert.ok(c.position.equals(position));
  assert.ok(c.rotation.equals(rotation));
  assert.ok(mesh.matrixWorld.equals(matrix));
  c.position.z = 2;
  assert.equal(query.sample(c, meshes, 0.06, "rifle"), 0);
  c.position.z = 0;
  assert.ok(query.sample(c, meshes, 0.12, "rifle") > 0.5);
  assert.equal(query.sample(c, meshes, 0.13, "rifle", false), 0);
  assert.ok(query.sample(c, meshes, 0.14, "rifle") > 0.5);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
test("clearance respects a real window opening and checks the gun-side edge", () => {
  const c = camera(),
    query = new WeaponClearance(),
    meshes = [wall(-1, -0.6, 1), wall(1, -0.6, 1)];
  assert.equal(query.sample(c, meshes, 0, "rifle"), 0);
  c.position.x = 0.42;
  assert.ok(query.sample(c, meshes, 0.06, "rifle") > 0.5);
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
test("clearance cache resets when the world, weapon or clock changes", () => {
  const c = camera(),
    query = new WeaponClearance(),
    meshes = [wall()];
  assert.ok(query.sample(c, meshes, 1, "rifle") > 0.5);
  assert.equal(query.sample(c, [], 1.01, "rifle"), 0);
  assert.ok(query.sample(c, meshes, 0, "rifle") > 0.5);
  const long = query.amount,
    compact = query.sample(c, meshes, 0.001, "pistol");
  assert.ok(compact < long);
  for (const m of meshes) {
    m.geometry.dispose();
    m.material.dispose();
  }
});
for (const id of ["rifle", "sniper", "pistol", "dualpistols"])
  test(`${id}: wall-ready pose moves the gun only and completely clears ADS`, () => {
    const model = createViewModel(id, WEAPONS[id]),
      animator = new WeaponAnimator();
    const input = {
      dt: 1 / 120,
      speed: 0,
      shake: true,
      shotAge: 10,
      aim: false,
      clearance: 0,
    };
    for (let i = 0; i < 240; i++) animator.update(model, input);
    const neutral = model.position.clone();
    for (let i = 0; i < 240; i++)
      animator.update(model, { ...input, clearance: 1 });
    assert.ok(model.position.y < neutral.y - 0.07);
    assert.ok(model.position.z > neutral.z + 0.1);
    for (let i = 0; i < 480; i++)
      animator.update(model, { ...input, clearance: 1, aim: true });
    const sight = model.userData.adsPoint
      .clone()
      .applyMatrix4((model.updateMatrix(), model.matrix));
    assert.ok(Math.hypot(sight.x, sight.y) < 1e-6);
    for (let i = 0; i < 240; i++)
      animator.update(model, { ...input, clearance: 1, shake: false });
    assert.ok(model.position.distanceTo(neutral) < 1e-6);
  });

test("damage trail holds briefly, eases after damage and resets immediately on heals/rounds", () => {
  const trail = new HealthTrail();
  assert.equal(trail.sample(150, 150, 0), 150);
  assert.equal(trail.sample(90, 150, 0.1), 150);
  assert.equal(trail.sample(90, 150, 0.31), 150);
  assert.ok(trail.sample(90, 150, 0.6) > 90);
  assert.ok(trail.value < 100);
  assert.equal(trail.sample(120, 150, 0.7), 120);
  assert.equal(trail.sample(75, 150, 0.8, true), 75);
  assert.equal(trail.sample(40, 150, 0), 40);
  assert.ok(Number.isFinite(trail.sample(NaN, 0, NaN)));
});
test("damage chip catch-up is independent of update frequency", () => {
  const run = (hz) => {
    const trail = new HealthTrail();
    trail.sample(150, 150, 0);
    trail.sample(50, 150, 0.1);
    for (let i = 1; i <= hz; i++) trail.sample(50, 150, 0.1 + i / hz);
    return trail.value;
  };
  assert.ok(Math.abs(run(30) - run(144)) < 1e-9);
});
test("magazine meter handles empty, infinite, utility and invalid capacities", () => {
  assert.equal(magazineFraction(15, 30, 0), 0.5);
  assert.equal(magazineFraction(0, 30, 1), 0);
  assert.equal(magazineFraction(99, 30, 0), 1);
  assert.equal(magazineFraction(Infinity, Infinity, 0), null);
  assert.equal(magazineFraction(1, 1, 3), null);
  assert.equal(magazineFraction(NaN, 30, 0), null);
});

test("three operator kits and callsigns are deterministic cosmetic identity, with unchanged team panels", () => {
  const names = Array.from({ length: 30 }, (_, i) => `RIVAL-${i}`);
  assert.equal(
    new Set(names.map((name) => operatorIdentity(name).kit.name)).size,
    OPERATOR_KITS.length,
  );
  for (const name of names.slice(0, 6)) {
    assert.deepEqual(operatorIdentity(name), operatorIdentity(name));
    const a = createOperator(0, name),
      b = createOperator(1, name);
    assert.equal(a.group.userData.kitStyle, b.group.userData.kitStyle);
    assert.equal(a.group.userData.callsign, b.group.userData.callsign);
    assert.notDeepEqual(
      a.parts.callsignMaterial.map.image.data,
      b.parts.callsignMaterial.map.image.data,
    );
    assert.equal(a.parts.callsignMaterial.map.image.width, 64);
    for (const key of ["head", "weaponRig", "leftElbow", "rightKnee"])
      assert.ok(a.parts[key]);
  }
  const a = callsignTexture("11", 0),
    b = callsignTexture("88", 0);
  assert.notDeepEqual(a.image.data, b.image.data);
  a.dispose();
  b.dispose();
});
test("legacy industrial colors are neutralized and actual wood/metal/stone finishes differ", () => {
  for (const hex of [0x625d78, 0x6b6583, 0x655e7b, 0xa79cbc, 0x90819c]) {
    const c = artColor(hex);
    assert.ok((c & 255) - ((c >> 16) & 255) < 40);
    assert.equal(surfaceFinish(hex).texture, "metal");
  }
  assert.equal(surfaceFinish(0xc68d75).texture, "wood");
  assert.equal(surfaceFinish(0xd8dbdd).texture, "concrete");
  assert.ok(
    surfaceFinish(0x6b6583).metalness > surfaceFinish(0xd8dbdd).metalness,
  );
});
