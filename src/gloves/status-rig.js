import { gateDormantRig } from "./dormant-rig.js";
import * as THREE from "three";
import { batchFixedMeshes } from "../batching.js";
const mat = (color) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
export function createStatusRig() {
  const root = gateDormantRig(new THREE.Group());
  root.name = "glove-status-aura";
  root.position.y = 0.9;
  const gold = gateDormantRig(new THREE.Group()),
    reverse = gateDormantRig(new THREE.Group()),
    space = gateDormantRig(new THREE.Group());
  gold.name = "golden-sunburst";
  reverse.name = "reverse-chevrons";
  space.name = "space-orbits";
  const amber = mat("#ffd05c"),
    mint = mat("#aee4bd"),
    violet = mat("#b6a5ff");
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), amber);
  shell.material = amber;
  gold.add(shell);
  // A sparse wire shell keeps the actor readable, rather than an opaque shield.
  shell.material = amber.clone();
  shell.material.wireframe = true;
  shell.material.opacity = 0.18;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.21, 0.035), amber);
    m.position.set(Math.cos(a) * 0.83, Math.sin(a) * 0.83, 0);
    m.rotation.z = a - Math.PI / 2;
    gold.add(m);
  }
  batchFixedMeshes(gold);
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, -0.12);
  shape.lineTo(0.05, -0.12);
  shape.lineTo(0.05, -0.25);
  shape.lineTo(0.34, 0);
  shape.lineTo(0.05, 0.25);
  shape.lineTo(0.05, 0.12);
  shape.lineTo(-0.3, 0.12);
  shape.closePath();
  const arrowGeometry = new THREE.ShapeGeometry(shape);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2,
      m = new THREE.Mesh(arrowGeometry.clone(), mint);
    m.position.set(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7);
    m.rotation.y = -a + Math.PI / 2;
    m.rotation.z = i % 2 ? Math.PI : 0;
    reverse.add(m);
  }
  arrowGeometry.dispose();
  batchFixedMeshes(reverse);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.68 + i * 0.075, 0.012, 5, 40),
      violet,
    );
    ring.rotation.set(0.6 + i * 0.7, i * 0.9, 0);
    space.add(ring);
  }
  for (let i = 0; i < 3; i++) {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.065), violet);
    star.name = "orbit-star";
    space.add(star);
  }
  root.add(gold, reverse, space);
  root.userData.systems = { gold, reverse, space };
  return root;
}
export function animateStatusRig(root, actor, time = 0) {
  const { gold, reverse, space } = root.userData.systems;
  gold.visible = actor.goldTime > 0;
  reverse.visible = actor.reverseTime > 0;
  space.visible = actor.spaceTime > 0;
  root.visible = gold.visible || reverse.visible || space.visible;
  if (!root.visible) return;
  if (gold.visible) {
    gold.rotation.set(
      Math.sin(time * 0.8) * 0.12,
      time * 0.65,
      Math.sin(time) * 0.08,
    );
    gold.scale.setScalar(1 + Math.sin(time * 4) * 0.035);
  }
  if (reverse.visible) {
    reverse.rotation.y = -time * 1.7;
    reverse.position.y = Math.sin(time * 3) * 0.04;
  }
  if (space.visible)
    space.children.forEach((o, i) => {
      if (i < 3) o.rotation.z = time * (i % 2 ? -1 : 1) * (0.6 + i * 0.2);
      else {
        const a = time * (1.4 + (i - 3) * 0.25) + ((i - 3) * Math.PI * 2) / 3;
        o.position.set(
          Math.cos(a) * 0.82,
          Math.sin(a * 1.3) * 0.36,
          Math.sin(a) * 0.82,
        );
        o.rotation.y = a;
      }
    });
}
