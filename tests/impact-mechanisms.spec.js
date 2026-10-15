import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.use({ viewport: { width: 960, height: 720 } });
test("real pistol locks and reloads its slide, and real wall hits render pooled debris pixels", async ({
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
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { WEAPONS } = await import("/src/data.js"),
      THREE = await import("/node_modules/three/build/three.module.js");
    g.world.build("blockout");
    g.audio.volume = 0;
    g.settings.shake = false;
    g.clock = 10;
    g.yaw = -Math.PI / 2;
    g.pitch = 0;
    g.renderPrevious = null;
    g.keys.clear();
    Object.assign(g.player, {
      x: 11, // Keep the original four-unit wall distance in the wider Arena.
      y: 0,
      z: 3,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
    });
    for (const e of g.entities) if (e.model) e.model.group.visible = false;
    g.loadout[1] = "pistol";
    g.slot = -1;
    g.equip(1);
    g.switchTime = 0;
    g.reloadTime = 0;
    g.cooldown = 0;
    g.mouseDown = false;
    g.trigger = false;
    g.aiming = false;
    const p = g.viewModel,
      bolt = p.userData.bolt,
      rest = bolt.userData.restPosition.clone();
    g.ammunition[1].mag = 1;
    for (let i = 0; i < 100; i++) g.updateCamera(1 / 120);
    g.camera.updateMatrixWorld();
    g.firePlayer();
    g.updateCamera(1 / 120);
    const fired = {
      ammo: g.ammunition[1].mag,
      lock: bolt.position.z - rest.z,
      details: bolt.children.length,
    };
    g.reload();
    let extraction = 0;
    for (let i = 0; i < 600 && g.reloadTime > 0; i++) {
      g.clock += 1 / 120;
      g.updatePlayer(1 / 120);
      g.updateCamera(1 / 120);
      extraction = Math.max(
        extraction,
        p.userData.magazine.userData.restPosition.y -
          p.userData.magazine.position.y,
      );
    }
    const reloaded = {
      ammo: g.ammunition[1].mag,
      expected: WEAPONS.pistol.mag,
      bolt: bolt.position.distanceTo(rest),
      magazine: p.userData.magazine.position.distanceTo(
        p.userData.magazine.userData.restPosition,
      ),
    };
    const fx = g.combatFX;
    fx.clear();
    g.flash = 0;
    if (g.muzzleLight) g.muzzleLight.intensity = 0;
    g.updateCamera(1 / 120);
    g.camera.updateMatrixWorld();
    g.renderer.setPixelRatio(0.65);
    g.resize();
    g.bullet(
      g.player,
      g.eye(g.player),
      new THREE.Vector3(1, 0, 0),
      WEAPONS.rifle,
    );
    const emitted = fx.particleState
      .filter((p) => p.life > 0)
      .map((p) => p.type);
    fx.update(0.035, g.world.boxes);
    fx.traces.visible = fx.decals.visible = fx.casings.visible = false;
    const gl = g.renderer.getContext(),
      size = g.renderer.getDrawingBufferSize(new THREE.Vector2());
    const draw = () => {
      g.renderer.autoClear = true;
      g.renderWorld();
      gl.finish();
      const pixels = new Uint8Array(size.x * size.y * 4);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    fx.points.visible = false;
    const before = draw();
    fx.points.visible = true;
    const after = draw();
    let changed = 0;
    for (let i = 0; i < before.length; i += 4)
      if (
        Math.abs(before[i] - after[i]) +
          Math.abs(before[i + 1] - after[i + 1]) +
          Math.abs(before[i + 2] - after[i + 2]) >
        3
      )
        changed++;
    const resources = [...g.scene.children].filter((o) =>
      [fx.points, fx.traces, fx.decals, fx.casings].includes(o),
    ).length;
    fx.decals.visible = true;
    draw();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
    gl.finish();
    return {
      fired,
      reloaded,
      extraction,
      emitted,
      changed,
      resources,
      glError: gl.getError(),
      active: fx.active,
    };
  });
  expect(result.fired.ammo).toBe(0);
  expect(result.fired.lock).toBeCloseTo(0.045, 6);
  expect(result.fired.details).toBeGreaterThan(0);
  expect(result.reloaded.ammo).toBe(result.reloaded.expected);
  expect(result.reloaded.bolt).toBeLessThan(1e-8);
  expect(result.reloaded.magazine).toBeLessThan(1e-8);
  expect(result.extraction).toBeGreaterThan(0.27);
  expect(result.emitted.filter((t) => t === 1)).toHaveLength(6);
  expect(result.emitted.filter((t) => t === 2)).toHaveLength(4);
  expect(result.emitted.filter((t) => t === 3)).toHaveLength(2);
  expect(result.changed).toBeGreaterThan(20);
  expect(result.resources).toBe(4);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
  if (process.env.ARENA_SCREENSHOTS) {
    await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: `${process.env.ARENA_SCREENSHOTS}/concrete-impact.png`,
    });
  }
  console.log(JSON.stringify({ impactMechanisms: result }));
});
