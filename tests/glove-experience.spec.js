import { test, expect } from "@playwright/test";
async function prepare(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /shader|WebGLProgram/i.test(m.text()))
      errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.audio.volume = 0;
    g.settings.performance = true;
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(800, 600, false);
  });
  return errors;
}
async function practice(page) {
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
}

test("locked gloves can be genuinely test-driven, without equipping them in the profile or awarding saved slaps", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page
    .getByRole("button", { name: "Golden glove locked", exact: true })
    .click();
  await expect(page.locator(".slap-equip")).toBeDisabled();
  await page.getByRole("button", { name: /TRY IN PRACTICE/ }).click();
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  expect(
    await page.evaluate(() => ({
      id: window.__arena.loadout[0],
      trial: window.__arena.testDrive,
      profile: JSON.parse(
        localStorage.getItem("slap-arena-profile-v1") || "{}",
      ),
    })),
  ).toMatchObject({ id: "glove_golden", trial: true });
  await expect(page.locator(".slap-trial-label")).toContainText(
    "NO SAVED REWARDS",
  );
  const outcome = await page.evaluate(async () => {
    const g = window.__arena,
      { resolveSlap } = await import("/src/gloves/combat.js");
    g.world.boxes = [];
    Object.assign(g.player, { x: 0, y: 0, z: 8 });
    g.yaw = g.pitch = 0;
    g.entities.slice(1).forEach((e) => (e.alive = false));
    Object.assign(g.entities[1], {
      alive: true,
      health: 150,
      x: 0,
      y: 0,
      z: 5.8,
      slapGrace: 0,
      goldTime: 0,
      stoneTime: 0,
    });
    resolveSlap(g, g.player, "glove_golden");
    g.events.tick(g);
    return {
      health: g.entities[1].health,
      hits: g.matchStats.hits,
      slaps: g.matchStats.slaps,
      profile: JSON.parse(
        localStorage.getItem("slap-arena-profile-v1") || "{}",
      ),
    };
  });
  expect(outcome.health).toBeLessThan(150);
  expect(outcome.hits).toBe(1);
  expect(outcome.slaps).toBe(0);
  expect(outcome.profile.slaps || 0).toBe(0);
  expect(outcome.profile.selected || "glove_default").toBe("glove_default");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave arena", exact: true }).click();
  await expect(page.locator(".slap-equip")).toBeDisabled();
  expect(errors).toEqual([]);
});
test("actual slap range cue appears for visible targets and vanishes for Ghost/cover, while failed E explains why", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  await page.evaluate(() => {
    const g = window.__arena;
    g.world.boxes = [];
    Object.assign(g.player, { x: 0, y: 0, z: 8 });
    g.yaw = g.pitch = 0;
    g.entities.slice(1).forEach((e) => (e.alive = false));
    Object.assign(g.entities[1], {
      alive: true,
      health: 150,
      x: 0,
      y: 0,
      z: 5.8,
      ghostTime: 0,
    });
    g.events.update(g);
  });
  await expect(page.locator(".slap-reach")).toContainText("IN REACH");
  await page.evaluate(() => {
    const g = window.__arena;
    g.entities[1].ghostTime = 2;
    g.events.update(g);
  });
  await expect(page.locator(".slap-reach")).toHaveCount(0);
  await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js");
    g.loadout = gloveLoadout("glove_magnet");
    g.slot = -1;
    g.equip(0);
    g.entities[1].z = -25;
    g.entities[1].ghostTime = 0;
    g.player.abilityCooldown = 0;
  });
  await page.keyboard.press("KeyE");
  await expect(page.locator(".glove-cast-notice")).toContainText(
    "NO VISIBLE TARGET",
  );
  expect(
    await page.evaluate(() => window.__arena.player.abilityCooldown || 0),
  ).toBe(0);
  expect(errors).toEqual([]);
});
test("every active glove renders its own first- and third-person cast without camera rotation, including unique status silhouettes and tethers", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { GLOVE_ROSTER, gloveLoadout } = await import("/src/gloves/catalog.js"),
      { presentGloveAbility } = await import("/src/gloves/fx.js"),
      { presentGloveStates } = await import("/src/gloves/visual-effects.js");
    g.world.boxes = [];
    g.cameraZoom = 4;
    g.yaw = 0.1;
    g.pitch = -0.1;
    g.player.vx = g.player.vz = 0;
    const poses = [];
    for (const glove of GLOVE_ROSTER.filter((x) => x.activation === "active")) {
      g.loadout = gloveLoadout(glove.id);
      g.slot = -1;
      g.equip(0);
      g.clock = 10;
      g.player.gloveCastTime = 9.8;
      g.player.goldTime = g.player.reverseTime = g.player.spaceTime = 0;
      g.updateCamera(1 / 60);
      g.renderer.autoClear = true;
      g.renderer.render(g.scene, g.camera);
      g.renderer.clearDepth();
      g.viewModel.visible = true;
      g.renderer.render(g.weaponScene, g.weaponCamera);
      poses.push({
        id: glove.id,
        position: g.viewModel.position.toArray(),
        finger: g.viewModel.userData.gloveRig.fingers[0].rotation.x,
        finite: g.player.model.group.position.toArray().every(Number.isFinite),
      });
    }
    g.player.goldTime = 3;
    presentGloveStates(g, g.player);
    const gold = g.player.model.gloveAura.userData.systems.gold.visible;
    g.player.goldTime = 0;
    g.player.reverseTime = 2;
    presentGloveStates(g, g.player);
    const reverse = g.player.model.gloveAura.userData.systems.reverse.visible;
    g.player.reverseTime = 0;
    g.player.spaceTime = 2;
    presentGloveStates(g, g.player);
    const space = g.player.model.gloveAura.userData.systems.space.visible;
    const target = g.entities[1];
    target.alive = true;
    presentGloveAbility(g, {
      player: g.player.id,
      target: target.id,
      glove: "glove_magnet",
      position: [g.player.x, g.player.y + 0.6, g.player.z],
      yaw: g.yaw,
    });
    g.updateEffects(0.1);
    g.renderer.render(g.scene, g.camera);
    return {
      poses,
      yaw: g.yaw,
      pitch: g.pitch,
      gold,
      reverse,
      space,
      links: g.gloveFX.links.mesh.count,
    };
  });
  expect(result.poses.length).toBe(15);
  expect(result.poses.every((p) => p.finite)).toBe(true);
  expect(
    new Set(result.poses.map((p) => p.position.join(","))).size,
  ).toBeGreaterThan(10);
  expect(result).toMatchObject({
    yaw: 0.1,
    pitch: -0.1,
    gold: true,
    reverse: true,
    space: true,
    links: 64,
  });
  expect(errors).toEqual([]);
});
test("Foundry and Courtyard retain distinct floors, collision geometry, stable resource caches and real rendered identity", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const results = [];
  for (const id of ["foundry", "courtyard"]) {
    results.push(
      await page.evaluate((id) => {
        const g = window.__arena;
        g.world.build(id);
        g.yaw = 0;
        g.pitch = -0.08;
        const spawn = g.world.spawns[0][0];
        Object.assign(g.player, { x: spawn.x, y: 0, z: spawn.z });
        g.cameraZoom = 0;
        g.cameraZoomSmoothed = 0;
        g.updateCamera(1);
        g.renderer.autoClear = true;
        g.renderWorld();
        g.renderer.autoClear = false;
        g.renderer.clearDepth();
        g.renderer.render(g.weaponScene, g.weaponCamera);
        const counts = {
          boxes: g.world.boxes.length,
          materials: g.world.materials.size,
          textures: g.world.graphics.textures.size,
          color: g.world.materials.get(id + "-floor").color.getHex(),
        };
        g.world.build(id);
        return {
          ...counts,
          again: {
            boxes: g.world.boxes.length,
            materials: g.world.materials.size,
            textures: g.world.graphics.textures.size,
          },
        };
      }, id),
    );
    await page.screenshot({ path: `test-results/experience-${id}.png` });
  }
  expect(results[0].color).not.toBe(results[1].color);
  for (const r of results) {
    expect(r.again).toEqual({
      boxes: r.boxes,
      materials: r.materials,
      textures: r.textures,
    });
  }
  expect(errors).toEqual([]);
});

