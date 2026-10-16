import { test, expect } from "@playwright/test";

test("all gun handling renders in the real engine; reload cancellation restores magazines and idle HUD does not churn", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => !!document.pointerLockElement);
  const report = await page.evaluate(async () => {
    const g = window.__arena;
    const { WEAPONS } = await import("/src/data.js");
    const { createViewModel } = await import("/src/world.js");
    const { WeaponAnimator } = await import("/src/animation.js");
    const { hud } = await import("/src/ui-session.js");
    const records = [];
    const aim = { yaw: 0.37, pitch: -0.08 };
    g.yaw = aim.yaw;
    g.pitch = aim.pitch;
    g.audio.volume = 0;
    for (const [id, w] of Object.entries(WEAPONS).filter(
      ([, w]) => w.slot < 2,
    )) {
      const model = createViewModel(id, w),
        animator = new WeaponAnimator();
      g.weaponScene.add(model);
      g.viewModel.visible = false;
      const state = { dt: 1 / 60, ammo: w.mag, shake: false, shotAge: 10 };
      for (let i = 0; i < 90; i++) animator.update(model, state);
      animator.update(model, { ...state, reloading: true, reload: 0.45 });
      const mag = model.userData.magazine;
      const extracted = mag
        ? mag.userData.restPosition.y - mag.position.y
        : null;
      g.renderer.autoClear = true;
      g.renderer.render(g.weaponScene, g.weaponCamera);
      const gl = g.renderer.getContext().getError();
      for (let i = 0; i < 90; i++) animator.update(model, state);
      records.push({
        id,
        extracted,
        reset:
          !mag || mag.position.distanceTo(mag.userData.restPosition) < 1e-8,
        gl,
      });
      g.weaponScene.remove(model);
      g.disposeVisual(model);
    }
    g.viewModel.visible = true;
    // In a stationary, frozen fixture, repeated forced HUD samples contain no
    // displayed changes. The old store notified on every one of these calls.
    g.events.update(g);
    let notifications = 0;
    const unsubscribe = hud.subscribe(() => notifications++);
    for (let i = 0; i < 120; i++) g.events.update(g);
    unsubscribe();
    g.events.tick(g);
    g.renderWorld();
    g.updateCamera(1 / 60);
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    return {
      records,
      notifications,
      aim,
      after: { yaw: g.yaw, pitch: g.pitch },
    };
  });
  console.log(JSON.stringify({ handlingRender: report }));
  expect(report.records).toHaveLength(17);
  for (const row of report.records) {
    expect(row.gl, row.id).toBe(0);
    expect(row.reset, row.id).toBe(true);
    if (row.extracted !== null)
      expect(row.extracted, row.id).toBeGreaterThan(0.2);
  }
  expect(report.notifications).toBe(0);
  expect(report.after).toEqual(report.aim);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/handling-performance.png" });
});
