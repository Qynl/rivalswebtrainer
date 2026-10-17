import test from "node:test";
import assert from "node:assert/strict";
import { createOperator } from "../src/character-model.js";
import { createGloveModel } from "../src/gloves/model.js";
function meshes(root) {
  const list = [];
  root.traverse((o) => {
    if (o.isMesh) list.push(o);
  });
  return list;
}
function dispose(root) {
  const geos = new Set(),
    mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) mats.add(o.material);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) {
    m.map?.dispose();
    m.bumpMap?.dispose();
    m.dispose();
  }
}
for (const [kind, create] of [
  [
    "operator",
    () => createOperator(1, "OWNED BUFFERS", { unarmed: true }).group,
  ],
  ["glove", () => createGloveModel("glove_default")],
]) {
  test(`${kind} template reuse preserves exact geometry while actor buffers/disposal stay independent`, () => {
    const a = create(),
      b = create(),
      am = meshes(a),
      bm = meshes(b);
    assert.equal(am.length, bm.length);
    assert.ok(am.length > 5);
    for (let i = 0; i < am.length; i++) {
      assert.notEqual(am[i].geometry, bm[i].geometry);
      for (const key of ["position", "normal", "uv"]) {
        const av = am[i].geometry.attributes[key],
          bv = bm[i].geometry.attributes[key];
        if (av && bv) {
          assert.notEqual(av.array, bv.array);
          assert.deepEqual(av.array, bv.array);
        }
      }
    }
    const expected = bm[0].geometry.attributes.position.array.slice();
    am[0].geometry.attributes.position.array.fill(0);
    dispose(a);
    assert.deepEqual(bm[0].geometry.attributes.position.array, expected);
    const c = create();
    assert.deepEqual(meshes(c)[0].geometry.attributes.position.array, expected);
    dispose(b);
    dispose(c);
  });
}
