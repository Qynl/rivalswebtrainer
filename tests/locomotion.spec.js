import { test, expect } from "@playwright/test";

test("live slide buffering, slide-jump aim, descending stairs and optional speed FOV stay coherent", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.render = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const report = await page.evaluate(() => {
    const g = window.__arena,
      p = g.player,
      key = (code, type = "keydown") =>
        window.dispatchEvent(new KeyboardEvent(type, { code }));
    g.world.build("range");
    g.yaw = 0;
    g.pitch = 0;
    g.keys.clear();
    Object.assign(p, {
      x: 0,
      y: 0,
      z: 12,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      jumps: 0,
    });
    g.renderPrevious = null;
    key("KeyW");
    for (let i = 0; i < 48; i++) g.simulate(1 / 60);
    const runDistance = 12 - p.z;
    g.slideCooldown = 0;
    key("ShiftLeft");
    g.simulate(1 / 60);
    g.updateCamera(1 / 60);
    const sliding = g.slideTime > 0;
    key("Space");
    key("Space", "keyup");
    g.simulate(1 / 60);
    g.updateCamera(1 / 60);
    const jump = {
      slide: g.slideTime,
      vy: p.vy,
      speed: Math.hypot(p.vx, p.vz),
    };
    let shot;
    g.bullet = (_p, origin, dir) => {
      shot = { origin: origin.toArray(), direction: dir.toArray() };
      return false;
    };
    g.cooldown = 0;
    g.firePlayer();
    const originError = Math.hypot(
      ...shot.origin.map((x, i) => x - g.camera.position.toArray()[i]),
    );
    g.keys.clear();
    g.slideCooldown = 0;
    g.slideTime = 0;
    g.jumpBuffer = 0;
    g.coyoteTime = 0;
    Object.assign(p, {
      x: 0,
      y: 0.04,
      z: 10,
      vx: 0,
      vz: -12.2,
      vy: -2,
      grounded: false,
      jumps: 1,
    });
    key("KeyC");
    key("KeyC", "keyup");
    for (let i = 0; i < 3; i++) g.simulate(1 / 60);
    const buffered = g.slideTime > 0;
    g.world.build("compound");
    g.keys.clear();
    g.yaw = Math.PI;
    g.slideTime = 0;
    g.slideBuffer = 0;
    g.jumpBuffer = 0;
    g.coyoteTime = 0;
    Object.assign(p, {
      x: -8,
      y: 4.85,
      z: 0.3,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      jumps: 0,
    });
    key("KeyW");
    let airborne = 0,
      maxDrop = 0;
    for (let i = 0; i < 50; i++) {
      const y = p.y;
      g.simulate(1 / 60);
      g.updateCamera(1 / 60);
      if (!p.grounded) airborne++;
      maxDrop = Math.max(maxDrop, y - p.y);
    }
    g.settings.dynamicFov = false;
    g.aiming = false;
    g.slideTime = 0.3;
    g.camera.fov = 95;
    g.settings.fov = 95;
    g.updateCamera(1 / 60);
    return {
      runDistance,
      sliding,
      jump,
      originError,
      buffered,
      stairs: { airborne, maxDrop, y: p.y },
      fixedFov: g.camera.fov,
    };
  });
  expect(report.runDistance).toBeGreaterThan(9);
  expect(report.runDistance).toBeLessThan(10);
  expect(report.sliding).toBe(true);
  expect(report.jump.slide).toBe(0);
  expect(report.jump.vy).toBeGreaterThan(11.2);
  expect(report.jump.vy).toBeLessThan(12);
  expect(report.jump.speed).toBeGreaterThan(18);
  expect(report.originError).toBeLessThan(1e-10);
  expect(report.buffered).toBe(true);
  expect(report.stairs.airborne).toBe(0);
  expect(report.stairs.maxDrop).toBeLessThan(0.401);
  expect(report.stairs.y).toBe(0);
  expect(report.fixedFov).toBe(95);
});
