import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.use({ viewport: { width: 960, height: 720 } });
async function open(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
}
const track = (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
};

test("three revised courts render, keep every spawn route and summit walkable, and new-map bots fight", async ({
  page,
}) => {
  const errors = track(page);
  await open(page);
  await page.evaluate(() => {
    const g = __arena;
    g.renderer.setPixelRatio(0.65);
    g.resize();
    for (const id of ["lobby", "hud", "round-banner"])
      document.getElementById(id).classList.add("hidden");
  });
  if (process.env.ARENA_SCREENSHOTS)
    await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
  const reports = [];
  for (const id of ["blockout", "foundry", "courtyard"]) {
    const report = await page.evaluate(async (id) => {
      const g = __arena,
        w = g.world,
        { canOccupy, moveBody, verticalStep } = await import("/src/physics.js");
      w.build(id);
      const a = w.layout;
      const walk = (start, goal) => {
        const path = w.nav.path(start, goal),
          body = {
            ...start,
            y: 0,
            vx: 0,
            vz: 0,
            vy: 0,
            radius: 0.38,
            height: 1.9,
            grounded: true,
          },
          end = path.at(-1);
        let node = 0,
          invalid = 0;
        for (let frame = 0; frame < 3000 && node < path.length; frame++) {
          const p = path[node],
            dx = p.x - body.x,
            dz = p.z - body.z,
            d = Math.hypot(dx, dz);
          if (d < 0.12 && Math.abs((p.y || 0) - body.y) < 0.55) {
            node++;
            continue;
          }
          if (d < 1e-8) break;
          const step = Math.min(d, 12 / 120);
          body.vx = (dx / d) * 12;
          body.vz = (dz / d) * 12;
          moveBody(body, (dx / d) * step, (dz / d) * step, w.boxes);
          verticalStep(body, 1 / 120, w.boxes);
          if (
            !canOccupy(body, body.x, body.y, body.z, w.boxes) ||
            body.y < -0.01 ||
            ![body.x, body.y, body.z].every(Number.isFinite)
          )
            invalid++;
        }
        return {
          complete: node === path.length && path.length > 0,
          invalid,
          y: body.y,
          endpoint: end ? Math.hypot(end.x - goal.x, end.z - goal.z) : 999,
        };
      };
      const routes = [];
      for (const start of w.spawns[0])
        for (const goal of w.spawns[1]) routes.push(walk(start, goal));
      const summits = [-1, 1].map((side) =>
        walk(w.spawns[side === 1 ? 0 : 1][0], {
          x: a.rampX * side,
          z: a.platformZ * side,
        }),
      );
      let invalidMatrices = 0;
      w.group.updateMatrixWorld(true);
      w.group.traverse((o) => {
        if (!o.matrixWorld.elements.every(Number.isFinite)) invalidMatrices++;
      });
      g.camera.position.set(a.width * 0.21, a.wallHeight + 3, a.depth * 0.36);
      g.camera.lookAt(0, 1, 0);
      g.camera.fov = 65;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.getContext().finish();
      return {
        id,
        routes,
        summits,
        rise: a.rampRise,
        clear: Object.values(w.spawns)
          .flat()
          .every((p) =>
            canOccupy({ height: 1.9, radius: 0.38 }, p.x, 0, p.z, w.boxes),
          ),
        spawnLOS: g.hasLOS(
          g.eye({ ...w.spawns[0][0], y: 0 }),
          g.eye({ ...w.spawns[1][0], y: 0 }),
        ),
        invalidMatrices,
        batches: w.staticStats,
        gl: g.renderer.getContext().getError(),
      };
    }, id);
    reports.push(report);
    expect(report.clear).toBe(true);
    expect(report.spawnLOS).toBe(false);
    expect(report.invalidMatrices).toBe(0);
    expect(report.gl).toBe(0);
    expect(report.batches.after).toBeLessThan(report.batches.before / 2);
    for (const r of report.routes) {
      expect(r.complete, `${id} spawn route`).toBe(true);
      expect(r.invalid).toBe(0);
      expect(r.endpoint).toBeLessThan(1.2);
    }
    for (const r of report.summits) {
      expect(r.complete, `${id} summit`).toBe(true);
      expect(r.invalid).toBe(0);
      expect(r.y).toBeCloseTo(report.rise, 4);
    }
    if (process.env.ARENA_SCREENSHOTS)
      await page.screenshot({
        path: `${process.env.ARENA_SCREENSHOTS}/${id}-overview.png`,
      });
  }
  await page.evaluate(() => {
    document.getElementById("lobby").classList.remove("hidden");
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const combat = await page.evaluate(() => {
    const g = __arena,
      request = g.requestLock;
    g.requestLock = () => {};
    g.audio.volume = 0;
    g.audio.clearSpatial();
    const reports = [];
    const originalDamage = g.damage;
    for (const map of ["foundry", "courtyard"]) {
      g.start({
        ...g.config,
        map,
        range: false,
        mode: 3,
        difficulty: "elite",
        loadout: ["rifle", "pistol", "katana", "grenade"],
      });
      g.state = "playing";
      let hits = 0,
        invalid = 0;
      g.damage = () => {
        hits++;
      };
      const visited = g.entities
        .filter((e) => !e.isPlayer)
        .map(() => new Set());
      for (let i = 0; i < 3600; i++) {
        g.clock += 1 / 120;
        let n = 0;
        for (const e of g.entities)
          if (!e.isPlayer) {
            g.updateBot(e, 1 / 120);
            visited[n++].add(Math.floor(e.x) + "," + Math.floor(e.z));
            if (
              ![e.x, e.y, e.z].every(Number.isFinite) ||
              e.y < -0.01 ||
              Math.abs(e.x) > g.world.layout.width / 2 ||
              Math.abs(e.z) > g.world.layout.depth / 2
            )
              invalid++;
          }
        g.updateEffects(1 / 120);
        g.combatFX.update(1 / 120, g.world.boxes);
      }
      reports.push({
        map,
        hits,
        invalid,
        visited: visited.map((s) => s.size),
        actions: g.entities
          .filter((e) => !e.isPlayer)
          .map((e) => e.actionCounts),
      });
    }
    g.damage = originalDamage;
    g.requestLock = request;
    return reports;
  });
  for (const c of combat) {
    expect(c.hits).toBeGreaterThan(0);
    expect(c.invalid).toBe(0);
    expect(c.visited.every((n) => n > 8)).toBe(true);
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ courts: reports, combat }));
});

