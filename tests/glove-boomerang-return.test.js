import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { presentBoomerangReturn } from "../src/gloves/boomerang-return.js";
import { GloveFX, GLOVE_FX_LIMITS } from "../src/gloves/fx.js";
function fixture() {
  const calls = [],
    source = { id: "source", team: 0, alive: true },
    target = {
      id: "target",
      team: 1,
      alive: true,
      vx: 1,
      vy: 2,
      vz: 3,
      health: 125,
    },
    g = {
      clock: 1,
      round: 2,
      state: "playing",
      player: source,
      scene: { add() {} },
      audio: { volume: 1, play: (...a) => calls.push(["audio", ...a]) },
      gloveFX: {
        returnPull: () => calls.push(["ring"]),
        link: () => calls.push(["link"]),
      },
      events: {
        hit: () => calls.push(["hit"]),
        slap: () => calls.push(["reward"]),
      },
      matchStats: { hits: 1, slaps: 1 },
    },
    event = {
      type: "impulse",
      glove: "glove_boomerang",
      phase: "return",
      source: "source",
      player: "target",
      position: [0, 1, -2],
      velocity: [0, 5, 24],
      round: 2,
    };
  return { g, event, source, target, calls };
}
test("the actual return impulse gets its own cue, never another damage, hit marker, reward or client velocity change", () => {
  const f = fixture(),
    before = { ...f.target };
  assert.equal(presentBoomerangReturn(f.g, f.event, f.source, f.target), true);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["ring", "link", "audio"],
  );
  assert.equal(f.calls[2][1], "glovePull");
  assert.deepEqual(f.target, before);
  assert.deepEqual(f.g.matchStats, { hits: 1, slaps: 1 });
});
test("primary/ordinary, stale, malformed or unknown-identity impulses cannot impersonate a return cue", () => {
  for (const patch of [
    { phase: undefined },
    { glove: undefined },
    { round: 1 },
    { source: undefined },
    { player: "missing" },
    { position: [NaN, 0, 0] },
    { position: [1e308, 0, 0] },
  ]) {
    const f = fixture();
    assert.equal(
      presentBoomerangReturn(f.g, { ...f.event, ...patch }, f.source, f.target),
      false,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("headless and hidden-remote actors never allocate a return tracker, but the invisible victim can still understand their own pull", () => {
  for (const mode of ["headless", "hidden-source", "hidden-target"]) {
    const f = fixture();
    if (mode === "headless") f.g.headless = true;
    if (mode === "hidden-source") {
      f.source.ghostTime = 2;
      f.g.player = f.target;
    }
    if (mode === "hidden-target") f.target.ghostTime = 2;
    assert.equal(
      presentBoomerangReturn(f.g, f.event, f.source, f.target),
      false,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.g.player = f.target;
  f.target.ghostTime = 2;
  assert.equal(presentBoomerangReturn(f.g, f.event, f.source, f.target), true);
});
test("return rings use the existing bounded pools, collapse inward and clear without retaining extra scene nodes", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene),
    before = scene.children.length,
    camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 100; i++)
    fx.returnPull(new THREE.Vector3(0, 1, 0), 0xffbb66);
  assert.equal(scene.children.length, before);
  assert.equal(fx.rings.states.length, GLOVE_FX_LIMITS.rings);
  fx.update(0.01, camera);
  const first = fx.rings.mesh.instanceMatrix.array.slice();
  fx.update(0.1, camera);
  assert.notDeepEqual(fx.rings.mesh.instanceMatrix.array, first);
  assert.ok(
    fx.rings.mesh.instanceMatrix.array[0] < first[0],
    "return radius must actually collapse inward",
  );
  assert.ok(fx.rings.mesh.instanceMatrix.array.every(Number.isFinite));
  fx.update(1, camera);
  assert.ok(fx.rings.states.every((s) => s.life === 0));
  fx.dispose();
  assert.equal(scene.children.length, 0);
});
