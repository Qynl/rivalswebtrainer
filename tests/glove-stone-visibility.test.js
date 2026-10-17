import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCharacter } from "../src/world.js";
import { presentStone, presentRagdoll } from "../src/gloves/ragdoll.js";
const actor = () => ({
  id: "diamond",
  model: createCharacter(1, "STONE", { unarmed: true }),
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  alive: true,
});
function dispose(root) {
  const gs = new Set(),
    ms = new Set();
  root.traverse((o) => {
    if (o.geometry) gs.add(o.geometry);
    if (o.material) ms.add(o.material);
  });
  for (const g of gs) g.dispose();
  for (const m of ms) m.dispose();
}
test("Stone recovery preserves hidden original equipment instead of making all child branches visible", () => {
  const e = actor(),
    hidden = new THREE.Group();
  hidden.name = "intentionally-hidden";
  hidden.visible = false;
  e.model.group.add(hidden);
  const original = [...e.model.group.children].map((c) => [c, c.visible]);
  e.stoneTime = 2.5;
  assert.equal(presentStone({}, e), true);
  for (const [c] of original) assert.equal(c.visible, false);
  e.stoneTime = 0;
  assert.equal(presentStone({}, e), false);
  for (const [c, visible] of original) assert.equal(c.visible, visible, c.name);
  dispose(e.model.group);
});
test("ending Stone cannot resurrect a dormant detailed ragdoll for a frame", () => {
  const e = actor();
  e.ragdollTime = 0.7;
  e.ragdollGeneration = 1;
  presentRagdoll({ clock: 0 }, e, 1 / 120);
  e.ragdollTime = 0;
  presentRagdoll({ clock: 0.8 }, e, 1 / 120);
  assert.equal(e.model.gloveRagdoll.root.visible, false);
  e.stoneTime = 2.5;
  presentStone({}, e);
  e.stoneTime = 0;
  presentStone({}, e);
  assert.equal(e.model.gloveRagdoll.root.visible, false);
  dispose(e.model.group);
});
test("Stone notices new visual branches during activation and restores each branch to its own prior visibility", () => {
  const e = actor();
  e.stoneTime = 2.5;
  presentStone({}, e);
  const added = new THREE.Group(),
    hidden = new THREE.Group();
  hidden.visible = false;
  e.model.group.add(added, hidden);
  presentStone({}, e);
  assert.equal(added.visible, false);
  e.stoneTime = 0;
  presentStone({}, e);
  assert.equal(added.visible, true);
  assert.equal(hidden.visible, false);
  dispose(e.model.group);
});
