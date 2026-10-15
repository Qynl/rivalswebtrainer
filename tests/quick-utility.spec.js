import { test, expect } from "@playwright/test";
async function range(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.start({
      mode: 1,
      map: "blockout",
      range: true,
      difficulty: "regular",
      capture: false,
      loadout: ["rifle", "revolver", "knife", "grenade"],
    });
    g.audio.volume = 0;
    g.range = false;
    g.state = "playing";
    g.clock = 10;
    g.yaw = g.pitch = 0;
    g.cooldown = g.switchTime = 0;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 14,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    g.events.banner("", "", "", 0.001);
  });
}
async function draw(page) {
  return page.evaluate(() => {
    const g = window.__arena;
    g.updateCamera(1 / 60);
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
    g.events.update(g);
    return g.renderer.getContext().getError();
  });
}
test("real G binding quick-uses all five utilities, shows the actual model and returns to the same gun", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await range(page);
  for (const id of [
    "grenade",
    "grenade",
    "molotov",
    "smoke",
    "flashbang",
    "medkit",
  ]) {
    await page.evaluate((id) => {
      const g = window.__arena;
      g.cancelThrow();
      g.clearQuickMelee();
      g.loadout[3] = id;
      g.ammunition[3] = { mag: id === "medkit" ? 1 : 2, reserve: 0 };
      g.weaponReadyAt[3] = 0;
      g.player.health = 75;
      g.cooldown = 1;
      g.reloadTime = 0.6;
      g.aiming = true;
      g.events.update(g);
    }, id);
    const gunAmmo = await page.evaluate(() => window.__arena.ammunition[0].mag);
    await page.keyboard.down("g");
    await page.keyboard.down("g"); // real autorepeat must not consume another charge
    await page.keyboard.up("g");
    const active = await page.evaluate(() => {
      const g = window.__arena;
      return {
        id: g.quickModel?.userData.weaponId,
        gunVisible: g.viewModel.visible,
        slot: g.slot,
        ammo: g.ammunition[0].mag,
        utilityAmmo: g.ammunition[3].mag,
        cooldown: g.cooldown,
        heal: g.healTime,
      };
    });
    expect(active.id).toBe(id);
    expect(active.gunVisible).toBe(false);
    expect(active.slot).toBe(0);
    expect(active.ammo).toBe(gunAmmo);
    expect(active.cooldown).toBe(1);
    expect(active.utilityAmmo).toBe(id === "medkit" ? 0 : 1);
    await expect(page.locator("#utility-status")).toContainText(
      id === "medkit" ? "HEALING" : "THROWING",
    );
    expect(await draw(page)).toBe(0);
    expect(
      await page.evaluate(
        () => window.__arena.quickModel.userData.throwableBody?.visible ?? true,
      ),
    ).toBe(true);
    const inFrame = await page.evaluate(async () => {
      const g = window.__arena,
        THREE = await import("/node_modules/.vite/deps/three.js");
      g.quickModel.updateMatrixWorld(true);
      const p = new THREE.Box3()
        .setFromObject(g.quickModel.userData.throwableBody || g.quickModel)
        .getCenter(new THREE.Vector3())
        .project(g.weaponCamera);
      return { x: p.x, y: p.y };
    });
    expect(Math.abs(inFrame.x)).toBeLessThan(1);
    expect(Math.abs(inFrame.y)).toBeLessThan(1);
    if (id === "grenade")
      await page.screenshot({ path: "/tmp/night-quick-grenade.png" });
    const result = await page.evaluate(() => {
      const g = window.__arena,
        count = g.projectiles.length;
      for (let i = 0; i < 110; i++) {
        g.clock += 1 / 120;
        g.throwTime = Math.max(0, g.throwTime - 1 / 120);
        g.updateSupport(1 / 120);
        g.updatePlayer(1 / 120);
      }
      g.updateCamera(1 / 60);
      g.events.update(g);
      return {
        visible: g.viewModel.visible,
        quick: !!g.quickModel,
        slot: g.slot,
        health: g.player.health,
        released: g.projectiles.length - count,
        ammo: g.ammunition[0].mag,
      };
    });
    expect(result.visible).toBe(true);
    expect(result.quick).toBe(false);
    expect(result.slot).toBe(0);
    expect(result.health).toBe(id === "medkit" ? 100 : 75);
    expect(result.released).toBe(id === "medkit" ? 0 : 1);
    expect(result.ammo).toBe(gunAmmo);
    expect(await draw(page)).toBe(0);
  }
  await expect(page.locator("#utility-status")).toContainText("EMPTY");
  const ammo = await page.evaluate(() => window.__arena.ammunition[0].mag);
  await page.keyboard.press("g");
  expect(await page.evaluate(() => window.__arena.ammunition[0].mag)).toBe(
    ammo,
  );
  // F and G remain adjacent, compact and inside a narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator(".quick-actions").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeLessThan(40);
  expect(errors).toEqual([]);
});
test("billowing smoke really renders, clips against the map, hazes its interior and disposes on expiry", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await range(page);
  await page.evaluate(() => {
    const g = window.__arena;
    const position = g.eye(g.player).set(0, 1.5, -1);
    g.explosion(position, g.player, "smoke");
    g.effects.at(-1).life = 6;
    g.updateEffects(0.01);
  });
  expect(await draw(page)).toBe(0);
  await page.screenshot({ path: "/tmp/night-smoke-outside.png" });
  const outside = await page.evaluate(() => {
    const g = window.__arena,
      cloud = g.smokes[0].effect.mesh;
    return {
      count: cloud.count,
      instanced: cloud.isInstancedMesh,
      fade: cloud.userData.smokeUniforms.fade.value,
    };
  });
  expect(outside).toEqual({ count: 32, instanced: true, fade: 1 });
  await page.evaluate(() => {
    const g = window.__arena;
    g.settings.performance = true;
    g.updateEffects(0.01);
  });
  expect(await draw(page)).toBe(0);
  expect(
    await page.evaluate(() => window.__arena.smokes[0].effect.mesh.count),
  ).toBe(16);
  await page.evaluate(() => {
    const g = window.__arena;
    g.settings.performance = false;
    g.updateEffects(0.01);
  });

  await page.evaluate(() => {
    const g = window.__arena;
    g.player.z = -1;
    g.renderPrevious = null;
    g.updateCamera(1);
    g.events.update(g);
  });
  expect(await draw(page)).toBe(0);
  await expect(page.locator("#smoke-overlay")).toBeVisible();
  expect(
    Number(
      await page.locator("#smoke-overlay").evaluate((el) => el.style.opacity),
    ),
  ).toBeGreaterThan(0.9);
  await page.screenshot({ path: "/tmp/night-smoke-inside.png" });
  await page.evaluate(() => {
    const g = window.__arena;
    g.updateEffects(8);
    g.updateProjectiles(0);
    g.events.update(g);
  });
  await expect(page.locator("#smoke-overlay")).toBeHidden();
  expect(await page.evaluate(() => window.__arena.smokes.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("an actual elite opponent reacts to a visible grenade and moves away instead of standing in its blast", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const report = await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.audio.volume = 0;
    g.start({
      mode: 1,
      map: "blockout",
      range: false,
      difficulty: "elite",
      capture: false,
      loadout: ["rifle", "revolver", "knife", "grenade"],
    });
    g.world.build("range"); // open, real walkable test lane; the opponent is NOT a range dummy
    g.state = "playing";
    g.clock = 10;
    Object.assign(g.player, { x: 0, y: 0, z: 14 });
    const e = g.entities.find((e) => e.team === 1);
    Object.assign(e, {
      x: 0,
      y: 0,
      z: 4,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      shootTimer: 999,
      meleeId: "knife",
      activeWeapon: "rifle",
      health: 150,
    });
    const origin = g.eye(e).set(2, 0.2, 4),
      dir = origin.clone().set(0, 0, -1);
    g.spawnProjectile(g.player, origin, dir, "grenade");
    const p = g.projectiles.at(-1);
    p.pos.set(2, 0.2, 4);
    p.mesh.position.copy(p.pos);
    p.vel.set(0, 0, 0);
    p.fuse = 0.6;
    const start = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
    let evaded = false,
      firstReaction = null;
    for (let i = 0; i < 120; i++) {
      g.clock += 1 / 120;
      g.updateBot(e, 1 / 120);
      if (e.evadingHazard && firstReaction === null)
        firstReaction = (i + 1) / 120;
      evaded ||= e.evadingHazard;
    }
    return {
      start,
      end: Math.hypot(e.x - p.pos.x, e.z - p.pos.z),
      evaded,
      firstReaction,
      finite: [e.x, e.y, e.z, e.vx, e.vy, e.vz].every(Number.isFinite),
      target: !!e.target,
    };
  });
  expect(report.target).toBe(false);
  expect(report.evaded).toBe(true);
  expect(report.end).toBeGreaterThan(report.start + 2);
  expect(report.firstReaction).toBeGreaterThan(0.05);
  expect(report.finite).toBe(true);
});

