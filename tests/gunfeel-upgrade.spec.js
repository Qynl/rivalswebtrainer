import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 960, height: 720 } });
test("every firearm renders a real kick, scoped Sniper punches without changing aim, and the articulated operator reacts", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  await page.waitForFunction(() => !!document.pointerLockElement);
  const report = await page.evaluate(async () => {
    const g = window.__arena,
      { WEAPONS } = await import("/src/data.js");
    g.updateBot = () => {};
    g.audio.volume = 0;
    g.state = "playing";
    g.yaw = 0.2;
    g.pitch = 0.05;
    g.selectingLoadout = false;
    g.settings.shake = true;
    Object.assign(g.player, {
      x: 12,
      y: 0,
      z: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      alive: true,
    });
    const draw = () => {
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.autoClear = false;
      g.renderer.clearDepth();
      g.renderer.render(g.weaponScene, g.weaponCamera);
    };
    const shots = [];
    for (const [id, w] of Object.entries(WEAPONS).filter(
      ([, w]) => w.slot < 2,
    )) {
      g.clock += 2;
      g.loadout[w.slot] = id;
      g.slot = -1;
      g.equip(w.slot);
      g.ammunition[w.slot] = { mag: w.mag, reserve: w.reserve };
      g.cooldown =
        g.switchTime =
        g.reloadTime =
        g.deflectTime =
        g.quickUtilityTime =
        g.quickMeleeTime =
          0;
      g.weaponReadyAt[w.slot] = 0;
      g.lastShotAt = g.clock - 10;
      g.kick = 0;
      g.spinTime = 1;
      g.aiming = false;
      g.bowCharge = 0.8;
      for (let i = 0; i < 120; i++) g.updateCamera(1 / 120);
      const rest = g.viewModel.position.z,
        sequence = g.shotSequence || 0;
      g.firePlayer();
      g.updateCamera(1 / 120);
      g.events.update(g);
      shots.push({
        id,
        kick: g.viewModel.position.z - rest,
        pitch: g.viewModel.rotation.x,
        fired: g.shotSequence > sequence,
        finite: Number.isFinite(g.camera.fov),
      });
      draw();
    }
    g.loadout[0] = "sniper";
    g.slot = -1;
    g.equip(0);
    g.aiming = true;
    g.cooldown = g.switchTime = g.reloadTime = 0;
    g.weaponReadyAt[0] = 0;
    g.ammunition[0] = { mag: 5, reserve: 20 };
    g.lastShotAt = g.clock - 10;
    g.kick = 0;
    for (let i = 0; i < 120; i++) g.updateCamera(1 / 120);
    const baseFov = g.camera.fov,
      aim = [g.yaw, g.pitch];
    g.firePlayer();
    g.updateCamera(1 / 120);
    g.events.update(g);
    draw();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scope = {
      baseFov,
      fov: g.camera.fov,
      pulse: +document.getElementById("scope").dataset.shotPulse,
      aim,
      after: [g.yaw, g.pitch],
    };
    const enemy = g.entities.find((e) => e.model);
    Object.assign(enemy, {
      vx: 7,
      vz: 0,
      vy: 0,
      grounded: true,
      yaw: 0.6,
      animationPhase: Math.PI / 2,
      hitReact: 0.11,
    });
    for (let i = 0; i < 20; i++) g.animateBot(enemy, 1 / 120);
    const parts = enemy.model.parts;
    const rig = {
      foot: parts.leftFoot.rotation.x,
      torso: parts.torso.rotation.y,
      revision: enemy.model.group.userData.rigRevision,
      glow: parts.armorMaterial.emissiveIntensity,
    };
    g.aiming = false;
    g.clock += 2;
    g.events.update(g);
    g.camera.position.set(enemy.x + 2.7, enemy.y + 1.65, enemy.z - 4);
    g.camera.lookAt(enemy.x, enemy.y + 1, enemy.z);
    g.viewModel.visible = false;
    g.camera.fov = 55;
    g.camera.updateProjectionMatrix();
    g.renderer.autoClear = true;
    g.renderWorld();
    return { shots, scope, rig };
  });
  expect(report.shots).toHaveLength(17);
  for (const shot of report.shots) {
    expect(shot.fired, shot.id).toBe(true);
    expect(shot.kick, shot.id).toBeGreaterThan(0.002);
    expect(shot.finite).toBe(true);
  }
  expect(report.scope.fov).toBeGreaterThan(report.scope.baseFov + 2);
  expect(report.scope.pulse).toBeGreaterThan(0.9);
  expect(report.scope.after).toEqual(report.scope.aim);
  expect(report.rig.revision).toBe(3);
  expect(Math.abs(report.rig.foot)).toBeGreaterThan(0.1);
  await page.screenshot({ path: "/tmp/operator-animation-upgrade.png" });
  expect(errors).toEqual([]);
});
