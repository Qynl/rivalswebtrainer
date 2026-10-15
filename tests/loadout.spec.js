import { test, expect } from "@playwright/test";

test("reference arena, four-step picker, draft cancellation, new weapons and medkit inputs", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("THREE.WebGLProgram"))
      errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  expect(
    await page.evaluate(() => ({
      map: window.__arena.world.mapId,
      angled: window.__arena.world.boxes.filter((b) => b.angle).length,
      depth: window.__arena.world.nav.sizeZ,
    })),
  ).toEqual({ map: "blockout", angled: 4, depth: 32 });
  const walls = await page.evaluate(() =>
    window.__arena.world.boxes.filter((b) => b.maxY > 10),
  );
  expect(walls.length).toBe(4);
  expect(walls.every((b) => b.maxY === 24)).toBe(true);
  await page.evaluate(() => (window.__arena.renderer.render = () => {}));
  await page.click("#play-button");
  await expect(page.locator("#match-setup")).toBeVisible();
  await expect(page.locator("#setup-title")).toHaveText("Choose your primary");
  expect(await page.evaluate(() => window.__arena.state)).toBe("lobby");
  const picker = await page.locator(".setup-modal").boundingBox();
  expect(picker.width).toBeLessThanOrEqual(760);
  expect(picker.height).toBeLessThan(600);
  await page.click('[data-pick-weapon="bow"]');
  await page.keyboard.press("Escape");
  await expect(page.locator("#match-setup")).not.toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("rivals-loadout")),
  ).toBeNull();
  await page.click("#play-button");
  await expect(page.locator('[data-pick-weapon="rifle"]')).toHaveClass(
    /selected/,
  );
  await page.click('[data-pick-weapon="bow"]');
  await page.click("#setup-next");
  await expect(page.locator("#setup-title")).toHaveText(
    "Choose your secondary",
  );
  await page.click('[data-pick-weapon="uzi"]');
  await page.click("#setup-next");
  await expect(page.locator("#setup-title")).toHaveText("Choose your melee");
  await page.click('[data-pick-weapon="scythe"]');
  await page.click("#setup-next");
  await expect(page.locator("#setup-title")).toHaveText("Choose your utility");
  await expect(page.locator('[data-pick-weapon="flashbang"]')).toBeVisible();
  await page.click('[data-pick-weapon="medkit"]');
  await expect(page.locator("#setup-next")).toHaveText("DEPLOY →");
  await page.click("#setup-back");
  await expect(page.locator('[data-pick-weapon="scythe"]')).toHaveClass(
    /selected/,
  );
  await page.click("#setup-next");
  await expect(page.locator('[data-pick-weapon="medkit"]')).toHaveClass(
    /selected/,
  );
  await page.click("#setup-next");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await expect(page.locator("#match-setup")).not.toBeVisible();
  await expect(page.locator(".hud-controls")).not.toBeVisible();
  const slot = await page.locator(".hud-slot").first().boundingBox();
  expect(slot.width).toBe(62);
  expect(slot.height).toBe(44);
  expect(await page.evaluate(() => window.__arena.loadout)).toEqual([
    "bow",
    "uzi",
    "scythe",
    "medkit",
  ]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rivals-loadout")),
    ),
  ).toEqual(["bow", "uzi", "scythe", "medkit"]);
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.updateBot = () => {};
    g.countdown = 0.001;
    g.simulate(0.02);
  });
  await page.keyboard.press("Digit4");
  await page.evaluate(() => {
    window.__arena.player.health = 35;
    window.__arena.cooldown = 0;
  });
  await page.mouse.down({ button: "right" });
  expect(await page.evaluate(() => window.__arena.healTime)).toBeGreaterThan(0);
  await page.mouse.up({ button: "right" });
  await page.evaluate(() => window.__arena.updateSupport(1));
  expect(await page.evaluate(() => window.__arena.player.health)).toBe(60);
  expect(await page.evaluate(() => window.__arena.ammunition[3].mag)).toBe(0);
  await page.keyboard.press("Digit1");
  await page.evaluate(() => {
    window.__arena.cooldown = 0;
    window.__arena.pitch = 0;
    window.__arena.yaw = 0;
  });
  await page.mouse.down();
  await page.evaluate(() => {
    for (let i = 0; i < 72; i++) window.__arena.updatePlayer(1 / 60);
  });
  expect(await page.evaluate(() => window.__arena.ammunition[0].mag)).toBe(1);
  await page.mouse.up();
  await page.evaluate(() => window.__arena.updatePlayer(1 / 60));
  expect(await page.evaluate(() => window.__arena.projectiles[0].arrow)).toBe(
    true,
  );
  const utility = await page.evaluate(() => {
    const g = window.__arena;
    g.loadout[3] = "flashbang";
    g.ammunition[3] = { mag: 2, reserve: 0 };
    g.equip(3);
    g.cooldown = 0;
    g.firePlayer();
    return {
      mag: g.ammunition[3].mag,
      id: g.projectiles.at(-1).id,
      fuse: g.projectiles.at(-1).fuse,
    };
  });
  expect(utility).toEqual({ mag: 1, id: "flashbang", fuse: 1.5 });
  await page.evaluate(() => window.__arena.finish());
  await page.click("#rematch-button");
  await expect(page.locator("#setup-title")).toHaveText("Choose your primary");
  await page.click("#setup-close");
  await expect(page.locator("#results")).toBeVisible();
  expect(errors).toEqual([]);
});
