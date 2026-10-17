import { test, expect } from "@playwright/test";
async function prepare(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby", null, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.settings.performance = true;
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(640, 400, false);
  });
  return errors;
}
async function practice(page) {
  await page.click("#range-button");
  await page.waitForFunction(
    () => !!document.pointerLockElement && window.__arena.state === "playing",
  );
  await page.evaluate(() => {
    const g = window.__arena;
    g.audio.volume = 0;
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
    g.__step = (n) => {
      for (let i = 0; i < n; i++) g.simulate(1 / 120);
      g.updateCamera(1 / 60);
      g.events.tick(g);
    };
  });
}
test("glove-only collection, locked ability descriptions, settings and responsive menu", async ({
  page,
}) => {
  const errors = await prepare(page);
  await expect(
    page.getByRole("button", { name: "Default glove", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".slap-glove-grid>button")).toHaveCount(9);
  await page
    .getByRole("button", { name: "Flash glove locked", exact: true })
    .click();
  await expect(page.locator(".slap-glove-details")).toContainText(
    "Teleportation",
  );
  await expect(page.locator(".slap-equip")).toBeDisabled();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Invert mouse Y").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("rivals-settings")).invertMouseY,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.querySelector(".slap-app").scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
test("real mouse hits cause damage, launched ragdolls, one saved slap, no hidden guns, and recovery", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  await page.evaluate(() => {
    const g = window.__arena,
      e = g.entities[1];
    e.alive = true;
    e.model.group.visible = true;
    e.health = 150;
    Object.assign(e, { x: 0, y: 0, z: 5.8, vx: 0, vz: 0, vy: 0, seed: 0 });
  });
  await page.mouse.down();
  const result = await page.evaluate(() => {
    const g = window.__arena;
    g.__step(17);
    return {
      health: g.entities[1].health,
      ragdoll: g.entities[1].ragdollTime,
      hits: g.matchStats.hits,
      model: g.entities[1].model.gloveRagdoll?.nodes.length,
      slaps: JSON.parse(localStorage.getItem("slap-arena-profile-v1")).slaps,
    };
  });
  await page.mouse.up();
  expect(result.health).toBe(126);
  expect(result.ragdoll).toBeGreaterThan(0.5);
  expect(result.hits).toBe(1);
  expect(result.model).toBe(15);
  expect(result.slaps).toBe(1);
  await page.keyboard.press("Digit2");
  await page.keyboard.press("KeyG");
  await page.keyboard.press("KeyR");
  const recovered = await page.evaluate(() => {
    const g = window.__arena;
    g.__step(100);
    return {
      slot: g.slot,
      weapon: g.loadout[g.slot],
      ragdoll: g.entities[1].ragdollTime,
      visible: g.entities[1].model.gloveRagdoll.root.visible,
      pending: !!g.pendingThrow,
      z: g.entities[1].z,
    };
  });
  expect(recovered.slot).toBe(0);
  expect(recovered.weapon).toBe("glove_default");
  expect(recovered.ragdoll).toBe(0);
  expect(recovered.visible).toBe(false);
  expect(recovered.pending).toBe(false);
  expect(recovered.z).toBeLessThan(0);
  await page.keyboard.press("KeyE");
  const burst = await page.evaluate(() => ({
    boost: window.__arena.player.boostTime,
    cooldown: window.__arena.player.abilityCooldown,
    slaps: JSON.parse(localStorage.getItem("slap-arena-profile-v1")).slaps,
  }));
  expect(burst.boost).toBeGreaterThan(1);
  expect(burst.cooldown).toBe(7);
  expect(burst.slaps).toBe(1);

  expect(errors).toEqual([]);
});
test("15 actual confirmed hits unlock Diamond, selection persists, and misses do not farm currency", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const earned = await page.evaluate(() => {
    const g = window.__arena,
      e = g.entities[1];
    g.mouseDown = false;
    for (let hit = 0; hit < 15; hit++) {
      Object.assign(e, {
        alive: true,
        health: 150,
        x: 0,
        y: 0,
        z: 5.8,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
        ragdollTime: 0,
        slapGrace: 0,
      });
      g.player.gloveCooldown = 0;
      g.firePlayer();
      g.clock += 0.1;
      g.updatePlayerMelee(0.1);
    }
    e.z = 50;
    g.player.gloveCooldown = 0;
    g.firePlayer();
    g.updatePlayerMelee(0.2);
    return JSON.parse(localStorage.getItem("slap-arena-profile-v1")).slaps;
  });
  expect(earned).toBe(15);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave arena", exact: true }).click();
  await page
    .getByRole("button", { name: "Diamond glove", exact: true })
    .click();
  await page
    .getByRole("button", { name: "EQUIP GLOVE →", exact: true })
    .click();
  await expect(page.locator(".slap-glove-details .slap-equip")).toContainText(
    "EQUIPPED",
  );
  await page.reload();
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slap-arena-profile-v1")),
    ),
  ).toMatchObject({ slaps: 15, selected: "glove_diamond" });
  expect(errors).toEqual([]);
});
test("bots genuinely approach, slap, knock back and eliminate in glove-only team rounds", async ({
  page,
}) => {
  const errors = await prepare(page);
  const results = await page.evaluate(() => {
    const g = window.__arena,
      results = [];
    for (const mode of [1, 2]) {
      g.start({
        map: "foundry",
        mode,
        difficulty: "regular",
        loadout: ["glove_default", "pistol", "fists", "grenade"],
        capture: false,
      });
      g.state = "playing";
      g.countdown = 0;
      g.audio.volume = 0;
      let firstHit = -1,
        minPlayerHealth = 150,
        minHealth = 150,
        maxLaunch = 0;
      // Advance real simulation time, with the actual navigation, arena collision and AI.
      // Teams can legitimately focus your teammate first, so measure the duel separately.
      for (let i = 0; i < 120 * 65; i++) {
        if (["playing", "roundend", "countdown"].includes(g.state))
          g.simulate(1 / 120);
        minPlayerHealth = Math.min(minPlayerHealth, g.player?.health ?? 150);
        minHealth = Math.min(minHealth, ...g.entities.map((e) => e.health));
        maxLaunch = Math.max(
          maxLaunch,
          ...g.entities.map((e) =>
            e.ragdollTime > 0 ? Math.hypot(e.vx, e.vz) : 0,
          ),
        );
        if (firstHit < 0 && g.entities.some((e) => e.health < 150))
          firstHit = i / 120;
      }
      results.push({
        mode,
        firstHit,
        minPlayerHealth,
        minHealth,
        maxLaunch,
        gloves: g.entities
          .filter((e) => !e.isPlayer)
          .every((e) => e.activeWeapon?.startsWith("glove_")),
        score: [...g.score],
        round: g.round,
      });
    }
    return results;
  });
  console.log("OFFLINE GLOVE BOTS", JSON.stringify(results));
  for (const result of results) {
    expect(result.firstHit).toBeGreaterThanOrEqual(0);
    expect(result.firstHit).toBeLessThan(15);
    expect(result.minHealth).toBeLessThan(150);
    expect(result.maxLaunch).toBeGreaterThan(10);
    expect(result.gloves).toBe(true);
    expect(result.score.some((n) => n > 0)).toBe(true);
  }
  expect(results[0].minPlayerHealth).toBeLessThan(150);
  expect(errors).toEqual([]);
});
test("between-round selection is one unlocked glove and preserves health and movement settings", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.click("#play-button");
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("KeyM");
  await expect(page.locator(".slap-round-gloves button")).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: "Bull 475 SLAPS" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Keep current glove", exact: true })
    .click();
  const result = await page.evaluate(() => ({
    health: window.__arena.player.health,
    loadout: window.__arena.loadout[0],
    selecting: window.__arena.selectingLoadout,
  }));
  expect(result).toEqual({
    health: 150,
    loadout: "glove_default",
    selecting: false,
  });
  expect(errors).toEqual([]);
});