test("opaque rigid glove batching reduces actual GPU submissions without losing triangles or retaining disposed textures", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const results = await page.evaluate(async () => {
    const g = window.__arena;
    const { createGloveModel, animateGlove } =
      await import("/src/gloves/model.js");
    const { GLOVE_ROSTER } = await import("/src/gloves/catalog.js");
    const results = [];
    const original = g.viewModel;
    original.visible = false;
    const draw = (model) => {
      g.weaponScene.add(model);
      animateGlove(model, {
        gloveSwingAge: 0.08,
        gloveCastAge: 10,
        shake: false,
      });
      g.renderer.autoClear = true;
      g.renderer.render(g.weaponScene, g.weaponCamera);
      g.renderer.getContext().finish();
      const result = {
        calls: g.renderer.info.render.calls,
        triangles: g.renderer.info.render.triangles,
      };
      g.weaponScene.remove(model);
      g.disposeVisual(model);
      return result;
    };
    for (const glove of GLOVE_ROSTER) {
      const raw = draw(createGloveModel(glove.id, { batch: false }));
      const batched = draw(createGloveModel(glove.id));
      results.push({ key: glove.key, raw, batched });
      await new Promise(requestAnimationFrame);
    }
    original.visible = true;
    g.renderer.render(g.weaponScene, g.weaponCamera);
    return {
      results,
      textures: g.renderer.info.memory.textures,
      geometries: g.renderer.info.memory.geometries,
    };
  });
  console.log("REAL GLOVE GPU SUBMISSIONS", JSON.stringify(results));
  for (const r of results.results) {
    expect(r.batched.calls, r.key).toBeLessThan(r.raw.calls);
    expect(r.batched.triangles, r.key).toBeGreaterThanOrEqual(r.raw.triangles);
  }
  expect(results.textures).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test("offline enemy casts animate the enemy, not the local hand or local ability notice", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { useGloveAbility } = await import("/src/gloves/combat.js");
    const bot = g.entities[1];
    bot.activeWeapon = "glove_golden";
    bot.abilityCooldown = 0;
    bot.ragdollTime = 0;
    bot.stoneTime = 0;
    g.clock = 20;
    g.player.gloveCastTime = -100;
    bot.gloveCastTime = -100;
    g.gloveNotice = null;
    const cast = useGloveAbility(g, bot, "glove_golden");
    g.animateBot(bot, 1 / 60);
    g.events.update(g);
    return {
      cast,
      ids: g.entities.map((e) => e.id),
      playerCast: g.player.gloveCastTime,
      botCast: bot.gloveCastTime,
      notice: g.gloveNotice?.text || "",
      gold: bot.goldTime,
      playerGold: g.player.goldTime || 0,
    };
  });
  expect(new Set(result.ids).size).toBe(result.ids.length);
  expect(result).toMatchObject({
    cast: true,
    playerCast: -100,
    botCast: 20,
    notice: "",
    gold: 3,
    playerGold: 0,
  });
  await expect(page.locator(".glove-cast-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("taking a real slap shows the known impact bearing and delayed health chip without changing aim", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  await page.evaluate(() => {
    const g = window.__arena;
    g.clock = 5;
    g.yaw = 0;
    g.pitch = 0.1;
    g.events.tick(g);
    const bot = g.entities[1];
    Object.assign(bot, { x: g.player.x + 3, z: g.player.z, alive: true });
    g.damage(g.player, 32, bot);
    g.clock += 0.01;
    g.events.update(g);
  });
  await expect(page.locator(".slap-health strong")).toContainText("118");
  await expect(page.locator(".slap-damage-bearings svg")).toHaveCount(1);
  const feedback = await page.evaluate(() => {
    const g = window.__arena;
    const chip = document.querySelector(".slap-health-chip"),
      hp = document.querySelector(".slap-health-current");
    return {
      chip: parseFloat(chip.style.width),
      health: parseFloat(hp.style.width),
      bearing: document.querySelector(".slap-damage-bearings svg").style
        .transform,
      yaw: g.yaw,
      pitch: g.pitch,
    };
  });
  expect(feedback.chip).toBeGreaterThan(feedback.health);
  expect(parseFloat(feedback.bearing.replace("rotate(", ""))).toBeCloseTo(
    Math.PI / 2,
    4,
  );
  expect(feedback.yaw).toBe(0);
  expect(feedback.pitch).toBe(0.1);
  await page.evaluate(() => {
    const g = window.__arena;
    g.clock += 1;
    g.events.update(g);
  });
  await expect(page.locator(".slap-damage-bearings svg")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("practice lab can borrow a locked glove, change target behaviour/count, reset with R and actually fight a configured opponent", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Practice lab" }),
  ).toBeVisible();
  await page.getByLabel("Training glove").selectOption("glove_golden");
  await page.getByLabel("Practice behaviour").selectOption("stationary");
  await page.getByLabel("Practice target count").selectOption("1");
  await page
    .getByRole("button", { name: "Apply sandbox setup", exact: true })
    .click();
  const stationary = await page.evaluate(() => {
    const g = window.__arena,
      b = g.entities[1];
    g.clock += 0.1;
    g.updateBot(b, 1 / 120);
    return {
      state: g.state,
      weapon: g.loadout[0],
      trial: g.testDrive,
      count: g.entities.length,
      vx: b.vx,
      mode: b.practiceMode,
      profile: JSON.parse(
        localStorage.getItem("slap-arena-profile-v1") || "{}",
      ),
    };
  });
  expect(stationary).toMatchObject({
    state: "paused",
    weapon: "glove_golden",
    trial: true,
    count: 2,
    vx: 0,
    mode: "stationary",
  });
  expect(stationary.profile.selected || "glove_default").toBe("glove_default");
  await page.getByLabel("Practice behaviour").selectOption("sparring");
  await page.getByLabel("Opponent glove").selectOption("glove_snow");
  await page
    .getByRole("button", { name: "Apply sandbox setup", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to the fight ↗", exact: true })
    .click();
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  const duel = await page.evaluate(() => {
    const g = window.__arena,
      b = g.entities[1];
    g.world.boxes = [];
    g.hasLOS = () => true;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 0,
      health: 150,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      goldTime: 0,
    });
    Object.assign(b, {
      x: 0,
      y: 0,
      z: -6,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: Math.PI,
      grounded: true,
    });
    for (let i = 0; i < 360; i++) {
      g.clock += 1 / 120;
      g.updateSupport(1 / 120);
      g.updateBot(b, 1 / 120);
    }
    return {
      opponent: b.activeWeapon,
      target: b.target,
      health: g.player.health,
      chill: g.player.chillTime || 0,
      ragdoll: g.player.ragdollTime || 0,
    };
  });
  expect(duel.opponent).toBe("glove_snow");
  expect(duel.target).toBe(false);
  expect(duel.health).toBeLessThan(150);
  expect(duel.chill).toBeGreaterThan(0);
  await page.keyboard.press("KeyR");
  expect(
    await page.evaluate(() => ({
      health: window.__arena.player.health,
      count: window.__arena.entities.length,
      stats: window.__arena.practiceStats,
      weapon: window.__arena.loadout[0],
    })),
  ).toMatchObject({
    health: 150,
    count: 2,
    stats: { damage: 0, contacts: 0 },
    weapon: "glove_golden",
  });
  expect(errors).toEqual([]);
});

