import { test, expect } from "@playwright/test";

test("offline wayfinding, directional damage, physical reticle and spatial sound work in the live game", async ({
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
  const result = await page.evaluate(() => {
    const g = window.__arena;
    g.world.build("blockout");
    g.player.health = 100;
    g.player.alive = true;
    g.player.grounded = true;
    g.yaw = 0;
    g.kick = 0;
    g.aiming = false;
    g.events.feedClear();
    const source = { x: g.player.x + 8, z: g.player.z, team: 1, name: "TEST" };
    g.damage(g.player, 12, source);
    g.events.tick(g);
    const arc = [...document.querySelectorAll(".damage-arc")].find(
      (e) => Number(e.style.opacity) > 0,
    );
    const firstAngle = Number(
      arc.style.transform.match(/rotate\((.*)rad\)/)[1],
    );
    g.yaw = Math.PI / 2;
    g.clock += 0.05;
    g.events.tick(g);
    const turnedAngle = Number(
      arc.style.transform.match(/rotate\((.*)rad\)/)[1],
    );
    const gap = () =>
      parseFloat(
        document
          .getElementById("crosshair")
          .style.getPropertyValue("--reticle-gap"),
      );
    const ground = gap();
    g.player.grounded = false;
    g.events.tick(g);
    const airborne = gap();
    g.aiming = true;
    g.player.grounded = true;
    g.events.tick(g);
    const ads = gap();
    g.events.hit(true);
    const headMarker =
      document.getElementById("hitmarker").classList.contains("headshot") &&
      !!document.querySelector("#hitmarker svg path");
    g.audio.volume = 0.2;
    g.audio.playAt(
      "rifle",
      { x: g.player.x + 4, y: 1.6, z: g.player.z },
      g.player,
      0,
    );
    const spatialVoices = g.audio.spatialVoices.size;
    g.audio.clearSpatial();
    const cleared = g.audio.spatialVoices.size === 0;
    g.events.feedClear();
    const compassCleared = [...document.querySelectorAll(".damage-arc")].every(
      (e) => Number(e.style.opacity) === 0,
    );
    const dressing = g.world.group.getObjectByName("arena-wayfinding");
    const collisionBefore = g.world.solidMeshes.length;
    g.renderer.setPixelRatio(0.5);
    g.resize();
    // The RAF is intentionally stopped: clear the equip timer rather than
    // measuring ADS while a frozen weapon-switch pose is still applied.
    g.switchTime = 0;
    g.reloadTime = 0;
    g.settings.shake = false;
    g.player.vx = 0;
    g.player.vz = 0;
    for (let i = 0; i < 100; i++) g.updateCamera(1 / 60);
    g.viewModel.updateMatrixWorld(true);
    const sight = g.viewModel
      .localToWorld(g.viewModel.userData.adsPoint.clone())
      .project(g.weaponCamera);
    const adsAligned = Math.abs(sight.x) < 0.001 && Math.abs(sight.y) < 0.001;
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.getContext().finish();
    return {
      firstAngle,
      turnedAngle,
      adsAligned,
      ground,
      airborne,
      ads,
      headMarker,
      spatialVoices,
      cleared,
      compassCleared,
      dressing: !!dressing,
      dressingBatches: dressing?.userData.batching,
      collisionBefore,
      collisionAfter: g.world.solidMeshes.length,
      textureSize: g.world.graphics.textures.get("arena-stencils")?.image.width,
      glError: g.renderer.getContext().getError(),
    };
  });
  expect(result.firstAngle).toBeCloseTo(Math.PI / 2, 5);
  expect(Math.abs(result.turnedAngle)).toBeCloseTo(Math.PI, 5);
  expect(result.airborne).toBeGreaterThan(result.ground);
  expect(result.ads).toBeLessThan(result.ground);
  expect(result.spatialVoices).toBeGreaterThan(0);
  expect(result.dressingBatches.after).toBe(2);
  expect(result.collisionAfter).toBe(result.collisionBefore);
  expect(result).toMatchObject({
    adsAligned: true,
    headMarker: true,
    cleared: true,
    compassCleared: true,
    dressing: true,
    textureSize: 512,
    glError: 0,
  });
  expect(errors).toEqual([]);
});
