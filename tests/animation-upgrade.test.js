import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { knifeStabPose, sniperBoltPose } from "../src/weapon-actions.js";
import { WeaponAnimator } from "../src/animation.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
import { updateScopeGlint } from "../src/scope-glint.js";
import { WEAPONS } from "../src/data.js";
import { Game } from "../src/game.js";
import { setup } from "./helpers/match.js";
import { encodeSnapshot, decodeSnapshot } from "../src/net/snapshot-codec.js";
const dispose = (o) => Game.prototype.disposeVisual.call({}, o);
test("reverse grip and downward drive meet the actual 105ms contact and settle completely", () => {
  const hit = knifeStabPose(0.36 - 0.105);
  assert.ok(hit.drive > 0.99);
  assert.ok(hit.grip > 0.99);
  assert.equal(knifeStabPose(0).drive, 0);
  for (let i = 0; i <= 360; i++)
    assert.ok(Object.values(knifeStabPose(i / 1000)).every(Number.isFinite));
});
test("backstab rotates the dagger and gripping hand around their grip, leaving the brace independent", () => {
  const m = createViewModel("knife", WEAPONS.knife),
    a = new WeaponAnimator(),
    p = m.userData;
  try {
    assert.equal(p.hands[0].parent, p.knifeRig);
    assert.equal(p.hands[1].parent, m);
    a.update(m, { dt: 1, swing: 0.255, knifeStab: true });
    m.updateMatrixWorld(true);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(
      p.knifeRig.getWorldQuaternion(new THREE.Quaternion()),
    );
    assert.ok(direction.y < -0.7);
    assert.ok(direction.z < 0);
    assert.ok(p.knifeRig.position.z < p.knifeRig.userData.restPosition.z - 0.3);
    assert.equal(p.slashTrail.visible, false);
    const forearm = new THREE.Vector3(0, 0, 1).applyQuaternion(
      p.hands[0].userData.sleeve.getWorldQuaternion(new THREE.Quaternion()),
    );
    assert.ok(
      forearm.z > 0.7,
      "sleeve still extends toward the camera, not out through the blade",
    );
    a.update(m, { dt: 1, swing: 0 });
    assert.ok(
      p.knifeRig.position.distanceTo(p.knifeRig.userData.restPosition) < 1e-10,
    );
    assert.equal(p.knifeRig.rotation.x, 0);
  } finally {
    dispose(m);
  }
});
for (const rear of [true, false])
  test(`normal Knife ${rear ? "rear" : "front"} strike selects an honest pose and preserves damage`, () => {
    const { m, g, other } = setup();
    try {
      Object.assign(other.player, {
        x: 0,
        y: 0,
        z: 10,
        yaw: rear ? 0 : Math.PI,
      });
      g.yaw = g.pitch = 0;
      g.equip(2);
      g.cooldown = 0;
      assert.equal(g.firePlayer(), true);
      assert.equal(g.knifeStabAttack, rear);
      g.updatePlayerMelee(0.105);
      assert.equal(other.player.health, rear ? 0 : 110);
    } finally {
      m.dispose();
    }
  });
