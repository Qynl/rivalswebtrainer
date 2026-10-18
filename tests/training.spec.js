import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function ready(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const game = window.__arena;
    game.renderer.setPixelRatio(0.5);
    game.renderer.shadowMap.enabled = false;
    game.renderer.render = () => {};
  });
  await page.click('[data-tab="training"]');
  await expect(page.locator("#training-tab")).toBeVisible();
}

async function finishQuickly(page, stats) {
  await page.evaluate((counts) => {
    const game = window.__arena;
    Object.assign(game.matchStats, counts);
    const action = game.recordTrainingAction(game.loadout[0]);
    game.recordTrainingContact(game.loadout[0], {
      kind: "direct",
      head: counts.headshots > 0,
      distance: 12,
      damage: 13,
      action,
    });
    game.drillElapsed = game.activeDrill.duration - 1 / 240;
    game.simulate(1 / 120);
  }, stats);
  await expect(page.locator("#drill-results")).toBeVisible();
}

test("timed tracking drill produces a local personal best, retry and session history", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(page.locator("#training-drills article")).toHaveCount(3);
  await expect(page.locator('[data-drill-card="tracking"]')).toContainText("NO RUN YET");
  await page.click("#training-edit-loadout");
  await expect(page.locator("#loadout-tab")).toBeVisible();
  await page.click("#loadout-done");
  await expect(page.locator("#training-tab")).toBeVisible();

  await page.click("#start-drill-tracking");
  await page.waitForFunction(
    () =>
      window.__arena?.activeDrill?.id === "tracking" &&
      window.__arena.state === "playing" &&
      document.pointerLockElement !== null,
  );
  const initial = await page.evaluate(() => ({
    remaining: window.__arena.activeDrill.duration - window.__arena.drillElapsed,
    targets: window.__arena.entities.filter((entity) => entity.target).length,
    hudDrill: document.querySelector("#drill-status strong")?.textContent,
  }));
  expect(initial.remaining).toBeLessThanOrEqual(60);
  expect(initial.remaining).toBeGreaterThan(59.5);
  expect(initial.targets).toBe(5);
  expect(initial.hudDrill).toBe("Track the strafe");
  await expect(page.locator("#timer")).toHaveText("1:00");

  await finishQuickly(page, { shots: 20, hits: 11, headshots: 4, kills: 3 });
  await expect(page.locator("#drill-result-score")).toHaveText("11");
  await expect(page.locator("#drill-result-eyebrow")).toHaveText("NEW PERSONAL BEST");
  await expect(page.locator("#drill-result-metrics")).toContainText("55%");
  await expect(page.locator("#drill-result-best")).toContainText("new best");
  await expect(page.locator("#drill-results")).toContainText("WEAPON BREAKDOWN");
  await expect(page.locator("#drill-result-analytics .drill-weapon-row")).toHaveCount(4);
  await expect(page.locator("#drill-result-analytics .drill-weapon-row").first()).toContainText("Assault Rifle");
  await expect(page.locator("#drill-result-analytics .drill-weapon-row").first()).toContainText("1/1");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rivals-training-history"))[0]),
  ).toMatchObject({
    drillId: "tracking",
    score: 11,
    shots: 20,
    hits: 11,
    accuracy: 55,
    loadout: ["rifle", "pistol", "fists", "grenade"],
  });
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rivals-training-history"))[0].analytics.weapons[0],
    ),
  ).toMatchObject({
    weaponId: "rifle",
    actions: 1,
    hitActions: 1,
    headHitActions: 1,
    directContacts: 1,
    headContacts: 1,
  });

  await page.click("#drill-again");
  await page.waitForFunction(
    () =>
      window.__arena?.activeDrill?.id === "tracking" &&
      window.__arena.state === "playing" &&
      document.pointerLockElement !== null,
  );
  expect(await page.evaluate(() => window.__arena.matchStats.shots)).toBe(0);
  await finishQuickly(page, { shots: 20, hits: 8, headshots: 2, kills: 1 });
  await expect(page.locator("#drill-result-eyebrow")).toHaveText("DRILL COMPLETE");
  await expect(page.locator("#drill-result-best")).toHaveText("Personal best: 11 HITS");
  await page.click("#drill-lobby");
  await expect(page.locator("#training-tab")).toBeVisible();
  await expect(page.locator('[data-drill-card="tracking"]')).toContainText("11 HITS");
  await expect(page.locator('[data-training-trend="tracking"]')).toContainText("9.5 HITS AVG");
  await expect(page.locator('[data-training-trend="tracking"]')).toContainText("Need 1 more run");
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(2);
  const downloadPromise = page.waitForEvent("download");
  await page.click("#training-export");
  const download = await downloadPromise,
    exportedText = await readFile(await download.path(), "utf8"),
    exported = JSON.parse(exportedText);
  expect(download.suggestedFilename()).toMatch(/^rivals-training-.*\.json$/);
  expect(exported).toMatchObject({
    format: "rivals-training-history",
    schemaVersion: 1,
  });
  expect(exported.runs).toHaveLength(2);
  expect(exported.runs[0].analytics.version).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.getElementById("lobby").scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click('[data-tab="training"]');
  await expect(page.locator('[data-drill-card="tracking"]')).toContainText("11 HITS");
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(2);
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.click("#training-reset");
  await expect(page.locator("#training-history")).toContainText("No sessions yet");
  expect(await page.evaluate(() => localStorage.getItem("rivals-training-history"))).toBe("[]");

  const importFile = {
    name: "rivals-training-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportedText),
  };
  await page.setInputFiles("#training-import-file", importFile);
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(2);
  await expect(page.locator('[data-drill-card="tracking"]')).toContainText("11 HITS");
  await page.setInputFiles("#training-import-file", importFile);
  await expect(page.locator("#toast")).toContainText("Duplicate records were skipped");
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(2);
  await page.setInputFiles("#training-import-file", {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("not JSON"),
  });
  await expect(page.locator("#toast")).toContainText("not valid training-history JSON");
  await expect(page.locator("#training-history .training-history-row")).toHaveCount(2);
  await page.click("#training-reset");
  await expect(page.locator("#training-history")).toContainText("No sessions yet");
  expect(await page.evaluate(() => localStorage.getItem("rivals-training-history"))).toBe("[]");
  expect(errors).toEqual([]);
});

test("precision and speed drills load distinct target layouts and the clock freezes when paused", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  for (const [id, expectedTargets, expectedSpeed] of [
    ["precision", 3, 0.62],
    ["clears", 5, 1.05],
  ]) {
    await page.click(`#start-drill-${id}`);
    await page.waitForFunction(
      (drillId) =>
        window.__arena?.activeDrill?.id === drillId &&
        window.__arena.state === "playing" &&
        document.pointerLockElement !== null,
      id,
    );
    const drill = await page.evaluate(() => ({
      targetCount: window.__arena.entities.filter((entity) => entity.target).length,
      speed: window.__arena.activeDrill.targetSpeed,
      duration: window.__arena.activeDrill.duration,
    }));
    expect(drill).toEqual({
      targetCount: expectedTargets,
      speed: expectedSpeed,
      duration: 60,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator("#pause")).toBeVisible();
    const clock = await page.evaluate(() => ({
      game: window.__arena.clock,
      drill: window.__arena.drillElapsed,
    }));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__arena.clock)).toBe(clock.game);
    expect(await page.evaluate(() => window.__arena.drillElapsed)).toBe(clock.drill);
    await page.click("#quit-button");
    await expect(page.locator("#lobby")).toBeVisible();
    await page.click('[data-tab="training"]');
  }
  expect(errors).toEqual([]);
});
