import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createViewModel, createCharacter } from "../src/world.js";
import { WEAPONS } from "../src/data.js";
import { WeaponAnimator } from "../src/animation.js";
import { Game } from "../src/game.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
test("Bow is left-hand held with rearward limbs/string and an arrow pointing forward, not a reversed rig", () => {
  const m = createViewModel("bow", WEAPONS.bow),
    p = m.userData,
    a = new WeaponAnimator();
  assert.equal(p.bowOrientation, "planar-forward-v4");
  assert.ok(p.bowGripPoint.x < 0);
  assert.ok(p.hipYaw < 0);
  assert.ok(p.drawHand.rotation.y > 0.5);
  for (const draw of [0, 0.2, 0.4, 0.6, 0.8, 0]) {
    a.update(m, { dt: 1 / 60, draw, ammo: 1, shotAge: 10 });
    const string = p.string.geometry.attributes.position;
    for (const [limb, cam, index] of [
      [p.bowUpper, p.bowTopCam, 0],
      [p.bowLower, p.bowBottomCam, 2],
    ]) {
      const tip = limb.userData.tipPosition
        .clone()
        .applyEuler(limb.rotation)
        .add(limb.position);
      assert.ok(tip.distanceTo(cam.position) < 1e-10);
      assert.ok(
        cam.position.distanceTo(
          new THREE.Vector3().fromBufferAttribute(string, index),
        ) < 1e-6,
      );
      assert.ok(
        cam.position.z > limb.position.z,
        "limbs sweep toward archer, not away",
      );
      assert.ok(string.getZ(1) > cam.position.z, "nock is behind limb tips");
    }
    const tip = p.arrowTip.clone().add(p.arrow.position),
      nock = p.arrowNock.clone().add(p.arrow.position);
    assert.ok(
      tip.z < p.bowUpper.position.z,
      "arrowhead stays in front of the riser",
    );
    assert.ok(nock.z > p.bowTopCam.position.z);
    assert.ok(Math.abs(nock.z - string.getZ(1)) < 1e-6);
    assert.ok(
      tip
        .sub(nock)
        .normalize()
        .dot(new THREE.Vector3(0, 0, -1)) > 0.99999,
    );
  }
  m.traverse((o) => {
    for (const mat of Array.isArray(o.material) ? o.material : [o.material])
      if (mat?.isMeshStandardMaterial) {
        assert.ok(mat.roughness >= 0 && mat.roughness <= 1);
        assert.ok(mat.metalness >= 0 && mat.metalness <= 1);
      }
  });
  Game.prototype.disposeVisual.call({}, m);
});
test("Bow ADS uses the forward sight and neither hand crosses the aiming ray at rest or full draw", () => {
  for (const draw of [0, 0.8]) {
    const m = createViewModel("bow", WEAPONS.bow),
      a = new WeaponAnimator();
    m.scale.setScalar(0.78);
    for (let i = 0; i < 120; i++)
      a.update(m, { dt: 1 / 60, aim: true, draw, ammo: 1, shotAge: 10 });
    m.updateMatrixWorld(true);
    const p = m.localToWorld(m.userData.adsPoint.clone());
    assert.ok(Math.hypot(p.x, p.y) < 0.0001);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
    );
    for (const hand of m.userData.hands)
      assert.equal(ray.intersectObject(hand, true).length, 0);
    Game.prototype.disposeVisual.call({}, m);
  }
});
test("world Bow shares the corrected facing and both operator wrists target the actual grip/pull points", () => {
  const m = createCharacter(1, "ARCHER");
  updateBotWeapon(
    m,
    { netId: "bow-player", activeWeapon: "bow", meleeId: "knife" },
    0,
  );
  const p = m.parts,
    w = p.onlineSocket.userData.weapon;
  assert.equal(w.userData.bowOrientation, "planar-forward-v4");
  assert.ok(
    p.botLeftGrip.distanceTo(
      w.userData.bowGripPoint.clone().multiplyScalar(0.85).add(w.position),
    ) < 1e-10,
  );
  assert.ok(
    p.botRightGrip.distanceTo(
      w.userData.bowPullPoint.clone().multiplyScalar(0.85).add(w.position),
    ) < 1e-10,
  );
  Game.prototype.disposeVisual.call({}, m.group);
});

test("Bow limb backbones bend in the arrow/string plane, not sideways across the grip", () => {
  const m = createViewModel("bow", WEAPONS.bow), p = m.userData;
  for (const [limb, cam] of [[p.bowUpper, p.bowTopCam], [p.bowLower, p.bowBottomCam]]) {
    const tube = limb.children.find(o => o.geometry?.type === "TubeGeometry"),
      curve = tube.geometry.parameters.path,
      points = curve.points;
    // Inspect actual generated geometry, not just an orientation label or anchor.
    for (const point of curve.getPoints(96)) assert.ok(Math.abs(point.x) < 1e-10, "body must not sweep sideways");
    assert.ok(points[2].z > points[1].z);
    assert.ok(points.at(-1).z > points[2].z, "tips must sweep toward the archer");
    assert.equal(limb.position.x, cam.position.x);
    assert.equal(limb.position.x, p.bowGripPoint.x);
    assert.ok(Math.abs(limb.position.x - p.arrowNock.x) < .02);
    // The string should be behind, not crossing through the middle of the limb.
    const tip = points.at(-1).clone().add(limb.position);
    for (const point of points.slice(0, -1)) {
      const y = point.y + limb.position.y,
        t = (y - tip.y) / (p.arrowNock.y - tip.y),
        stringZ = THREE.MathUtils.lerp(tip.z, p.arrowNock.z, t);
      assert.ok(stringZ - (point.z + limb.position.z) > .027);
    }
  }
  Game.prototype.disposeVisual.call({}, m);
});
