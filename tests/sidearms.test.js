import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WEAPONS, weaponIcon } from "../src/data.js";
import { createViewModel } from "../src/world.js";
import { Game } from "../src/game.js";
import {
  WeaponAnimator,
  selectShotSide,
  mechanismPose,
} from "../src/animation.js";
import { cleanLoadout, PROTOCOL } from "../src/net/protocol.js";
const ids = ["revolver", "burstpistol", "dualpistols"];
for (const id of ids)
  test(`${id} is a real secondary with authored model, readable aim, bounded meshes and online loadout support`, () => {
    const w = WEAPONS[id],
      m = createViewModel(id, w);
    assert.equal(w.slot, 1);
    assert.ok(w.damage > 0 && w.mag > 0 && w.reload > 0);
    assert.ok(cleanLoadout(["rifle", id, "knife", "grenade"]));
    assert.equal(cleanLoadout([id, "pistol", "knife", "grenade"]), null);
    assert.equal(m.userData.secondaryRevision, "sidearms-v1");
    assert.ok(m.userData.adsPoint);
    m.updateMatrixWorld(true);
    assert.ok(
      m.userData.muzzleFlash.getWorldPosition(new THREE.Vector3()).z < -0.85,
    );
    assert.notEqual(weaponIcon(id), weaponIcon("rifle"));
    let count = 0;
    m.traverse((o) => {
      if (o.isMesh) {
        count++;
        assert.ok(
          [...o.geometry.attributes.position.array].every(Number.isFinite),
        );
      }
    });
    assert.ok(count < 45, `${id}: ${count}`);
    m.scale.setScalar(0.78);
    const a = new WeaponAnimator();
    for (let i = 0; i < 120; i++)
      a.update(m, { dt: 1 / 60, aim: true, ammo: w.mag, shotAge: 10 });
    m.updateMatrixWorld(true);
    const p = m.localToWorld(m.userData.adsPoint.clone());
    assert.ok(Math.hypot(p.x, p.y) < 0.001);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
    );
    for (const h of m.userData.hands || [])
      assert.equal(
        ray.intersectObject(h, true).length,
        0,
        "hands must not cover aim",
      );
    Game.prototype.disposeVisual.call({}, m);
  });
test("new roster appends IDs without changing old binary weapon indices", () => {
  const keys = Object.keys(WEAPONS);
  assert.equal(keys.indexOf("pistol"), 11);
  assert.equal(keys.indexOf("medkit"), 22);
  assert.deepEqual(keys.slice(-3), ids);
  assert.equal(PROTOCOL, 2);
});
test("dual shots alternate flash, slide and actual muzzle; the idle slide remains still", () => {
  const m = createViewModel("dualpistols", WEAPONS.dualpistols),
    a = new WeaponAnimator();
  for (const sequence of [1, 2, 3, 4]) {
    selectShotSide(m, sequence);
    const side = (sequence - 1) % 2;
    assert.equal(m.userData.muzzleFlash, m.userData.muzzleFlashes[side]);
    assert.equal(m.userData.muzzleFlash.parent, m.userData.dualGuns[side]);
    assert.equal(
      Math.sign(m.userData.muzzleFlash.getWorldPosition(new THREE.Vector3()).x),
      side === 0 ? 1 : -1,
    );
    a.update(m, {
      dt: 1 / 120,
      shotSequence: sequence,
      shotAge: 0.018,
      flash: true,
      ammo: 20,
    });
    assert.equal(m.userData.muzzleFlashes.filter((f) => f.visible).length, 1);
    for (let i = 0; i < 2; i++) {
      const b = m.userData.bolts[i];
      assert.ok(
        Math.abs(
          b.position.z -
            b.userData.restPosition.z -
            (i === side ? mechanismPose(0.018).bolt : 0),
        ) < 1e-9,
      );
      assert.equal(m.userData.dualGuns[i].parent, m);
    }
  }
  a.update(m, { dt: 1 / 60, shotSequence: 4, shotAge: 1, ammo: 20 });
  assert.equal(m.userData.muzzleFlashes.filter((f) => f.visible).length, 0);
  Game.prototype.disposeVisual.call({}, m);
});
test("dual magazines extract together and both guns recover without geometry allocation", () => {
  const m = createViewModel("dualpistols", WEAPONS.dualpistols),
    a = new WeaponAnimator(),
    geos = [];
  m.traverse((o) => {
    if (o.geometry) geos.push(o.geometry);
  });
  a.update(m, { dt: 1 / 60, reloading: true, reload: 0.45, ammo: 0 });
  for (const p of m.userData.magazines)
    assert.ok(p.position.y < p.userData.restPosition.y - 0.25);
  a.update(m, { dt: 1 / 60, reloading: true, reload: 1, ammo: 24 });
  for (const p of m.userData.magazines)
    assert.ok(p.position.distanceTo(p.userData.restPosition) < 1e-9);
  let j = 0;
  m.traverse((o) => {
    if (o.geometry) assert.equal(o.geometry, geos[j++]);
  });
  Game.prototype.disposeVisual.call({}, m);
});
test("revolver indexes cylinder by one chamber, swings it out for reload and returns", () => {
  const m = createViewModel("revolver", WEAPONS.revolver),
    a = new WeaponAnimator(),
    c = m.userData.revolverCylinder;
  a.update(m, { dt: 1 / 60, shotSequence: 1, shotAge: 0.018, ammo: 5 });
  assert.ok(c.rotation.z > 0 && c.rotation.z < Math.PI / 3);
  a.update(m, { dt: 1 / 60, shotSequence: 1, shotAge: 0.1, ammo: 5 });
  assert.equal(c.rotation.z, Math.PI / 3);
  assert.notEqual(m.userData.hammer.rotation.x, 0);
  a.update(m, {
    dt: 1 / 60,
    shotSequence: 2,
    shotAge: 1,
    ammo: 0,
    reloading: true,
    reload: 0.45,
  });
  assert.ok(c.position.x < c.userData.restPosition.x - 0.1);
  a.update(m, { dt: 1 / 60, shotSequence: 2, shotAge: 1, ammo: 6 });
  assert.equal(c.position.x, c.userData.restPosition.x);
  assert.equal(c.rotation.z, (2 * Math.PI) / 3);
  Game.prototype.disposeVisual.call({}, m);
});

test("burst pistol and both dual slides lock on empty, then release at the reload rack", () => {
  for (const id of ["burstpistol", "dualpistols"]) {
    const m = createViewModel(id, WEAPONS[id]),
      a = new WeaponAnimator(),
      parts = m.userData,
      bolts = parts.bolts || [parts.bolt];
    a.update(m, { dt: 1 / 60, ammo: 0, shotAge: 10 });
    for (const b of bolts)
      assert.ok(
        Math.abs(b.position.z - b.userData.restPosition.z - 0.045) < 1e-9,
      );
    a.update(m, { dt: 1 / 60, ammo: 0, reloading: true, reload: 0.5 });
    for (const b of bolts)
      assert.ok(
        Math.abs(b.position.z - b.userData.restPosition.z - 0.045) < 1e-9,
      );
    a.update(m, { dt: 1 / 60, ammo: 0, reloading: true, reload: 1 });
    for (const b of bolts)
      assert.ok(b.position.distanceTo(b.userData.restPosition) < 1e-9);
    Game.prototype.disposeVisual.call({}, m);
  }
});
