import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ArenaAtmosphere } from "../src/atmosphere.js";

test("the analytic sky stays behind cover without writing depth or casting shadows", () => {
  const sky = new ArenaAtmosphere();
  assert.equal(sky.material.depthWrite, false);
  assert.equal(sky.material.depthTest, true);
  assert.equal(sky.material.depthFunc, THREE.LessEqualDepth);
  assert.equal(sky.mesh.castShadow, false);
  assert.equal(sky.mesh.frustumCulled, false);
  assert.ok(sky.mesh.renderOrder > 0);
  sky.dispose();
});

test("sky updates use the actual render camera and reuse matrix and shader resources", () => {
  const sky = new ArenaAtmosphere(),
    camera = new THREE.PerspectiveCamera(85, 1.6, 0.07, 200);
  const uniforms = sky.material.uniforms,
    projection = uniforms.inverseProjection.value,
    world = uniforms.cameraWorld.value,
    geometry = sky.mesh.geometry,
    material = sky.material;
  camera.position.set(12, 3, -9);
  camera.lookAt(0, 4, 0);
  camera.updateMatrixWorld();
  sky.mesh.onBeforeRender(null, null, camera);
  assert.ok(projection.equals(camera.projectionMatrixInverse));
  assert.ok(world.equals(camera.matrixWorld));
  camera.aspect = 0.5;
  camera.fov = 110;
  camera.updateProjectionMatrix();
  camera.rotation.y += 1.2;
  camera.updateMatrixWorld();
  for (let i = 0; i < 1000; i++) {
    sky.update(i / 60, i % 2 === 0);
    sky.mesh.onBeforeRender(null, null, camera);
  }
  assert.equal(uniforms.inverseProjection.value, projection);
  assert.equal(uniforms.cameraWorld.value, world);
  assert.equal(sky.mesh.geometry, geometry);
  assert.equal(sky.material, material);
  assert.ok(projection.equals(camera.projectionMatrixInverse));
  assert.ok(world.equals(camera.matrixWorld));
  sky.update(60, true);
  assert.equal(uniforms.time.value, 60);
  assert.equal(uniforms.cloudDetail.value, 0);
  sky.update(61, false);
  assert.equal(uniforms.cloudDetail.value, 1);
  sky.dispose();
});

test("sky disposal releases both GPU resource owners and detaches the mesh", () => {
  const scene = new THREE.Scene(),
    sky = new ArenaAtmosphere();
  let geometries = 0,
    materials = 0;
  scene.add(sky.mesh);
  sky.mesh.geometry.addEventListener("dispose", () => geometries++);
  sky.material.addEventListener("dispose", () => materials++);
  sky.dispose();
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
  assert.equal(sky.mesh.parent, null);
  assert.equal(scene.children.length, 0);
});
