import { test, expect } from "@playwright/test";

test("all seven maps render their new art without changing collision, LOS, navigation or GPU resource ownership", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const result = await page.evaluate(async () => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.setPixelRatio(0.65);
    g.resize();
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const ids = [
      "blockout",
      "foundry",
      "courtyard",
      "compound",
      "rooftops",
      "hangar",
      "range",
    ];
    const w = g.world,
      original = w.finishMapArt,
      report = [];
    const snapshot = () => {
      const a = w.spawns[0][0],
        b = w.spawns[1][0];
      const ray = new THREE.Raycaster(
        new THREE.Vector3(a.x, 1.66, a.z),
        new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(),
      );
      return JSON.stringify({
        boxes: w.boxes,
        spawns: w.spawns,
        solids: w.solidMeshes.length,
        path: w.nav.path(a, b),
        hits: ray
          .intersectObjects(w.solidMeshes, false)
          .map((hit) => Math.round(hit.distance * 1e6)),
      });
    };
    for (const id of ids) {
      // Exactly the same runtime map, first without dressing and then with it.
      w.finishMapArt = () => {};
      let before;
      try {
        w.build(id);
        before = snapshot();
      } finally {
        w.finishMapArt = original;
      }
      w.build(id);
      const art = w.group.getObjectByName("map-architecture");
      const sun = g.scene.getObjectByName("arena-sun");
      const directionError = sun.position
        .clone()
        .normalize()
        .distanceTo(w.atmosphere.material.uniforms.sunDirection.value);
      g.camera.position.set(10, 15, 20);
      g.camera.lookAt(0, 1, 0);
      g.renderer.autoClear = true;
      g.renderWorld();
      const gl = g.renderer.getContext();
      gl.finish();
      report.push({
        id,
        unchanged: before === snapshot(),
        batches: art.userData.batching.after,
        sourceMeshes: art.userData.sourceMeshes,
        directionError,
        glError: gl.getError(),
      });
    }
    // Warm both owners once, then repeatedly traverse every map. All new
    // materials/atlases are registered and retained, while merged geometry dies.
    const materials = w.materials.size,
      textures = w.graphics.textures.size;
    const gpuBefore = { ...g.renderer.info.memory };
    for (let cycle = 0; cycle < 2; cycle++)
      for (const id of ids) {
        w.build(id);
        g.renderWorld();
      }
    const stable =
      materials === w.materials.size && textures === w.graphics.textures.size;
    return {
      report,
      stable,
      materials,
      textures,
      gpuBefore,
      gpuAfter: { ...g.renderer.info.memory },
    };
  });
  console.log(JSON.stringify({ mapArt: result }));
  expect(result.stable, JSON.stringify(result)).toBe(true);
  expect(result.gpuAfter).toEqual(result.gpuBefore);
  for (const r of result.report) {
    expect(r.unchanged, r.id).toBe(true);
    expect(r.sourceMeshes, r.id).toBeGreaterThan(30);
    expect(r.batches, r.id).toBeLessThanOrEqual(7);
    expect(r.directionError, r.id).toBeLessThan(1e-12);
    expect(r.glError, r.id).toBe(0);
  }
  expect(errors).toEqual([]);
});
