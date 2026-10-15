import * as THREE from "three";
import { WEAPONS } from "./data.js";
import { THROWN_UTILITIES, createThrownModel } from "./throwables.js";
// Identical offline/online presentation; the server only uses an Object3D pose.
export function createProjectileModel(id) {
  if (THROWN_UTILITIES.has(id)) return createThrownModel(id);
  const weapon = WEAPONS[id];
  if (!weapon) throw Error("Unknown projectile");
  const arrow = weapon.type === "bow",
    rocket = weapon.type === "rocket";
  const mesh = new THREE.Mesh(
    arrow
      ? new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6)
      : rocket
        ? new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8)
        : new THREE.IcosahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({
      color: rocket ? 0xffc99a : weapon.color,
      emissive: rocket ? 0xe96920 : 0,
      emissiveIntensity: 0.8,
    }),
  );
  if (arrow) {
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.065, 0.16, 6),
      new THREE.MeshStandardMaterial({
        color: 0xbbccd3,
        metalness: 0.65,
        roughness: 0.25,
      }),
    );
    tip.position.y = 0.48;
    mesh.add(tip);
  }
  mesh.name = "projectile-" + id;
  return mesh;
}
