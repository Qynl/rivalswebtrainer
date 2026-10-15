import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 800, height: 600 } });

test("all 23 actual weapon models, skeletal bots and pooled combat shaders render without GL errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.setPixelRatio(0.5);
    g.resize();
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const report = await page.evaluate(async () => {
    const { WEAPONS } = await import("/src/data.js"),
      THREE = await import("/node_modules/three/build/three.module.js"),
      g = window.__arena,
      gl = g.renderer.getContext();
    g.world.build("blockout");
    g.state = "playing";
    g.range = true;
    g.clock = 10;
    g.player.x = 6;
    g.player.z = 7;
    g.player.y = 0;
    g.yaw = 0;
    g.pitch = 0;
    g.renderPrevious = null;
    const bot = g.entities.find((e) => e.model);
    for (const e of g.entities) if (e.model) e.model.group.visible = e === bot;
    Object.assign(bot, {
      x: 4.5,
      y: 0,
      z: 0.5,
      yaw: Math.PI,
      lastShotAt: 10,
      targetEntity: g.player,
    });
    g.animateBot(bot, 1 / 60);
    g.ray.set(new THREE.Vector3(6, 1.3, 5), new THREE.Vector3(0, 0, -1));
    g.ray.far = 100;
    const hit = g.ray.intersectObjects(g.world.solidMeshes, false)[0];
    g.combatFX.impact(
      hit.point,
      hit.face.normal.clone().transformDirection(hit.object.matrixWorld),
    );
    g.combatFX.burst(new THREE.Vector3(5.5, 1.2, 3), 0xffc388, 12);
    g.combatFX.trace(new THREE.Vector3(6.3, 1.4, 6), hit.point);
    g.combatFX.eject(
      new THREE.Vector3(6.4, 1.6, 6.3),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const draw = () => {
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
      gl.finish();
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("WebGL rendering error");
    };
    let rendered = 0;
    for (const [id, w] of Object.entries(WEAPONS)) {
      g.loadout[w.slot] = id;
      g.slot = -1;
      g.ammunition[w.slot] = { mag: w.mag, reserve: w.reserve };
      g.equip(w.slot);
      g.switchTime = 0;
      g.swingTime = id === "katana" || id === "scythe" ? 0.14 : 0;
      g.flash = 0.05;
      g.clock += 0.025;
      g.lastShotAt = g.clock;
      for (let i = 0; i < 20; i++) g.updateCamera(1 / 60);
      if (g.viewModel.userData.weaponId !== id)
        throw new Error("Wrong model: " + id);
      g.combatFX.update(0.025, g.world.boxes);
      draw();
      rendered++;
    }
    const before = g.renderer.info.memory.geometries;
    for (let i = 0; i < 500; i++) {
      g.combatFX.impact(hit.point, new THREE.Vector3(0, 0, 1));
      g.combatFX.burst(hit.point, 0xffddaa, 10);
      g.combatFX.trace(new THREE.Vector3(6.3, 1.4, 6), hit.point);
      g.combatFX.update(1 / 60, g.world.boxes);
    }
    draw();
    const after = g.renderer.info.memory.geometries;
    g.setSettings({ ...g.settings, performance: true });
    draw();
    g.setSettings({ ...g.settings, performance: false });
    return {
      rendered,
      before,
      after,
      staticStats: g.world.staticStats,
      active: g.combatFX.active,
    };
  });
  console.log(JSON.stringify(report));
  expect(report.rendered).toBe(23);
  expect(report.after).toBeLessThanOrEqual(report.before + 1);
  expect(report.staticStats.after).toBeLessThan(report.staticStats.before / 2);
  expect(report.staticStats.retainedRayMeshes).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
