import { test, expect } from "@playwright/test";

test("keyboard bindings remap, cancel safely, survive reload and drive actual movement input", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click("#settings-open");
  await expect(page.locator("#settings")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.click("#controls-reset");
  await expect(page.locator('[data-rebind="moveForward"]')).toHaveText("W");

  const jump = page.locator('[data-rebind="jump"]');
  await jump.click();
  await expect(jump).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(jump).toHaveAttribute("aria-pressed", "false");
  await expect(jump).toHaveText("SPACE");

  const forward = page.locator('[data-rebind="moveForward"]');
  await forward.click();
  await page.keyboard.press("i");
  await expect(forward).toHaveText("I");
  await page.locator('[data-rebind="quickMelee"]').click();
  await page.keyboard.press("g");
  await expect(page.locator('[data-rebind="quickMelee"]')).toHaveText("G");
  await expect(page.locator('[data-rebind="quickUtility"]')).toHaveText("F");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rivals-controls")).bindings),
  ).toMatchObject({
    moveForward: ["KeyI"],
    quickMelee: ["KeyG"],
    quickUtility: ["KeyF"],
  });
  await page.reload();
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click("#settings-open");
  await expect(page.locator('[data-rebind="moveForward"]')).toHaveText("I");
  await expect(page.locator('[data-rebind="quickMelee"]')).toHaveText("G");
  await expect(page.locator('[data-rebind="quickUtility"]')).toHaveText("F");
  await page.click("#settings-done");
  await page.click("#range-button");
  await page.waitForFunction(
    () => window.__arena?.range === true && window.__arena.state === "playing",
  );
  await page.keyboard.down("i");
  await expect
    .poll(() => page.evaluate(() => window.__arena.controlDown("moveForward")))
    .toBe(true);
  const movement = await page.evaluate(() => {
    const game = window.__arena,
      direction = game.moveDirection();
    return {
      x: direction.x,
      z: direction.z,
      expectedX: -Math.sin(game.yaw),
      expectedZ: -Math.cos(game.yaw),
    };
  });
  expect(movement.x * movement.expectedX + movement.z * movement.expectedZ).toBeGreaterThan(0.99);
  await page.keyboard.up("i");
  await expect
    .poll(() => page.evaluate(() => window.__arena.controlDown("moveForward")))
    .toBe(false);
  expect(errors).toEqual([]);
});

test("first-run guide routes players to local controls, drills and a live warm-up", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click('[data-tab="guide"]');
  await expect(page.locator("#guide-tab")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.locator("#guide-start-title")).toHaveText("Build a practice loop.");
  await page.click("#guide-open-settings");
  await expect(page.locator("#settings")).toBeVisible();
  await page.click("#settings-done");
  await expect(page.locator("#settings")).toBeHidden();
  await page.click("#guide-open-training");
  await expect(page.locator("#training-tab")).toBeVisible();
  await page.click('[data-tab="guide"]');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click("#guide-open-range");
  await page.waitForFunction(
    () => window.__arena?.range === true && window.__arena.state !== "lobby",
  );
  if ((await page.evaluate(() => window.__arena.state)) === "paused") {
    await page.click("#resume-button");
    await page.waitForFunction(() => window.__arena?.state === "playing");
  }
  expect(errors).toEqual([]);
});