test("utility input winds up, releases a detailed tumbling item, and renders grounded animated molotov fire", async ({
  page,
}) => {
  const errors = track(page);
  await open(page);
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const results = await page.evaluate(async () => {
    const g = __arena,
      { WEAPONS } = await import("/src/data.js");
    g.world.build("blockout");
    g.audio.volume = 0;
    g.updateBot = () => {};
    g.state = "playing";
    g.range = true;
    g.clock = 10;
    g.yaw = 0;
    g.pitch = 0.08;
    g.settings.shake = false;
    g.renderPrevious = null;
    Object.assign(g.player, {
      x: 14,
      y: 0,
      z: 9,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
    });
    for (const e of g.entities) if (e.model) e.model.group.visible = false;
    g.renderer.setPixelRatio(0.7);
    g.resize();
    const results = [];
    for (const id of ["grenade", "molotov", "smoke", "flashbang"]) {
      g.cleanEntities();
      g.entities = [g.player];
      g.loadout[3] = id;
      g.ammunition[3] = { mag: WEAPONS[id].mag, reserve: 0 };
      g.slot = -1;
      g.equip(3);
      g.cooldown = 0;
      g.switchTime = 0;
      g.firePlayer();
      const initial = g.projectiles.length,
        pending = !!g.pendingThrow;
      for (let i = 0; i < 12; i++) {
        g.simulate(1 / 120);
        g.updateCamera(1 / 120);
      }
      const beforeRelease = g.projectiles.length;
      for (let i = 0; i < 10; i++) {
        g.simulate(1 / 120);
        g.updateCamera(1 / 120);
      }
      const p = g.projectiles[0];
      if (!p) throw Error("No released projectile: " + id);
      const item = p.mesh.userData.utility,
        hidden = !g.viewModel.userData.throwableBody.visible,
        rotation = p.mesh.rotation.x;
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
      g.renderer.getContext().finish();
      results.push({
        id,
        initial,
        pending,
        beforeRelease,
        item,
        hidden,
        rotation,
        gl: g.renderer.getContext().getError(),
      });
    }
    g.cleanEntities();
    g.entities = [g.player];
    g.explosion(g.eye(g.player).set(6, 0.2, 1), g.player, "molotov");
    g.clock += 0.5;
    g.updateEffects(0.1);
    g.camera.position.set(9, 2.8, 6);
    g.camera.lookAt(6, 0.35, 1);
    g.camera.fov = 70;
    g.camera.updateProjectionMatrix();
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.getContext().finish();
    return {
      results,
      fire: {
        y: g.fires[0].pos.y,
        name: g.effects[0].mesh.name,
        children: g.effects[0].mesh.children.length,
        gl: g.renderer.getContext().getError(),
      },
    };
  });
  for (const r of results.results) {
    expect(r).toMatchObject({
      initial: 0,
      pending: true,
      beforeRelease: 0,
      item: r.id,
      hidden: true,
      gl: 0,
    });
    expect(r.rotation).toBeGreaterThan(0);
  }
  expect(results.fire).toMatchObject({
    name: "molotov-fire",
    children: 2,
    gl: 0,
  });
  expect(results.fire.y).toBeCloseTo(0);
  if (process.env.ARENA_SCREENSHOTS) {
    await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
    await page.evaluate(() => {
      for (const id of ["hud", "round-banner"])
        document.getElementById(id).classList.add("hidden");
    });
    await page.screenshot({
      path: `${process.env.ARENA_SCREENSHOTS}/molotov-fire.png`,
    });
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ throwables: results }));
});

