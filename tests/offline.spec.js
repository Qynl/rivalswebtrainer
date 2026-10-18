import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
  await page.bringToFront();
  await page.click("#range-button");
  // Chromium can reject initial capture after a disconnected navigation. The
  // real, visible resume button provides a fresh gesture; never fake the lock.
  await page.waitForFunction(
    () =>
      document.pointerLockElement !== null || window.__arena.state === "paused",
    { timeout: 10000 },
  );
  if (!(await page.evaluate(() => !!document.pointerLockElement)))
    await page.locator("#resume-button").click();
  await page.waitForFunction(() => document.pointerLockElement !== null, {
    timeout: 10000,
  });
  expect(await page.evaluate(() => window.__arena.state)).toBe("playing");
  expect(
    await page.evaluate(() => window.__arena.camera.position.z),
  ).toBeCloseTo(19, 8);
  expect(await page.evaluate(() => window.__arena.entities.length)).toBe(6);

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toBeVisible();
  await page.click("#quit-button");
  await expect(page.locator("#lobby")).toBeVisible();
  await page.click('[data-tab="training"]');
  await page.click("#start-drill-tracking");
  await page.waitForFunction(
    () =>
      window.__arena?.activeDrill?.id === "tracking" &&
      window.__arena.state === "playing" &&
      document.pointerLockElement !== null,
  );
  await page.evaluate(() => {
    Object.assign(window.__arena.matchStats, {
      shots: 10,
      hits: 7,
      headshots: 2,
      kills: 1,
    });
    window.__arena.drillElapsed = window.__arena.activeDrill.duration - 1 / 240;
    window.__arena.simulate(1 / 120);
  });
  await expect(page.locator("#drill-results")).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rivals-training-history"))?.[0]?.score,
    ),
  ).toBe(7);
  await page.click("#drill-lobby");
  await expect(page.locator("#training-tab")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.click("#training-export");
  const download = await downloadPromise,
    backup = await readFile(await download.path());
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.click("#training-reset");
  await page.setInputFiles("#training-import-file", {
    name: "offline-training-backup.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rivals-training-history"))?.[0]?.score,
    ),
  ).toBe(7);
  expect(errors).toEqual([]);
});
