import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CombatFX, FX_LIMITS } from "../src/combat-fx.js";
import { mechanismPose, WeaponAnimator } from "../src/animation.js";
import { createViewModel } from "../src/world.js";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

test("shot mechanisms have separate bounded bolt and delayed pump cycles", () => {
  assert.deepEqual(mechanismPose(0), { bolt: 0, pump: 0 });
  assert.equal(mechanismPose(0.018).bolt, 0.045);
  assert.equal(mechanismPose(0.145).pump, 0.075);
  assert.equal(mechanismPose(0.03).pump, 0);
  assert.equal(mechanismPose(0.1).bolt, 0);
  for (let i = 0; i < 1000; i++) {
    const p = mechanismPose(i / 1000);
    assert.ok(p.bolt >= 0 && p.bolt <= 0.045);
    assert.ok(p.pump >= 0 && p.pump <= 0.075);
  }
  for (const age of [undefined, Infinity, NaN, -1, 1e9])
    assert.deepEqual(mechanismPose(age), { bolt: 0, pump: 0 });
});
test("bolt motion follows each shot age, rather than accumulated weapon recoil", () => {
  const m = createViewModel("rifle", WEAPONS.rifle),
    a = new WeaponAnimator(),
    b = m.userData.bolt,
    rest = b.position.clone();
  for (let n = 0; n < 60; n++) {
    a.update(m, { dt: 1 / 120, shotAge: 0.018, kick: 0.13 });
    assert.ok(Math.abs(b.position.z - rest.z - 0.045) < 1e-9);
    a.update(m, { dt: 1 / 120, shotAge: 0.09, kick: 0.13 });
    assert.ok(b.position.distanceTo(rest) < 1e-9);
  }
  Game.prototype.disposeVisual.call({}, m);
});
test("shotgun support hand and pump move together only during the pump cycle", () => {
  const m = createViewModel("shotgun", WEAPONS.shotgun),
    a = new WeaponAnimator(),
    p = m.userData.pump,
    h = m.userData.hands[1];
  for (const age of [0, 0.03, 0.145, 0.31, 10]) {
    a.update(m, { dt: 1 / 120, shotAge: age });
    assert.ok(
      Math.abs(
        p.position.z - p.userData.restPosition.z - mechanismPose(age).pump,
      ) < 1e-9,
    );
    assert.ok(
      Math.abs(
        h.position.z - h.userData.restPosition.z - mechanismPose(age).pump,
      ) < 1e-9,
    );
  }
  Game.prototype.disposeVisual.call({}, m);
});
test("pistol empty slide stays locked through magazine insertion and releases on the final rack", () => {
  const m = createViewModel("pistol", WEAPONS.pistol),
    a = new WeaponAnimator(),
    p = m.userData.bolt,
    rest = p.position.clone();
  assert.ok(p.children.length > 0, "irons and serrations are slide children");
  a.update(m, { dt: 1 / 60, ammo: 0, shotAge: 10 });
  assert.ok(Math.abs(p.position.z - rest.z - 0.045) < 1e-9);
  a.update(m, { dt: 1 / 60, ammo: 0, reloading: true, reload: 0.5 });
  assert.ok(Math.abs(p.position.z - rest.z - 0.045) < 1e-9);
  const mag = m.userData.magazine;
  assert.ok(mag.position.y < mag.userData.restPosition.y - 0.27);
  a.update(m, { dt: 1 / 60, ammo: 0, reloading: true, reload: 1 });
  assert.ok(p.position.distanceTo(rest) < 1e-9);
  assert.ok(mag.position.distanceTo(mag.userData.restPosition) < 1e-9);
  a.update(m, { dt: 1 / 60, ammo: 12 });
  assert.ok(p.position.distanceTo(rest) < 1e-9);
  Game.prototype.disposeVisual.call({}, m);
});
test("weapon mechanisms give identical sampled poses at different render rates without state mutation", () => {
  const models = [
      createViewModel("rifle", WEAPONS.rifle),
      createViewModel("rifle", WEAPONS.rifle),
    ],
    anims = [new WeaponAnimator(), new WeaponAnimator()];
  for (let j = 0; j < 2; j++) {
    const s = { dt: 1 / (j ? 144 : 60), shotAge: 0.018, ammo: 10 };
    const before = { ...s };
    anims[j].update(models[j], s);
    assert.deepEqual(s, before);
  }
  assert.ok(
    models[0].userData.bolt.position.distanceTo(
      models[1].userData.bolt.position,
    ) < 1e-9,
  );
  models.forEach((m) => Game.prototype.disposeVisual.call({}, m));
});
test("impact emits bounded chips, dust and flecks into one existing particle buffer", () => {
  const s = new THREE.Scene(),
    fx = new CombatFX(s),
    objects = [...s.children];
  fx.impact(v(0, 2, 0), v(0, 0, 1));
  assert.deepEqual(
    fx.particleState.slice(0, 12).map((p) => p.type),
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3],
  );
  assert.equal(s.children.length, 4);
  assert.deepEqual(s.children, objects);
  assert.equal(fx.points.geometry.attributes.shape.count, FX_LIMITS.particles);
  for (let i = 0; i < 12; i++)
    assert.ok(fx.points.geometry.attributes.position.getZ(i) > 0.01);
  fx.dispose();
});
test("debris launches outward from walls, floors, ceilings and non-unit normals", () => {
  const fx = new CombatFX(new THREE.Scene());
  for (const n of [
    v(0, -1),
    v(1),
    v(-1),
    v(0, 1),
    v(1, 2, -3).multiplyScalar(4),
  ]) {
    const before = n.clone();
    fx.clear();
    fx.burst(v(1, 2, 3), 0xffffff, 100, n);
    for (let i = 0; i < 100; i++)
      assert.ok(fx.particleState[i].v.dot(n.clone().normalize()) >= 0.399999);
    assert.ok(n.equals(before));
  }
  fx.dispose();
});
test("dust expands gently and fades, while generic flesh/explosion particles retain round styling", () => {
  const fx = new CombatFX(new THREE.Scene());
  fx.impact(v(0, 2), v(0, 0, 1));
  const attrs = fx.points.geometry.attributes,
    start = attrs.size.getX(6);
  fx.update(0.05);
  assert.ok(attrs.size.getX(6) > start);
  assert.ok(attrs.alpha.getX(6) <= 0.35);
  fx.burst(v(), 0xff0000, 3);
  for (let i = 12; i < 15; i++) {
    assert.equal(attrs.shape.getX(i), 0);
    assert.equal(fx.particleState[i].type, 0);
  }
  fx.update(2);
  assert.equal(fx.active.particles, 0);
  assert.equal(fx.points.geometry.drawRange.count, 0);
  fx.dispose();
});
test("concrete chips bounce against raised support instead of falling through a platform", () => {
  const fx = new CombatFX(new THREE.Scene()),
    box = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 2 };
  fx.impact(v(0, 2.04), v(0, 1));
  fx.particleState[0].v.set(0, -1, 0);
  let landed = false;
  for (let i = 0; i < 30; i++) {
    fx.update(1 / 120, [box]);
    const y = fx.points.geometry.attributes.position.getY(0);
    assert.ok(y >= 2.019);
    if (y < 2.021) landed = true;
  }
  assert.ok(landed);
  fx.dispose();
});
test("impact pool wraps without new GPU resources or stale shape state, and clear resets counters", () => {
  const scene = new THREE.Scene(),
    fx = new CombatFX(scene),
    resources = scene.children.map((o) => [o, o.geometry, o.material]);
  for (let i = 0; i < 300; i++) {
    fx.impact(v(0, 2, -2), v(0, 0, 1));
    fx.update(1 / 120);
  }
  assert.ok(fx.active.particles <= FX_LIMITS.particles);
  assert.equal(fx.decals.count, FX_LIMITS.decals);
  scene.children.forEach((o, i) =>
    assert.deepEqual([o, o.geometry, o.material], resources[i]),
  );
  for (const a of Object.values(fx.points.geometry.attributes))
    assert.ok(a.array.every(Number.isFinite));
  fx.clear();
  assert.deepEqual(fx.active, { particles: 0, traces: 0, casings: 0 });
  assert.equal(fx.decals.count, 0);
  fx.burst(v(), 0xffffff, 1);
  assert.equal(fx.points.geometry.attributes.shape.getX(0), 0);
  fx.dispose();
});
test("zero impact normals use a safe surface direction without invalid decal matrices", () => {
  const fx = new CombatFX(new THREE.Scene()),
    normal = v();
  fx.impact(v(1, 2, 3), normal);
  assert.ok(fx.decals.instanceMatrix.array.every(Number.isFinite));
  assert.equal(normal.length(), 0);
  fx.dispose();
});
test("invalid and nonpositive effects time steps cannot poison GPU buffers", () => {
  const fx = new CombatFX(new THREE.Scene());
  fx.impact(v(0, 1), v(0, 0, 1));
  const time = fx.time;
  for (const dt of [-1, NaN, Infinity, 0]) fx.update(dt);
  assert.equal(fx.time, time);
  for (const a of Object.values(fx.points.geometry.attributes))
    assert.ok(a.array.every(Number.isFinite));
  fx.dispose();
});