test("the detailed actor kit and both Dual gloves remain visible through a real GPU-rendered ragdoll and recover to the original rig", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { updateBotWeapon } = await import("/src/bot-visuals.js");
    const e = g.entities[1];
    g.entities.slice(2).forEach((e) => (e.model.group.visible = false));
    Object.assign(e, {
      x: 0,
      y: 0,
      z: 6,
      yaw: 0.3,
      vx: 8,
      vy: 5,
      vz: -8,
      activeWeapon: "glove_dual",
      alive: true,
      ragdollTime: 0.7,
      ragdollGeneration: 1,
    });
    updateBotWeapon(e.model, e, g.clock);
    const original = e.model.parts.onlineSocket.userData.weapon;
    for (let i = 0; i < 90; i++) {
      g.clock += 1 / 120;
      g.animateBot(e, 1 / 120);
    }
    const rig = e.model.gloveRagdoll;
    g.camera.position.set(2.5, 2.6, 9.3);
    g.camera.lookAt(0, 0.55, 6);
    g.camera.updateMatrixWorld();
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.getContext().finish();
    const report = {
      grips: rig.grips.length,
      chest: rig.chest.name,
      feet: rig.ends.filter((e) => e.mesh?.name.includes("Foot")).length,
      held: rig.grips.every((g) => g.weapon.visible),
      same: rig.grips[0].weapon === original,
      finite: rig.nodes.every((n) => n.p.toArray().every(Number.isFinite)),
    };
    window.__ragdollFixture = e;
    return report;
  });
  expect(result).toMatchObject({
    grips: 2,
    chest: "ragdoll-kit-torso",
    feet: 2,
    held: true,
    same: true,
    finite: true,
  });
  await page.screenshot({ path: "test-results/detailed-dual-ragdoll.png" });
  expect(
    await page.evaluate(() => {
      const g = window.__arena,
        e = window.__ragdollFixture;
      e.ragdollTime = 0;
      g.animateBot(e, 1 / 120);
      return (
        e.model.parts.onlineSocket.userData.weapon.parent ===
        e.model.parts.onlineSocket
      );
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("holding Tab shows genuine round-persistent combat tallies and never exposes rival health", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.click("#play-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.player,
  );
  await page.evaluate(async () => {
    const g = window.__arena,
      { resolveSlap } = await import("/src/gloves/combat.js");
    g.state = "playing";
    g.world.boxes = [];
    g.yaw = g.pitch = 0;
    Object.assign(g.player, { x: 0, y: 0, z: 3 });
    Object.assign(g.entities[1], {
      x: 0,
      y: 0,
      z: 0.8,
      health: 150,
      alive: true,
      slapGrace: 0,
      goldTime: 0,
      stoneTime: 0,
    });
    resolveSlap(g, g.player, "glove_default");
    g.events.update(g);
  });
  await page.keyboard.down("Tab");
  await expect(
    page.getByRole("region", { name: "Match scoreboard" }),
  ).toBeVisible();
  await expect(page.locator(".slap-scoreboard tbody tr")).toHaveCount(2);
  await expect(page.locator(".slap-scoreboard tr.self td").nth(3)).toHaveText(
    "1",
  );
  await expect(
    page
      .locator(".slap-scoreboard tr:not(.self) td")
      .filter({ hasText: "126 HP" }),
  ).toHaveCount(0);
  const aim = await page.evaluate(() => [
    window.__arena.yaw,
    window.__arena.pitch,
  ]);
  expect(aim).toEqual([0, 0]);
  await page.keyboard.up("Tab");
  await expect(page.locator(".slap-scoreboard")).toHaveCount(0);
  await page.evaluate(async () => {
    const g = window.__arena,
      { resolveSlap } = await import("/src/gloves/combat.js");
    const e = g.entities[1];
    e.health = 5;
    e.slapGrace = 0;
    resolveSlap(g, g.player, "glove_default");
    g.startRound();
  });
  await page.keyboard.down("Tab");
  await expect(page.locator(".slap-scoreboard tr.self td").nth(2)).toHaveText(
    "1 / 0",
  );
  await expect(page.locator(".slap-scoreboard tr.self td").nth(3)).toHaveText(
    "2",
  );
  await page.screenshot({ path: "test-results/match-scoreboard.png" });
  await page.keyboard.up("Tab");
  expect(errors).toEqual([]);
});

test("dead team-one players cycle only living teammates, zoom safely, and retain their own aim/view choice", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.getByRole("button", { name: "3v3", exact: true }).click();
  await page.click("#play-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.entities.length === 6,
  );
  const names = await page.evaluate(async () => {
    const g = window.__arena;
    g.state = "playing";
    g.player.team = 1;
    g.cameraZoom = 0;
    g.yaw = 0.7;
    g.pitch = 0.1;
    const rival = g.entities.find((e) => e.team === 0 && e !== g.player);
    const { applyImpact } = await import("/src/gloves/combat.js"),
      { GLOVES } = await import("/src/gloves/catalog.js");
    g.player.health = 10;
    applyImpact(g, rival, g.player, GLOVES.glove_default, true);
    g.updateCamera(1 / 60);
    g.events.update(g);
    return g.entities.filter((e) => e.alive && e.team === 1).map((e) => e.name);
  });
  const panel = page.getByRole("complementary", { name: "Spectator camera" });
  await expect(panel).toContainText(names[0]);
  await expect(panel).toContainText("1 / 3");
  await expect(panel).toContainText("ELIMINATED BY");
  await expect(panel).toContainText("Default · 10 DMG");
  await expect(panel).toContainText("RECENT 1 HIT / 10 DMG");
  await expect(page.locator(".slap-crosshair")).toHaveCount(0);
  await expect(page.locator(".slap-ability")).toContainText("OUT");
  await page.keyboard.press("ArrowRight");
  await expect(panel).toContainText(names[1]);
  await expect(panel).toContainText("2 / 3");
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toContainText(names[0]);
  await page.keyboard.press("KeyV");
  await page.mouse.wheel(0, 100);
  const view = await page.evaluate(() => {
    const g = window.__arena;
    g.updateCamera(1 / 60);
    g.events.update(g);
    g.renderWorld();
    return {
      zoom: g.cameraZoom,
      spectatorZoom: g.spectatorZoom,
      aim: [g.yaw, g.pitch],
      follow: g.spectatorFollow?.team,
      camera: g.camera.position.toArray(),
    };
  });
  expect(view.zoom).toBe(0);
  expect(view.spectatorZoom).toBeGreaterThan(6);
  expect(view.aim).toEqual([0.7, 0.1]);
  expect(view.follow).toBe(1);
  expect(view.camera.every(Number.isFinite)).toBe(true);
  await page.screenshot({ path: "test-results/teammate-spectating.png" });
  await page.evaluate(() => {
    const g = window.__arena;
    for (const e of g.entities) if (e.team === g.player.team) e.alive = false;
    g.updateCamera(1 / 60);
    g.events.update(g);
  });
  await expect(panel).toContainText("Waiting for the next round");
  expect(await page.evaluate(() => window.__arena.spectatorFollow)).toBe(null);
  expect(errors).toEqual([]);
});

test("Brick sits on an actual Foundry ramp, visibly arms, and disposes immediately after a real no-damage trip", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js"),
      { useGloveAbility, tickGloves } = await import("/src/gloves/combat.js"),
      { surfaceHeight } = await import("/src/physics.js");
    g.start({
      mode: 1,
      map: "foundry",
      difficulty: "regular",
      loadout: gloveLoadout("glove_brick"),
      capture: false,
    });
    g.state = "playing";
    const ramp = g.world.boxes.find((b) => b.ramp);
    const x = (ramp.minX + ramp.maxX) / 2,
      z = (ramp.minZ + ramp.maxZ) / 2;
    Object.assign(g.player, {
      x,
      y: surfaceHeight(ramp, x, z),
      z,
      grounded: true,
      vx: 0,
      vy: 0,
      vz: 0,
    });
    g.yaw = 0;
    g.pitch = -1;
    g.player.abilityCooldown = 0;
    const placed = useGloveAbility(g),
      brick = g.gloveBricks?.[0],
      armedInitially = brick?.mesh.userData.armed;
    g.clock += 0.5;
    tickGloves(g, 0.5);
    g.updateEffects(0.5);
    g.yaw = Math.PI;
    g.cameraZoom = 0;
    g.updateCamera(1 / 60);
    g.events.update(g);
    g.renderWorld();
    window.__testedBrick = brick;
    return {
      placed,
      armedInitially,
      armed: brick?.mesh.userData.armed,
      y: brick?.y,
      support: brick ? surfaceHeight(ramp, brick.x, brick.z) : null,
      tilt: brick?.mesh.quaternion.toArray(),
      hits: g.matchStats.hits,
    };
  });
  expect(result.placed).toBe(true);
  expect(result.armedInitially).toBe(false);
  expect(result.armed).toBe(true);
  expect(result.y).toBeCloseTo(result.support, 6);
  expect(result.tilt.some((v, i) => i < 3 && Math.abs(v) > 0.01)).toBe(true);
  expect(result.hits).toBe(0);
  await page.screenshot({ path: "test-results/brick-ramp-contact.png" });
  const trip = await page.evaluate(async () => {
    const g = window.__arena,
      b = window.__testedBrick,
      { tickGloves } = await import("/src/gloves/combat.js");
    const e = g.entities.find((e) => e.team !== g.player.team);
    Object.assign(e, {
      x: b.x,
      y: b.y,
      z: b.z,
      alive: true,
      grounded: true,
      ragdollTime: 0,
      goldTime: 0,
      stoneTime: 0,
    });
    const hp = e.health;
    tickGloves(g, 0.01);
    g.updateEffects(0.01);
    return {
      before: hp,
      after: e.health,
      ragdoll: e.ragdollTime,
      parent: b.mesh.parent !== null,
      remaining: g.gloveBricks.length,
      effects: g.effects.filter((e) => e.brick === b).length,
      hits: g.matchStats.hits,
    };
  });
  expect(trip.before).toBe(trip.after);
  expect(trip.ragdoll).toBeGreaterThan(0.7);
  expect(trip.parent).toBe(false);
  expect(trip.remaining).toBe(0);
  expect(trip.effects).toBe(0);
  expect(trip.hits).toBe(0);
  expect(errors).toEqual([]);
});

