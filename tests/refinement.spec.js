import { test, expect } from "@playwright/test";

test("compact mirrored Arena has real ramp surfaces, grounded traversal, window clearances and animated weapon parts", async ({
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
  const layout = await page.evaluate(() => {
    const g = window.__arena,
      b = g.world.boxes,
      close = (a, b) => Math.abs(a - b) < 1e-6;
    return {
      width: g.world.nav.size,
      depth: g.world.nav.sizeZ,
      ramps: b.filter((x) => x.ramp).length,
      mirrored: b.every((x) =>
        b.some(
          (y) =>
            close(x.minX, -y.maxX) &&
            close(x.maxX, -y.minX) &&
            close(x.minZ, -y.maxZ) &&
            close(x.maxZ, -y.minZ) &&
            close(x.minY, y.minY) &&
            close(x.maxY, y.maxY),
        ),
      ),
      shadow: g.renderer.shadowMap.enabled,
    };
  });
  expect(layout).toEqual({
    width: 40,
    depth: 50,
    ramps: 6,
    mirrored: true,
    shadow: true,
  });
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.render = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const traversal = await page.evaluate(() => {
    const g = window.__arena,
      p = g.player;
    g.world.build("blockout");
    g.keys.clear();
    g.keys.add("KeyW");
    g.yaw = Math.PI;
    Object.assign(p, {
      x: g.world.layout.rampX,
      z: g.world.layout.rampZ - g.world.layout.rampLength / 2 - 0.4,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      jumps: 0,
    });
    let airborne = 0,
      maxRise = 0,
      previous = 0;
    for (let i = 0; i < 41; i++) {
      g.updatePlayer(1 / 60);
      if (!p.grounded) airborne++;
      maxRise = Math.max(maxRise, p.y - previous);
      previous = p.y;
    }
    const up = { y: p.y, z: p.z, airborne, maxRise };
    g.yaw = 0;
    let downhillAirborne = 0;
    const downhillFrames = [];
    for (let i = 0; i < 64; i++) {
      g.updatePlayer(1 / 60);
      if (p.z <= g.world.layout.rampZ - g.world.layout.rampLength / 2 - 0.45)
        break;
      if (!p.grounded) {
        downhillAirborne++;
        downhillFrames.push({
          frame: i,
          x: p.x,
          y: p.y,
          z: p.z,
          vy: p.vy,
          vz: p.vz,
        });
      }
    }
    g.keys.clear();
    return {
      up,
      down: {
        y: p.y,
        z: p.z,
        airborne: downhillAirborne,
        frames: downhillFrames,
      },
    };
  });
  console.log(JSON.stringify({ traversal }));
  expect(traversal.up.y).toBeCloseTo(3.2);
  expect(traversal.up.airborne).toBe(0);
  expect(traversal.up.maxRise).toBeLessThan(0.4);
  expect(traversal.down.y).toBeLessThan(0.2);
  expect(traversal.down.airborne).toBe(0);
  await page.keyboard.press("KeyT");
  expect(await page.evaluate(() => window.__arena.inspectTime)).toBe(1.8);
  const animation = await page.evaluate(() => {
    const g = window.__arena,
      m = g.viewModel;
    g.inspectTime = 0;
    g.player.alive = true;
    g.ammunition[0].mag = 1;
    g.reloadTime = 0;
    g.reload();
    g.reloadTime = g.reloadTotal * 0.5;
    g.updateCamera(1 / 60);
    const lowered =
      m.userData.magazine.position.y <
      m.userData.magazine.userData.restPosition.y - 0.27;
    g.reloadTime = 0;
    g.updateCamera(1 / 60);
    return {
      lowered,
      returned:
        m.userData.magazine.position.distanceTo(
          m.userData.magazine.userData.restPosition,
        ) < 1e-8,
      hasBolt: !!m.userData.bolt,
    };
  });
  expect(animation).toEqual({ lowered: true, returned: true, hasBolt: true });
  const window = await page.evaluate(() => {
    const g = window.__arena,
      p = g.player;
    g.keys.clear();
    g.keys.add("KeyW");
    g.yaw = 0;
    Object.assign(p, {
      x: -1.2,
      z: -12.85,
      y: 1,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: false,
      jumps: 1,
    });
    for (let i = 0; i < 25; i++) g.updatePlayer(1 / 60);
    g.keys.clear();
    return { z: p.z, y: p.y };
  });
  expect(window.z).toBeLessThan(-15.38);
  expect(errors).toEqual([]);
});
