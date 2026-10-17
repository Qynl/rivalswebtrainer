import * as THREE from "three";
import { GLOVES } from "./catalog.js";
const rounded = (w, h, d, r = 0.04) => new THREE.BoxGeometry(w, h, d); // bevel highlights come from joint caps and layered panels
export function createGloveModel(id, options = {}) {
  const glove = GLOVES[id];
  const root = new THREE.Group();
  root.name = `original-${id}-rig`;
  const palm = new THREE.Group(),
    wrist = new THREE.Group();
  root.add(wrist);
  wrist.add(palm);
  const main = new THREE.MeshStandardMaterial({
    color: glove.color,
    roughness: glove.key === "diamond" ? 0.19 : 0.48,
    metalness: glove.key === "diamond" ? 0.55 : 0.16,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#202d39",
    roughness: 0.58,
    metalness: 0.25,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: glove.color,
    emissive: glove.color,
    emissiveIntensity: 0.18,
    roughness: 0.25,
    metalness: 0.45,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: "#d9a27d",
    roughness: 0.75,
  });
  const box = (parent, w, h, d, x, y, z, material = main) => {
    const m = new THREE.Mesh(rounded(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  box(wrist, 0.22, 0.46, 0.21, 0, -0.31, 0.01, dark);
  box(wrist, 0.255, 0.085, 0.245, 0, -0.12, 0.01, trim);
  if (options.hands !== false) {
    box(wrist, 0.19, 0.32, 0.18, 0, -0.62, 0.01, skin);
    box(wrist, 0.215, 0.1, 0.205, 0, -0.46, 0.01, dark);
  }
  box(palm, 0.39, 0.36, 0.16, 0, 0.13, 0);
  box(palm, 0.3, 0.23, 0.022, 0, 0.13, 0.096, dark);
  // Four individually articulated fingers and an opposable thumb, not a mitten silhouette.
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const joint = new THREE.Group();
    joint.position.set((i - 1.5) * 0.103, 0.29, 0);
    palm.add(joint);
    const length = [0.25, 0.32, 0.3, 0.23][i];
    box(joint, 0.087, length, 0.14, 0, length * 0.5, 0);
    box(joint, 0.092, 0.065, 0.16, 0, 0.09, 0.003, trim);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), main);
    tip.scale.set(1, 1, 1.5);
    tip.position.y = length;
    joint.add(tip);
    fingers.push(joint);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.215, 0.09, 0);
  thumb.rotation.z = 0.65;
  palm.add(thumb);
  box(thumb, 0.12, 0.22, 0.15, 0, 0.08, 0);
  box(thumb, 0.125, 0.055, 0.16, 0, 0.13, 0, trim);
  fingers.push(thumb);
  // Readable, modelled ability identities; no imported Roblox geometry/textures.
  if (glove.key === "diamond") {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), trim);
    crystal.scale.y = 1.35;
    crystal.position.set(0, 0.13, 0.15);
    palm.add(crystal);
    for (let i = 0; i < 3; i++) {
      const c = crystal.clone();
      c.scale.multiplyScalar(0.4);
      c.position.set((i - 1) * 0.14, 0.29, 0.11);
      palm.add(c);
    }
  } else if (glove.key === "extended") {
    box(wrist, 0.09, 0.9, 0.09, 0, -0.76, 0.02, dark);
    box(wrist, 0.16, 0.07, 0.16, 0, -0.96, 0.02, trim);
    box(wrist, 0.16, 0.07, 0.16, 0, -0.57, 0.02, trim);
  } else if (glove.key === "snow") {
    for (let i = 0; i < 3; i++) {
      const bar = box(palm, 0.025, 0.25, 0.024, 0, 0.13, 0.14, trim);
      bar.rotation.z = (i * Math.PI) / 3;
    }
  } else if (glove.key === "flash") {
    for (const [x, y, r] of [
      [-0.045, 0.21, -0.45],
      [0.025, 0.12, -0.45],
    ]) {
      const b = box(palm, 0.065, 0.16, 0.035, x, y, 0.14, trim);
      b.rotation.z = r;
    }
  } else if (glove.key === "spring") {
    const pts = [];
    for (let i = 0; i < 120; i++) {
      const t = i / 119;
      pts.push(
        new THREE.Vector3(
          Math.cos(t * Math.PI * 12) * 0.16,
          -0.5 + t * 0.4,
          Math.sin(t * Math.PI * 12) * 0.16,
        ),
      );
    }
    wrist.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(pts),
          96,
          0.022,
          5,
          false,
        ),
        trim,
      ),
    );
  } else if (glove.key === "pull" || glove.key === "swapper") {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(
        0.11,
        0.022,
        6,
        20,
        glove.key === "pull" ? Math.PI * 1.6 : Math.PI * 2,
      ),
      trim,
    );
    ring.position.set(0, 0.13, 0.14);
    palm.add(ring);
    if (glove.key === "pull") palm.rotation.z = Math.PI;
  } else if (glove.key === "bull") {
    for (let i = 0; i < 4; i++)
      box(palm, 0.085, 0.09, 0.11, (i - 1.5) * 0.1, 0.27, 0.15, dark);
    box(palm, 0.46, 0.12, 0.24, 0, 0.02, 0, dark);
  }
  // Palm faces left/front in first person, with visible open fingers.
  root.position.set(0.48, -0.43, -0.85);
  if (options.hands !== false) root.scale.setScalar(0.6);
  root.rotation.set(0.12, -0.55, -0.28);
  root.userData = {
    id,
    glove: true,
    gloveRig: { wrist, palm, fingers, trim },
    basePosition: root.position.clone(),
    baseRotation: root.rotation.clone(),
    botRightGrip: new THREE.Vector3(0, -0.4, 0),
    botLeftGrip: new THREE.Vector3(-0.28, -0.48, 0),
  };
  if (options.hands === false) {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
  }
  return root;
}
const ease = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
export function slapPose(age, windup = 0.095) {
  if (age < 0 || age > 0.52 + windup) return { wind: 0, strike: 0, recover: 0 };
  const wind = ease(age / windup),
    strike = ease((age - windup) / 0.065),
    recover = ease((age - windup - 0.065) / 0.38);
  return { wind: wind * (1 - strike), strike: strike * (1 - recover), recover };
}
export function animateGlove(model, state) {
  const glove = GLOVES[model.userData.id],
    rig = model.userData.gloveRig;
  const rawAge = state.gloveSwingAge ?? 10;
  // Brief presentation-only contact hold. Simulation, input and mouse aim never pause.
  const age =
    state.shake !== false && state.gloveImpact > 0.1
      ? Math.min(rawAge, glove.windup + 0.02)
      : rawAge;
  const p = slapPose(age, glove.windup);
  const bob =
    state.shake === false
      ? 0
      : Math.sin(state.phase || 0) *
        Math.min(0.012, (state.speed || 0) * 0.0015);
  model.position.copy(model.userData.basePosition);
  model.position.x += p.wind * 0.18 - p.strike * 0.66;
  model.position.y +=
    p.wind * 0.16 + p.strike * 0.08 + bob - (state.gloveRagdoll > 0 ? 0.24 : 0);
  model.position.z +=
    p.wind * 0.15 - p.strike * 0.35 + (state.slide ? 0.06 : 0);
  model.rotation.copy(model.userData.baseRotation);
  model.rotation.y += p.wind * 0.8 - p.strike * 1.3;
  model.rotation.z += p.wind * 0.65 - p.strike * 1.45;
  model.rotation.x += p.wind * 0.2 - p.strike * 0.16;
  const stop = state.shake === false ? 0 : Math.max(0, state.gloveImpact || 0);
  model.position.z += Math.sin(stop * 100) * stop * 0.18;
  for (let i = 0; i < 4; i++)
    rig.fingers[i].rotation.x = -0.08 + p.wind * 0.18 - p.strike * 0.12;
  rig.trim.emissiveIntensity =
    0.18 + (state.gloveStone > 0 ? 0.6 : 0) + stop * 2;
  if (glove.key === "spring")
    rig.wrist.scale.y = 1 + Math.sin((state.time || 0) * 5) * 0.025;
}