test("F is visually an overhand stab even on a front hit, but cannot grant rear damage", () => {
  const { m, g, other } = setup();
  try {
    Object.assign(other.player, { x: 0, y: 0, z: 10, yaw: Math.PI });
    g.meleeAbility(true);
    assert.equal(g.knifeStabAttack, true);
    g.updatePlayerMelee(0.105);
    assert.equal(other.player.health, 110);
    assert.equal(g.slot, 0);
  } finally {
    m.dispose();
  }
});
test("ADS and Knife pose cross the binary wire without growing ordinary frames", () => {
  const { m, g } = setup();
  try {
    g.aiming = true;
    g.knifeStabAttack = true;
    g.swingTime = 0.25;
    const s = m.snapshot(),
      meta = new Map(s.players.map((p) => [p.index, p]));
    const bytes = encodeSnapshot(s),
      decoded = decodeSnapshot(bytes, meta);
    assert.equal(bytes.length, 23 + 94 * 2);
    const p = decoded.players.find((p) => p.id === "p0");
    assert.equal(p.aiming, true);
    assert.equal(p.knifeStab, true);
    assert.equal(decoded.players.find((p) => p.id === "p1").aiming, false);
  } finally {
    m.dispose();
  }
});
test("white scope glint is forward-cone ADS only, depth tested, and suppressed by reload/utility/death", () => {
  const m = createCharacter(1, "SNIPER"),
    e = { alive: true, activeWeapon: "sniper", aiming: true };
  try {
    updateBotWeapon(m, e, 10);
    const weapon = m.parts.onlineSocket.userData.weapon,
      glint = weapon.userData.scopeGlint;
    const center = glint.getWorldPosition(new THREE.Vector3());
    const front = center.clone().add(new THREE.Vector3(0, 0, -10));
    updateScopeGlint(m, e, front, 10);
    assert.equal(glint.visible, true);
    assert.ok(glint.material.uniforms.opacity.value > 0.8);
    assert.equal(glint.material.depthTest, true);
    assert.equal(glint.material.depthWrite, false);
    for (const offset of [
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(0, 0, 10),
    ]) {
      updateScopeGlint(m, e, center.clone().add(offset), 10);
      assert.equal(glint.visible, false);
    }
    for (const override of [
      { aiming: false },
      { alive: false },
      { reload: 1 },
      { quickUtilityTime: 0.4 },
      { quickMeleeTime: 0.4 },
    ]) {
      updateScopeGlint(m, { ...e, ...override }, front, 10);
      assert.equal(glint.visible, false);
    }
    const own = createViewModel("sniper", WEAPONS.sniper);
    assert.equal(own.userData.scopeGlint, undefined);
    dispose(own);
  } finally {
    dispose(m.group);
  }
});
test("Sniper bolt lifts, pulls, pushes and locks, including remote shots on a different clock", () => {
  assert.ok(sniperBoltPose(0.37).pull > 0.99);
  assert.equal(sniperBoltPose(0.8).pull, 0);
  const m = createViewModel("sniper", WEAPONS.sniper),
    a = new WeaponAnimator();
  const character = createCharacter(1, "BOLT");
  try {
    const b = m.userData.sniperBolt;
    a.update(m, { dt: 1, shotAge: 0.37 });
    assert.ok(b.position.z > b.userData.restPosition.z + 0.09);
    a.update(m, { dt: 1, shotAge: 1 });
    assert.equal(b.position.z, b.userData.restPosition.z);
    updateBotWeapon(
      character,
      {
        netId: "remote",
        activeWeapon: "sniper",
        netShot: 100,
        netShotAge: 0.37,
      },
      500,
    );
    const remote =
      character.parts.onlineSocket.userData.weapon.userData.sniperBolt;
    assert.ok(remote.position.z > remote.userData.restPosition.z + 0.09);
  } finally {
    dispose(m);
    dispose(character.group);
  }
});

test("remote Flamethrower heat still follows the replicated flash when shot age is nonzero", () => {
  const model = createCharacter(1, "HEAT");
  try {
    updateBotWeapon(
      model,
      {
        netId: "remote",
        activeWeapon: "flame",
        netShotAge: 0.03,
        fireFlash: 0.04,
      },
      500,
    );
    const glow = model.parts.onlineSocket.userData.weapon.userData.nozzleGlow;
    assert.equal(glow.material.emissiveIntensity, 1.8);
    updateBotWeapon(
      model,
      { netId: "remote", activeWeapon: "flame", netShotAge: 1, fireFlash: 0 },
      501,
    );
    assert.equal(glow.material.emissiveIntensity, 0.15);
  } finally {
    dispose(model.group);
  }
});
