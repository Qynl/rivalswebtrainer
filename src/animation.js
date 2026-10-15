import * as THREE from "three";

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
export class WeaponAnimator {
  constructor() {
    this.x = new Spring(0.09);
    this.y = new Spring(-0.1);
    this.z = new Spring(-0.16);
    this.aim = new Spring();
    this.roll = new Spring();
    this.carry = new Spring();
  }
  equip() {
    this.carry.value = 0;
    this.carry.velocity = 0;
    this.y.value = -0.46;
    this.y.velocity = 0.6;
    this.z.value = -0.08;
    this.roll.value = 0.2;
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
    const ads = this.aim.step(aim ? 1 : 0, dt, 24),
      motion = shake ? (1 - ads) * Math.min(speed / 11.5, 1.4) : 0;
    const reloadState = reloadPose(reloading ? reload : 0),
      stride = grounded ? motion : motion * 0.12;
    const profile = model.userData.poseOffset || {};
    const sight = model.userData.adsPoint;
    const hipX = 0.09 + (profile.x || 0),
      hipY = -0.1 + (profile.y || 0);
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
    const impulse =
      age < 0.16
        ? Math.exp(-age * 28) *
          Math.sin(Math.min(1, age / 0.022) * Math.PI * 0.5)
        : 0;
    const poseZ =
      -0.16 + (profile.z || 0) + ads * 0.14 + kick * 0.35 + impulse * 0.024;
    model.position.set(
      this.x.step(poseX, dt, 26),
      this.y.step(poseY, dt, 24),
      this.z.step(poseZ, dt, 26),
    );
    model.rotation.set(
      kick * 0.7 +
        impulse * 0.025 +
        reloadState.lower * 0.35 -
        swap * 0.6 +
        lookY * (1 - ads) -
        carry * 0.12,
      reloadState.lower * 0.38 + 0.08 * (1 - ads) + carry * 0.08,
      this.roll.step(
        carry * 0.1 -
          reloadState.lower * 0.3 -
          (shake ? (state.strafe || 0) * 0.025 * (1 - ads) : 0) -
          (slide ? 0.05 : 0) -
          Math.sin(phase * 0.5) * 0.012 * stride,
        dt,
        20,
      ),
    );
    const parts = model.userData,
      mechanism = mechanismPose(age);
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
      const locked =
        parts.weaponId === "pistol" &&
        state.ammo === 0 &&
        (!reloading || reload < 0.87);
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
    if (parts.rotor) parts.rotor.rotation.z += dt * (state.spin || 0) * 100;
    if (parts.string?.isLine) {
      const p = parts.string.geometry.attributes.position;
      p.setZ(1, -0.6 + (state.draw || 0) * 0.16);
      p.needsUpdate = true;
    }
    if (parts.arrow) {
      parts.arrow.visible = !reloading;
      parts.arrow.position.z = (state.draw || 0) * 0.16;
    }
    if (parts.muzzleFlash) {
      parts.muzzleFlash.visible = !!state.flash;
      parts.muzzleFlash.rotation.z = (state.time || 0) * 97;
      parts.muzzleFlash.scale.setScalar(
        1 + Math.sin((state.time || 0) * 177) * 0.2,
      );
    }
    if (state.heal > 0) {
      model.rotation.set(-0.23, 0.2, 0.06);
      model.position.y += 0.055 + Math.sin((state.time || 0) * 5) * 0.005;
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
    if (state.swing > 0) {
      const t = 1 - state.swing / 0.28;
      const cut = smooth(t / 0.48) * (1 - smooth((t - 0.5) / 0.5));
      if (parts.weaponId === "fists" || parts.weaponId === "knife") {
        model.position.z -= cut * (parts.weaponId === "fists" ? 0.08 : 0.24);
        if (parts.weaponId === "fists" && parts.hands?.[0])
          parts.hands[0].position.z -= cut * 0.22;
        model.position.x -= cut * 0.035;
        model.rotation.x -= cut * 0.16;
      } else {
        model.rotation.z -= cut * 1.05;
        model.rotation.y -= cut * 0.6;
        model.rotation.x -= Math.sin(t * Math.PI) * 0.15;
        model.position.x -= cut * 0.06;
        if (parts.slashTrail) {
          parts.slashTrail.visible = t > 0.17 && t < 0.72;
          parts.slashTrail.material.opacity =
            Math.sin(saturate((t - 0.17) / 0.55) * Math.PI) * 0.35;
        }
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
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  mesh.visible = false;
  return mesh;
}
