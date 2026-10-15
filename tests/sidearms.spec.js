import { test, expect } from "@playwright/test";
test("six secondary choices save through the real picker; new sidearms fire, reload and render with clear ADS", async ({
  page,
}) => {
  // Three new shader/model render checks can be slow with a software GPU.
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.click("#play-button");
  await page.click("#setup-next");
  await expect(page.locator("#setup-title")).toHaveText(
    "Choose your secondary",
  );
  await expect(page.locator("[data-pick-weapon]")).toHaveCount(6);
  for (const id of ["revolver", "burstpistol", "dualpistols"]) {
    await page.click(`[data-pick-weapon="${id}"]`);
    await expect(page.locator(`[data-pick-weapon="${id}"]`)).toHaveClass(
      /selected/,
    );
  }
  await page.click("#setup-next");
  await page.click("#setup-next");
  await page.click("#setup-next");
  await page.waitForFunction(
    () =>
      window.__arena?.loadout[1] === "dualpistols" &&
      window.__arena?.state !== "lobby",
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("rivals-loadout"))[1],
    ),
  ).toBe("dualpistols");
  const reports = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js");
    g.frame = () => {};
    g.audio.volume = 0;
    g.start({
      mode: 1,
      map: "blockout",
      range: true,
      loadout: ["rpg", "dualpistols", "knife", "grenade"],
      capture: false,
    });
    g.state = "playing";
    g.updateBot = () => {};
    g.clock = 20;
    g.pitch = 0;
    g.yaw = 0;
    g.events.banner("", "", "", 0);
    const reports = [];
    for (const id of ["revolver", "burstpistol", "dualpistols"]) {
      g.equip(0);
      g.loadout[1] = id;
      g.equip(1);
      g.switchTime = 0;
      g.cooldown = 0;
      g.weaponReadyAt[1] = 0;
      const w = (await import("/src/data.js")).WEAPONS[id];
      g.ammunition[1] = { mag: w.mag, reserve: w.reserve };
      g.aiming = false;
      g.mouseDown = true;
      g.trigger = true;
      g.updatePlayer(1 / 120);
      g.mouseDown = false;
      if (w.type === "burst")
        for (let i = 0; i < 28; i++) {
          g.clock += 1 / 120;
          g.updatePlayer(1 / 120);
        }
      const spent = w.mag - g.ammunition[1].mag;
      g.clock += 1;
      g.aiming = true;
      g.kick = 0;
      g.flash = 0;
      for (let i = 0; i < 100; i++) g.updateCamera(1 / 60);
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
      g.renderer.autoClear = true;
      g.viewModel.updateMatrixWorld(true);
      const p = g.viewModel
          .localToWorld(g.viewModel.userData.adsPoint.clone())
          .project(g.weaponCamera),
        clearRay = new THREE.Raycaster(
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -1),
        );
      const handHits = (g.viewModel.userData.hands || []).reduce(
        (n, h) => n + clearRay.intersectObject(h, true).length,
        0,
      );
      const gl = g.renderer.getContext().getError();
      g.reload();
      for (let i = 0; i < 240; i++) {
        g.clock += 1 / 120;
        g.updatePlayer(1 / 120);
      }
      reports.push({
        id,
        spent,
        sight: Math.hypot(p.x, p.y),
        handHits,
        gl,
        reloaded: g.ammunition[1].mag,
        capacity: w.mag,
      });
    }
    g.aiming = false;
    g.flash = 0;
    g.switchTime = 0;
    g.clock += 1;
    for (let i = 0; i < 60; i++) g.updateCamera(1 / 60);
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
    g.events.update(g);
    return reports;
  });
  for (const r of reports) {
    expect(r.spent).toBe(r.id === "burstpistol" ? 3 : 1);
    expect(r.sight).toBeLessThan(0.001);
    expect(r.handHits).toBe(0);
    expect(r.gl).toBe(0);
    expect(r.reloaded).toBe(r.capacity);
  }
  await page.screenshot({ path: "/tmp/dual-pistols-first-person.png" });
  expect(errors).toEqual([]);
});
