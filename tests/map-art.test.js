import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  MAP_ART,
  applyMapLighting,
  createMapArchitecture,
} from "../src/map-art.js";
import { ArenaAtmosphere } from "../src/atmosphere.js";
import { ARENA, HALF_COVER } from "../src/arena-layout.js";
import { EXTRA_COURTS } from "../src/map-layouts.js";

let oldDocument;
before(() => {
  oldDocument = globalThis.document;
  // Only the lettering/maintenance atlases need Canvas here; real pixels are
  // exercised in the browser spec and the seven-map screenshot audit.
  const context = new Proxy(
    {},
    {
      get: (target, key) => target[key] ?? (() => {}),
      set: (target, key, value) => ((target[key] = value), true),
    },
  );
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
});
after(() => {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
});
const fakeWorld = (id) => ({
  mapId: id,
  materials: new Map(),
  graphics: { textures: new Map() },
  boxes: [{ sentinel: true }],
  solidMeshes: [],
});
const layoutFor = (id) => (id === "blockout" ? ARENA : EXTRA_COURTS[id]);
const releaseGeometry = (group) => group.traverse((o) => o.geometry?.dispose());

for (const id of Object.keys(MAP_ART)) {
  test(`${id}: map finishing is batched, finite and never registers collision`, () => {
    const world = fakeWorld(id),
      layout = layoutFor(id);
    const boxes = world.boxes,
      rays = world.solidMeshes;
    const group = createMapArchitecture(
      world,
      layout,
      layout?.cover || (id === "blockout" ? HALF_COVER : []),
    );
    assert.equal(group.name, "map-architecture");
    assert.equal(group.userData.style, id);
    assert.ok(group.userData.sourceMeshes > 30);
    assert.ok(group.userData.exteriorMeshes > 0);
    assert.ok(group.userData.batching.after <= 7);
    assert.equal(group.userData.batching.retainedRayMeshes, 0);
    assert.equal(world.boxes, boxes);
    assert.deepEqual(boxes, [{ sentinel: true }]);
    assert.equal(world.solidMeshes, rays);
    assert.equal(rays.length, 0);
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      assert.ok(
        [...obj.geometry.attributes.position.array].every(Number.isFinite),
      );
      if (!obj.castShadow) return;
      // Every substantive new silhouette lies entirely outside the court.
      const p = obj.geometry.attributes.position,
        width = layout?.width || 47,
        depth = layout?.depth || 47;
      for (let i = 0; i < p.count; i++)
        assert.ok(
          Math.abs(p.getX(i)) > width / 2 || Math.abs(p.getZ(i)) > depth / 2,
          `exterior vertex inside ${id}`,
        );
    });
    releaseGeometry(group);
  });
  test(`${id}: rebuilding reuses all registered materials and texture owners`, () => {
    const world = fakeWorld(id),
      layout = layoutFor(id);
    const a = createMapArchitecture(world, layout);
    const materials = [...world.materials.entries()],
      textures = [...world.graphics.textures.entries()];
    releaseGeometry(a);
    const b = createMapArchitecture(world, layout);
    assert.deepEqual([...world.materials.entries()], materials);
    assert.deepEqual([...world.graphics.textures.entries()], textures);
    for (const material of world.materials.values())
      if (material.map)
        assert.ok(textures.some(([, texture]) => texture === material.map));
    releaseGeometry(b);
  });
}

test("all map skies match the actual world sun and reset fog/fill without touching gun lights", () => {
  const scene = new THREE.Scene(),
    sky = new ArenaAtmosphere();
  const sun = new THREE.DirectionalLight();
  sun.name = "arena-sun";
  scene.add(sun);
  const fill = new THREE.HemisphereLight();
  fill.name = "arena-fill";
  scene.add(fill);
  const muzzle = new THREE.PointLight(0xff0000, 0);
  scene.add(muzzle);
  scene.fog = new THREE.Fog(0, 1, 2);
  const uniforms = sky.material.uniforms,
    sunVector = uniforms.sunDirection.value;
  for (const id of [...Object.keys(MAP_ART), "blockout"]) {
    const art = applyMapLighting(scene, sky, id);
    assert.ok(sun.position.clone().normalize().distanceTo(sunVector) < 1e-12);
    assert.equal(uniforms.sunDirection.value, sunVector);
    assert.equal(sun.color.getHex(), art.light);
    assert.equal(scene.fog.color.getHex(), art.fog);
    assert.equal(uniforms.horizon.value.getHex(), fill.color.getHex());
    assert.ok(sun.intensity >= 2 && sun.intensity <= 2.6);
    assert.equal(scene.fog.near, 60);
    assert.equal(scene.fog.far, 145);
    assert.equal(muzzle.intensity, 0);
    assert.equal(muzzle.color.getHex(), 0xff0000);
  }
  assert.equal(scene.children.length, 3);
  sky.dispose();
});

test("unknown maps fall back safely with no world lights or fog installed", () => {
  const scene = new THREE.Scene(),
    sky = new ArenaAtmosphere();
  assert.equal(applyMapLighting(scene, sky, "unknown"), MAP_ART.blockout);
  assert.equal(scene.children.length, 0);
  sky.dispose();
});
