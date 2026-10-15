import { test, expect } from "@playwright/test";
test("Shift/C slides, jump cancels, F quick ability, Katana reflection and mouse spike filtering", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena);
  await page.evaluate(() => {
    // Explicit velocity fixtures must not decay while separate CDP keyboard
    // commands are in flight. Live locomotion has its own simulation test.
    window.__arena.frame = () => {};
    window.__arena.renderer.render = () => {};
  });
  await page.click('[data-tab="loadout"]');
  await page.click('[data-slot="2"]');
  await page.click('[data-weapon="scythe"]');
  await page.click("#loadout-done");
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await page.evaluate(() => {
    const g = window.__arena;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 12,
      vx: 0,
      vz: -7.8,
      vy: 0,
      grounded: true,
      jumps: 0,
    });
    g.keys.clear();
    g.yaw = 0;
    g.pitch = 0;
    g.slideCooldown = 0;
  });
  await page.keyboard.press("ShiftLeft");
  expect(await page.evaluate(() => window.__arena.slideTime > 0)).toBe(true);
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__arena.slideTime)).toBe(0);
  // Trigger the real key handler and inspect its result atomically to avoid timed animation races.
  const quick = await page.evaluate(() => {
    const g = window.__arena;
    g.dashCooldown = 0;
    g.slot = 0;
    const ammo = g.ammunition[0].mag;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
    return {
      slot: g.slot,
      ammoUnchanged: g.ammunition[0].mag === ammo,
      quick: g.quickModelId,
      cooldown: g.dashCooldown,
      speed: Math.hypot(g.player.vx, g.player.vz),
    };
  });
  expect(quick).toEqual({
    slot: 0,
    ammoUnchanged: true,
    quick: "scythe",
    cooldown: 3,
    speed: 28,
  });
  const look = await page.evaluate(() => {
    const g = window.__arena;
    g.pitch = 0;
    g.yaw = 0;
    g.mouseLook.reset(-10000);
    document.dispatchEvent(
      new MouseEvent("mousemove", { movementX: 1, movementY: -400 }),
    );
    const afterSpike = g.pitch;
    document.dispatchEvent(
      new MouseEvent("mousemove", { movementX: 12, movementY: 4 }),
    );
    return { afterSpike, afterNormal: g.pitch, yaw: g.yaw };
  });
  expect(look.afterSpike).toBe(0);
  expect(look.afterNormal).toBeLessThan(0);
  expect(look.yaw).toBeLessThan(0);
  await page.keyboard.press("Escape");
  await page.click("#quit-button");
  await page.click('[data-tab="loadout"]');
  await page.click('[data-slot="2"]');
  await page.click('[data-weapon="katana"]');
  await page.click("#loadout-done");
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const reflect = await page.evaluate(() => {
    const g = window.__arena;
    g.yaw = 0;
    g.pitch = 0;
    g.deflectCooldown = 0;
    g.player.x = 0;
    g.player.z = 0;
    const bot = g.entities[1];
    Object.assign(bot, { x: 0, y: 0, z: -8, health: 100, alive: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    const ammo = g.ammunition[0].mag;
    g.firePlayer();
    const origin = g.eye(bot).set(0, 1, -8),
      direction = origin.clone().set(0, 0, 1);
    g.bullet(bot, origin, direction, { damage: 13, head: 1.65, range: 100 });
    g.events.tick(g);
    return {
      slot: g.slot,
      playerHealth: g.player.health,
      botHealth: bot.health,
      ammoUnchanged: g.ammunition[0].mag === ammo,
      guard: g.deflectTime,
      cooldown: g.deflectCooldown,
    };
  });
  expect(reflect.slot).toBe(0);
  expect(reflect.playerHealth).toBe(150);
  expect(reflect.botHealth).toBeLessThan(100);
  expect(reflect.ammoUnchanged).toBe(true);
  expect(reflect.guard).toBeGreaterThan(0);
  await expect(page.locator("#guard-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.click("#pause-settings");
  await page.check("#performance-mode");
  expect(
    await page.evaluate(() => window.__arena.renderer.shadowMap.enabled),
  ).toBe(false);
  expect(errors).toEqual([]);
});
