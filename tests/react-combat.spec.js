import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const errorsFor = (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
};
async function deploy(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#play-button");
  for (let i = 0; i < 4; i++) await page.click("#setup-next");
  await page.waitForFunction(() => document.pointerLockElement !== null);
}
test("React retains five maps and the full picker; M selection does not hold up the five-second round start", async ({
  page,
}) => {
  const errors = errorsFor(page);
  await deploy(page);
  expect(await page.evaluate(() => __arena.countdown)).toBe(5);
  expect(
    await page.evaluate(() => __arena.entities.every((e) => e.health === 150)),
  ).toBe(true);
  await page.keyboard.press("m");
  await expect(page.locator("#match-setup")).toBeVisible();
  await page.waitForFunction(() => document.pointerLockElement === null);
  const report = await page.evaluate(() => {
    const g = __arena,
      p = g.player,
      bot = g.entities.find((e) => !e.isPlayer),
      before = { x: p.x, z: p.z },
      b = { x: bot.x, z: bot.z };
    g.ammunition[0].mag = 3;
    for (let i = 0; i < 840; i++) g.simulate(1 / 120);
    return {
      state: g.state,
      selecting: g.selectingLoadout,
      playerDistance: Math.hypot(p.x - before.x, p.z - before.z),
      botDistance: Math.hypot(bot.x - b.x, bot.z - b.z),
      round: g.round,
      countdown: g.countdown,
    };
  });
  expect(report.state).toBe("playing");
  expect(report.selecting).toBe(true);
  expect(report.playerDistance).toBe(0);
  expect(report.botDistance).toBeGreaterThan(0.3);
  expect(report.round).toBe(1);
  for (let i = 0; i < 4; i++) await page.click("#setup-next");
  await expect(page.locator("#match-setup")).toBeHidden();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  expect(await page.evaluate(() => __arena.ammunition[0].mag)).toBe(3);
  expect(await page.evaluate(() => __arena.selectingLoadout)).toBe(false);
  await page.keyboard.press("m");
  await expect(page.locator("#match-setup")).toBeHidden();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ roundSelection: report }));
});
test("React displays confirmed damage above opponents and actual Paintball/Sniper ADS stays clear", async ({
  page,
}) => {
  const errors = errorsFor(page);
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => (__arena.frame = () => {}));
  await page.click("#range-button");
  await page.waitForFunction(() => document.pointerLockElement !== null);
  await page.evaluate(() => {
    const g = __arena,
      p = g.player,
      e = g.entities.find((e) => e.model);
    g.clock = 10;
    g.yaw = g.pitch = 0;
    g.renderPrevious = null;
    Object.assign(p, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    Object.assign(e, { x: 0, y: 0, z: -4, health: 150, alive: true });
    g.entities = [p, e];
    g.damageNumbers.clear();
    g.updateCamera(1);
    g.damage(e, 40, p);
    g.events.update(g);
  });
  await expect(page.locator(".damage-number")).toHaveText("40");
  const box = await page.locator(".damage-number").boundingBox();
  expect(box.y).toBeLessThan(400);
  expect(box.x).toBeGreaterThan(500);
  const ads = [];
  for (const id of ["paintball", "sniper"]) {
    const r = await page.evaluate((id) => {
      const g = __arena;
      g.loadout[0] = id;
      g.slot = -1;
      g.equip(0);
      g.switchTime = 0;
      g.aiming = true;
      for (let i = 0; i < 160; i++) g.updateCamera(1 / 120);
      g.events.update(g);
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
      g.renderer.getContext().finish();
      return {
        id,
        visible: g.viewModel.visible,
        aimPoint: g.viewModel.userData.adsPoint.toArray(),
        fov: g.camera.fov,
        gl: g.renderer.getContext().getError(),
      };
    }, id);
    ads.push(r);
    if (process.env.ARENA_SCREENSHOTS) {
      await mkdir(process.env.ARENA_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: `${process.env.ARENA_SCREENSHOTS}/${id}-ads.png`,
      });
    }
  }
  expect(ads[0].visible).toBe(true);
  expect(ads[1].visible).toBe(false);
  expect(ads[1].fov).toBeCloseTo(32, 3);
  for (const r of ads) expect(r.gl).toBe(0);
  await page.evaluate(() => {
    const g = __arena;
    g.aiming = false;
    g.updateCamera(1 / 60);
  });
  expect(await page.evaluate(() => __arena.viewModel.visible)).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ ads }));
});

test("startup precomputed lighting preserves the procedural path pixel-for-pixel", async ({
  page,
}) => {
  const errors = errorsFor(page),
    frames = [];
  for (const query of ["?rebuild-environment=1", ""]) {
    await page.goto("/" + query);
    await page.waitForFunction(() => window.__arena?.state === "lobby");
    frames.push(
      await page.evaluate(() => {
        const g = __arena;
        g.frame = () => {};
        g.renderer.setPixelRatio(0.5);
        g.resize();
        g.camera.position.set(8, 12, 13);
        g.camera.lookAt(0, 2, 0);
        g.camera.fov = 70;
        g.camera.updateProjectionMatrix();
        g.world.atmosphere.update(0, false);
        g.renderer.autoClear = true;
        g.renderWorld();
        g.renderer.getContext().finish();
        const gl = g.renderer.getContext(),
          pixels = new Uint8Array(
            gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
          );
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        return {
          baked: !!g.environmentMap.texture.isDataTexture,
          pixels: Array.from(pixels),
          gl: gl.getError(),
          ready: performance.getEntriesByName("arena-ready")[0].startTime,
        };
      }),
    );
  }
  expect(frames[0].baked).toBe(false);
  expect(frames[1].baked).toBe(true);
  let changed = 0,
    max = 0,
    total = 0;
  for (let i = 0; i < frames[0].pixels.length; i++) {
    const d = Math.abs(frames[0].pixels[i] - frames[1].pixels[i]);
    if (d) changed++;
    max = Math.max(max, d);
    total += d;
  }
  expect(max).toBeLessThanOrEqual(1);
  expect(total / frames[0].pixels.length).toBeLessThan(0.01);
  for (const f of frames) expect(f.gl).toBe(0);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      startupLighting: {
        changed,
        max,
        mean: total / frames[0].pixels.length,
        proceduralReady: frames[0].ready,
        bakedReady: frames[1].ready,
      },
    }),
  );
});