test("pointer look rejects mid-session outliers and ignores input while paused without accumulated catch-up", async ({
  page,
}) => {
  const errors = track(page);
  await open(page);
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const result = await page.evaluate(() => {
    const g = __arena;
    g.mouseLook.reset(-10000);
    g.yaw = 0;
    g.pitch = 0;
    const move = (x, y) =>
      document.dispatchEvent(
        new MouseEvent("mousemove", { movementX: x, movementY: y }),
      );
    for (let i = 0; i < 5; i++) move(4, 2);
    const start = { yaw: g.yaw, pitch: g.pitch };
    move(160, 110);
    const afterBad = { yaw: g.yaw, pitch: g.pitch };
    move(5, 2);
    const afterNormal = { yaw: g.yaw, pitch: g.pitch };
    g.state = "paused";
    move(40, 40);
    const paused = { yaw: g.yaw, pitch: g.pitch };
    g.state = "playing";
    move(5, 2);
    return {
      start,
      afterBad,
      afterNormal,
      paused,
      final: { yaw: g.yaw, pitch: g.pitch },
      fallback: g.rawMouseSupported === false,
    };
  });
  // Browser implementations differ in the ordering of the rejected raw-lock
  // promise and pointerlockerror. Exercise both with the real event listener.
  const fallbackOrders = await page.evaluate(async () => {
    const g = __arena,
      original = g.canvas.requestPointerLock;
    const results = [];
    try {
      for (const order of ["event-first", "promise-first"]) {
        let calls = 0;
        g.state = "playing";
        g.rawMouseSupported = undefined;
        g.ignoredRawErrors = 0;
        g.canvas.requestPointerLock = (options) => {
          calls++;
          if (!options?.unadjustedMovement) return Promise.resolve();
          if (order === "event-first")
            queueMicrotask(() =>
              document.dispatchEvent(new Event("pointerlockerror")),
            );
          return Promise.reject(
            new DOMException("Raw input unavailable", "NotSupportedError"),
          );
        };
        g.requestLock();
        await Promise.resolve();
        await Promise.resolve();
        if (order === "promise-first")
          document.dispatchEvent(new Event("pointerlockerror"));
        results.push({
          order,
          calls,
          state: g.state,
          raw: g.rawMouseSupported,
        });
      }
    } finally {
      g.canvas.requestPointerLock = original;
    }
    return results;
  });
  for (const r of fallbackOrders)
    expect(r).toMatchObject({ calls: 2, state: "playing", raw: false });
  expect(result.afterBad).toEqual(result.start);
  expect(result.paused).toEqual(result.afterNormal);
  expect(result.afterNormal.yaw).toBeLessThan(result.start.yaw);
  expect(result.final.yaw - result.afterNormal.yaw).toBeCloseTo(-0.01, 6);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ mouse: result }));
});
