import { test, expect } from "@playwright/test";
test("production assets support a disconnected reload and range session", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4173");
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).some((k) => k.startsWith("offline-arena-")),
    ),
  ).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await expect(page.locator("#play-button")).toBeVisible();
  await page.evaluate(() => {
    window.__arena.renderer.render = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  expect(await page.evaluate(() => window.__arena.state)).toBe("playing");
  expect(
    await page.evaluate(() => window.__arena.camera.position.z),
  ).toBeCloseTo(19, 8);
  expect(await page.evaluate(() => window.__arena.entities.length)).toBe(6);
  expect(errors).toEqual([]);
});
