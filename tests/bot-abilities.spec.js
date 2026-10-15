import { test, expect } from "@playwright/test";

test("AI chooses quick dash/guard, chains slide-jump/double-jump, equips melee and renders its real weapon", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const report = await page.evaluate(async () => {
    const g = window.__arena,
      bot = g.entities.find((e) => e.model),
      p = g.player;
    const THREE = await import("/node_modules/three/build/three.module.js");
    g.config.difficulty = "elite";
    g.world.build("blockout");
    g.audio.volume = 0;
    g.audio.clearSpatial();
    for (const e of g.entities) if (e.model) e.model.group.visible = e === bot;
    g.entities = [p, bot];
    g.state = "playing";
    g.range = true;
    g.clock = 10;
    g.renderer.setPixelRatio(0.5);
    g.renderer.shadowMap.enabled = false;
    g.resize();
    const reset = (id) => {
      Object.assign(p, {
        x: 14.5,
        y: 0,
        z: 3,
        vx: 0,
        vy: 0,
        vz: 0,
        health: 1000,
        alive: true,
        height: 1.9,
        yaw: Math.PI,
      });
      Object.assign(bot, {
        target: false,
        meleeId: id,
        activeWeapon: "rifle",
        x: 14.5,
        y: 0,
        z: 18,
        vx: 0,
        vy: 0,
        vz: -10,
        health: 1000,
        alive: true,
        height: 1.9,
        grounded: true,
        jumps: 0,
        seed: 0.5,
        strafe: 1,
        targetEntity: p,
        visible: true,
        seen: 1,
        decision: 0,
        pathTimer: 1,
        path: [],
        reload: 0,
        ammo: 20,
        shootTimer: 0,
        actionCounts: {},
        meleePending: null,
        coverPlan: null,
        lastKnown: null,
        lastKnownAt: g.clock,
        dashCooldown: 0,
        dashTime: 0,
        deflectCooldown: 0,
        deflectTime: 0,
        quickMeleeTime: 0,
        meleeCooldown: 0,
        swingTime: 0,
        botEquipTime: 0,
        slideCooldown: 0,
        slideTime: 0,
        mobilityCooldown: 0,
        actionThinkTime: 0,
        guardFlash: 0,
        jumpCooldown: 0,
        pressureUntil: 0,
        coverReadyAt: 0,
        slideAge: 0,
        jumpAge: 0,
        slideJumpCombo: false,
        slideJumpQueued: false,
      });
      g.lastShotAt = undefined;
    };
    const tick = () => {
      g.clock += 1 / 120;
      g.updateBot(bot, 1 / 120);
    };
    const draw = () => {
      g.camera.position.set(11.5, 2, 20);
      g.camera.lookAt(bot.x, bot.y + 1, bot.z);
      g.camera.fov = 70;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.getContext().finish();
      if (g.renderer.getContext().getError())
        throw Error("NPC ability GL error");
    };
    reset("scythe");
    tick();
    draw();
    const dash = {
      count: bot.actionCounts.dashes,
      quick: bot.actionCounts.quickAbilities,
      ammo: bot.ammo,
      weapon: bot.activeWeapon,
      shown: bot.model.parts.meleeSocket?.userData.weaponId,
      gun: bot.model.parts.gun.visible,
      speed: Math.hypot(bot.vx, bot.vz),
    };
    reset("katana");
    g.lastShotAt = g.clock;
    tick();
    draw();
    const health = bot.health,
      playerHealth = p.health;
    g.bullet(p, new THREE.Vector3(14.5, 1, 3), new THREE.Vector3(0, 0, 1), {
      damage: 13,
      head: 1.65,
      range: 100,
    });
    const guard = {
      count: bot.actionCounts.guards,
      quick: bot.actionCounts.quickAbilities,
      ammo: bot.ammo,
      health: bot.health,
      before: health,
      reflected: p.health < playerHealth,
      deflections: bot.actionCounts.deflections,
      shown: bot.model.parts.meleeSocket?.userData.weaponId,
    };
    reset("fists");
    bot.activeWeapon = "fists";
    p.x = -14;
    p.z = -14;
    bot.path = [16, 14, 12, 10, 8, 6].map((z) => ({ x: 14.5, z }));
    let sawLow = false,
      sawAir = false;
    for (let i = 0; i < 160; i++) {
      tick();
      sawLow ||= bot.height < 1.4;
      sawAir ||= !bot.grounded;
    }
    draw();
    const combo = {
      ...bot.actionCounts,
      sawLow,
      sawAir,
      finite: [bot.x, bot.y, bot.z, bot.vx, bot.vy, bot.vz].every(
        Number.isFinite,
      ),
    };
    reset("knife");
    bot.z = 10;
    p.z = 8;
    const before = p.health;
    for (let i = 0; i < 65; i++) tick();
    draw();
    const melee = {
      ...bot.actionCounts,
      damage: before - p.health,
      shown: bot.model.parts.meleeSocket?.userData.weaponId,
    };
    return { dash, guard, combo, melee };
  });
  console.log(JSON.stringify({ botAbilityScenarios: report }));
  expect(report.dash).toMatchObject({
    count: 1,
    quick: 1,
    ammo: 20,
    weapon: "rifle",
    shown: "scythe",
    gun: false,
  });
  expect(report.dash.speed).toBeCloseTo(28, 5);
  expect(report.guard).toMatchObject({
    count: 1,
    quick: 1,
    ammo: 20,
    reflected: true,
    deflections: 1,
    shown: "katana",
  });
  expect(report.guard.health).toBe(report.guard.before);
  expect(report.combo.slides).toBeGreaterThan(0);
  expect(report.combo.slideJumps).toBeGreaterThan(0);
  expect(report.combo.doubleJumps).toBeGreaterThan(0);
  expect(report.combo).toMatchObject({
    sawLow: true,
    sawAir: true,
    finite: true,
  });
  expect(report.melee.switches).toBeGreaterThan(0);
  expect(report.melee.meleeHits).toBeGreaterThan(0);
  expect(report.melee.damage).toBeGreaterThan(0);
  expect(report.melee.shown).toBe("knife");
  expect(errors).toEqual([]);
});
