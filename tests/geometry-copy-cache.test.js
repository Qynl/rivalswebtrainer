import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GeometryCopyCache } from "../src/geometry-copy-cache.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
test("CPU templates build once and return independent exact geometry buffers with ordinary disposal", () => {
  const cache = new GeometryCopyCache(2);
  let built = 0;
  const create = () => {
    built++;
    return new RoundedBoxGeometry(0.4, 0.6, 0.3, 2, 0.035);
  };
  const a = cache.copy("box", create),
    b = cache.copy("box", create),
    reference = create();
  assert.equal(built, 2);
  assert.notEqual(a, b);
  for (const key of ["position", "normal", "uv"]) {
    assert.deepEqual(a.attributes[key].array, reference.attributes[key].array);
    assert.deepEqual(b.attributes[key].array, reference.attributes[key].array);
    assert.notEqual(a.attributes[key].array, b.attributes[key].array);
  }
  const original = b.attributes.position.array.slice();
  a.attributes.position.array.fill(0);
  a.dispose();
  assert.deepEqual(b.attributes.position.array, original);
  const c = cache.copy("box", create);
  assert.deepEqual(c.attributes.position.array, original);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.deepEqual(c.attributes.position.array, original);
  b.dispose();
  c.dispose();
  reference.dispose();
});
test("template eviction is bounded and least-recently-used, never invalidating copied actor geometry", () => {
  const cache = new GeometryCopyCache(2),
    disposed = [],
    built = [];
  const copy = (key) =>
    cache.copy(key, () => {
      built.push(key);
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.addEventListener("dispose", () => disposed.push(key));
      return g;
    });
  const a = copy("a"),
    b = copy("b"),
    a2 = copy("a"),
    c = copy("c");
  assert.equal(cache.size, 2);
  assert.deepEqual(disposed, ["b"]);
  assert.deepEqual(
    b.attributes.position.array,
    new THREE.BoxGeometry(1, 1, 1).attributes.position.array,
  );
  const b2 = copy("b");
  assert.deepEqual(built, ["a", "b", "c", "b"]);
  assert.deepEqual(disposed, ["b", "a"]);
  cache.clear();
  assert.equal(disposed.length, 4);
  for (const g of [a, b, a2, c, b2]) g.dispose();
});
test("failed factories leave existing templates usable and invalid cache budgets are rejected", () => {
  assert.throws(() => new GeometryCopyCache(0), RangeError);
  const cache = new GeometryCopyCache(1),
    a = cache.copy("a", () => new THREE.BoxGeometry());
  assert.throws(
    () =>
      cache.copy("broken", () => {
        throw Error("failed");
      }),
    /failed/,
  );
  assert.equal(cache.size, 1);
  const again = cache.copy("a", () => {
    throw Error("should not rebuild");
  });
  assert.deepEqual(
    again.attributes.position.array,
    a.attributes.position.array,
  );
  cache.clear();
  a.dispose();
  again.dispose();
});
