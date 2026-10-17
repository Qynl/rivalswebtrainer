import { isGlove, GLOVES } from "./gloves/catalog.js";
import { slapPose } from "./gloves/model.js";
import { reloadHandling, animateMuzzle } from "./weapon-handling.js";
import { THROW_DURATION, THROW_RELEASE } from "./throwables.js";
import { knifeStabPose, sniperBoltPose } from "./weapon-actions.js";
import { selectShotSide, mechanismPose, reloadPose } from "./animation.js";
import * as THREE from "three";
import { createViewModel } from "./world.js";
import { COMBAT_ITEMS as WEAPONS } from "./data.js";

// One cached world-sized melee per actor, not a fresh model for each ability.
// All resources remain children of the character and use its normal disposal.
export function updateBotWeapon(model, e, clock = 0) {
  if (isGlove(e.activeWeapon)) return updateGloveWeapon(model, e, clock);
  const p = model.parts,
    melee =
      !(e.quickUtilityTime > 0) &&
      !!e.meleeId &&
      (e.activeWeapon === e.meleeId ||
        e.quickMeleeTime > 0 ||
        e.deflectTime > 0);
  p.gun.visible = p.barrel.visible = !melee;
  if (melee) p.muzzleFlash.visible = false;
  if (!p.botLeftGrip) {
    p.botLeftGrip = new THREE.Vector3(-0.12, -0.1, -0.17);
    p.botRightGrip = new THREE.Vector3(0, -0.13, -0.01);
  }
  p.botLeftGrip.set(-0.12, -0.1, -0.17);
  p.botRightGrip.set(0, -0.13, -0.01);
  if (!melee) {
    p.gun.visible = p.barrel.visible = false;
    if (p.baseMuzzleFlash) p.baseMuzzleFlash.visible = false;
    if (p.meleeSocket) p.meleeSocket.visible = false;
    if (!p.onlineSocket) {
      p.onlineSocket = new THREE.Group();
      p.weaponRig.add(p.onlineSocket);
    }
    const socket = p.onlineSocket,
      id = e.quickUtilityTime > 0 ? e.utilityId : e.activeWeapon || "rifle";
    if (socket.userData.id !== id) {
      const mats = new Set();
      socket.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) mats.add(o.material);
      });
      for (const m of mats) m.dispose();
      socket.clear();
      const weapon = createViewModel(id, WEAPONS[id], { hands: false });
      weapon.scale.setScalar(0.85);
      weapon.position.set(
        id === "bow" ? 0 : -0.24 * 0.85,
        0.24 * 0.85,
        0.62 * 0.85,
      );
      socket.add(weapon);
      socket.userData.id = id;
      socket.userData.weapon = weapon;
    }
    socket.visible = true;
    const weapon = socket.userData.weapon,
      parts = weapon.userData,
      age = e.netId
        ? (e.netShotAge ?? ((e.fireFlash || 0) > 0 ? 0 : 10))
        : Math.max(0, clock - (e.lastShotAt ?? -10));
    const reload = e.reload || 0,
      reloadProgress = reload > 0 ? 1 - reload / (WEAPONS[id].reload || 1) : 0,
      handling = reloadHandling(id, reloadProgress),
      cycle = reloadPose(reloadProgress);
    weapon.rotation.z = handling.cant;
    if (parts.bolt) {
      parts.bolt.position.copy(parts.bolt.userData.restPosition);
      parts.bolt.position.z += mechanismPose(age).bolt + cycle.rack * 0.055;
    }
    for (const magazine of parts.magazines ||
      (parts.magazine ? [parts.magazine] : [])) {
      magazine.position.copy(magazine.userData.restPosition);
      magazine.position.y -= cycle.extract * 0.28 - handling.seat;
      magazine.position.x -= handling.reach * 0.35;
      magazine.position.z += cycle.extract * 0.09;
    }
    if (parts.revolverCylinder) {
      parts.revolverCylinder.position.copy(
        parts.revolverCylinder.userData.restPosition,
      );
      parts.revolverCylinder.position.x -= cycle.extract * 0.12;
      parts.revolverCylinder.rotation.y = -cycle.lower * 0.32;
    }
    if (reload > 0 && WEAPONS[id].slot < 2) {
      p.botLeftGrip.x -= handling.reach;
      p.botLeftGrip.y -= cycle.extract * 0.17;
      p.botLeftGrip.y += handling.shell + handling.seat;
      p.botLeftGrip.z += cycle.lower * 0.14;
    }
    if (parts.sniperBolt) {
      const cycle = sniperBoltPose(age);
      parts.sniperBolt.position.copy(parts.sniperBolt.userData.restPosition);
      parts.sniperBolt.position.z += cycle.pull * 0.095;
      parts.sniperBolt.rotation.z = -cycle.lift * 0.95;
      p.botRightGrip.z += cycle.pull * 0.07;
    }
    if (WEAPONS[id].slot === 3) {
      const remaining = e.throwTime || e.quickUtilityTime || 0,
        throwing = id !== "medkit" && remaining > 0,
        t = throwing
          ? Math.max(0, Math.min(1, 1 - remaining / THROW_DURATION))
          : 0,
        wind = THREE.MathUtils.smoothstep(t, 0, 0.3),
        cast = THREE.MathUtils.smoothstep(t, 0.3, 0.5),
        recover = 1 - THREE.MathUtils.smoothstep(t, 0.5, 1);
      weapon.position.set(-0.24 * 0.85, 0.24 * 0.85, 0.62 * 0.85);
      weapon.position.y += (wind * 0.07 - cast * 0.12) * recover;
      weapon.position.z += (wind * 0.12 - cast * 0.32) * recover;
      weapon.rotation.set((wind * 0.45 - cast * 0.85) * recover, 0, 0);
      if (parts.throwableBody)
        parts.throwableBody.visible = throwing
          ? remaining > THROW_DURATION - THROW_RELEASE
          : (e.utilityAmmo ?? 1) > 0;
      if (parts.pullRing)
        parts.pullRing.visible =
          !throwing || remaining > THROW_DURATION - THROW_RELEASE;
      p.botRightGrip
        .set(id === "medkit" ? 0.35 : 0.27, -0.3, -0.61)
        .multiplyScalar(0.85)
        .applyEuler(weapon.rotation)
        .add(weapon.position);
      p.botLeftGrip
        .set(
          id === "medkit" ? -0.1 : 0.24,
          id === "medkit" ? -0.3 : -0.08,
          -0.65,
        )
        .multiplyScalar(0.85)
        .applyEuler(weapon.rotation)
        .add(weapon.position);
    }
    if (id === "bow") {
      p.botLeftGrip
        .copy(parts.bowGripPoint)
        .multiplyScalar(0.85)
        .add(weapon.position);
      p.botRightGrip
        .copy(parts.bowPullPoint)
        .multiplyScalar(0.85)
        .add(weapon.position);
    }
    if (parts.muzzleFlashes) {
      selectShotSide(weapon, (e.shotSide || 0) + 1);
      p.botLeftGrip.set(-0.408, -0.1, -0.03);
    }
    if (parts.muzzleFlash) {
      p.muzzleFlash = parts.muzzleFlash;
      animateMuzzle(parts.muzzleFlash, id, age, e.netShot || e.lastShotAt || 0);
    }
    if (WEAPONS[id].slot < 2 && id !== "bow") {
      for (const grip of [p.botLeftGrip, p.botRightGrip])
        grip
          .sub(weapon.position)
          .applyEuler(weapon.rotation)
          .add(weapon.position);
    }
    if (parts.pilotFlame)
      parts.pilotFlame.scale.y = 1 + Math.sin((e.netShot || 0) * 31) * 0.13;
    if (parts.nozzleGlow)
      parts.nozzleGlow.material.emissiveIntensity = (
        e.netId ? e.fireFlash > 0 : age < 0.12
      )
        ? 1.8
        : 0.15;
    return;
  }
  if (p.onlineSocket) p.onlineSocket.visible = false;
  if (!melee) {
    if (p.meleeSocket) p.meleeSocket.visible = false;
    return;
  }
  const stab = e.meleeId === "knife" && !!e.knifeStab;
  const duration = e.netId ? 0.36 : 0.28;
  const cut =
    !stab && e.swingTime > 0
      ? Math.sin(
          THREE.MathUtils.clamp(1 - e.swingTime / duration, 0, 1) * Math.PI,
        )
      : 0;
  if (e.meleeId === "fists") {
    if (p.meleeSocket) p.meleeSocket.visible = false;
    p.botLeftGrip.set(-0.18, -0.09, -0.12);
    p.botRightGrip.set(0.02, -0.1, -0.12 - cut * 0.4);
    return;
  }
  if (!p.meleeSocket) {
    p.meleeSocket = new THREE.Group();
    p.weaponRig.add(p.meleeSocket);
  }
  const socket = p.meleeSocket;
  if (socket.userData.weaponId !== e.meleeId) {
    const materials = new Set();
    socket.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) materials.add(o.material);
    });
    materials.forEach((m) => m.dispose());
    socket.clear();
    const weapon = createViewModel(e.meleeId, WEAPONS[e.meleeId], {
      hands: false,
    });
    const grip =
      e.meleeId === "scythe"
        ? [0.26, -0.3, -0.65]
        : e.meleeId === "katana"
          ? [0.29, -0.3, -0.65]
          : [0.28, -0.29, -0.62];
    const scale =
      e.meleeId === "scythe" ? 1.15 : e.meleeId === "katana" ? 1 : 0.9;
    weapon.scale.setScalar(scale);
    weapon.position.set(-grip[0] * scale, -grip[1] * scale, -grip[2] * scale);
    weapon.traverse((o) => {
      if (o.isMesh && o !== weapon.userData.slashTrail) o.castShadow = true;
    });
    socket.add(weapon);
    socket.userData.weaponId = e.meleeId;
    socket.userData.weapon = weapon;
  }
  socket.visible = true;
  socket.position.set(
    e.deflectTime > 0 ? 0.13 : 0,
    e.deflectTime > 0 ? 0.05 : -0.1,
    e.deflectTime > 0 ? -0.3 : -0.1 - cut * 0.2,
  );
  socket.rotation.set(
    e.dashTime > 0 ? -0.35 : cut * -0.2,
    cut * 0.8,
    e.deflectTime > 0 ? 0.95 : -cut * 1.1,
  );
  p.botRightGrip.copy(socket.position);
  p.botLeftGrip
    .set(0, e.meleeId === "scythe" ? 0.2 : -0.1, 0.015)
    .applyQuaternion(socket.quaternion)
    .add(socket.position);
  if (e.meleeId === "knife") p.botLeftGrip.set(-0.36, 0.12, -0.12);
  const weapon = socket.userData.weapon,
    trail = weapon.userData.slashTrail;
  if (trail) {
    trail.visible = cut > 0.4;
    trail.material.opacity = cut * 0.32;
  }
  const knifeRig = weapon.userData.knifeRig;
  if (knifeRig) {
    knifeRig.position.copy(knifeRig.userData.restPosition);
    knifeRig.rotation.set(0, 0, 0);
    if (stab && e.swingTime > 0) {
      const pose = knifeStabPose(e.swingTime, duration);
      knifeRig.rotation.x = pose.grip * (Math.PI + 0.45);
      knifeRig.position.y += pose.lift * 0.29 - pose.drive * 0.12;
      knifeRig.position.z -= pose.drive * 0.36;
      p.botRightGrip.addScaledVector(
        knifeRig.position.clone().sub(knifeRig.userData.restPosition),
        weapon.scale.x,
      );
    }
  }
  const blade = weapon.userData.blade;
  if (blade?.material.emissive) {
    blade.material.emissive.setHex(0x5ab9d0);
    blade.material.emissiveIntensity =
      e.guardFlash > 0 ? 0.9 : e.deflectTime > 0 ? 0.16 : 0;
  }
}

