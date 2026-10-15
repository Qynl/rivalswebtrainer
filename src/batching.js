import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Batch only fixed siblings. Joint groups, custom shaders, shadow flags and draw
// order stay intact. For the arena, original collision meshes live in a hidden
// ray-only group: accurate windows/slopes are not replaced with bounding boxes.
export function batchFixedMeshes(group, { rayMeshes = null } = {}) {
  const batches = new Map(),
    solid = new Set(rayMeshes || []),
    rayGroup = new THREE.Group();
  rayGroup.name = "collision-only";
  rayGroup.visible = false;
  group.updateMatrixWorld(true);
  let before = 0,
    after = 0;
  for (const mesh of [...group.children]) {
    if (
      !mesh.isMesh ||
      Array.isArray(mesh.material) ||
      !mesh.geometry.attributes.uv
    )
      continue;
    before++;
    const key = [
      mesh.material.uuid,
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.renderOrder,
    ].join(":");
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(mesh);
  }
  for (const meshes of batches.values()) {
    after++;
    if (meshes.length === 1) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) {
      after += meshes.length - 1;
      continue;
    }
    const first = meshes[0],
      visual = new THREE.Mesh(merged, first.material);
    visual.castShadow = first.castShadow;
    visual.receiveShadow = first.receiveShadow;
    visual.renderOrder = first.renderOrder;
    visual.name = "static-batch";
    for (const mesh of meshes) {
      group.remove(mesh);
      if (solid.has(mesh)) rayGroup.add(mesh);
      else mesh.geometry.dispose();
    }
    group.add(visual);
  }
  if (rayGroup.children.length) group.add(rayGroup);
  group.updateMatrixWorld(true);
  return { before, after, retainedRayMeshes: rayGroup.children.length };
}
