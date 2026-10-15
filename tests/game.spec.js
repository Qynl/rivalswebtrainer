import { test, expect } from "@playwright/test";
test("lobby, loadout, combat, utilities, bots, pause and complete match", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await expect(page.locator("h1").first()).toContainText("RIVALS");
  // Validate one real WebGL frame, then suppress rendering during deterministic simulations.
  await page.evaluate(() => {
    const g = window.__arena;
    g.renderer.setPixelRatio(0.5);
    g.renderer.shadowMap.enabled = false;
    g.renderer.render(g.scene, g.camera);
    g.renderer.render = () => {};
  });
  await page.click('[data-tab="loadout"]');
  await page.click('[data-weapon="sniper"]');
  await expect(page.locator(".weapon-detail h2")).toHaveText("Sniper");
  await page.click('[data-weapon="rifle"]');
  await page.click("#loadout-done");
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await expect(page.locator("#hud")).toBeVisible();
  await page.evaluate(() => {
    const g = window.__arena,
      p = g.player,
      t = g.entities[1];
    p.x = t.x;
    p.z = t.z + 6;
    p.y = 0;
    g.cooldown = 0;
    g.updateBot = () => {};
    // Teleport fixtures must also publish their camera origin. Otherwise the
    // first shot depends on whether RAF ran between evaluate and mouse.down.
    g.renderPrevious = null;
    g.yaw = 0;
    g.pitch = 0;
    g.updateCamera(1);
    g.camera.updateMatrixWorld();
  });
  await page.mouse.down();
  await page.evaluate(() => {
    const g = window.__arena;
    g.yaw = 0;
    g.pitch = 0;
    g.mouseDown = true;
    for (let i = 0; i < 150 && g.matchStats.kills === 0; i++) {
      g.updatePlayer(1 / 60);
      g.updateEffects(1 / 60);
    }
  });
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.__arena.matchStats.kills),
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    const g = window.__arena;
    g.mouseDown = false;
    g.reloadTime = 0;
    g.ammunition[0].mag = 2;
  });
  await page.keyboard.press("KeyR");
  expect(
    await page.evaluate(
      () =>
        window.__arena.reloadTime > 0 ||
        window.__arena.ammunition[0].mag === 20,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
  });
  expect(await page.evaluate(() => window.__arena.ammunition[0].mag)).toBe(20);
  await page.keyboard.press("Digit3");
  const jumps = await page.evaluate(() => {
    const g = window.__arena;
    g.player.y = 0;
    g.player.grounded = true;
    g.player.jumps = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    return g.player.jumps;
  });
  expect(jumps).toBe(2);
  // Timed grenade, smoke volume and fire pool all complete their real projectile lifecycles.
  const utilityResults = await page.evaluate(async () => {
    const g = window.__arena;
    const origin = g.eye(g.player).set(0, 2, 16),
      dir = origin.clone().set(0, 0.1, -1).normalize();
    g.spawnProjectile(g.player, origin, dir, "grenade");
    for (let i = 0; i < 130; i++) {
      g.updateProjectiles(0.02);
      g.updateEffects(0.02);
    }
    const grenadeEnded = g.projectiles.length === 0;
    g.spawnProjectile(g.player, origin, dir, "smoke");
    for (let i = 0; i < 180; i++) {
      g.updateProjectiles(0.02);
      g.updateEffects(0.02);
    }
    const smoke = g.smokes.length > 0;
    g.spawnProjectile(g.player, origin, dir, "molotov");
    for (let i = 0; i < 90; i++) {
      g.updateProjectiles(0.02);
      g.updateEffects(0.02);
    }
    return { grenadeEnded, smoke, fire: g.fires.length > 0 };
  });
  expect(utilityResults).toEqual({
    grenadeEnded: true,
    smoke: true,
    fire: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toBeVisible();
  const clock = await page.evaluate(() => window.__arena.clock);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__arena.clock)).toBe(clock);
  await page.click("#pause-settings");
  await page.locator("#volume").fill("25");
  await page.dispatchEvent("#volume", "input");
  await page.click("#settings-done");
  await page.click("#quit-button");
  await page.click("#map-cycle");
  await expect(page.locator("#map-name")).toHaveText("Skyline");
  await page.click("#map-cycle");
  await expect(page.locator("#map-name")).toHaveText("Hangar 09");
  await page.click('[data-mode="3"]');
  await page.click('[data-difficulty="elite"]');
  await page.evaluate(() => {
    delete window.__arena.updateBot;
  });
  await page.click("#play-button");
  for (let step = 0; step < 4; step++) await page.click("#setup-next");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  expect(await page.evaluate(() => window.__arena.entities.length)).toBe(6);
  await page.evaluate(() => {
    window.__arena.countdown = 0.01;
  });
  await page.waitForFunction(() => window.__arena.state === "playing");
  const bots = await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 720; i++) {
      g.clock += 1 / 60;
      for (const e of g.entities) if (!e.isPlayer) g.updateBot(e, 1 / 60);
      g.updateEffects(1 / 60);
      if (g.state !== "playing") break;
    }
    return g.entities.map((e) => ({ z: e.z, health: e.health }));
  });
  expect(bots.some((e) => e.health < 100)).toBe(true);
  expect(bots.slice(1).some((e) => Math.abs(e.z) < 17)).toBe(true);
  await page.evaluate(() => {
    const g = window.__arena;
    g.startRound();
    g.score = [0, 0];
    g.state = "playing";
    for (let round = 0; round < 5; round++) {
      for (const e of g.entities)
        if (e.team === 1 && e.alive) g.damage(e, 200, g.player);
      if (round < 4) {
        g.startRound();
        g.state = "playing";
      }
    }
    g.finish();
  });
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#result-title")).toContainText("VICTORY");
  expect(await page.evaluate(() => window.__arena.score)).toEqual([5, 0]);
  await page.click("#results-lobby");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#play-button")).toBeInViewport();
  await page.click('[data-tab="loadout"]');
  await expect(page.locator("#weapon-grid")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.getElementById("lobby").scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