function updateGloveWeapon(model, e, clock) {
  const p = model.parts,
    id = e.activeWeapon;
  p.gun.visible = p.barrel.visible = false;
  if (p.baseMuzzleFlash) p.baseMuzzleFlash.visible = false;
  if (p.muzzleFlash) p.muzzleFlash.visible = false;
  if (p.meleeSocket) p.meleeSocket.visible = false;
  if (!p.onlineSocket) {
    p.onlineSocket = new THREE.Group();
    p.weaponRig.add(p.onlineSocket);
  }
  const socket = p.onlineSocket;
  if (socket.userData.id !== id) {
    const mats = new Set();
    socket.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) mats.add(o.material);
    });
    for (const m of mats) m.dispose();
    socket.clear();
    const glove = createViewModel(id, WEAPONS[id], { hands: false });
    glove.scale.setScalar(0.8);
    socket.add(glove);
    socket.userData = { id, weapon: glove };
  }
  socket.visible = true;
  const age = e.netId ? (e.netShotAge ?? 10) : clock - (e.lastSlapAt ?? -10),
    pose = slapPose(age, GLOVES[id].windup),
    glove = socket.userData.weapon;
  glove.position.set(
    0.15 + pose.wind * 0.26 - pose.strike * 0.55,
    -0.14 + pose.wind * 0.14,
    -0.46 - pose.strike * 0.25,
  );
  glove.rotation.set(
    -1.35 + pose.wind * 0.4,
    -0.3 - pose.strike * 1.2,
    -0.25 - pose.strike * 0.9,
  );
  p.botRightGrip ||= new THREE.Vector3();
  p.botLeftGrip ||= new THREE.Vector3();
  p.botRightGrip.copy(glove.position).add(new THREE.Vector3(0, 0.15, 0.05));
  p.botLeftGrip.set(-0.24, -0.15, -0.2);
}
