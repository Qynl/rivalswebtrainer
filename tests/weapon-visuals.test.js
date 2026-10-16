import { weaponDisplayBounds } from "../src/weapon-preview.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WEAPONS } from "../src/data.js";
import {
  WEAPON_PRESENTATION,
  weaponPresentation,
} from "../src/weapon-presentation.js";
import { WeaponAnimator } from "../src/animation.js";
import { createViewModel } from "../src/world.js";
import { Game } from "../src/game.js";

const guns = Object.entries(WEAPONS).filter(([, w]) => w.slot < 2);
test("every primary/secondary has an immutable authored framing profile; other slots keep their size", () => {
  assert.equal(guns.length, 17);
  for (const [id] of guns) {
    const profile = weaponPresentation(id);
    assert.ok(Object.isFrozen(profile), id);
    assert.ok(Object.values(profile).every(Number.isFinite), id);
    assert.ok(profile.scale > 0.78 && profile.scale <= 1.04, id);
    assert.equal(profile, WEAPON_PRESENTATION[id]);
  }
  for (const id of ["knife", "katana", "grenade", "molotov", "medkit"])
    assert.equal(weaponPresentation(id).scale, 0.78);
  assert.ok(
    weaponPresentation("sniper").scale > weaponPresentation("rifle").scale,
  );
});
for (const [id, w] of guns) {
  test(`${id}: actual equip uses its authored size, complete finite model and bounded batching`, () => {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
      player: { alive: true },
      loadout: [id],
      slot: -1,
      cooldown: 0,
      clock: 10,
      cancelThrow() {},
      clearQuickMelee() {},
      trimQuickModels() {},
      weaponScene: new THREE.Scene(),
      audio: { play() {} },
      events: { update() {} },
    });
    g.equip(0);
    const m = g.viewModel;
    try {
      assert.equal(m.scale.x, weaponPresentation(id).scale);
      assert.equal(m.userData.visualRevision, "arsenal-v3");
      assert.ok(m.userData.designName?.length > 5);
      let meshes = 0;
      m.traverse((o) => {
        if (o.isMesh) {
          meshes++;
          assert.ok(
            o.geometry.attributes.position.array.every(Number.isFinite),
            id,
          );
        }
      });
      assert.ok(meshes < 48, `${id}: ${meshes} draws`);
      assert.ok(
        new THREE.Box3()
          .setFromObject(m)
          .getSize(new THREE.Vector3())
          .length() > 0.5,
      );
    } finally {
      g.disposeVisual(m);
    }
  });
  test(`${id}: larger ADS framing keeps the authored sight centered and both hands off the aiming ray`, () => {
    const m = createViewModel(id, w),
      a = new WeaponAnimator();
    m.scale.setScalar(weaponPresentation(id).scale);
    try {
      for (let i = 0; i < 180; i++)
        a.update(m, {
          dt: 1 / 120,
          aim: true,
          shake: false,
          ammo: w.mag,
          shotAge: 10,
        });
      m.updateMatrixWorld(true);
      if (m.userData.adsPoint) {
        const sight = m.localToWorld(m.userData.adsPoint.clone());
        assert.ok(
          Math.hypot(sight.x, sight.y) < 0.001,
          `${id}: ${sight.toArray()}`,
        );
        assert.ok(sight.z < -0.1);
      }
      const ray = new THREE.Raycaster(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
      );
      for (const hand of m.userData.hands || [])
        assert.equal(ray.intersectObject(hand, true).length, 0, id);
    } finally {
      Game.prototype.disposeVisual.call({}, m);
    }
  });
}
test("enlarging long guns also brings them forward instead of leaving the same tiny projection", () => {
  const p = weaponPresentation("rifle");
  const old = new THREE.Vector3(
    0.24 * 0.78 + 0.09,
    -0.16 * 0.78 - 0.1,
    -0.72 * 0.78 - 0.16,
  );
  const now = new THREE.Vector3(
    0.24 * p.scale + 0.09 + p.x,
    -0.16 * p.scale - 0.1 + p.y,
    -0.72 * p.scale - 0.16 + p.z,
  );
  assert.ok(
    old.distanceTo(now) < 1e-10,
    "receiver center must stay anchored while its silhouette grows",
  );
});
test("Sniper world glint is seated in front of the new scope glass, not buried in its barrel", () => {
  const m = createViewModel("sniper", WEAPONS.sniper, { hands: false });
  try {
    assert.ok(m.userData.scopeFront.z < -1);
    assert.ok(
      m.userData.scopeGlint.position.distanceTo(m.userData.scopeFront) < 1e-10,
    );
    assert.ok(m.userData.muzzleFlash.position.z < -1.61);
    assert.ok(m.userData.sniperBolt.parent);
  } finally {
    Game.prototype.disposeVisual.call({}, m);
  }
});
test("new sidearm/pump details remain parented to their animated mechanisms", () => {
  for (const id of [
    "pistol",
    "burstpistol",
    "dualpistols",
    "shotgun",
    "shorty",
  ]) {
    const m = createViewModel(id, WEAPONS[id]);
    try {
      const parts = m.userData.bolts || [m.userData.pump || m.userData.bolt];
      for (const part of parts) {
        assert.ok(part.children.length > 0, id);
        const detail = part.children[0];
        m.updateMatrixWorld(true);
        const before = detail.getWorldPosition(new THREE.Vector3());
        part.position.z += 0.1;
        m.updateMatrixWorld(true);
        assert.ok(
          Math.abs(
            detail.getWorldPosition(new THREE.Vector3()).z - before.z - 0.1,
          ) < 1e-8,
          id,
        );
      }
    } finally {
      Game.prototype.disposeVisual.call({}, m);
    }
  }
});

test("loadout display fits the physical Sniper, not its invisible 1x1 glint billboard", () => {
  const m = createViewModel("sniper", WEAPONS.sniper, { hands: false });
  try {
    const physical = weaponDisplayBounds(m).clone();
    const raw = new THREE.Box3().setFromObject(m);
    assert.ok(
      raw.getSize(new THREE.Vector3()).y >
        physical.getSize(new THREE.Vector3()).y * 1.2,
    );
    const glint = m.userData.scopeGlint;
    glint.visible = true;
    glint.scale.setScalar(100);
    m.userData.muzzleFlash.visible = true;
    m.userData.muzzleFlash.scale.setScalar(100);
    const same = weaponDisplayBounds(m);
    assert.ok(same.min.distanceTo(physical.min) < 1e-10);
    assert.ok(same.max.distanceTo(physical.max) < 1e-10);
  } finally {
    Game.prototype.disposeVisual.call({}, m);
  }
});
