import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as THREE from "three";
// Presentation-only joint physics. Gameplay launch/collision is shared by the
// offline engine and match authority; no client-authored limb can deal damage.
const UP = new THREE.Vector3(0, 1, 0);
const pose = [
  [0, 0.7, 0],
  [0, 1.18, 0],
  [0, 1.65, 0],
  [-0.33, 1.32, 0],
  [-0.53, 0.98, -0.1],
  [-0.57, 0.66, -0.15],
  [0.33, 1.32, 0],
  [0.53, 0.98, -0.1],
  [0.57, 0.66, -0.15],
  [-0.17, 0.65, 0],
  [-0.18, 0.34, 0],
  [-0.18, 0.08, -0.08],
  [0.17, 0.65, 0],
  [0.18, 0.34, 0],
  [0.18, 0.08, -0.08],
];
const links = [
  [0, 1, 0.33],
  [1, 2, 0.26],
  [1, 3, 0.21],
  [3, 4, 0.14],
  [4, 5, 0.12],
  [1, 6, 0.21],
  [6, 7, 0.14],
  [7, 8, 0.12],
  [0, 9, 0.2],
  [9, 10, 0.19],
  [10, 11, 0.17],
  [0, 12, 0.2],
  [12, 13, 0.19],
  [13, 14, 0.17],
  [3, 6, 0],
  [9, 12, 0],
];
function makeRagdoll(e) {
  const root = new THREE.Group();
  root.name = "verlet-articulated-ragdoll";
  const armor = new THREE.MeshStandardMaterial({
    color: e.team === 0 ? "#629bba" : "#d27957",
    roughness: 0.62,
    metalness: 0.18,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: "#d8a47f",
    roughness: 0.72,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#263846",
    roughness: 0.7,
  });
  const nodes = pose.map((p) => ({
    p: new THREE.Vector3(...p),
    old: new THREE.Vector3(...p),
  }));
  const constraints = links.map(([a, b, width]) => {
    let mesh = null;
    if (width) {
      mesh = new THREE.Mesh(
        new RoundedBoxGeometry(width, 1, width * 0.9, 2, width * 0.18),
        a === 1 && b === 2 ? skin : a >= 9 ? dark : armor,
      );
      mesh.castShadow = true;
      root.add(mesh);
    }
    return { a, b, length: nodes[a].p.distanceTo(nodes[b].p), mesh };
  });
  // Cross constraints keep the shoulders/pelvis anatomically connected.
  for (const [a, b] of [
    [0, 3],
    [0, 6],
    [1, 9],
    [1, 12],
  ])
    constraints.push({
      a,
      b,
      length: nodes[a].p.distanceTo(nodes[b].p),
      mesh: null,
    });
  const head =
    e.model.parts?.head?.clone() ||
    new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.34, 0.29, 2, 0.04), skin);
  head.castShadow = true;
  root.add(head);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.085, 0.02), dark);
  face.position.set(0, 0.04, -0.151);
  if (!e.model.parts?.head) head.add(face);
  else {
    face.geometry.dispose();
    face.material = null;
  }
  const chest = new THREE.Mesh(
    new RoundedBoxGeometry(0.5, 0.44, 0.27, 2, 0.06),
    armor,
  );
  chest.castShadow = true;
  root.add(chest);
  const jointCaps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.082, 10, 8),
    dark,
    pose.length,
  );
  jointCaps.name = "ragdoll-joint-caps";
  jointCaps.castShadow = true;
  jointCaps.frustumCulled = false;
  root.add(jointCaps);
  const originals = [...e.model.group.children];
  e.model.group.add(root);
  return {
    root,
    jointCaps,
    dummy: new THREE.Object3D(),
    nodes,
    constraints,
    head,
    chest,
    originals,
    generation: -1,
    delta: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    anchor: new THREE.Vector3(0, 0.48, 0),
  };
}
export function presentRagdoll(g, e, dt) {
  if (!e.model) return false;
  const active = e.ragdollTime > 0 || !e.alive;
  let rig = e.model.gloveRagdoll;
  if (!active) {
    if (rig?.root.visible) {
      rig.root.visible = false;
      for (const child of rig.originals) child.visible = true;
    }
    return false;
  }
  rig ||= e.model.gloveRagdoll = makeRagdoll(e);
  for (const child of rig.originals) child.visible = false;
  rig.root.visible = true;
  e.model.group.position.set(e.x, e.y, e.z);
  e.model.group.rotation.set(0, e.yaw, 0);
  const generation = e.ragdollGeneration || 0;
  if (rig.generation !== generation) {
    rig.generation = generation;
    for (let i = 0; i < rig.nodes.length; i++) {
      const n = rig.nodes[i];
      n.p.set(...pose[i]);
      n.old.copy(n.p);
      n.old.z += 0.018 * (i % 2 ? 1 : -1);
      n.old.x += ((i % 3) - 1) * 0.015;
    }
  }
  dt = Math.min(0.05, Math.max(0.001, dt));
  const steps = Math.max(1, Math.ceil(dt / (1 / 120))),
    step = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < rig.nodes.length; i++) {
      const n = rig.nodes[i],
        velocity = rig.velocity.copy(n.p).sub(n.old).multiplyScalar(0.965);
      n.old.copy(n.p);
      n.p.add(velocity);
      n.p.y -= 23 * step * step;
    }
    // Pelvis follows the physically launched capsule; the other joints remain free.
    rig.nodes[0].p.lerp(rig.anchor, 0.35);
    for (let iteration = 0; iteration < 7; iteration++) {
      for (const c of rig.constraints) {
        const a = rig.nodes[c.a].p,
          b = rig.nodes[c.b].p,
          delta = rig.delta.copy(b).sub(a),
          length = delta.length();
        if (length < 1e-6) continue;
        delta.multiplyScalar(((length - c.length) / length) * 0.5);
        if (c.a !== 0) a.add(delta);
        b.sub(delta);
      }
      for (const n of rig.nodes) {
        n.p.y = Math.max(0.07 - e.y, n.p.y);
        n.p.x = THREE.MathUtils.clamp(n.p.x, -1.1, 1.1);
        n.p.z = THREE.MathUtils.clamp(n.p.z, -1.1, 1.1);
      }
    }
  }
  for (const c of rig.constraints) {
    if (!c.mesh) continue;
    const a = rig.nodes[c.a].p,
      b = rig.nodes[c.b].p,
      d = rig.delta.copy(b).sub(a);
    c.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    c.mesh.scale.y = d.length();
    c.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  }
  for (let i = 0; i < rig.nodes.length; i++) {
    rig.dummy.position.copy(rig.nodes[i].p);
    rig.dummy.updateMatrix();
    rig.jointCaps.setMatrixAt(i, rig.dummy.matrix);
  }
  rig.jointCaps.instanceMatrix.needsUpdate = true;
  rig.head.position.copy(rig.nodes[2].p);
  rig.head.rotation.set(
    0.4,
    Math.sin((e.seed || 0) + g.clock * 2) * 0.35,
    0.25,
  );
  const chest = rig.nodes[1].p,
    pelvis = rig.nodes[0].p;
  rig.chest.position.copy(chest).add(pelvis).multiplyScalar(0.5);
  rig.chest.quaternion.setFromUnitVectors(
    UP,
    rig.delta.copy(chest).sub(pelvis).normalize(),
  );
  return true;
}

export function presentStone(g, e) {
  if (!e.model) return false;
  let stone = e.model.gloveStone;
  if (e.stoneTime > 0 && !stone) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.87, 1),
      new THREE.MeshStandardMaterial({
        color: "#647984",
        roughness: 0.5,
        metalness: 0.34,
        flatShading: true,
      }),
    );
    mesh.position.y = 0.83;
    mesh.scale.set(1, 0.9, 0.9);
    mesh.castShadow = true;
    mesh.name = "diamond-stone-form";
    stone = e.model.gloveStone = {
      mesh,
      originals: [...e.model.group.children],
      active: false,
    };
    e.model.group.add(mesh);
  }
  if (!stone) return false;
  if (e.stoneTime <= 0) {
    if (stone.active) {
      for (const child of stone.originals) child.visible = true;
      stone.active = false;
    }
    stone.mesh.visible = false;
    return false;
  }
  for (const child of stone.originals) child.visible = false;
  stone.mesh.visible = true;
  stone.active = true;
  e.model.group.position.set(e.x, e.y, e.z);
  e.model.group.rotation.set(0, e.yaw, 0);
  return true;
}
