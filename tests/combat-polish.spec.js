import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.use({ viewport: { width: 960, height: 720 } });

test("live carry preserves aim, real hits prioritize eliminations and directional bot poses render", async ({
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
      THREE = await import("/node_modules/three/build/three.module.js"),
      { WEAPONS } = await import("/src/data.js");
    g.world.build("blockout");
    g.audio.volume = 0;
    g.clock = 10;
    g.loadout[0] = "rifle";
    g.slot = -1;
    g.equip(0);
    g.switchTime = 0;
    g.reloadTime = 0;
    g.kick = 0;
    g.lastShotAt = 0;
    g.aiming = false;
    g.settings.shake = true;
    g.settings.dynamicFov = false;
    g.lookSway = { x: 0, y: 0 };
    g.walkPhase = Math.PI / 2;
    g.renderPrevious = null;
    g.yaw = 0.37;
    g.pitch = 0.06;
    Object.assign(g.player, {
      x: 12,
      y: 0,
      z: 1,
      grounded: true,
      vx: 0,
      vz: 0,
      vy: 0,
    });
    const camera = () => {
      for (let i = 0; i < 180; i++) g.updateCamera(1 / 120);
    };
    camera();
    const neutralY = g.viewModel.position.y;
    g.player.vx = -Math.sin(g.yaw) * 12;
    g.player.vz = -Math.cos(g.yaw) * 12;
    camera();
    const carry = g.weaponAnimator.carry.value,
      lowering = g.viewModel.position.y - neutralY,
      aimBefore = { yaw: g.yaw, pitch: g.pitch };
    const actualBullet = g.bullet,
      origin = g.camera.position.clone(),
      expected = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(g.pitch, g.yaw, 0, "YXZ"),
      );
    let shot;
    g.bullet = (_, from, dir) => {
      shot = {
        originError: origin.distanceTo(from),
        alignment: dir.dot(expected),
      };
      return false;
    };
    g.cooldown = 0;
    g.firePlayer();
    g.bullet = actualBullet;
    camera();
    const fireCarry = g.weaponAnimator.carry.value;
    g.kick = 0;
    g.lastShotAt = 0;
    g.aiming = true;
    camera();
    g.viewModel.updateMatrixWorld(true);
    const sight = g.viewModel
        .localToWorld(g.viewModel.userData.adsPoint.clone())
        .project(g.weaponCamera),
      adsError = Math.hypot(sight.x, sight.y),
      aimAfter = { yaw: g.yaw, pitch: g.pitch };
    const bot = g.entities.find((e) => e.model);
    for (const e of g.entities) if (e.model) e.model.group.visible = e === bot;
    g.entities = [g.player, bot];
    Object.assign(bot, {
      x: 12,
      y: 0,
      z: -5,
      height: 1.9,
      health: 100,
      alive: true,
      team: 1,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      meleeId: "katana",
      activeWeapon: "rifle",
      deflectTime: 0,
      quickMeleeTime: 0,
      reload: 0,
    });
    g.events.feedClear();
    const marker = document.getElementById("hitmarker"),
      shotAt = (y) =>
        g.bullet(
          g.player,
          new THREE.Vector3(12, y, 1),
          new THREE.Vector3(0, 0, -1),
          WEAPONS.rifle,
        );
    shotAt(1.3);
    const body = marker.dataset.confirmation;
    shotAt(1.75);
    const head = marker.dataset.confirmation;
    bot.health = 1;
    const kills = g.matchStats.kills;
    shotAt(1.3);
    g.events.hit(false);
    g.events.hit(true);
    const elimination = marker.dataset.confirmation,
      killDelta = g.matchStats.kills - kills;
    g.events.feedClear();
    const reset =
      Number(marker.style.opacity) === 0 &&
      !marker.classList.contains("elimination") &&
      !marker.classList.contains("headshot");
    Object.assign(g.player, { x: 9, y: 0, z: -2, vx: 0, vz: 0 });
    Object.assign(bot, {
      alive: true,
      health: 100,
      yaw: Math.PI * 0.75,
      visible: true,
      targetEntity: g.player,
      animationPhase: Math.PI / 2,
      seed: 0.5,
      lastShotAt: -10,
    });
    g.combatFX.update(2, g.world.boxes);
    g.flash = 0;
    if (g.muzzleLight) g.muzzleLight.intensity = 0;
    if (g.weaponFlashLight) g.weaponFlashLight.intensity = 0;
    g.renderer.setPixelRatio(0.6);
    g.resize();
    g.camera.position.set(9, 1.6, -2);
    g.camera.lookAt(12, 0.95, -5);
    g.camera.fov = 55;
    g.camera.updateProjectionMatrix();
    const poses = [];
    for (const stance of ["idle", "strafe", "slide", "air"]) {
      Object.assign(bot, { vx: 0, vz: 0, vy: 0, height: 1.9, grounded: true });
      if (stance === "strafe")
        Object.assign(bot, {
          vx: Math.cos(bot.yaw) * 12,
          vz: -Math.sin(bot.yaw) * 12,
        });
      if (stance === "slide")
        Object.assign(bot, { height: 1.15, vx: -12, vz: 12 });
      if (stance === "air")
        Object.assign(bot, { grounded: false, vy: 9, vx: -8, vz: 8 });
      for (let i = 0; i < 120; i++) g.animateBot(bot, 1 / 120);
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.getContext().finish();
      const pose = bot.model.parts.locomotion;
      poses.push({
        stance,
        leftX: pose.leftX,
        leftZ: pose.leftZ,
        knee: pose.leftKnee,
        gl: g.renderer.getContext().getError(),
      });
    }
    window.__polishBot = bot;
    return {
      carry,
      lowering,
      shot,
      fireCarry,
      adsError,
      aimBefore,
      aimAfter,
      body,
      head,
      elimination,
      killDelta,
      reset,
      poses,
    };
  });
  expect(result.carry).toBeGreaterThan(0.99);
  expect(result.lowering).toBeCloseTo(-0.035, 5);
  expect(result.shot.originError).toBeLessThan(1e-6);
  expect(result.shot.alignment).toBeGreaterThan(0.999);
  expect(result.fireCarry).toBeLessThan(0.001);
  expect(result.adsError).toBeLessThan(0.001);
  expect(result.aimAfter).toEqual(result.aimBefore);
  expect(result).toMatchObject({
    body: "body",
    head: "head",
    elimination: "elimination",
    killDelta: 1,
    reset: true,
  });
  expect(result.poses.every((p) => p.gl === 0)).toBe(true);
  expect(Math.abs(result.poses[0].leftX)).toBeLessThan(0.001);
  expect(Math.abs(result.poses[1].leftZ)).toBeGreaterThan(0.25);
  expect(result.poses[2].leftX).toBeGreaterThan(1.1);
  expect(result.poses[3].knee).toBeLessThan(-0.9);
  expect(errors).toEqual([]);
  // Expiry uses a real monotonic timer even with simulation/RAF stopped.
  expect(
    await page.evaluate(() => {
      const g = window.__arena;
      g.events.confirmKill(false);
      g.events.hit(true);
      return document.getElementById("hitmarker").dataset.confirmation;
    }),
  ).toBe("elimination");
  await expect(page.locator("#hitmarker")).toHaveAttribute(
    "data-confirmation",
    "",
  );
  expect(
    await page.locator("#hitmarker").evaluate((e) => Number(e.style.opacity)),
  ).toBe(0);
  if (process.env.ARENA_SCREENSHOTS) {
    await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
    for (const stance of ["idle", "strafe", "slide"]) {
      await page.evaluate((stance) => {
        const g = window.__arena,
          e = window.__polishBot;
        Object.assign(e, { vx: 0, vz: 0, vy: 0, grounded: true, height: 1.9 });
        if (stance === "strafe")
          Object.assign(e, {
            vx: Math.cos(e.yaw) * 12,
            vz: -Math.sin(e.yaw) * 12,
          });
        if (stance === "slide")
          Object.assign(e, { height: 1.15, vx: -12, vz: 12 });
        for (let i = 0; i < 120; i++) g.animateBot(e, 1 / 120);
        document.getElementById("hud").classList.add("hidden");
        document.getElementById("round-banner").classList.add("hidden");
        g.renderer.autoClear = true;
        g.renderWorld();
        g.renderer.getContext().finish();
      }, stance);
      await page.screenshot({
        path: `${process.env.ARENA_SCREENSHOTS}/bot-${stance}.png`,
      });
    }
  }
  console.log(JSON.stringify({ combatPolish: result }));
});