test("pause practice and settings keep native Tab/Space navigation without enqueuing movement or attacks", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  await page.keyboard.press("Escape");
  await page.getByLabel("Training glove").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Practice behaviour")).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const invert = page.getByRole("checkbox", { name: "Invert mouse Y" });
  await invert.focus();
  const before = await invert.isChecked();
  await page.keyboard.press("Space");
  if (before) await expect(invert).not.toBeChecked();
  else await expect(invert).toBeChecked();
  const state = await page.evaluate(() => ({
    state: window.__arena.state,
    keys: [...window.__arena.keys],
    pending: window.__arena.player.slapPending,
    saved: JSON.parse(localStorage.getItem("rivals-settings") || "{}"),
  }));
  expect(state.state).toBe("paused");
  expect(state.keys).toEqual([]);
  expect(state.saved.invertMouseY).toBe(!before);
  expect(state.pending).toBeFalsy();
  expect(errors).toEqual([]);
});

test("the full six-player roster fits a short landscape view and a narrow portrait view", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.getByRole("button", { name: "3v3", exact: true }).click();
  await page.click("#play-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.entities.length === 6,
  );
  await page.keyboard.down("Tab");
  for (const viewport of [
    { width: 760, height: 420 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".slap-scoreboard tbody tr")).toHaveCount(6);
    const bounds = await page.locator(".slap-scoreboard").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.screenshot({ path: "test-results/portrait-team-roster.png" });
  await page.keyboard.up("Tab");
  expect(errors).toEqual([]);
});

