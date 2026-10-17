import { gateDormantRig } from "./dormant-rig.js";
import { circleBox, surfaceHeight } from "../physics.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as THREE from "three";
// Presentation-only joint physics. Gameplay launch/collision is shared by the
// offline engine and match authority; no client-authored limb can deal damage.
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const BODY_EXCLUSION = [4, 5, 7, 8, 10, 11, 13, 14];
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
// Presentation support uses actual rotated/ramped gameplay surfaces, not a
// universal y=0 floor. This never moves the authoritative capsule.
export function ragdollFloorHeight(boxes, actor, point) {
  const c = Math.cos(actor.yaw || 0),
    s = Math.sin(actor.yaw || 0);
  const x = actor.x + point.x * c + point.z * s;
  const z = actor.z - point.x * s + point.z * c;
  const worldY = actor.y + point.y;
  let floor = 0;
  for (const box of boxes || []) {
    if (!circleBox(x, z, 0.045, box)) continue;
    const top = surfaceHeight(box, x, z);
    if (top <= worldY + 0.14 && top >= floor) floor = top;
  }
  return floor - actor.y + 0.07;
}
function makeRagdoll(e) {
  const root = gateDormantRig(new THREE.Group());
  root.name = "verlet-articulated-ragdoll";
  const palette = e.model.parts?.materialPalette;
  const armor =
    palette?.armor ||
    new THREE.MeshStandardMaterial({
      color: e.team === 0 ? "#629bba" : "#d27957",
      roughness: 0.62,
      metalness: 0.18,
    });
  const skin =
    palette?.skin ||
    new THREE.MeshStandardMaterial({ color: "#d8a47f", roughness: 0.72 });
  const dark =
    palette?.trim ||
    new THREE.MeshStandardMaterial({ color: "#263846", roughness: 0.7 });
  const cloth = palette?.cloth || dark;
  // Clone only rigid bone details, never the child joints or held-item socket.
  // Geometry/material ownership stays with this actor's full hierarchy.
  const rigid = (name) => {
    const source = e.model.parts?.[name];
    if (!source) return null;
    const group = new THREE.Group();
    group.name = "ragdoll-kit-" + name;
    for (const child of source.children) {
      if (child.isMesh || child.name === "rigid-bone-detail")
        group.add(child.clone(true));
    }
    return group.children.length ? group : null;
  };
  const boneMap = {
    "3:4": ["leftArm", 0.34],
    "4:5": ["leftElbow", 0.4],
    "6:7": ["rightArm", 0.34],
    "7:8": ["rightElbow", 0.4],
    "9:10": ["leftLeg", 0.34],
    "10:11": ["leftKnee", 0.325],
    "12:13": ["rightLeg", 0.34],
    "13:14": ["rightKnee", 0.325],
  };
  const nodes = pose.map((p) => ({
    p: new THREE.Vector3(...p),
    old: new THREE.Vector3(...p),
  }));
  const constraints = links.map(([a, b, width]) => {
    const bone = boneMap[`${a}:${b}`];
    let mesh = bone ? rigid(bone[0]) : null;
    const detailed = !!mesh;
    if (width && !mesh && !["0:1", "1:3", "1:6"].includes(`${a}:${b}`)) {
      mesh = new THREE.Mesh(
        new RoundedBoxGeometry(width, 1, width * 0.9, 2, width * 0.18),
        a === 1 && b === 2 ? skin : cloth,
      );
      mesh.castShadow = true;
    }
    if (mesh) {
      mesh.castShadow = true;
      root.add(mesh);
    }
    return {
      detailed,
      boneLength: bone?.[1] || 1,
      a,
      b,
      length: nodes[a].p.distanceTo(nodes[b].p),
      mesh,
    };
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
  const chest =
    rigid("torso") ||
    new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.44, 0.27, 2, 0.06), armor);
  chest.castShadow = true;
  root.add(chest);
  const ends = [
    [5, 4, "leftHand"],
    [8, 7, "rightHand"],
    [11, 10, "leftFoot"],
    [14, 13, "rightFoot"],
  ].map(([node, previous, name]) => {
    const mesh = rigid(name);
    if (mesh) root.add(mesh);
    return { node, previous, mesh };
  });
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
  root.visible = false;
  e.model.group.add(root);
  return {
    ends,
    handDirection: new THREE.Vector3(),
    handSide: new THREE.Vector3(),
    handMatrix: new THREE.Matrix4(),
    grips: [],
    savedVisibility: [],
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
      rig.originals.forEach(
        (child, i) => (child.visible = rig.savedVisibility[i] ?? true),
      );
      for (const grip of rig.grips) {
        grip.parent.add(grip.weapon);
        grip.weapon.position.copy(grip.position);
        grip.weapon.quaternion.copy(grip.quaternion);
        grip.weapon.scale.copy(grip.scale);
      }
      rig.grips = [];
    }
    return false;
  }
  rig ||= e.model.gloveRagdoll = makeRagdoll(e);
  if (!rig.root.visible) {
    rig.savedVisibility = rig.originals.map((child) => child.visible);
    const held = e.model.parts?.onlineSocket?.userData.weapon;
    const items = held
      ? [
          [held, 8, 7],
          [held.userData.secondGlove, 5, 4],
        ]
      : [];
    for (const [weapon, node, previous] of items) {
      if (!weapon || !weapon.userData.glove) continue;
      rig.grips.push({
        weapon,
        node,
        previous,
        parent: weapon.parent,
        position: weapon.position.clone(),
        quaternion: weapon.quaternion.clone(),
        scale: weapon.scale.clone(),
      });
      rig.root.add(weapon);
      weapon.scale.set(node === 5 ? -0.8 : 0.8, 0.8, 0.8);
      if (weapon.userData.gloveRig?.sweep)
        weapon.userData.gloveRig.sweep.visible = false;
    }
  }
  for (const child of rig.originals) child.visible = false;
  rig.root.visible = true;
  e.model.group.position.set(e.x, e.y, e.z);
  e.model.group.rotation.set(0, e.yaw, 0);
  const generation = e.ragdollGeneration || 0;
  if (rig.generation !== generation) {
    rig.generation = generation;
    const c = Math.cos(e.yaw || 0),
      s = Math.sin(e.yaw || 0);
    const impactX = THREE.MathUtils.clamp(
      ((e.vx || 0) * c - (e.vz || 0) * s) * 0.002,
      -0.055,
      0.055,
    );
    const impactZ = THREE.MathUtils.clamp(
      ((e.vx || 0) * s + (e.vz || 0) * c) * 0.002,
      -0.055,
      0.055,
    );
    for (let i = 0; i < rig.nodes.length; i++) {
      const n = rig.nodes[i];
      n.p.set(...pose[i]);
      n.old.copy(n.p);
      n.old.z += 0.018 * (i % 2 ? 1 : -1);
      n.old.x += ((i % 3) - 1) * 0.015 + impactX * (i < 3 ? 0.7 : 1);
      n.old.z += impactZ * (i < 3 ? 0.7 : 1);
    }
  }
  for (const node of rig.nodes)
    node.floor = ragdollFloorHeight(g.world?.boxes, e, node.p);
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
      // Keep free wrists/elbows/ankles outside the torso volume. Otherwise
      // unconstrained joints can fold through the carrier and hide both hands.
      const pelvis = rig.nodes[0].p,
        chest = rig.nodes[1].p;
      const bx = chest.x - pelvis.x,
        by = chest.y - pelvis.y,
        bz = chest.z - pelvis.z;
      const bodyLength = Math.max(0.001, bx * bx + by * by + bz * bz);
      for (const index of BODY_EXCLUSION) {
        const node = rig.nodes[index],
          p = node.p;
        const t = THREE.MathUtils.clamp(
          ((p.x - pelvis.x) * bx +
            (p.y - pelvis.y) * by +
            (p.z - pelvis.z) * bz) /
            bodyLength,
          0,
          1,
        );
        let x = p.x - (pelvis.x + bx * t),
          y = p.y - (pelvis.y + by * t),
          z = p.z - (pelvis.z + bz * t);
        if (p.y - node.floor < 0.16 && y < 0) y = 0;
        let length = Math.hypot(x, y, z);
        const radius = index === 5 || index === 8 ? 0.43 : 0.29;
        if (length < radius) {
          if (length < 0.00001) {
            x = index < 6 ? -1 : 1;
            y = z = 0;
            length = 1;
          }
          const push = (radius - length) / length;
          p.x += x * push;
          p.y += y * push;
          p.z += z * push;
        }
      }
      for (const n of rig.nodes) {
        n.p.y = Math.max(n.floor, n.p.y);
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
    const length = d.length();
    if (c.detailed) {
      c.mesh.position.copy(a);
      c.mesh.scale.y = length / c.boneLength;
      c.mesh.quaternion.setFromUnitVectors(DOWN, d.normalize());
    } else {
      c.mesh.position.copy(a).add(b).multiplyScalar(0.5);
      c.mesh.scale.y = length;
      c.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    }
  }
  for (const end of [...rig.ends, ...rig.grips]) {
    const mesh = end.mesh || end.weapon;
    if (!mesh) continue;
    const node = rig.nodes[end.node].p;
    const direction = rig.delta
      .copy(node)
      .sub(rig.nodes[end.previous].p)
      .normalize();
    mesh.position.copy(node);
    if (end.weapon) {
      const floor = rig.nodes[end.node].floor;
      const onFloor = node.y - floor < 0.4;
      if (onFloor) {
        // A palm resting on a surface lies flat; arbitrary quaternion roll made
        // the oversized fingers disappear below the floor or stand on edge.
        rig.handDirection.set(direction.x, 0, direction.z);
        if (rig.handDirection.lengthSq() < 0.00001)
          rig.handDirection.set(0, 0, -1);
        rig.handDirection.normalize();
        rig.handSide.crossVectors(rig.handDirection, UP).normalize();
        rig.handMatrix.makeBasis(rig.handSide, rig.handDirection, UP);
        mesh.quaternion.setFromRotationMatrix(rig.handMatrix);
        mesh.position.addScaledVector(rig.handDirection, 0.22);
        mesh.position.y = Math.max(floor + 0.08, mesh.position.y);
      } else {
        mesh.position.addScaledVector(direction, 0.22);
        mesh.quaternion.setFromUnitVectors(UP, direction);
      }
    } else mesh.quaternion.setFromUnitVectors(DOWN, direction);
  }
  for (let i = 0; i < rig.nodes.length; i++) {
    rig.dummy.position.copy(rig.nodes[i].p);
    rig.dummy.updateMatrix();
    rig.jointCaps.setMatrixAt(i, rig.dummy.matrix);
  }
  rig.jointCaps.instanceMatrix.needsUpdate = true;
  rig.head.position.copy(rig.nodes[2].p);
  rig.head.quaternion.setFromUnitVectors(
    UP,
    rig.delta.copy(rig.nodes[2].p).sub(rig.nodes[1].p).normalize(),
  );
  rig.head.rotateY(Math.sin(e.seed || 0) * 0.12);
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
      visibility: new Map(),
      active: false,
    };
    e.model.group.add(mesh);
  }
  if (!stone) return false;
  stone.visibility ||= new Map();
  if (e.stoneTime <= 0) {
    if (stone.active) {
      for (const [child, visible] of stone.visibility)
        if (child.parent === e.model.group) child.visible = visible;
      stone.visibility.clear();
      stone.active = false;
    }
    stone.mesh.visible = false;
    return false;
  }
  for (const child of e.model.group.children) {
    if (child === stone.mesh) continue;
    if (!stone.visibility.has(child))
      stone.visibility.set(child, child.visible);
    child.visible = false;
  }
  stone.mesh.visible = true;
  stone.active = true;
  e.model.group.position.set(e.x, e.y, e.z);
  e.model.group.rotation.set(0, e.yaw, 0);
  return true;
}
