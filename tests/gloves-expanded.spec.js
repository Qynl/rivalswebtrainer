import { test, expect } from "@playwright/test";

async function prepare(page, unlocked = false) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (unlocked)
    await page.addInitScript(() =>
      localStorage.setItem(
        "slap-arena-profile-v1",
        JSON.stringify({ version: 1, slaps: 5500, selected: "glove_default" }),
      ),
    );
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.settings.performance = true;
    g.audio.volume = 0;
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(640, 400, false);
  });
  return errors;
}

test("24-glove collection has real search, availability filters, playstyles, sorting and an empty-state reset", async ({
  page,
}) => {
  const errors = await prepare(page);
  const cards = page.locator(".slap-glove-grid>button");
  await expect(cards).toHaveCount(24);
  await page.getByLabel("Search gloves").fill("invisibility");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName("Ghost glove locked");
  await cards.first().click();
  await expect(page.locator(".slap-glove-details")).toContainText(
    "Invisibility",
  );
  await expect(page.locator(".slap-equip")).toBeDisabled();
  await page.getByLabel("Search gloves").fill("");
  await page.getByRole("button", { name: "Unlocked", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName("Default glove");
  await page.getByRole("button", { name: "Locked", exact: true }).click();
  await expect(cards).toHaveCount(23);
  await page.getByRole("button", { name: "All gloves", exact: true }).click();
  await page.getByLabel("Glove playstyle").selectOption("Defense");
  await expect(cards).toHaveCount(4);
  await page.getByLabel("Sort gloves").selectOption("name");
  expect(await cards.locator("strong").allTextContents()).toEqual([
    "Diamond",
    "Ghost",
    "Golden",
    "Reverse",
  ]);
  await page.getByLabel("Search gloves").fill("this glove does not exist");
  await expect(cards).toHaveCount(0);
  await expect(page.locator(".slap-empty")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(cards).toHaveCount(24);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/expanded-collection-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("every glove renders its original first-person rig, with no nonfinite transforms or missing assets", async ({
  page,
}) => {
  const errors = await prepare(page, true),
    results = [];
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  const ids = await page.evaluate(async () =>
    Object.keys((await import("/src/gloves/catalog.js")).GLOVES),
  );
  for (const id of ids) {
    results.push(
      await page.evaluate(async (id) => {
        const g = window.__arena,
          { gloveLoadout, GLOVES } = await import("/src/gloves/catalog.js");
        g.loadout = gloveLoadout(id);
        g.config.loadout = [...g.loadout];
        g.startRound();
        g.state = "playing";
        g.countdown = 0;
        g.mouseDown = false;
        g.world.boxes = [];
        g.entities.slice(1).forEach((e) => {
          e.alive = false;
          e.model.group.visible = false;
        });
        Object.assign(g.player, {
          x: 0,
          y: 0,
          z: 8,
          vx: 0,
          vy: 0,
          vz: 0,
          grounded: true,
        });
        g.yaw = g.pitch = 0;
        g.updateCamera(1 / 60);
        g.renderer.clear();
        g.renderer.render(g.scene, g.camera);
        g.renderer.clearDepth();
        g.renderer.render(g.weaponScene, g.weaponCamera);
        let finite = true,
          meshes = 0;
        g.viewModel.traverse((o) => {
          finite &&= [
            ...o.position.toArray(),
            ...o.rotation.toArray().slice(0, 3),
            ...o.scale.toArray(),
          ].every(Number.isFinite);
          if (o.isMesh) meshes++;
        });
        return {
          id,
          key: GLOVES[id].key,
          finite,
          meshes,
          rig: g.viewModel.userData.weaponId,
          dual: !!g.viewModel.userData.secondGlove,
        };
      }, id),
    );
  }
  expect(results).toHaveLength(24);
  expect(
    results.every((r) => r.finite && r.meshes >= 15 && r.rig === r.id),
  ).toBe(true);
  expect(results.find((r) => r.key === "dual").dual).toBe(true);
  await page.screenshot({ path: "test-results/expanded-first-person.png" });
  expect(errors).toEqual([]);
});

test("real E input activates expanded mechanics with accurate HUD states and no forced camera rotation", async ({
  page,
}) => {
  const errors = await prepare(page, true);
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  for (const [id, status] of [
    ["glove_ghost", "HIDDEN"],
    ["glove_golden", "POWERUP"],
    ["glove_reverse", "REFLECTING"],
    ["glove_space", "ZERO-G"],
    ["glove_acrobat", null],
    ["glove_thanos", null],
    ["glove_brick", null],
  ]) {
    await page.evaluate(async (id) => {
      const g = window.__arena,
        { gloveLoadout } = await import("/src/gloves/catalog.js");
      g.loadout = gloveLoadout(id);
      g.config.loadout = [...g.loadout];
      g.startRound();
      g.state = "playing";
      g.countdown = 0;
      g.world.boxes = [];
      g.entities.slice(1).forEach((e) => {
        e.alive = false;
        e.model.group.visible = false;
      });
      Object.assign(g.player, {
        x: 0,
        y: 0,
        z: 8,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
      });
      g.yaw = 0.37;
      g.pitch = 0.12;
    }, id);
    await page.keyboard.press("KeyE");
    const result = await page.evaluate(() => {
      const g = window.__arena;
      g.events.update(g);
      return {
        cooldown: g.player.abilityCooldown,
        yaw: g.yaw,
        pitch: g.pitch,
        bricks: g.gloveBricks?.length,
        mark: g.player.gloveMark,
      };
    });
    expect(result.cooldown).toBeGreaterThan(0);
    expect(result.yaw).toBe(0.37);
    expect(result.pitch).toBe(0.12);
    if (status)
      await expect(page.locator(".slap-status")).toContainText(status);
    if (id === "glove_thanos") {
      expect(result.mark).toEqual({ x: 0, y: 0, z: 8 });
      await expect(page.locator(".slap-return-hint")).toContainText("REARMING");
      await expect(page.locator(".slap-ability > span")).toHaveText("0.4s");
      expect(
        await page
          .locator(".slap-ability")
          .evaluate((e) => e.style.getPropertyValue("--ready")),
      ).toBe("0%");
      await page.evaluate(() => {
        const g = window.__arena;
        for (let i = 0; i < 50; i++) g.simulate(1 / 120);
        g.events.update(g);
      });
      await expect(page.locator(".slap-return-hint")).toContainText(
        "E TO RETURN",
      );
      await expect(page.locator(".slap-ability > span")).toHaveText("RETURN");
    }
    if (id === "glove_brick") expect(result.bricks).toBe(1);
  }
  expect(errors).toEqual([]);
});

test("expanded glove bots actually use abilities and land authoritative melee, rather than idle behind new models", async ({
  page,
}) => {
  const errors = await prepare(page, true);
  const results = await page.evaluate(async () => {
    const g = window.__arena,
      { GLOVE_ROSTER, gloveLoadout } = await import("/src/gloves/catalog.js");
    const results = [];
    for (const glove of GLOVE_ROSTER) {
      g.start({
        map: "blockout",
        mode: 1,
        difficulty: "regular",
        loadout: gloveLoadout(glove.id),
        capture: false,
      });
      g.state = "playing";
      g.countdown = 0;
      g.world.boxes = [];
      g.hasLOS = () => true;
      const bot = g.entities[1];
      bot.activeWeapon = glove.id;
      bot.abilityCooldown = 0;
      Object.assign(g.player, {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
      });
      Object.assign(bot, {
        x: 0,
        y: 0,
        z:
          glove.key === "diamond"
            ? 3.5
            : glove.key === "swapper"
              ? 12
              : glove.key === "flash"
                ? 10
                : 6,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
      });
      if (glove.key === "diamond") {
        g.yaw = Math.PI;
        bot.yaw = 0;
      } // The warned attack is visible and faces the defender.
      if (glove.key === "diamond")
        g.player.slapPending = { remaining: 0.3, id: "glove_default" };
      let activated = false,
        launched = false;
      for (let i = 0; i < 120 * 4; i++) {
        g.clock += 1 / 120;
        g.updateSupport(1 / 120);
        g.updatePlayerMelee(1 / 120); // The initial defensive threat really finishes.
        g.updateBot(bot, 1 / 120);
        activated ||= bot.abilityCooldown > 0;
        launched ||= (g.player.ragdollTime || 0) > 0;
      }
      results.push({
        id: glove.id,
        active: glove.activation === "active",
        activated,
        health: g.player.health,
        launched,
        finite: [bot.x, bot.y, bot.z, bot.vx, bot.vy, bot.vz].every(
          Number.isFinite,
        ),
      });
    }
    return results;
  });
  console.log("EXPANDED BOT RESULTS", JSON.stringify(results));
  expect(results).toHaveLength(24);
  expect(results.every((r) => r.finite)).toBe(true);
  expect(results.filter((r) => r.active).every((r) => r.activated)).toBe(true);
  expect(results.every((r) => r.health < 150 && r.launched)).toBe(true);
  expect(errors).toEqual([]);
});
