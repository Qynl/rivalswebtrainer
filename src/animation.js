import { weaponPresentation } from "./weapon-presentation.js";
import { knifeStabPose, sniperBoltPose } from "./weapon-actions.js";
import * as THREE from "three";
import { BOW_DRAW_TIME } from "./combat-rules.js";
import { weaponFeel, shotEnvelope } from "./weapon-feel.js";

export const saturate = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => {
  x = saturate(x);
  return x * x * (3 - 2 * x);
};
// Exact critically damped integration: no overshoot or frame-rate dependence.
export class Spring {
  constructor(value = 0) {
    this.value = value;
    this.velocity = 0;
  }
  step(target, dt, frequency = 18) {
    dt = Math.max(0, Math.min(0.2, dt));
    const offset = this.value - target,
      c = this.velocity + frequency * offset,
      e = Math.exp(-frequency * dt);
    this.value = target + (offset + c * dt) * e;
    this.velocity = (this.velocity - frequency * c * dt) * e;
    return this.value;
  }
}
export function reloadPose(progress) {
  const p = saturate(progress);
  const lower = smooth(p / 0.18) * (1 - smooth((p - 0.78) / 0.22));
  const extract = smooth((p - 0.12) / 0.18) * (1 - smooth((p - 0.57) / 0.23));
  const rack = Math.sin(saturate((p - 0.78) / 0.16) * Math.PI);
  return { lower, extract, rack };
}
// Time-based mechanisms return to rest between shots even under sustained recoil.
export function mechanismPose(age = Infinity) {
  if (!Number.isFinite(age) || age < 0) return { bolt: 0, pump: 0 };
  const pulse = (start, peak, end) =>
    age <= start || age >= end
      ? 0
      : age < peak
        ? smooth((age - start) / (peak - start))
        : 1 - smooth((age - peak) / (end - peak));
  return {
    bolt: pulse(0, 0.018, 0.085) * 0.045,
    pump: pulse(0.045, 0.145, 0.31) * 0.075,
  };
}
// Called at shot time too: a tracer must start at the gun that actually fired.
export function selectShotSide(model, sequence = 1) {
  const p = model?.userData;
  if (!p?.muzzleFlashes) return;
  p.activeShotSide = (Math.max(1, sequence) - 1) % p.muzzleFlashes.length;
  for (const f of p.muzzleFlashes) f.visible = false;
  p.muzzleFlash = p.muzzleFlashes[p.activeShotSide];
  p.bolt = p.bolts[p.activeShotSide];
}
export class WeaponAnimator {
  constructor() {
    this.x = new Spring(0.09);
    this.y = new Spring(-0.1);
    this.z = new Spring(-0.16);
    this.aim = new Spring();
    this.roll = new Spring();
    this.carry = new Spring();
    this.clearance = new Spring();
  }
  equip() {
    this.clearance.value = this.clearance.velocity = 0;
    this.carry.value = 0;
    this.carry.velocity = 0;
    this.y.value = -0.46;
    this.y.velocity = 0.6;
    this.z.value = -0.08;
    this.roll.value = 0.2;
  }
  quickDraw() {
    // A 160ms quick-throw windup must not spend most of its life below screen.
    for (const [spring, value] of [
      [this.x, 0.09],
      [this.y, -0.125],
      [this.z, -0.16],
      [this.aim, 0],
      [this.carry, 0],
    ]) {
      spring.value = value;
      spring.velocity = 0;
    }
  }
  update(model, state) {
    const {
      dt,
      phase = 0,
      speed = 0,
      grounded = true,
      slide = false,
      aim = false,
      kick = 0,
      swap = 0,
      reload = 0,
      reloading = false,
      shake = true,
      lookX = 0,
      lookY = 0,
    } = state;
    const age = Math.max(0, state.shotAge ?? 10);
    const carrying =
      state.carryAllowed &&
      shake &&
      grounded &&
      !slide &&
      !aim &&
      !reloading &&
      !swap &&
      age > 0.25 &&
      !state.guard &&
      !state.swing &&
      !state.dash &&
      !state.heal &&
      !state.throwing &&
      !state.inspect;
    const carry = this.carry.step(
      carrying ? saturate(((state.forwardSpeed || 0) - 7) / 5) : 0,
      dt,
      22,
    );
    const obstruction = this.clearance.step(
      shake &&
        !aim &&
        !reloading &&
        !swap &&
        !state.throwing &&
        !state.swing &&
        !state.inspect
        ? saturate(state.clearance || 0)
        : 0,
      dt,
      22,
    );
    const feel = weaponFeel(model.userData.weaponId);
    const ads = this.aim.step(aim ? 1 : 0, dt, feel.ads),
      motion = shake ? (1 - ads) * Math.min(speed / 11.5, 1.4) : 0;
    const tuck = obstruction * (1 - ads);
    const reloadState = reloadPose(reloading ? reload : 0),
      stride = grounded ? motion : motion * 0.12;
    const profile = model.userData.poseOffset || {};
    const framing = weaponPresentation(model.userData.weaponId);
    const sight = model.userData.adsPoint;
    const hipX = 0.09 + (profile.x || 0) + framing.x,
      hipY = -0.1 + (profile.y || 0) + framing.y;
    const aimX = sight ? -sight.x * model.scale.x : hipX - 0.277;
    const aimY = sight ? -sight.y * model.scale.y : hipY - 0.015;
    const poseX =
      THREE.MathUtils.lerp(hipX, aimX, ads) +
      Math.sin(phase * 0.5) * 0.009 * stride -
      lookX * (1 - ads);
    const poseY =
      THREE.MathUtils.lerp(hipY, aimY, ads) +
      Math.cos(phase) * 0.006 * stride -
      kick * 0.34 -
      swap * 0.65 -
      reloadState.lower * 0.04 -
      (slide ? 0.035 : 0) -
      carry * 0.035 -
      (shake
        ? Math.max(
            -0.018,
            Math.min(0.025, (state.verticalSpeed || 0) * 0.0015),
          ) +
          (state.landing || 0) * 0.6
        : 0);
    const impulse = shotEnvelope(age, model.userData.weaponId);
    const poseZ =
      -0.16 +
      (profile.z || 0) +
      framing.z +
      ads * 0.14 +
      kick * 0.35 +
      impulse * 0.024;
    model.position.set(
      this.x.step(poseX, dt, 26) + tuck * 0.035,
      this.y.step(poseY, dt, 24) - tuck * 0.085,
      this.z.step(poseZ, dt, 26) + tuck * 0.13,
    );
    model.rotation.set(
      kick * 0.7 +
        impulse * 0.025 +
        reloadState.lower * 0.35 -
        swap * 0.6 +
        lookY * (1 - ads) -
        carry * 0.12 -
        tuck * 0.24,
      reloadState.lower * 0.38 +
        (model.userData.hipYaw ?? 0.08) * (1 - ads) +
        carry * 0.08 +
        tuck * 0.13,
      this.roll.step(
        carry * 0.1 -
          tuck * 0.08 -
          reloadState.lower * 0.3 -
          (shake ? (state.strafe || 0) * 0.025 * (1 - ads) : 0) -
          (slide ? 0.05 : 0) -
          Math.sin(phase * 0.5) * 0.012 * stride,
        dt,
        20,
      ),
    );
    // Sharp initial kick, fast return: don't low-pass the whole shot through a spring.
    if (
      model.userData.weaponId &&
      !state.swing &&
      !state.throwing &&
      !state.heal
    ) {
      const scale = 1 - ads * 0.35;
      model.position.z += impulse * feel.kick * scale;
      model.rotation.x += impulse * feel.pitch * scale;
      model.rotation.z +=
        impulse * feel.roll * ((state.shotSequence || 0) % 2 ? 1 : -1) * scale;
    }
    const parts = model.userData,
      mechanism = mechanismPose(age),
      emptySlide =
        ["pistol", "burstpistol", "dualpistols"].includes(
          model.userData.weaponId,
        ) &&
        state.ammo === 0 &&
        (!reloading || reload < 0.87);
    if (parts.muzzleFlashes) selectShotSide(model, state.shotSequence);
    if (parts.bolts)
      for (const b of parts.bolts) {
        b.position.copy(b.userData.restPosition);
        b.position.z += emptySlide
          ? 0.045
          : b === parts.bolt
            ? mechanism.bolt
            : 0;
      }
    if (parts.dualGuns)
      for (let i = 0; i < parts.dualGuns.length; i++) {
        const gun = parts.dualGuns[i];
        gun.position.copy(gun.userData.restPosition);
        gun.rotation.x = i === parts.activeShotSide ? impulse * 0.11 : 0;
        gun.position.z += i === parts.activeShotSide ? impulse * 0.035 : 0;
      }
    if (parts.magazines)
      for (const m of parts.magazines) {
        m.position.copy(m.userData.restPosition);
        m.position.y -= reloadState.extract * 0.28;
        m.position.z += reloadState.extract * 0.09;
      }
    if (parts.revolverCylinder) {
      const c = parts.revolverCylinder;
      c.position.copy(c.userData.restPosition);
      c.position.x -= reloadState.extract * 0.12;
      const chamber = (state.shotSequence || 0) % 6;
      c.rotation.z =
        ((chamber -
          ((state.shotSequence || 0) > 0 ? 1 - smooth(age / 0.065) : 0)) *
          Math.PI) /
        3;
      c.rotation.y = -reloadState.lower * 0.32;
    }
    if (parts.hammer) parts.hammer.rotation.x = -mechanism.bolt * 9;
    if (parts.magazine) {
      const m = parts.magazine;
      m.position.copy(m.userData.restPosition);
      m.position.y -= reloadState.extract * 0.28;
      m.position.z += reloadState.extract * 0.09;
      m.rotation.x = m.userData.restRotationX + reloadState.extract * 0.3;
    }
    if (parts.bolt) {
      const b = parts.bolt;
      b.position.copy(b.userData.restPosition);
      const locked = emptySlide;
      b.position.z += locked
        ? 0.045
        : mechanism.bolt + reloadState.rack * 0.055;
    }
    if (parts.pump) {
      const p = parts.pump;
      p.position.copy(p.userData.restPosition);
      p.position.z += mechanism.pump;
    }
    if (parts.hands?.[1]) {
      const h = parts.hands[1];
      h.position.copy(h.userData.restPosition);
      h.position.y -= reloadState.extract * 0.22;
      h.position.z += reloadState.lower * 0.27;
      h.position.x -= reloadState.extract * 0.045;
      h.rotation.x = -reloadState.extract * 0.4;
      if (h.userData.sleeve)
        h.userData.sleeve.rotation.x =
          (h.userData.sleeve.userData.restRotationX || 0) +
          reloadState.extract * 0.25;
      h.rotation.z = -reloadState.lower * 0.25;
      if (parts.pump) h.position.z += mechanism.pump;
    }
    if (parts.dualGuns)
      for (let i = 0; i < (parts.hands || []).length; i++) {
        const h = parts.hands[i],
          fired = i === parts.activeShotSide;
        h.position.copy(h.userData.restPosition);
        h.position.z +=
          (fired ? impulse * 0.035 : 0) + reloadState.lower * 0.27;
        h.position.y -= reloadState.extract * 0.22;
        h.rotation.x = fired ? impulse * 0.11 : 0;
        h.rotation.z = reloadState.lower * (i === 0 ? 0.18 : -0.18);
      }
    if (parts.rocket) {
      parts.rocket.position.copy(parts.rocket.userData.restPosition);
      parts.rocket.position.z -= reloadState.extract * 0.38;
      parts.rocket.visible =
        (state.ammo ?? 1) > 0 || (reloading && reload > 0.3);
      parts.rocket.position.y -= reloadState.extract * 0.09;
    }
    if (parts.rag)
      parts.rag.rotation.z = Math.sin((state.time || 0) * 11) * 0.025;
    if (parts.pilotFlame)
      parts.pilotFlame.scale.set(
        1,
        1 + Math.sin((state.time || 0) * 23) * 0.13,
        1,
      );
    if (parts.weaponId === "flame") {
      const pressure = age < 0.14 && !reloading ? 1 : 0;
      if (parts.pressureValve)
        parts.pressureValve.rotation.x = (state.time || 0) * pressure * 2;
      if (parts.nozzleGlow)
        parts.nozzleGlow.material.emissiveIntensity =
          pressure * 1.6 + Math.min(0.4, Math.max(0, 1 - age) * 0.4);
      if (pressure) {
        model.position.z += Math.sin((state.time || 0) * 55) * 0.0025;
        model.rotation.z += Math.sin((state.time || 0) * 23) * 0.004;
      }
    }
    if (parts.rotor) parts.rotor.rotation.z += dt * (state.spin || 0) * 100;
    if (parts.string?.isLine) {
      const draw = saturate((state.draw || 0) / BOW_DRAW_TIME),
        released =
          age < 0.16 && !reloading
            ? Math.sin(age * 180) * Math.exp(-age * 32) * 0.018
            : 0,
        p = parts.string.geometry.attributes.position;
      p.setZ(1, -0.54 + draw * 0.32 + released);
      if (parts.bowUpper) parts.bowUpper.rotation.x = draw * 0.075;
      if (parts.bowLower) parts.bowLower.rotation.x = -draw * 0.075;
      for (const [cam, limb, index, sign] of [
        [parts.bowTopCam, parts.bowUpper, 0, 1],
        [parts.bowBottomCam, parts.bowLower, 2, -1],
      ])
        if (cam && limb) {
          // The string attaches to the actual moving limb tip, not a guessed Z offset.
          cam.position
            .copy(limb.userData.tipPosition)
            .applyEuler(limb.rotation)
            .add(limb.position);
          cam.rotation.x = draw * sign * 0.65;
          p.setXYZ(index, cam.position.x, cam.position.y, cam.position.z);
        }
      p.needsUpdate = true;
      if (parts.arrow) {
        parts.arrow.visible = !reloading && (state.ammo ?? 1) > 0;
        parts.arrow.position.z = draw * 0.32;
      }
      if (parts.drawHand) {
        parts.drawHand.position.copy(parts.drawHand.userData.restPosition);
        parts.drawHand.position.z += draw * 0.32;
        parts.drawHand.position.x += draw * 0.012;
      }
    }
    if (parts.muzzleFlash) {
      parts.muzzleFlash.visible = !!state.flash;
      parts.muzzleFlash.rotation.z = (state.time || 0) * 97;
      parts.muzzleFlash.scale.setScalar(
        (1.2 + Math.min(0.7, feel.kick * 4)) *
          (1 + Math.sin((state.time || 0) * 177) * 0.14),
      );
    }
    if (state.heal > 0) {
      model.rotation.set(-0.23, 0.2, 0.06);
      model.position.y += 0.055 + Math.sin((state.time || 0) * 5) * 0.005;
    }
    if (parts.pullRing) {
      parts.pullRing.position.copy(parts.pullRing.userData.restPosition);
      const pull =
        state.throwing > 0 ? smooth((0.48 - state.throwing) / 0.13) : 0;
      parts.pullRing.position.x -= pull * 0.06;
      parts.pullRing.position.y += pull * 0.035;
      parts.pullRing.visible = !state.throwReleased || !state.throwing;
    }
    if (parts.throwableBody)
      parts.throwableBody.visible =
        state.throwing > 0 ? !state.throwReleased : (state.ammo ?? 1) > 0;
    if (state.throwing > 0) {
      const t = saturate(1 - state.throwing / 0.48),
        wind = smooth(t / 0.3),
        cast = smooth((t - 0.3) / 0.2),
        recover = 1 - smooth((t - 0.5) / 0.5);
      model.position.z += (wind * 0.13 - cast * 0.38) * recover;
      model.position.y += (wind * 0.08 - cast * 0.06) * recover;
      model.position.x += (-wind * 0.06 + cast * 0.11) * recover;
      model.rotation.x += (wind * 0.65 - cast * 1.2) * recover;
      model.rotation.z += (wind * 0.35 - cast * 0.5) * recover;
    }
    if (parts.slashTrail) {
      parts.slashTrail.visible = false;
      parts.slashTrail.material.opacity = 0;
    }
    if (parts.weaponId === "fists" && parts.hands?.[0]) {
      const h = parts.hands[0];
      h.position.copy(h.userData.restPosition);
    }
    if (state.dash > 0) {
      const dash = Math.sin(Math.min(1, state.dash / 0.24) * Math.PI * 0.5);
      model.rotation.y += dash * 0.28;
      model.rotation.x -= dash * 0.2;
      model.position.z += dash * 0.07;
    }
    if (parts.knifeRig) {
      const sleeve = parts.hands?.[0]?.userData.sleeve;
      if (sleeve) {
        sleeve.position.set(0, -0.04, 0.08);
        sleeve.rotation.set(0, 0, 0);
      }
      parts.knifeRig.position.copy(parts.knifeRig.userData.restPosition);
      parts.knifeRig.rotation.set(0, 0, 0);
    }
    if (parts.sniperBolt) {
      const bolt = sniperBoltPose(state.shotAge);
      parts.sniperBolt.position.copy(parts.sniperBolt.userData.restPosition);
      parts.sniperBolt.position.z += bolt.pull * 0.095;
      parts.sniperBolt.rotation.z = -bolt.lift * 0.95;
      if (parts.hands?.[0]) {
        const hand = parts.hands[0];
        hand.position.copy(hand.userData.restPosition);
        hand.position.z += bolt.pull * 0.075;
        hand.position.x += bolt.lift * 0.035;
        hand.position.y += bolt.lift * 0.025;
      }
    }
    if (state.swing > 0) {
      const t = saturate(1 - state.swing / 0.36),
        wind = smooth(t / 0.28),
        strike = smooth((t - 0.28) / 0.22),
        recover = 1 - smooth((t - 0.55) / 0.45),
        direction = (state.swingSequence || 0) % 2 ? 1 : -1;
      if (
        parts.weaponId === "knife" &&
        (state.quickStab || state.knifeStab || state.backstab > 0)
      ) {
        const pose = knifeStabPose(state.swing),
          rig = parts.knifeRig;
        if (rig) {
          rig.rotation.set(
            pose.grip * (Math.PI + 0.45),
            -0.12 * pose.drive,
            0.12 * pose.lift,
          );
          rig.position.y += pose.lift * 0.29 - pose.drive * 0.12;
          rig.position.z += pose.lift * 0.04 - pose.drive * 0.36;
          rig.position.x -= pose.drive * 0.08;
          // The wrist flips the dagger; the forearm must still lead back to
          // the camera, not turn upside down with the blade.
          const sleeve = parts.hands?.[0]?.userData.sleeve;
          if (sleeve) {
            sleeve.quaternion.copy(rig.quaternion).invert();
            sleeve.position
              .set(0, -0.04, 0.08)
              .applyQuaternion(sleeve.quaternion);
            sleeve.rotateX(pose.grip * 0.5);
          }
        }
        model.position.z -= pose.drive * 0.045;
        if (parts.hands?.[1]) {
          parts.hands[1].position.y += pose.lift * 0.08;
          parts.hands[1].position.z -= pose.drive * 0.1;
        }
      } else if (parts.weaponId === "knife") {
        model.position.x +=
          (wind * 0.045 - strike * 0.15) * recover * direction;
        model.position.z += (wind * 0.065 - strike * 0.28) * recover;
        model.position.y += (wind * 0.04 - strike * 0.05) * recover;
        model.rotation.z += (wind * 0.35 - strike * 0.95) * recover * direction;
        model.rotation.y += (wind * 0.15 - strike * 0.3) * recover * direction;
        model.rotation.x += (wind * 0.18 - strike * 0.45) * recover;
      } else if (parts.weaponId === "fists") {
        const hand = parts.hands?.[(state.swingSequence || 0) % 2];
        if (hand) {
          hand.position.z -= strike * recover * 0.28;
          hand.rotation.z += strike * recover * 0.18 * direction;
        }
        model.rotation.y += (wind * 0.1 - strike * 0.2) * recover * direction;
      } else {
        model.rotation.z += (wind * 0.28 - strike * 1.15) * recover * direction;
        model.rotation.y += (wind * 0.16 - strike * 0.65) * recover * direction;
        model.rotation.x -= Math.sin(t * Math.PI) * 0.2;
        model.position.x -= strike * recover * 0.09 * direction;
        model.position.z -= strike * recover * 0.06;
      }
      if (parts.slashTrail) {
        parts.slashTrail.visible =
          !(
            parts.weaponId === "knife" &&
            (state.quickStab || state.knifeStab)
          ) &&
          t > 0.28 &&
          t < 0.6;
        parts.slashTrail.material.opacity =
          Math.sin(saturate((t - 0.28) / 0.32) * Math.PI) * 0.24;
      }
    }
    if (state.inspect > 0 && !state.guard && !reloading) {
      const t = 1 - state.inspect / 1.8,
        envelope = smooth(t / 0.22) * (1 - smooth((t - 0.72) / 0.28));
      model.rotation.y += envelope * 0.7;
      model.rotation.z += envelope * 0.17;
      model.rotation.x -= envelope * 0.12;
      model.position.x -= envelope * 0.07;
      model.position.y += envelope * 0.04;
    }
    if (state.guard) {
      model.position.set(-0.12, -0.03, -0.24);
      model.rotation.set(0.15, -0.25, -0.85);
    }
    return { ads, reload: reloadState };
  }
}

// Small local object motion, not camera/aim displacement.
export function rememberPart(mesh) {
  mesh.userData.restPosition = mesh.position.clone();
  mesh.userData.restRotationX = mesh.rotation.x;
  return mesh;
}
export function muzzleFlash(material) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      r = i % 2 ? 0.022 : 0.075;
    const x = Math.cos(a) * r,
      y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const face = new THREE.ShapeGeometry(shape);
  const flat = face.toNonIndexed();
  const front = flat.attributes.position.array;
  // A single draw: hot frontal crown plus crossed gas jets, visible side-on
  // on other players as well as through the local weapon camera.
  const positions = new Float32Array(front.length + 18);
  positions.set(front);
  positions.set(
    [
      -0.032, 0, 0, 0.032, 0, 0, 0, 0, -0.16, 0, -0.032, 0, 0, 0.032, 0, 0, 0,
      -0.16,
    ],
    front.length,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  face.dispose();
  flat.dispose();
  material.toneMapped = false;
  material.depthWrite = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "volumetric-muzzle-crown";
  mesh.visible = false;
  return mesh;
}
