import { BRICK_LIFETIME } from "./balance.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { batchFixedMeshes } from "../batching.js";
import {
  circleBox,
  surfaceHeight,
  rampGradient,
  canOccupy,
} from "../physics.js";
function support(boxes, x, z, maxY, minY) {
  let y = minY <= 0 && maxY >= 0 ? 0 : -Infinity,
    box = null;
  for (const b of boxes || [])
    if (circleBox(x, z, 0.005, b)) {
      const top = surfaceHeight(b, x, z);
      if (top >= minY && top <= maxY && top > y) {
        y = top;
        box = b;
      }
    }
  return { y, box };
}
export function brickPlacement(body, yaw, boxes) {
  if (![body.x, body.y, body.z, yaw].every(Number.isFinite)) return null;
  const p = {
    x: body.x + Math.sin(yaw) * 0.9,
    y: body.y,
    z: body.z + Math.cos(yaw) * 0.9,
  };
  const floor = support(boxes, p.x, p.z, body.y + 0.6, body.y - 0.6);
  if (!Number.isFinite(floor.y)) return null;
  p.y = floor.y;
  const gradient = floor.box ? rampGradient(floor.box) : { x: 0, z: 0 };
  // Require support under the whole brick, not just its center: no floating
  // ledge traps. Sloped support is evaluated in the actual authored ramp plane.
  for (const dx of [-0.31, 0.31])
    for (const dz of [-0.16, 0.16]) {
      const expected = p.y + gradient.x * dx + gradient.z * dz;
      if (
        !Number.isFinite(
          support(boxes, p.x + dx, p.z + dz, expected + 0.08, expected - 0.08)
            .y,
        )
      )
        return null;
    }
  return canOccupy(
    { radius: 0.4, height: 0.2 },
    p.x,
    p.y,
    p.z,
    boxes || [],
    0.2,
  )
    ? p
    : null;
}
export function alignBrickModel(root, boxes, p) {
  const floor = support(boxes, p.x, p.z, p.y + 0.04, p.y - 0.04);
  const slope = floor.box ? rampGradient(floor.box) : { x: 0, z: 0 };
  root.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-slope.x, 1, -slope.z).normalize(),
  );
}
export function animateBrick(root, life, clock = 0) {
  const rig = root.userData.brickRig;
  if (!rig) return;
  const arming = life > BRICK_LIFETIME - 0.4,
    expiring = life < 1.2;
  const pulse =
    arming || expiring
      ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(clock * (arming ? 25 : 14)))
      : 1;
  rig.signal.emissiveIntensity = 0.45 + pulse * 0.8;
  rig.signal.color.setHex(arming ? 0x985e32 : 0xe0ac5b);
  root.userData.armed = !arming;
}
export function createBrickModel() {
  const root = new THREE.Group();
  root.name = "original-trip-brick";
  const material = new THREE.MeshStandardMaterial({
    color: "#db7655",
    roughness: 0.52,
    metalness: 0.08,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#343f43",
    roughness: 0.8,
  });
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(0.7, 0.14, 0.38, 2, 0.018),
    material,
  );
  base.position.y = 0.07;
  root.add(base);
  const lip = new THREE.Mesh(
    new RoundedBoxGeometry(0.66, 0.024, 0.34, 1, 0.008),
    dark,
  );
  lip.position.y = 0.019;
  root.add(lip);
  for (let i = 0; i < 4; i++) {
    const stud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.066, 0.066, 0.055, 12),
      material,
    );
    stud.position.set(
      ((i % 2) - 0.5) * 0.34,
      0.165,
      (Math.floor(i / 2) - 0.5) * 0.18,
    );
    root.add(stud);
  }
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  batchFixedMeshes(root, { opaqueOnly: true });
  const signal = new THREE.MeshStandardMaterial({
    color: 0xe0ac5b,
    emissive: 0xbe7326,
    emissiveIntensity: 1,
    roughness: 0.45,
  });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.016, 0.014), signal);
  led.position.set(0, 0.106, -0.191);
  root.add(led);
  root.userData.brickRig = { signal };
  animateBrick(root, 9, 0);
  return root;
}
