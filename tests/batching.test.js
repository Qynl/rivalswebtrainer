import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { batchFixedMeshes } from "../src/batching.js";

test("batching copies exact parametric vertex data without rebuilding its expensive geometry constructors", () => {
  let constructions = 0;
  class CountedRoundBox extends RoundedBoxGeometry {
    constructor(...args) {
      super(...args);
      constructions++;
    }
  }
  const group = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    meshes = [
      new THREE.Mesh(new CountedRoundBox(0.7, 0.4, 0.6, 2, 0.04), material),
      new THREE.Mesh(new CountedRoundBox(0.3, 0.8, 0.5, 2, 0.03), material),
    ];
  group.position.set(3, 2, -5);
  meshes[0].position.set(-2, 0.4, 1);
  meshes[1].position.set(2, -0.3, -1);
  meshes[1].rotation.set(0.1, 0.2, 0.3);
  meshes[0].scale.set(1.2, 0.8, 1.1);
  group.add(...meshes);
  group.updateMatrixWorld(true);
  const expected = meshes.map((m) =>
    new THREE.BufferGeometry().copy(m.geometry).applyMatrix4(m.matrix),
  );
  const retained = meshes[0].geometry,
    originalPositions = retained.attributes.position.array.slice();
  const stats = batchFixedMeshes(group, { rayMeshes: [meshes[0]] });
  assert.equal(
    constructions,
    2,
    "a clone must not execute RoundedBoxGeometry again only to overwrite its output",
  );
  assert.equal(stats.after, 1);
  assert.equal(stats.retainedRayMeshes, 1);
  const batch = group.children.find((o) => o.name === "static-batch");
  assert.ok(batch);
  for (const name of ["position", "normal", "uv"]) {
    const actual = batch.geometry.attributes[name].array,
      first = expected[0].attributes[name].array,
      second = expected[1].attributes[name].array;
    assert.deepEqual(actual.slice(0, first.length), first);
    assert.deepEqual(actual.slice(first.length), second);
  }
  assert.equal(meshes[0].geometry, retained);
  assert.deepEqual(
    retained.attributes.position.array,
    originalPositions,
    "ray-only original must never receive baked transforms",
  );
  assert.equal(meshes[0].parent.visible, false);
  expected.forEach((g) => g.dispose());
  group.traverse((o) => o.geometry?.dispose());
  material.dispose();
});
