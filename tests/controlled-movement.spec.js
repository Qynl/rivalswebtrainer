import { test, expect } from "@playwright/test";

test("real C/Shift/Space controls give short slides, controlled jumps and no held-key auto hopping", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click("#range-button");
  await page.waitForFunction(
    () => window.__arena?.state === "playing" && !!document.pointerLockElement,
  );
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(640, 400, false);
    // Isolate locomotion measurements on a flat test surface, not target furniture.
    g.world.boxes = [];
    Object.assign(g.player, {
      x: 0,
      z: 12,
      y: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      jumps: 0,
    });
    g.yaw = 0;
    g.pitch = 0;
    g.keys.clear();
    g.slideTime = g.slideCooldown = g.jumpBuffer = g.slideBuffer = 0;
    g.settings.shake = true;
    g.__motionStep = (count) => {
      for (let i = 0; i < count; i++) {
        g.clock += 1 / 120;
        g.updatePlayer(1 / 120);
        g.updateCamera(1 / 120);
      }
    };
  });
  await page.keyboard.down("KeyD");
  await page.evaluate(() => window.__arena.__motionStep(15));
  expect(await page.evaluate(() => window.__arena.player.vx)).toBeCloseTo(8);
  await page.keyboard.down("KeyC");
  const entry = await page.evaluate(() => {
    const g = window.__arena;
    return { x: g.player.x, speed: g.player.vx, slide: g.slideTime };
  });
  expect(entry.speed).toBeCloseTo(9.4);
  expect(entry.slide).toBeCloseTo(0.19);
  await page.keyboard.up("KeyC");
  const burst = await page.evaluate(() => {
    const g = window.__arena;
    g.__motionStep(24);
    return {
      x: g.player.x,
      slide: g.slideTime,
      fov: g.camera.fov,
      base: g.settings.fov,
      yaw: g.yaw,
      pitch: g.pitch,
    };
  });
  expect(burst.x - entry.x).toBeGreaterThan(1.2);
  expect(burst.x - entry.x).toBeLessThan(1.65);
  expect(burst.slide).toBe(0);
  expect(burst.fov - burst.base).toBeLessThan(0.9);
  expect(burst.yaw).toBe(0);
  expect(burst.pitch).toBe(0);
  await page.evaluate(() => window.__arena.__motionStep(100));
  await page.keyboard.down("ShiftLeft");
  expect(await page.evaluate(() => window.__arena.slideTime)).toBeCloseTo(0.19);
  await page.keyboard.down("Space");
  const jump = await page.evaluate(() => ({
    slide: window.__arena.slideTime,
    vy: window.__arena.player.vy,
    speed: window.__arena.player.vx,
  }));
  expect(jump.slide).toBe(0);
  expect(jump.vy).toBeCloseTo(7.8);
  expect(jump.speed).toBeCloseTo(9.4);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyD");
  const flight = await page.evaluate(() => {
    const g = window.__arena;
    let apex = 0;
    for (let i = 0; i < 120; i++) {
      g.__motionStep(1);
      apex = Math.max(apex, g.player.y);
    }
    return {
      apex,
      grounded: g.player.grounded,
      jumps: g.player.jumps,
      holding: g.keys.has("Space"),
      vx: g.player.vx,
    };
  });
  expect(flight.apex).toBeGreaterThan(1.0);
  expect(flight.apex).toBeLessThan(1.03);
  expect(flight.holding).toBe(true);
  expect(flight.grounded).toBe(true);
  expect(flight.jumps).toBe(0);
  expect(flight.vx).toBe(0);
  await page.keyboard.up("Space");
  await page.keyboard.down("Space");
  expect(await page.evaluate(() => window.__arena.player.vy)).toBeCloseTo(7.8);
  await page.keyboard.up("Space");
  await page.evaluate(() => {
    const g = window.__arena;
    g.__motionStep(100);
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
  });
  expect(
    await page.evaluate(() => window.__arena.renderer.getContext().getError()),
  ).toBe(0);
  expect(errors).toEqual([]);
});
