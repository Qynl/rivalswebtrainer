import { test, expect } from "@playwright/test";

test("roomier lower Arena keeps protected spawns, connected lanes and physically walkable ramp summits", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const report = await page.evaluate(async () => {
    const g = window.__arena;
    g.frame = () => {};
    const { moveBody, verticalStep, canOccupy } = await import(
      "/src/physics.js"
    );
    const { ARENA, HALF_COVER } = await import("/src/arena-layout.js");
    const w = g.world,
      shape = { radius: 0.38, height: 1.9 };
    const spawnClear = Object.values(w.spawns)
      .flat()
      .every((p) => canOccupy(shape, p.x, 0, p.z, w.boxes));
    const routes = [];
    const walk = (start, end) => {
      const path = w.nav.path(start, end),
        last = path.at(-1);
      const body = {
        ...shape,
        ...start,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        grounded: true,
        jumps: 0,
      };
      let node = 0,
        invalid = 0,
        maxY = 0;
      for (let tick = 0; tick < 2400 && node < path.length; tick++) {
        const p = path[node],
          dx = p.x - body.x,
          dz = p.z - body.z,
          d = Math.hypot(dx, dz);
        if (d < 0.12) {
          node++;
          continue;
        }
        const step = Math.min(d, 12.2 / 120);
        body.vx = (dx / d) * 12.2;
        body.vz = (dz / d) * 12.2;
        moveBody(body, (dx / d) * step, (dz / d) * step, w.boxes);
        verticalStep(body, 1 / 120, w.boxes);
        if (
          ![body.x, body.y, body.z].every(Number.isFinite) ||
          body.y < -0.001 ||
          !canOccupy(body, body.x, body.y, body.z, w.boxes)
        )
          invalid++;
        maxY = Math.max(maxY, body.y);
      }
      return {
        complete: node === path.length && path.length > 0,
        endpoint: last ? Math.hypot(last.x - end.x, last.z - end.z) : 999,
        invalid,
        maxY,
        y: body.y,
      };
    };
    for (const a of w.spawns[0])
      for (const b of w.spawns[1]) routes.push(walk(a, b));
    const summits = [-1, 1].map((side) =>
      walk(w.spawns[side === 1 ? 0 : 1][0], {
        x: ARENA.rampX * side,
        z: ARENA.platformZ * side,
      }),
    );
    const galleries = ARENA.galleries.flatMap((deck) =>
      [-8, 0, 8].map((z) => walk(w.spawns[0][0], { x: deck.x, z })),
    );
    const a = g.eye({ ...w.spawns[0][0], y: 0 }),
      b = g.eye({ ...w.spawns[1][0], y: 0 });
    return {
      bounds: w.bounds,
      area: ARENA.width * ARENA.depth,
      walls: w.boxes.filter((b) => b.maxY > 10).map((b) => b.maxY),
      coverHeights: HALF_COVER.map((b) => b.h),
      spawnClear,
      spawnLOS: g.hasLOS(a, b),
      routes,
      summits,
      galleries,
    };
  });
  console.log(JSON.stringify({ revisedArena: report }));
  expect(report.area).toBe(2000);
  expect(report.walls).toEqual([14, 14, 14, 14]);
  expect(Math.min(...report.coverHeights)).toBeGreaterThanOrEqual(4.2);
  expect(report.spawnClear).toBe(true);
  expect(report.spawnLOS).toBe(false);
  for (const r of report.routes) {
    expect(r.complete).toBe(true);
    expect(r.endpoint).toBeLessThan(1.2);
    expect(r.invalid).toBe(0);
  }
  for (const r of [...report.summits, ...report.galleries]) {
    expect(r.complete).toBe(true);
    expect(r.invalid).toBe(0);
    expect(r.y).toBeCloseTo(3.2);
  }
  expect(errors).toEqual([]);
});
