import { test, expect } from "@playwright/test";
test("corrected Bow faces downrange with a left grip/right draw in hip fire and ADS, and releases a forward arrow", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.start({
      mode: 1,
      map: "blockout",
      range: true,
      difficulty: "regular",
      loadout: ["bow", "revolver", "knife", "grenade"],
      capture: false,
    });
    g.audio.volume = 0;
    g.state = "playing";
    g.clock = 10;
    g.yaw = g.pitch = 0;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 14,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    g.switchTime = g.kick = g.flash = 0;
    g.events.banner("", "", "", 0.001);
    for (const e of g.entities) if (e.model) e.model.group.visible = false;
  });
  for (const pose of ["rest", "full", "ads"]) {
    const r = await page.evaluate(async (pose) => {
      const g = window.__arena,
        THREE = await import("/node_modules/.vite/deps/three.js");
      g.aiming = pose === "ads";
      g.bowCharge = pose === "rest" ? 0 : 0.8;
      for (let i = 0; i < 90; i++) g.updateCamera(1 / 60);
      g.viewModel.updateMatrixWorld(true);
      const p = g.viewModel.userData,
        tip = p.arrow.localToWorld(p.arrowTip.clone()),
        nock = p.arrow.localToWorld(p.arrowNock.clone()),
        grip = g.viewModel.localToWorld(p.bowGripPoint.clone()),
        sight = g.viewModel
          .localToWorld(p.adsPoint.clone())
          .project(g.weaponCamera),
        ray = new THREE.Raycaster(
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -1),
        );
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
      g.renderer.autoClear = true;
      g.events.update(g);
      return {
        bodySkew: Math.max(...[p.bowUpper, p.bowLower].flatMap(limb =>
          limb.children.find(o => o.geometry?.type === "TubeGeometry")
            .geometry.parameters.path.getPoints(96).map(v => Math.abs(v.x)))),
        bodyArrowOffset: Math.abs(p.bowUpper.position.x - p.arrowNock.x),
        forward: tip.clone().sub(nock).normalize().z,
        tipZ: tip.z,
        nockZ: nock.z,
        gripX: grip.x,
        sightError: Math.hypot(sight.x, sight.y),
        handHits: p.hands.reduce(
          (n, h) => n + ray.intersectObject(h, true).length,
          0,
        ),
        gl: g.renderer.getContext().getError(),
        yaw: g.yaw,
        pitch: g.pitch,
      };
    }, pose);
    expect(r.bodySkew).toBeLessThan(1e-10);
    expect(r.bodyArrowOffset).toBeLessThan(0.02);
    expect(r.forward).toBeLessThan(-0.99);
    expect(r.tipZ).toBeLessThan(r.nockZ);
    if (pose !== "ads") expect(r.gripX).toBeLessThan(0);
    else {
      expect(r.sightError).toBeLessThan(0.001);
      expect(r.handHits).toBe(0);
    }
    expect(r.gl).toBe(0);
    expect(r.yaw).toBe(0);
    expect(r.pitch).toBe(0);
    await expect(page.locator("#ammo-value")).not.toHaveClass(/low/);
    await page.screenshot({ path: `/tmp/bow-forward-${pose}.png` });
  }
  const shot = await page.evaluate(() => {
    const g = window.__arena;
    g.aiming = false;
    g.bowCharge = 0.8;
    g.cooldown = 0;
    g.firePlayer();
    const p = g.projectiles.at(-1);
    g.updateProjectiles(1 / 120);
    g.updateCamera(1 / 60);
    const result = {
      velocityZ: p.vel.z,
      hidden: !g.viewModel.userData.arrow.visible,
      health: g.player.health,
      ammo: g.ammunition[0].mag,
    };
    g.updatePlayer(0.3);
    g.updateCamera(1 / 60);
    result.renocked = g.viewModel.userData.arrow.visible;
    return result;
  });
  expect(shot.velocityZ).toBeLessThan(-110);
  expect(shot.hidden).toBe(true);
  expect(shot.renocked).toBe(true);
  expect(shot.ammo).toBe(0);
  expect(shot.health).toBe(150);
  expect(errors).toEqual([]);
});
