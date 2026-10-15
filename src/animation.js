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
export class WeaponAnimator {
  constructor() {
    this.x = new Spring(0.09);
    this.y = new Spring(-0.1);
    this.z = new Spring(-0.16);
    this.aim = new Spring();
    this.roll = new Spring();
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
    const ads = this.aim.step(aim ? 1 : 0, dt, 24),
      motion = shake ? (1 - ads) * Math.min(speed / 11.5, 1.4) : 0;
    const reloadState = reloadPose(reloading ? reload : 0),
      stride = grounded ? motion : motion * 0.12;
    const poseX =
      0.09 -
      0.277 * ads +
      Math.sin(phase * 0.5) * 0.009 * stride -
      lookX * (1 - ads);
    const poseY =
      -0.1 -
      0.015 * ads +
      Math.cos(phase) * 0.006 * stride -
      kick * 0.34 -
      swap * 0.65 -
      reloadState.lower * 0.1 -
      (slide ? 0.035 : 0);
    const poseZ = -0.16 + ads * 0.14 + kick * 0.35;
    model.position.set(
      this.x.step(poseX, dt, 26),
      this.y.step(poseY, dt, 24),
      this.z.step(poseZ, dt, 26),
    );
    model.rotation.set(
      kick * 0.7 - reloadState.lower * 0.25 + lookY * (1 - ads),
      reloadState.lower * 0.17 + 0.08 * (1 - ads),
      this.roll.step(
        -reloadState.lower * 0.22 -
          (slide ? 0.05 : 0) -
          Math.sin(phase * 0.5) * 0.012 * stride,
        dt,
        20,
      ),
    );
    const parts = model.userData;
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
      b.position.z += Math.min(0.045, kick * 0.4) + reloadState.rack * 0.055;
    }
    if (parts.pump) {
      const p = parts.pump;
      p.position.copy(p.userData.restPosition);
      p.position.z +=
        Math.max(0, Math.sin(((state.shotAge || 0) * Math.PI) / 0.28)) *
        0.075 *
        ((state.shotAge || 0) < 0.28 ? 1 : 0);
    }
    if (parts.hands?.[1]) {
      const h = parts.hands[1];
      h.position.copy(h.userData.restPosition);
      h.position.y -= reloadState.extract * 0.16;
      h.position.z += reloadState.lower * 0.14;
      h.rotation.z = -reloadState.lower * 0.25;
    }
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
    if (state.swing > 0) {
      const t = 1 - state.swing / 0.28;
      const cut = smooth(t / 0.48) * (1 - smooth((t - 0.5) / 0.5));
      model.rotation.z -= cut * 1.05;
      model.rotation.y -= cut * 0.6;
      model.rotation.x -= Math.sin(t * Math.PI) * 0.15;
      model.position.x -= cut * 0.06;
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
