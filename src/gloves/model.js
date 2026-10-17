import { batchFixedMeshes } from "../batching.js";
import { abilityPose } from "./ability-motion.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { gloveFinish, createSweep } from "./finishes.js";
import { gloveMotion, slapPose } from "./motion.js";
export { slapPose } from "./motion.js";
import { addGloveDetails } from "./model-details.js";
import * as THREE from "three";
import { GLOVES } from "./catalog.js";
const rounded = (w, h, d, r = 0.035) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w * 0.22, h * 0.22, d * 0.22));
export function createGloveModel(id, options = {}) {
  const glove = GLOVES[id];
  const root = new THREE.Group();
  root.name = `original-${id}-rig`;
  const palm = new THREE.Group(),
    wrist = new THREE.Group();
  root.add(wrist);
  wrist.add(palm);
  const main = gloveFinish(
    glove.key === "default" ? "#bca98b" : glove.color,
    glove.key,
  );
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
  if (glove.key === "default") {
    trim.color.set("#d7ac69");
    trim.emissive.set("#b98b42");
  }
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
  box(palm, 0.31, 0.245, 0.025, 0, 0.13, 0.089, dark);
  const panel = box(palm, 0.265, 0.208, 0.027, 0, 0.13, 0.106, main);
  panel.name = "raised-backhand-panel";
  // Raised saddle seams and wrist stitching catch the grazing key light.
  for (const sign of [-1, 1]) {
    box(palm, 0.012, 0.265, 0.012, sign * 0.171, 0.12, 0.082, trim);
    for (let i = 0; i < 5; i++)
      box(
        wrist,
        0.017,
        0.006,
        0.012,
        sign * 0.101,
        -0.18 - i * 0.039,
        0.119,
        trim,
      );
  }
  box(wrist, 0.285, 0.065, 0.26, 0, -0.31, 0.015, main);
  box(wrist, 0.075, 0.079, 0.027, 0.047, -0.31, 0.157, trim);
  for (let i = 0; i < 3; i++)
    box(palm, 0.056, 0.09, 0.018, (i - 1) * 0.069, 0.015, -0.09, dark);
  if (glove.key === "default" || glove.key === "dual") {
    box(palm, 0.18, 0.15, 0.018, 0, 0.13, 0.128, dark);
    for (const x of [-0.038, 0.038]) {
      const crest = box(palm, 0.025, 0.095, 0.015, x, 0.14, 0.145, trim);
      crest.rotation.z = x < 0 ? -0.4 : 0.4;
    }
    box(palm, 0.1, 0.018, 0.014, 0, 0.088, 0.145, trim);
  }
  // Four individually articulated fingers and an opposable thumb, not a mitten silhouette.
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const joint = new THREE.Group();
    joint.position.set((i - 1.5) * 0.103, 0.29, 0);
    palm.add(joint);
    const length = [0.25, 0.32, 0.3, 0.23][i];
    joint.name = `finger-${i}-proximal`;
    joint.rotation.z = (i - 1.5) * -0.055;
    box(joint, 0.086, length * 0.4, 0.145, 0, length * 0.2, 0);
    box(joint, 0.09, 0.045, 0.153, 0, 0.045, 0.004, trim);
    const mid = new THREE.Group();
    mid.name = `finger-${i}-middle`;
    mid.position.y = length * 0.4;
    joint.add(mid);
    box(mid, 0.081, length * 0.34, 0.137, 0, length * 0.17, 0);
    const distal = new THREE.Group();
    distal.name = `finger-${i}-tip`;
    distal.position.y = length * 0.34;
    mid.add(distal);
    box(distal, 0.076, length * 0.27, 0.13, 0, length * 0.135, 0);
    box(mid, 0.065, 0.022, 0.012, 0, length * 0.14, 0.073, dark);
    box(distal, 0.058, 0.025, 0.012, 0, length * 0.11, 0.069, trim);
    joint.userData.phalanges = [mid, distal];
    fingers.push(joint);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.215, 0.09, 0);
  thumb.rotation.z = 0.65;
  palm.add(thumb);
  box(thumb, 0.12, 0.22, 0.15, 0, 0.08, 0);
  box(thumb, 0.125, 0.055, 0.16, 0, 0.13, 0, trim);
  const thumbTip = new THREE.Group();
  thumbTip.position.y = 0.18;
  thumb.add(thumbTip);
  box(thumbTip, 0.105, 0.075, 0.135, 0, 0.035, 0);
  thumb.userData.phalanges = [thumbTip];
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
  addGloveDetails(glove, { palm, wrist, box, main, dark, trim });
  // Preserve every articulated joint; merge only fixed same-material siblings.
  // This keeps the exact triangles, textures and animation with fewer submissions.
  const batching = { before: 0, after: 0 };
  if (options.batch !== false) {
    const bones = [];
    wrist.traverse((o) => {
      if (o.isGroup) bones.push(o);
    });
    for (const bone of bones) {
      const result = batchFixedMeshes(bone, { opaqueOnly: true });
      batching.before += result.before;
      batching.after += result.after;
    }
  }
  const sweep = createSweep(glove.color);
  root.add(sweep);
  // Palm faces left/front in first person, with visible open fingers.
  root.position.set(0.35, -0.39, -0.9);
  if (options.hands !== false) root.scale.setScalar(0.54);
  root.rotation.set(0.12, -0.55, -0.28);
  root.userData = {
    id,
    weaponId: id,
    glove: true,
    batching,
    gloveRig: { wrist, palm, fingers, trim, main, sweep },
    basePosition: root.position.clone(),
    baseRotation: root.rotation.clone(),
    botRightGrip: new THREE.Vector3(0, -0.4, 0),
    botLeftGrip: new THREE.Vector3(-0.28, -0.48, 0),
  };
  if (options.hands === false) {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
  }
  if (glove.key === "dual" && !options.single) {
    const second = createGloveModel(id, {
      ...options,
      single: true,
      hands: false,
    });
    second.position.set(-1.25, -0.04, -0.03);
    second.rotation.set(0, 0.25, 0.18);
    second.scale.set(-1, 1, 1);
    root.add(second);
    root.userData.secondGlove = second;
  }
  return root;
}
export function animateGlove(model, state) {
  const glove = GLOVES[model.userData.id],
    rig = model.userData.gloveRig;
  const rawAge = state.gloveSwingAge ?? 10;
  // Brief presentation-only contact hold. Simulation, input and mouse aim never pause.
  const age =
    state.shake !== false && state.gloveImpact > 0.1
      ? Math.min(rawAge, glove.windup + 0.008)
      : rawAge;
  const p = gloveMotion(glove.key, age, glove.windup, state.gloveSequence ?? 1),
    cast = abilityPose(glove.key, state.gloveCastAge);
  const bob =
    state.shake === false
      ? 0
      : Math.sin(state.phase || 0) *
        Math.min(0.012, (state.speed || 0) * 0.0015);
  model.position.copy(model.userData.basePosition);
  model.position.x += p.x + cast.x;
  model.position.y += p.y + cast.y + bob - (state.gloveRagdoll > 0 ? 0.24 : 0);
  model.position.z += p.z + cast.z + (state.slide ? 0.09 : 0);
  model.rotation.copy(model.userData.baseRotation);
  model.rotation.y += p.ry + cast.ry;
  model.rotation.z += p.rz + cast.rz;
  model.rotation.x += p.rx + cast.rx;
  const stop = state.shake === false ? 0 : Math.max(0, state.gloveImpact || 0);
  model.position.z += Math.sin(stop * 100) * stop * 0.18;
  for (let i = 0; i < 5; i++) {
    const digit = rig.fingers[i],
      curl =
        Math.max(-0.1, p.curl + cast.curl) * (i === 4 ? 0.55 : 1 + i * 0.07);
    digit.rotation.x = curl;
    for (const [j, bone] of (digit.userData.phalanges || []).entries())
      bone.rotation.x = curl * (j === 0 ? 1.25 : 0.8);
  }
  rig.sweep.visible =
    p.trail > 0.01 && state.shake !== false && !(state.gloveRagdoll > 0);
  rig.sweep.material.uniforms.alpha.value = p.trail * 0.42;
  rig.sweep.rotation.z = p.side * (0.3 - p.strike * 1.4);
  rig.sweep.scale.x = p.side;
  rig.wrist.rotation.x =
    (state.gloveRagdoll > 0 ? -0.3 : 0) +
    Math.sin((state.time || 0) * 1.7) * 0.008;
  rig.wrist.rotation.z = cast.rz * 0.3;
  rig.trim.emissiveIntensity =
    0.18 +
    (state.gloveStone > 0 ? 0.6 : 0) +
    (state.gloveGold > 0 ? 0.8 : 0) +
    (state.gloveReverse > 0 ? 0.55 : 0) +
    stop * 2;
  if (rig.main) {
    rig.main.transparent = glove.key === "ghost" || state.gloveGhost > 0;
    rig.main.opacity =
      state.gloveGhost > 0 ? 0.22 : glove.key === "ghost" ? 0.68 : 1;
  }
  if (glove.key === "acrobat" && state.gloveBoost > 0) {
    const roll = Math.sin(Math.min(1, 1 - state.gloveBoost / 0.5) * Math.PI);
    model.rotation.z -= roll * 0.5;
    model.position.y -= roll * 0.18;
  }
  if (model.userData.secondGlove) {
    const second = model.userData.secondGlove;
    second.position.x = -1.25 + p.strike * 0.9;
    second.rotation.z = 0.18 + p.strike * 1.2 + p.follow * 0.2;
    for (const digit of second.userData.gloveRig.fingers) {
      digit.rotation.x = p.curl;
      for (const bone of digit.userData.phalanges || [])
        bone.rotation.x = p.curl;
    }
  }
  if (glove.key === "spring")
    rig.wrist.scale.y = 1 + Math.sin((state.time || 0) * 5) * 0.025;
}
