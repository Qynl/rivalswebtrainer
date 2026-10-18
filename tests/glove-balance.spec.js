import { test, expect } from "@playwright/test";
async function ready(page) {
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
    g.renderer.setSize(640, 480, false);
  });
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  return errors;
}
async function arrange(
  page,
  id = "glove_default",
  mode = "stationary",
  opponent = "glove_default",
  target = { z: -2.2 },
) {
  await page.evaluate(
    async ({ id, mode, opponent, target }) => {
      const g = window.__arena,
        { configurePractice } = await import("/src/gloves/practice.js");
      configurePractice(g, { glove: id, mode, count: 1, opponent });
      g.yaw = g.pitch = 0;
      Object.assign(g.player, {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
      });
      Object.assign(g.entities[1], {
        x: 0,
        y: 0,
        z: -2.2,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: Math.PI,
        grounded: true,
        abilityCooldown: 99,
        gloveCooldown: 99,
        ...target,
      });
      g.events.update(g);
    },
    { id, mode, opponent, target },
  );
}
// Drive the real DOM input handler without Playwright's absolute-position
// pointer-lock warps. Native E/Space/WASD remain keyboard inputs below.
async function left(page, type) {
  await page.evaluate(
    (type) =>
      window.__arena.canvas.dispatchEvent(
        new MouseEvent(type, { bubbles: true, button: 0 }),
      ),
    type,
  );
}
async function step(page, count) {
  await page.evaluate((count) => {
    const g = window.__arena;
    for (let i = 0; i < count; i++) g.simulate(1 / 120);
    g.events.update(g);
    g.updateCamera(1 / 60);
    g.renderWorld();
  }, count);
}
test("real Extended LMB has a handle blind spot, a narrow distant tip and a vertical escape, without ghost contacts or trial rewards", async ({
  page,
}) => {
  const errors = await ready(page),
    results = [];
  const before = await page.evaluate(() =>
    localStorage.getItem("slap-arena-profile-v1"),
  );
  for (const target of [
    { z: -1.4 },
    { z: -4.4 },
    { x: 1.2, z: -4 },
    { z: -3, y: 3, grounded: false },
  ]) {
    await arrange(
      page,
      "glove_extended",
      "stationary",
      "glove_default",
      target,
    );
    if (target.y === 3) await page.evaluate(() => (window.__arena.pitch = 0.6));
    const baseline = await page.evaluate(() => ({
      hits: window.__arena.matchStats.hits,
      shots: window.__arena.matchStats.shots,
    }));
    if (target.z === -1.4)
      await expect(page.locator(".slap-reach")).toContainText(
        "HANDLE BLIND SPOT",
      );
    await left(page, "mousedown");
    await step(page, 38);
    await left(page, "mouseup");
    results.push(
      await page.evaluate(
        (baseline) => ({
          hp: window.__arena.entities[1].health,
          hits: window.__arena.matchStats.hits - baseline.hits,
          shots: window.__arena.matchStats.shots - baseline.shots,
          aim: [window.__arena.yaw, window.__arena.pitch],
        }),
        baseline,
      ),
    );
  }

  expect(results.map((r) => r.hp)).toEqual([150, 130, 150, 150]);
  expect(results.map((r) => r.hits)).toEqual([0, 1, 0, 0]);
  expect(results.every((r) => r.shots === 1)).toBe(true);
  expect(results.map((r) => r.aim)).toEqual([
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0.6],
  ]);
  expect(
    await page.evaluate(() => localStorage.getItem("slap-arena-profile-v1")),
  ).toBe(before);
  expect(errors).toEqual([]);
});
test("real E can leave Diamond after rearm, without restoring cooldown or falsely keeping stone protection", async ({
  page,
}) => {
  const errors = await ready(page);
  await arrange(page, "glove_diamond");
  await page.keyboard.press("KeyE");
  await expect(page.locator(".slap-ability > span")).toHaveText("REARM");
  await expect(page.locator(".slap-status-time")).toHaveText("4.0s");
  await page.keyboard.press("KeyE");
  expect(await page.evaluate(() => window.__arena.player.stoneTime)).toBe(4);
  await step(page, 45);
  await expect(page.locator(".slap-ability > span")).toHaveText("EXIT");
  await page.keyboard.press("KeyE");
  expect(await page.evaluate(() => window.__arena.player.stoneTime)).toBe(0);
  await expect(page.locator(".slap-status")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__arena.player.abilityCooldown),
  ).toBeGreaterThan(11);
  await page.keyboard.press("KeyE");
  expect(await page.evaluate(() => window.__arena.player.stoneTime)).toBe(0);
  expect(errors).toEqual([]);
});
test("real Space dodges a telegraphed EMP and an actual LMB contact interrupts Erasure before its force", async ({
  page,
}) => {
  const errors = await ready(page);
  await arrange(page, "glove_default", "sparring", "glove_stun");
  await page.evaluate(async () => {
    const g = window.__arena,
      { useGloveAbility } = await import("/src/gloves/combat.js");
    g.entities[1].abilityCooldown = 0;
    useGloveAbility(g, g.entities[1], "glove_stun");
  });
  expect(await page.evaluate(() => window.__arena.player.health)).toBe(150);
  await page.keyboard.press("Space");
  await step(page, 55);
  expect(
    await page.evaluate(() => ({
      hp: window.__arena.player.health,
      rag: window.__arena.player.ragdollTime,
      vy: window.__arena.player.vy,
    })),
  ).toMatchObject({ hp: 150, rag: 0 });
  await arrange(page, "glove_default", "stationary", "glove_za_hando");
  await page.evaluate(async () => {
    const g = window.__arena,
      { useGloveAbility } = await import("/src/gloves/combat.js");
    g.entities[1].abilityCooldown = 0;
    g.entities[1].activeWeapon = "glove_za_hando";
    useGloveAbility(g, g.entities[1], "glove_za_hando");
  });
  await left(page, "mousedown");
  await step(page, 20);
  await left(page, "mouseup");
  const interrupted = await page.evaluate(() => ({
    pending: window.__arena.entities[1].gloveAbilityPending,
    hp: window.__arena.entities[1].health,
    hits: window.__arena.matchStats.hits,
    ownHP: window.__arena.player.health,
  }));

  expect(interrupted).toEqual({ pending: null, hp: 126, hits: 1, ownHP: 150 });
  await step(page, 50);
  expect(
    await page.evaluate(() => window.__arena.player.ragdollTime || 0),
  ).toBe(0);
  await arrange(page, "glove_default", "stationary", "glove_za_hando", {
    z: -4.5,
  });
  await page.evaluate(async () => {
    const g = window.__arena,
      e = g.entities[1],
      { useGloveAbility } = await import("/src/gloves/combat.js");
    e.abilityCooldown = 0;
    e.activeWeapon = "glove_za_hando";
    useGloveAbility(g, e, "glove_za_hando");
  });
  expect(
    await page.evaluate(
      () =>
        window.__arena.gloveFX.rays.states.filter(
          (s) =>
            s.lane &&
            s.castOwner === window.__arena.entities[1].id &&
            s.life > 0,
        ).length,
    ),
  ).toBe(4);
  await page.keyboard.down("KeyD");
  await step(page, 62);
  await page.keyboard.up("KeyD");
  const sidestep = await page.evaluate(() => ({
    x: window.__arena.player.x,
    hp: window.__arena.player.health,
    rag: window.__arena.player.ragdollTime || 0,
    pending: window.__arena.entities[1].gloveAbilityPending,
  }));
  expect(sidestep.x).toBeGreaterThan(1.8);
  expect(sidestep).toMatchObject({ hp: 150, rag: 0, pending: null });
  expect(errors).toEqual([]);
});
test("after a genuine knockdown the player can actually jump during get-up protection instead of being immediately relocked", async ({
  page,
}) => {
  const errors = await ready(page);
  await arrange(page, "glove_default", "sparring");
  await page.evaluate(async () => {
    const g = window.__arena,
      { resolveSlap } = await import("/src/gloves/combat.js");
    resolveSlap(g, g.entities[1], "glove_default");
  });
  await step(page, 80);
  expect(
    await page.evaluate(() => ({
      rag: window.__arena.player.ragdollTime,
      grace: window.__arena.player.slapGrace,
    })),
  ).toMatchObject({ rag: 0 });
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__arena.player.vy)).toBeGreaterThan(
    9,
  );
  const retry = await page.evaluate(async () => {
    const g = window.__arena,
      { resolveSlap } = await import("/src/gloves/combat.js"),
      e = g.entities[1];
    Object.assign(e, {
      x: g.player.x,
      y: g.player.y,
      z: g.player.z - 2,
      yaw: Math.PI,
    });
    return {
      hits: resolveSlap(g, e, "glove_default"),
      hp: g.player.health,
      grace: g.player.slapGrace,
    };
  });
  expect(retry.hits).toBe(0);
  expect(retry.hp).toBe(126);
  expect(retry.grace).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
