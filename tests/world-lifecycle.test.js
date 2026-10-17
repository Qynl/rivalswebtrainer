import test from "node:test";
import assert from "node:assert/strict";
import { ensureWorldMap } from "../src/world-lifecycle.js";
function world() {
  return {
    mapId: "blockout",
    nav: {},
    group: { children: [{}] },
    builds: [],
    build(id) {
      this.mapId = id;
      this.nav = {};
      this.group.children = [{}];
      this.builds.push(id);
    },
  };
}
test("a ready currently attached map is reused without replacing geometry, collision or navigation", () => {
  const w = world(),
    nav = w.nav,
    children = w.group.children;
  assert.equal(ensureWorldMap(w, "blockout"), false);
  assert.equal(w.nav, nav);
  assert.equal(w.group.children, children);
  assert.equal(w.builds.length, 0);
});
test("switching maps builds the requested geometry and never retains a cache of inactive maps", () => {
  const w = world();
  assert.equal(ensureWorldMap(w, "courtyard"), true);
  assert.equal(w.mapId, "courtyard");
  assert.equal(ensureWorldMap(w, "courtyard"), false);
  assert.equal(ensureWorldMap(w, "blockout"), true);
  assert.deepEqual(w.builds, ["courtyard", "blockout"]);
});
test("an empty or missing-navigation map is rebuilt even if its old ID matches", () => {
  for (const patch of [{ group: { children: [] } }, { nav: null }]) {
    const w = Object.assign(world(), patch);
    assert.equal(ensureWorldMap(w), true);
    assert.deepEqual(w.builds, ["blockout"]);
  }
});