test("real Web Audio renders a non-silent Default blast and a spatial EMP, then releases ended source graphs", async ({
  page,
}) => {
  const errors = await prepare(page);
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import("/src/audio.js"),
      { playGloveAbilityAudio } = await import("/src/gloves/audio.js");
    const results = [];
    for (const spatial of [false, true]) {
      const ctx = new OfflineAudioContext(2, 22050, 44100),
        audio = new GameAudio(),
        sources = [];
      audio.ctx = ctx;
      audio.noise = ctx.createBuffer(1, 44100, 44100);
      const noise = audio.noise.getChannelData(0);
      for (let i = 0; i < noise.length; i++)
        noise[i] = Math.sin(i * 12.345) * Math.cos(i * 0.713);
      for (const method of ["createOscillator", "createBufferSource"]) {
        const create = ctx[method].bind(ctx);
        ctx[method] = () => {
          const n = create(),
            disconnect = n.disconnect.bind(n),
            entry = { node: n, released: false };
          n.disconnect = () => {
            entry.released = true;
            disconnect();
          };
          sources.push(entry);
          return n;
        };
      }
      const p = { id: "self", alive: true, x: 0, y: 0, z: 0 },
        g = {
          audio,
          player: p,
          state: "playing",
          yaw: 0,
          eye: () => ({ x: 0, y: 1.6, z: 0 }),
        };
      playGloveAbilityAudio(g, {
        player: spatial ? "rival" : "self",
        glove: spatial ? "glove_stun" : "glove_default",
        position: spatial ? [8, 1.6, 0] : [0, 0.6, 0],
      });
      const rendered = await ctx.startRendering(),
        rms = [];
      let peak = 0;
      for (let c = 0; c < 2; c++) {
        const data = rendered.getChannelData(c);
        let energy = 0;
        for (const sample of data) {
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        rms.push(Math.sqrt(energy / data.length));
      }
      audio.clearSpatial();
      results.push({
        rms,
        peak,
        sources: sources.length,
        released: sources.every((s) => s.released && s.node.onended === null),
      });
    }
    return results;
  });
  expect(result[0].rms[0]).toBeGreaterThan(0.001);
  expect(result[0].peak).toBeLessThan(1);
  expect(result[1].rms[1]).toBeGreaterThan(result[1].rms[0] * 1.1);
  expect(result[1].peak).toBeLessThan(1);
  expect(result.every((r) => r.sources >= 2 && r.released)).toBe(true);
  expect(errors).toEqual([]);
});

