import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("a combat bot chooses, physically reaches and fires from a real Arena ramp perch", async ({
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
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      p = g.player,
      e = g.entities.find((e) => e.model),
      w = g.world;
    const { chooseFiringPosition } = await import("/src/bot-positioning.js");
    const { canOccupy } = await import("/src/physics.js");
    const { ARENA } = await import("/src/arena-layout.js");
    g.world.build("blockout");
    g.config.difficulty = "elite";
    g.audio.volume = 0;
    g.audio.clearSpatial();
    for (const a of g.entities) if (a.model) a.model.group.visible = a === e;
    g.entities = [p, e];
    g.clock = 10;
    g.state = "playing";
    g.range = true;
    Object.assign(e, {
      target: false,
      x: ARENA.width / 2 - 1,
      y: 0,
      z: ARENA.rampZ - 2.2,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      height: 1.9,
      radius: 0.38,
      meleeId: "katana",
      activeWeapon: "rifle",
      alive: true,
      health: 1000,
      seed: 0.3,
      strafe: 1,
      seen: 1,
      visible: true,
      decision: 0,
      reload: 0,
      ammo: 20,
      shootTimer: 0.4,
      pathTimer: 1,
      path: [],
      actionCounts: {},
      pressureUntil: 0,
      coverPlan: null,
      attackPlan: null,
      attackReadyAt: 0,
    });
    Object.assign(p, { alive: true, health: 1000, y: 0, height: 1.9 });
    const sight = (point, target) =>
      g.hasLOS(g.eye(point), g.eye({ ...target, y: (target.y || 0) - 0.26 }));
    const candidates = [{ x: ARENA.width / 2 - 1, y: 0, z: -5 }];
    for (let i = 0; i < w.nav.blocked.length; i += 2) {
      const c = w.nav.point(i);
      if (
        !w.nav.blocked[i] &&
        c.y === 0 &&
        c.z < -3 &&
        c.x > w.bounds.minX &&
        c.x < w.bounds.maxX &&
        c.z > w.bounds.minZ
      )
        candidates.push(c);
    }
    let target, preview;
    for (const c of candidates) {
      if (
        Math.hypot(c.x - e.x, c.z - e.z) < 12 ||
        !canOccupy(e, c.x, 0, c.z, w.boxes) ||
        !g.hasLOS(g.eye(e), g.eye(c))
      )
        continue;
      const plan = chooseFiringPosition(e, c, w, sight, [], { flank: false });
      if (plan?.kind === "high") {
        target = c;
        preview = plan;
        break;
      }
    }
    if (!target) throw Error("No visible real-Arena high-ground scenario");
    Object.assign(p, target);
    e.targetEntity = p;
    e.lastKnown = { ...target };
    e.lastKnownAt = g.clock;
    let hits = 0;
    g.damage = () => {
      hits++;
    };
    let arrival = null,
      invalid = 0,
      maxY = 0;
    for (let i = 0; i < 960; i++) {
      g.clock += 1 / 120;
      g.updateBot(e, 1 / 120);
      g.updateEffects(1 / 120);
      g.combatFX.update(1 / 120);
      maxY = Math.max(maxY, e.y);
      if (
        ![e.x, e.y, e.z, e.vx, e.vy, e.vz].every(Number.isFinite) ||
        e.y < -0.001 ||
        !canOccupy(e, e.x, e.y, e.z, w.boxes)
      )
        invalid++;
      if (e.actionCounts.highGroundArrivals && !arrival)
        arrival = {
          frame: i,
          y: e.y,
          x: e.x,
          z: e.z,
          shots: e.actionCounts.rifleShots || 0,
        };
      if (arrival && i > arrival.frame + 100) break;
    }
    g.renderer.setPixelRatio(0.5);
    g.resize();
    g.camera.position.set(12, 9, 15);
    g.camera.lookAt(e.x, e.y + 1, e.z);
    g.camera.fov = 75;
    g.camera.updateProjectionMatrix();
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.getContext().finish();
    return {
      target,
      preview: { point: preview.point, travel: preview.travel },
      arrival,
      actions: e.actionCounts,
      maxY,
      invalid,
      hits,
      glError: g.renderer.getContext().getError(),
    };
  });
  if (process.env.ARENA_SCREENSHOTS) {
    await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.ARENA_SCREENSHOTS + "/high-ground-combat.png",
    });
  }
  console.log(JSON.stringify({ highGroundCombat: result }));
  expect(result.actions.highGroundPlans).toBeGreaterThan(0);
  expect(result.arrival).not.toBeNull();
  expect(result.arrival.y).toBeGreaterThan(4.2);
  expect(result.actions.rifleShots).toBeGreaterThan(result.arrival.shots);
  expect(result.hits).toBeGreaterThan(0);
  expect(result.invalid).toBe(0);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
});
