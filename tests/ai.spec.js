import { test, expect } from "@playwright/test";

test("3v3 bots navigate the compact Arena and keep fighting during a two-minute simulation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.render = () => {};
  });
  await page.click('[data-mode="3"]');
  await page.click('[data-difficulty="elite"]');
  await page.click("#play-button");
  for (let i = 0; i < 4; i++) await page.click("#setup-next");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const result = await page.evaluate(() => {
    const g = window.__arena;
    g.state = "playing";
    g.audio.play = () => {};
    g.audio.noiseHit = () => {};
    let hits = 0;
    g.damage = () => {
      hits++;
    };
    const bots = g.entities.filter((e) => !e.isPlayer),
      visited = bots.map(() => new Set());
    let invalid = 0,
      maxY = 0;
    for (let frame = 0; frame < 7200; frame++) {
      g.clock += 1 / 60;
      for (let j = 0; j < bots.length; j++) {
        const e = bots[j];
        g.updateBot(e, 1 / 60);
        visited[j].add(Math.round(e.x) + "," + Math.round(e.z));
        if (
          ![e.x, e.y, e.z, e.vx, e.vy, e.vz].every(Number.isFinite) ||
          e.y < -0.001 ||
          Math.abs(e.x) > 15.57 ||
          Math.abs(e.z) > 20.57
        )
          invalid++;
        maxY = Math.max(maxY, e.y);
      }
      g.updateEffects(1 / 60);
    }
    return {
      hits,
      visited: visited.map((s) => s.size),
      invalid,
      maxY,
      bots: bots.length,
      roles: bots.map((e) => e.meleeId),
      actions: bots.map((e) => e.actionCounts),
    };
  });
  console.log(JSON.stringify({ botMovement: result }));
  const total = (key) => result.actions.reduce((n, a) => n + (a[key] || 0), 0);
  for (const key of [
    "dashes",
    "slides",
    "slideJumps",
    "doubleJumps",
    "switches",
    "meleeSwings",
    "meleeHits",
    "rifleShots",
  ])
    expect(total(key), key).toBeGreaterThan(0);
  expect(new Set(result.roles).size).toBe(4);
  expect(result.bots).toBe(5);
  expect(result.invalid).toBe(0);
  expect(result.hits).toBeGreaterThan(50);
  expect(result.visited.filter((n) => n > 8).length).toBeGreaterThanOrEqual(4);
  expect(result.maxY).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