test("a real Courtyard opponent navigates around low cover it can see over and lands real damage without walking through it", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js"),
      { canOccupy } = await import("/src/physics.js");
    g.start({
      mode: 1,
      map: "courtyard",
      difficulty: "regular",
      loadout: gloveLoadout("glove_default"),
      capture: false,
    });
    g.state = "playing";
    const e = g.entities[1],
      p = g.player;
    let cover,
      visible = false;
    for (const b of g.world.boxes.filter(
      (b) => Math.abs(b.maxY - 1.3) < 0.01,
    )) {
      const x = (b.minX + b.maxX) / 2;
      Object.assign(e, {
        x,
        y: 0,
        z: b.maxZ + 2,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
        abilityCooldown: 99,
      });
      Object.assign(p, {
        x,
        y: 0,
        z: b.minZ - 3,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
      });
      if (
        canOccupy(e, e.x, e.y, e.z, g.world.boxes) &&
        canOccupy(p, p.x, p.y, p.z, g.world.boxes) &&
        g.hasLOS(g.eye(e), g.eye(p))
      ) {
        cover = b;
        visible = true;
        break;
      }
    }
    if (!cover) return { visible: false };
    let side = 0,
      hitAt = null,
      physical = true;
    const center = (cover.minX + cover.maxX) / 2;
    for (let i = 0; i < 960; i++) {
      g.simulate(1 / 120);
      side = Math.max(side, Math.abs(e.x - center));
      physical &&= canOccupy(e, e.x, e.y, e.z, g.world.boxes);
      if (p.health < 150) {
        hitAt = i / 120;
        break;
      }
    }
    g.updateCamera(1 / 60);
    g.events.update(g);
    g.renderWorld();
    return {
      visible,
      side,
      width: cover.maxX - cover.minX,
      hitAt,
      physical,
      health: p.health,
      avoids: e.actionCounts?.obstacleAvoids || 0,
      phase: e.animationPhase,
      navigated: !!e.gloveNavigation,
    };
  });
  expect(result.visible).toBe(true);
  expect(result.hitAt).not.toBeNull();
  expect(result.hitAt).toBeLessThan(8);
  expect(result.health).toBeLessThan(150);
  expect(result.physical).toBe(true);
  expect(result.side).toBeGreaterThan(result.width / 2);
  expect(result.avoids).toBeGreaterThan(0);
  expect(result.navigated).toBe(true);
  expect(result.phase).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test("real Foundry cover breaks live bot tracking; sight reacquisition updates the remembered goal", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js");
    g.start({
      mode: 1,
      map: "foundry",
      difficulty: "regular",
      loadout: gloveLoadout("glove_default"),
      capture: false,
    });
    g.state = "playing";
    const e = g.entities[1],
      p = g.player;
    Object.assign(e, {
      x: -3.5,
      y: 0,
      z: -3,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      grounded: true,
      abilityCooldown: 99,
    });
    Object.assign(p, {
      x: -3.5,
      y: 0,
      z: -4.5,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    const initialSight = g.hasLOS(g.eye(e), g.eye(p));
    g.simulate(1 / 120);
    const remembered = { ...e.gloveAwareness?.goal };
    Object.assign(p, { x: -5, y: 0, z: -10, vx: 0, vy: 0, vz: 0 });
    const coveredA = g.hasLOS(g.eye(e), g.eye(p));
    g.simulate(1 / 120);
    const hiddenA = { ...e.gloveAwareness?.goal };
    const yawA = e.yaw;
    Object.assign(p, { x: -2, y: 0, z: -10, vx: 0, vy: 0, vz: 0 });
    const coveredB = g.hasLOS(g.eye(e), g.eye(p));
    g.simulate(1 / 120);
    const hiddenB = { ...e.gloveAwareness?.goal };
    const hiddenVisible = e.visible;
    Object.assign(p, { x: -4.5, y: 0, z: -3, vx: 0, vy: 0, vz: 0 });
    const regained = g.hasLOS(g.eye(e), g.eye(p));
    g.simulate(1 / 120);
    const reacquired = { ...e.gloveAwareness?.goal };
    return {
      initialSight,
      coveredA,
      coveredB,
      regained,
      remembered,
      hiddenA,
      hiddenB,
      hiddenVisible,
      reacquired,
      yawA,
      finite: Number.isFinite(e.yaw),
    };
  });
  expect(result.initialSight).toBe(true);
  expect(result.coveredA).toBe(false);
  expect(result.coveredB).toBe(false);
  expect(result.hiddenVisible).toBe(false);
  expect(result.hiddenA.x).toBe(result.remembered.x);
  expect(result.hiddenA.z).toBe(result.remembered.z);
  expect(result.hiddenB.x).toBe(result.remembered.x);
  expect(result.hiddenB.z).toBe(result.remembered.z);
  expect(result.hiddenB.slapPending).toBeNull();
  expect(result.regained).toBe(true);
  expect(result.reacquired.x).toBe(-4.5);
  expect(result.reacquired.z).toBe(-3);
  expect(result.finite).toBe(true);
  expect(errors).toEqual([]);
});

