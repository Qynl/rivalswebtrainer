import { test, expect } from "@playwright/test";
test("all arena floors have distinct layers; real stairs and slide jumps stay stable", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena);
  await page.evaluate(() => {
    window.__arena.renderer.render = () => {};
  });
  const surfaces = await page.evaluate(() => {
    const g = window.__arena;
    return ["compound", "rooftops", "hangar", "range"].map((id) => {
      g.world.build(id);
      const floors = g.world.group.children.filter((m) => {
        if (!m.geometry) return false;
        m.geometry.computeBoundingBox();
        const bounds = m.geometry.boundingBox;
        return (
          bounds.max.x - bounds.min.x >= 48 && bounds.max.z - bounds.min.z >= 48
        );
      });
      return {
        id,
        tops: floors.map((m) => m.position.y + m.geometry.boundingBox.max.y),
        marks: g.world.group.children
          .filter(
            (m) =>
              m.geometry?.type === "PlaneGeometry" &&
              Math.abs(m.rotation.x) > 1,
          )
          .every(
            (m) =>
              m.material.polygonOffset &&
              !m.material.depthWrite &&
              !m.castShadow,
          ),
      };
    });
  });
  for (const map of surfaces) {
    expect(map.tops.filter((y) => Math.abs(y) < 1e-8)).toHaveLength(1);
    expect(new Set(map.tops).size).toBe(map.tops.length);
    expect(map.marks).toBe(true);
  }
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const stairs = await page.evaluate(() => {
    const g = window.__arena;
    g.world.build("compound");
    Object.assign(g.player, {
      x: -8,
      z: 9.1,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      jumps: 0,
    });
    g.yaw = 0;
    g.keys.clear();
    g.keys.add("KeyW");
    let regressions = 0,
      lastY = 0,
      maxRise = 0;
    for (let i = 0; i < 95; i++) {
      g.updatePlayer(1 / 60);
      if (g.player.y < lastY - 0.01) regressions++;
      maxRise = Math.max(maxRise, g.player.y - lastY);
      lastY = g.player.y;
    }
    g.keys.clear();
    return {
      y: g.player.y,
      z: g.player.z,
      grounded: g.player.grounded,
      regressions,
      maxRise,
    };
  });
  expect(stairs.y).toBeCloseTo(4.85);
  expect(stairs.grounded).toBe(true);
  expect(stairs.regressions).toBe(0);
  expect(stairs.maxRise).toBeLessThanOrEqual(0.4);
  const slide = await page.evaluate(() => {
    const g = window.__arena;
    g.world.build("range");
    Object.assign(g.player, {
      x: 0,
      z: 12,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      jumps: 0,
    });
    g.yaw = 0;
    g.keys.clear();
    g.keys.add("KeyW");
    g.slideCooldown = 0;
    g.slideTime = 0;
    g.jumpBuffer = 0;
    for (let i = 0; i < 15; i++) g.updatePlayer(1 / 60);
    g.slide();
    const boosted = Math.hypot(g.player.vx, g.player.vz);
    g.jump();
    g.keys.clear();
    for (let i = 0; i < 10; i++) g.updatePlayer(1 / 60);
    return {
      boosted,
      speed: Math.hypot(g.player.vx, g.player.vz),
      y: g.player.y,
      slideTime: g.slideTime,
    };
  });
  expect(slide.boosted).toBeCloseTo(9.4);
  expect(slide.speed).toBeCloseTo(9.4);
  expect(slide.y).toBeGreaterThan(0.5);
  expect(slide.slideTime).toBe(0);
  expect(errors).toEqual([]);
});