test("real rendered F/G models reuse a bounded cache and round/lobby cleanup releases it", async ({
  page,
}) => {
  await range(page);
  const result = await page.evaluate(() => {
    const g = window.__arena;
    const models = new Map(),
      warm = [],
      baselineChildren = g.weaponScene.children.length;
    for (let i = 0; i < 80; i++) {
      const id = i % 2 ? "grenade" : "knife";
      g.showQuickAction(id, 0.48, id === "grenade");
      const previous = models.get(id);
      if (previous && previous !== g.quickModel)
        throw new Error("Model was rebuilt");
      models.set(id, g.quickModel);
      g.updateCamera(1 / 60);
      if (i < 4 || i % 10 === 0) {
        g.renderer.autoClear = true;
        g.renderer.render(g.weaponScene, g.weaponCamera);
        if (g.renderer.getContext().getError())
          throw new Error("Quick model GL error");
        if (i >= 3) warm.push(g.renderer.info.memory.geometries);
      }
      g.clearQuickMelee();
      if (g.weaponScene.children.length !== baselineChildren)
        throw new Error("Hidden models leaked into scene");
    }
    const retained = g.quickModels.size;
    g.quit();
    return {
      retained,
      after: g.quickModels.size,
      quick: !!g.quickModel,
      variation: Math.max(...warm) - Math.min(...warm),
      slot: g.weaponScene.children.length - baselineChildren,
    };
  });
  expect(result).toEqual({
    retained: 2,
    after: 0,
    quick: false,
    variation: 0,
    slot: 0,
  });
});
