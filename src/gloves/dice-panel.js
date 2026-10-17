import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export const DICE_FACES = Object.freeze([
  Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  Object.freeze([6]),
  Object.freeze([0, 5]),
  Object.freeze([0, 5, 6]),
  Object.freeze([0, 2, 3, 5]),
  Object.freeze([0, 2, 3, 5, 6]),
  Object.freeze([0, 1, 2, 3, 4, 5]),
]);
let template;
function panelTemplate() {
  if (template) return template;
  const points = [
      [-0.08, -0.08],
      [-0.08, 0],
      [-0.08, 0.08],
      [0.08, -0.08],
      [0.08, 0],
      [0.08, 0.08],
      [0, 0],
    ],
    parts = points.map(([x, y]) =>
      new THREE.SphereGeometry(0.023, 8, 6).translate(x, 0.15 + y, 0.225),
    );
  const stride = parts[0].index.count,
    geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const faces = DICE_FACES.map((pips) =>
    Uint16Array.from(
      pips.flatMap((p) =>
        Array.from(geometry.index.array.slice(p * stride, (p + 1) * stride)),
      ),
    ),
  );
  return (template = { geometry, faces });
}
export function createDicePanel(dark) {
  const panel = new THREE.Group();
  panel.name = "confirmed-dice-panel";
  const geometry = new THREE.BufferGeometry().copy(panelTemplate().geometry);
  geometry.index.setUsage(THREE.DynamicDrawUsage);
  const material = dark.clone();
  material.name = "dice-result-pips";
  material.emissive.setHex(0xffc65d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  panel.add(mesh);
  panel.userData.roll = -1;
  animateDicePanel(panel, 0, 10, false);
  return panel;
}
export function animateDicePanel(panel, value, age = 10, motion = true) {
  if (!panel) return;
  const roll = Number.isInteger(value) && value >= 1 && value <= 6 ? value : 0,
    mesh = panel.children[0];
  if (panel.userData.roll !== roll) {
    const face = panelTemplate().faces[roll];
    mesh.geometry.index.array.set(face);
    mesh.geometry.index.needsUpdate = true;
    mesh.geometry.setDrawRange(0, face.length);
    panel.userData.roll = roll;
  }
  const pulse =
    roll && motion && Number.isFinite(age) && age >= 0
      ? Math.max(0, 1 - age / 0.65)
      : 0;
  mesh.material.emissiveIntensity =
    (roll ? 0.025 : 0) + pulse * (roll === 6 ? 0.9 : 0.48);
}
