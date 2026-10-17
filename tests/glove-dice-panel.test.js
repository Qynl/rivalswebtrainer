import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createDicePanel,
  animateDicePanel,
  DICE_FACES,
} from "../src/gloves/dice-panel.js";
import { recordDiceOutcome } from "../src/gloves/dice-outcome.js";
test("one bounded 3D pip mesh displays every canonical confirmed face without allocating new GPU buffers", () => {
  const dark = new THREE.MeshStandardMaterial(),
    panel = createDicePanel(dark),
    mesh = panel.children[0],
    geometry = mesh.geometry,
    index = geometry.index,
    positions = geometry.attributes.position.array.slice();
  assert.equal(panel.children.length, 1);
  const perPip = geometry.drawRange.count / 7;
  for (let roll = 1; roll <= 6; roll++) {
    animateDicePanel(panel, roll, 0);
    assert.equal(panel.userData.roll, roll);
    assert.equal(geometry.drawRange.count, perPip * roll);
    assert.equal(mesh.geometry, geometry);
    assert.equal(geometry.index, index);
    assert.deepEqual(geometry.attributes.position.array, positions);
    const active = Array.from(index.array.slice(0, geometry.drawRange.count));
    assert.ok(active.every((i) => i < geometry.attributes.position.count));
    assert.equal(DICE_FACES[roll].length, roll);
  }
  const version = index.version;
  animateDicePanel(panel, 6, 0.2);
  assert.equal(
    index.version,
    version,
    "unchanged faces must not re-upload their index buffers",
  );
  mesh.geometry.dispose();
  mesh.material.dispose();
  dark.dispose();
});
test("roll flashes settle, respect reduced motion and reject impossible faces without changing base material", () => {
  const dark = new THREE.MeshStandardMaterial(),
    panel = createDicePanel(dark),
    mesh = panel.children[0];
  animateDicePanel(panel, 6, 0);
  assert.ok(mesh.material.emissiveIntensity > 0.8);
  animateDicePanel(panel, 6, 1);
  assert.equal(mesh.material.emissiveIntensity, 0.025);
  animateDicePanel(panel, 6, 0, false);
  assert.equal(mesh.material.emissiveIntensity, 0.025);
  assert.equal(dark.emissiveIntensity, 1);
  for (const value of [7, 0, -1, 2.5, NaN, "6"]) {
    animateDicePanel(panel, value, 0);
    assert.equal(panel.userData.roll, 0);
    assert.equal(mesh.material.emissiveIntensity, 0);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
  dark.dispose();
});
test("a disposed or mutated pip panel never corrupts another model or the CPU template", () => {
  const dark = new THREE.MeshStandardMaterial(),
    a = createDicePanel(dark),
    b = createDicePanel(dark),
    expected = b.children[0].geometry.attributes.position.array.slice();
  const expectedIndices = b.children[0].geometry.index.array.slice();
  a.children[0].geometry.index.array.fill(0);
  a.children[0].geometry.attributes.position.array.fill(0);
  a.children[0].geometry.dispose();
  a.children[0].material.dispose();
  assert.deepEqual(b.children[0].geometry.attributes.position.array, expected);
  assert.deepEqual(b.children[0].geometry.index.array, expectedIndices);
  const c = createDicePanel(dark);
  assert.deepEqual(c.children[0].geometry.attributes.position.array, expected);
  for (const panel of [b, c]) {
    panel.children[0].geometry.dispose();
    panel.children[0].material.dispose();
  }
  dark.dispose();
});
test("only real current-round direct Dice authority results set a source model outcome", () => {
  const source = {},
    g = { clock: 4, round: 2 },
    event = { glove: "glove_dice", roll: 6, direct: true, round: 2 };
  assert.equal(recordDiceOutcome(g, event, source), true);
  assert.deepEqual(source, { diceRoll: 6, diceRollAt: 4 });
  for (const patch of [
    { glove: "glove_default" },
    { roll: 7 },
    { roll: "6" },
    { direct: false },
    { round: 1 },
  ]) {
    const body = {};
    assert.equal(recordDiceOutcome(g, { ...event, ...patch }, body), false);
    assert.deepEqual(body, {});
  }
  assert.equal(recordDiceOutcome({ ...g, headless: true }, event, {}), false);
  assert.equal(recordDiceOutcome(g, event, null), false);
});
