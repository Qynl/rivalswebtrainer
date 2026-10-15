import * as THREE from "three";
import { WEAPONS } from "./data.js";
import { THROWN_UTILITIES, createThrownModel } from "./throwables.js";
// Identical offline/online presentation; the server only uses an Object3D pose.
export function createProjectileModel(id) {
  if (THROWN_UTILITIES.has(id)) return createThrownModel(id);
  const weapon = WEAPONS[id];
  if (!weapon) throw Error("Unknown projectile");
  const arrow = weapon.type === "bow",
    rocket = weapon.type === "rocket",
    launcher = weapon.type === "launcher";
  const mesh = new THREE.Mesh(
    arrow
      ? new THREE.CylinderGeometry(0.008, 0.008, 0.78, 6)
      : rocket
        ? new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8)
        : launcher
          ? new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10)
          : new THREE.IcosahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({
      color: rocket
        ? 0x66704e
        : arrow
          ? 0x38434a
          : launcher
            ? 0x4c6651
            : weapon.color,
      emissive: 0,
      emissiveIntensity: 0.8,
    }),
  );
  if (arrow) {
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.09, 6),
      new THREE.MeshStandardMaterial({
        color: 0xbbccd3,
        metalness: 0.65,
        roughness: 0.25,
      }),
    );
    tip.position.y = 0.435;
    mesh.add(tip);
    for (const angle of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(
        new THREE.PlaneGeometry(0.065, 0.14),
        new THREE.MeshStandardMaterial({
          color: 0xdcb577,
          side: THREE.DoubleSide,
          roughness: 0.7,
        }),
      );
      fin.position.y = -0.29;
      fin.rotation.y = angle;
      mesh.add(fin);
    }
  }
  if (rocket) {
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.071, 0.22, 10),
      new THREE.MeshStandardMaterial({
        color: 0x87916d,
        metalness: 0.3,
        roughness: 0.52,
      }),
    );
    nose.position.y = 0.31;
    mesh.add(nose);
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.074, 0.074, 0.055, 10),
      new THREE.MeshStandardMaterial({
        color: 0x303e40,
        metalness: 0.6,
        roughness: 0.45,
      }),
    );
    tail.position.y = -0.19;
    mesh.add(tail);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.12, 0.009),
        tail.material,
      );
      fin.position.y = -0.15;
      fin.rotation.y = (i * Math.PI) / 2;
      mesh.add(fin);
    }
    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.3, 9),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.5, 1.8, 0.3),
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    exhaust.position.y = -0.36;
    exhaust.rotation.z = Math.PI;
    mesh.add(exhaust);
    mesh.userData.exhaust = exhaust;
  }
  if (launcher) {
    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.061, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x5b795b,
        roughness: 0.48,
        metalness: 0.3,
      }),
    );
    nose.position.y = 0.065;
    mesh.add(nose);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.064, 0.035, 10),
      new THREE.MeshStandardMaterial({
        color: 0xbba36c,
        roughness: 0.34,
        metalness: 0.65,
      }),
    );
    base.position.y = -0.085;
    mesh.add(base);
  }
  mesh.name = "projectile-" + id;
  return mesh;
}
