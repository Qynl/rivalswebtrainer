import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { gateDormantRig } from "../src/gloves/dormant-rig.js";
test("hidden presentation rigs avoid descendant world-matrix walks without detaching disposable resources", () => {
  const parent = new THREE.Group(),
    rig = gateDormantRig(new THREE.Group()),
    child = new THREE.Object3D();
  let visits = 0;
  const original = child.updateMatrixWorld;
  child.updateMatrixWorld = function (force) {
    visits++;
    return original.call(this, force);
  };
  parent.add(rig);
  rig.add(child);
  rig.visible = false;
  for (let i = 0; i < 120; i++) {
    parent.position.x = i;
    parent.updateMatrixWorld(true);
  }
  assert.equal(visits, 0);
  assert.equal(rig.parent, parent);
  let traversed = 0;
  parent.traverse(() => traversed++);
  assert.equal(traversed, 3);
  rig.visible = true;
  child.position.y = 2;
  parent.updateMatrixWorld(true);
  assert.equal(visits, 1);
  assert.deepEqual(
    child.getWorldPosition(new THREE.Vector3()).toArray(),
    [119, 2, 0],
  );
});
test("reactivated rigs have exactly the same matrices as normal Three groups after hidden motion", () => {
  const normal = new THREE.Group(),
    optimized = gateDormantRig(new THREE.Group());
  const a = new THREE.Object3D(),
    b = new THREE.Object3D();
  normal.add(a);
  optimized.add(b);
  optimized.visible = false;
  for (let i = 0; i < 20; i++) {
    for (const g of [normal, optimized]) {
      g.position.set(i, i * 0.2, -i);
      g.rotation.y = i * 0.15;
      g.children[0].position.set(0.2, i * 0.1, 0.5);
      g.updateMatrixWorld(true);
    }
  }
  optimized.visible = true;
  optimized.updateMatrixWorld(true);
  assert.deepEqual([...a.matrixWorld.elements], [...b.matrixWorld.elements]);
});
test("explicit hidden-world queries still work and normal disposal traversal is untouched", () => {
  const parent = new THREE.Group(),
    rig = gateDormantRig(new THREE.Group()),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
  parent.add(rig);
  rig.add(mesh);
  rig.visible = false;
  parent.position.x = 7;
  rig.updateWorldMatrix(true, true);
  assert.equal(mesh.matrixWorld.elements[12], 7);
  let found = 0;
  parent.traverse((o) => {
    if (o.geometry) {
      found++;
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  assert.equal(found, 1);
});

test("an active aura on a hidden actor also avoids invisible branch matrix work", () => {
  const parent = new THREE.Group(),
    rig = gateDormantRig(new THREE.Group()),
    child = new THREE.Object3D();
  let visits = 0;
  child.updateMatrixWorld = () => {
    visits++;
  };
  parent.add(rig);
  rig.add(child);
  parent.visible = false;
  parent.updateMatrixWorld(true);
  assert.equal(visits, 0);
  parent.visible = true;
  parent.updateMatrixWorld(true);
  assert.equal(visits, 1);
});

test("inactive status animation keeps invisible branches dormant and resumes the exact absolute-time visible pose", async () => {
  const { createStatusRig, animateStatusRig } =
    await import("../src/gloves/status-rig.js");
  const root = createStatusRig(),
    actor = { goldTime: 1 };
  animateStatusRig(root, actor, 1);
  const gold = root.userData.systems.gold,
    before = gold.rotation.clone();
  actor.goldTime = 0;
  animateStatusRig(root, actor, 2);
  assert.equal(root.visible, false);
  assert.ok(gold.rotation.equals(before));
  actor.spaceTime = 1;
  animateStatusRig(root, actor, 3);
  assert.ok(gold.rotation.equals(before));
  actor.spaceTime = 0;
  actor.goldTime = 1;
  animateStatusRig(root, actor, 4);
  assert.equal(gold.rotation.y, 2.6);
  const gs = new Set(),
    ms = new Set();
  root.traverse((o) => {
    if (o.geometry) gs.add(o.geometry);
    if (o.material) ms.add(o.material);
  });
  for (const g of gs) g.dispose();
  for (const m of ms) m.dispose();
});
