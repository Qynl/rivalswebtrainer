import { test, expect } from "@playwright/test";
async function prepare(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /shader|WebGLProgram|VALIDATE_STATUS/i.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  return errors;
}
test("studio preview supports keyboard and pointer orbit, and disposes its animation on entering gameplay", async ({
  page,
}) => {
  const errors = await prepare(page);
  const canvas = page.getByLabel("Original three-dimensional glove model");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await page.screenshot({ path: "test-results/glove-studio.png" });
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("sculpted fingers, contact pose, ribbons and pooled impacts actually render without GLSL errors or camera displacement", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  await page.evaluate(() => {
    const g = window.__arena;
    g.audio.volume = 0;
    g.settings.performance = true;
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(1000, 800, false);
    g.world.boxes = [];
    g.entities.slice(1).forEach((e) => {
      e.alive = false;
      e.model.group.visible = false;
    });
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    const e = g.entities[1];
    Object.assign(e, {
      alive: true,
      health: 150,
      x: 0,
      y: 0,
      z: 5.8,
      vx: 0,
      vy: 0,
      vz: 0,
    });
    e.model.group.visible = true;
    g.yaw = g.pitch = 0;
    g.__render = () => {
      g.updateCamera(1 / 60);
      g.renderer.autoClear = true;
      g.renderer.render(g.scene, g.camera);
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
    };
    g.__render();
  });
  await page.screenshot({ path: "test-results/glove-ready.png" });
  await page.mouse.down();
  const result = await page.evaluate(() => {
    const g = window.__arena;
    // Screenshot/CDP pointer-lock warps are not player aim. Establish the
    // deterministic aim after the mouse event, before advancing contact.
    g.yaw = g.pitch = 0;
    for (let i = 0; i < 13; i++) g.simulate(1 / 120);
    g.updateEffects(1 / 120);
    g.__render();
    g.events.tick(g);
    return {
      health: g.entities[1].health,
      fx: !!g.gloveFX,
      ribbon: g.viewModel.userData.gloveRig.sweep.visible,
      yaw: g.yaw,
      pitch: g.pitch,
    };
  });
  await page.mouse.up();
  expect(result).toMatchObject({
    health: 126,
    fx: true,
    ribbon: true,
    yaw: 0,
    pitch: 0,
  });
  await page.screenshot({ path: "test-results/glove-contact.png" });
  const expired = await page.evaluate(() => {
    const g = window.__arena;
    g.clock += 1;
    g.updateEffects(1);
    g.__render();
    return g.gloveFX.rings.states.every((s) => s.life === 0);
  });
  expect(expired).toBe(true);
  expect(errors).toEqual([]);
});

test("real wheel and V switch to an animated local avatar, preserve aim/glove and let Default burst from rest", async ({
  page,
}) => {
  const errors = await prepare(page);
  await page.click("#range-button");
  await page.waitForFunction(
    () => document.pointerLockElement && window.__arena.state === "playing",
  );
  await page.evaluate(() => {
    const g = window.__arena;
    g.audio.volume = 0;
    g.settings.performance = true;
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(1000, 800, false);
    g.world.boxes = [];
    g.entities.slice(1).forEach((e) => {
      e.alive = false;
      e.model.group.visible = false;
    });
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    g.yaw = g.pitch = 0;
  });
  await page.mouse.wheel(0, 500);
  let r = await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 60; i++) g.updateCamera(1 / 60);
    return {
      zoom: g.cameraZoom,
      third: g.thirdPerson,
      avatar: g.player.model?.group.visible,
      hand: g.viewModel.visible,
      glove: g.loadout[0],
      yaw: g.yaw,
      pitch: g.pitch,
    };
  });
  expect(r).toMatchObject({
    zoom: 1.25,
    third: true,
    avatar: true,
    hand: false,
    glove: "glove_default",
    yaw: 0,
    pitch: 0,
  });
  await page.keyboard.press("KeyV");
  await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 60; i++) g.updateCamera(1 / 60);
  });
  expect(await page.evaluate(() => window.__arena.thirdPerson)).toBe(false);
  await page.keyboard.press("KeyV");
  await page.evaluate(() => {
    const g = window.__arena;
    g.yaw = g.pitch = 0;
    for (let i = 0; i < 60; i++) g.updateCamera(1 / 60);
    g.renderer.autoClear = true;
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: "test-results/glove-third-person.png" });
  expect(
    await page.evaluate(() => {
      const g = window.__arena;
      g.pitch = 0.4;
      for (let i = 0; i < 30; i++) g.updateCamera(1 / 60);
      const head = g.player.model.parts.head.rotation.x;
      g.pitch = 0;
      g.updateCamera(1 / 60);
      return head;
    }),
  ).toBeGreaterThan(0.2);

  await page.keyboard.press("KeyE");
  r = await page.evaluate(() => {
    const g = window.__arena,
      initial = g.player.z;
    for (let i = 0; i < 42; i++) {
      g.simulate(1 / 120);
      g.updateEffects(1 / 120);
    }
    g.updateCamera(1 / 60);
    g.events.tick(g);
    g.renderer.render(g.scene, g.camera);
    return {
      distance: initial - g.player.z,
      notice: g.gloveNotice?.text,
      puffs: g.gloveFX?.puffs.states.filter((s) => s.life > 0).length,
      hits: g.matchStats.hits,
    };
  });
  expect(r.distance).toBeGreaterThan(4);
  expect(r.notice).toContain("BOOSTING");
  expect(r.puffs).toBeGreaterThan(0);
  expect(r.hits).toBe(0);
  await page.screenshot({ path: "test-results/glove-boost-third-person.png" });
  await page.mouse.wheel(0, -2000);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -2000);
  r = await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 90; i++) g.updateCamera(1 / 60);
    return {
      third: g.thirdPerson,
      zoom: g.cameraZoom,
      avatar: g.player.model.group.visible,
      hand: g.viewModel.visible,
    };
  });
  expect(r).toMatchObject({ third: false, zoom: 0, avatar: false, hand: true });
  expect(errors).toEqual([]);
});