test("exact overlapping real glove opponents separate through ordinary movement without pushing the stationary player", async ({
  page,
}) => {
  const errors = await prepare(page);
  await practice(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js"),
      { canOccupy } = await import("/src/physics.js");
    g.start({
      mode: 2,
      map: "courtyard",
      difficulty: "regular",
      loadout: gloveLoadout("glove_default"),
      capture: false,
    });
    g.state = "playing";
    const p = g.player,
      enemies = g.entities.filter((e) => e.team === 1),
      ally = g.entities.find((e) => e !== p && e.team === 0);
    Object.assign(ally, { x: 10, z: 10 });
    Object.assign(p, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true });
    for (const e of enemies)
      Object.assign(e, {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: 0,
        grounded: true,
        activeWeapon: "glove_default",
        abilityCooldown: 99,
      });
    let physical = true;
    for (let i = 0; i < 20; i++) {
      g.simulate(1 / 120);
      for (const e of enemies)
        physical &&=
          canOccupy(e, e.x, e.y, e.z, g.world.boxes) &&
          [e.x, e.y, e.z, e.yaw].every(Number.isFinite);
    }
    return {
      separation: Math.hypot(
        enemies[0].x - enemies[1].x,
        enemies[0].z - enemies[1].z,
      ),
      fromPlayer: enemies.map((e) => Math.hypot(e.x - p.x, e.z - p.z)),
      player: [p.x, p.z],
      physical,
    };
  });
  expect(result.physical).toBe(true);
  expect(result.separation).toBeGreaterThan(0.5);
  expect(Math.min(...result.fromPlayer)).toBeGreaterThan(0.3);
  expect(result.player).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test("starting on the ready map retains actual GPU geometry, collision and navigation; switching maps still rebuilds", async ({
  page,
}) => {
  const errors = await prepare(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      { gloveLoadout } = await import("/src/gloves/catalog.js");
    let builds = 0;
    const original = g.world.build.bind(g.world);
    g.world.build = (...args) => {
      builds++;
      return original(...args);
    };
    const config = {
      mode: 1,
      map: g.world.mapId,
      difficulty: "regular",
      loadout: gloveLoadout("glove_default"),
      capture: false,
    };
    const initialMap = config.map;
    g.start(config);
    g.renderWorld();
    const firstBuilds = builds,
      boxes = g.world.boxes,
      nav = g.world.nav,
      ray = g.world.solidMeshes,
      geometry = [];
    g.world.group.traverse((o) => {
      if (o.geometry) geometry.push(o.geometry.uuid);
    });
    g.start(config);
    g.renderWorld();
    const after = [];
    g.world.group.traverse((o) => {
      if (o.geometry) after.push(o.geometry.uuid);
    });
    const retained = {
      boxes: boxes === g.world.boxes,
      nav: nav === g.world.nav,
      ray: ray === g.world.solidMeshes,
      geometry: JSON.stringify(geometry) === JSON.stringify(after),
      count: geometry.length,
      builds: builds - firstBuilds,
      health: g.player.health,
      countdown: g.countdown,
    };
    const next = initialMap === "foundry" ? "courtyard" : "foundry";
    g.start({ ...config, map: next });
    g.renderWorld();
    const switched = {
      id: g.world.mapId,
      nav: nav !== g.world.nav,
      boxes: boxes !== g.world.boxes,
      builds,
      entities: g.entities.length,
    };
    g.preview(next);
    const noRedundantPreview = builds === switched.builds;
    return { firstBuilds, retained, switched, next, noRedundantPreview };
  });
  expect(result.firstBuilds).toBe(0);
  expect(result.retained).toMatchObject({
    boxes: true,
    nav: true,
    ray: true,
    geometry: true,
    builds: 0,
    health: 150,
    countdown: 5,
  });
  expect(result.retained.count).toBeGreaterThan(10);
  expect(result.switched).toMatchObject({
    id: result.next,
    nav: true,
    boxes: true,
    builds: 1,
    entities: 2,
  });
  expect(result.noRedundantPreview).toBe(true);
  expect(errors).toEqual([]);
});
