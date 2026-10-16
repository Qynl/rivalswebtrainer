import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 960, height: 640 }, reducedMotion: "reduce" });

async function open(page) {
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
  return errors;
}
test("GPU tracer ribbons are visible, depth-occluded and safe across/behind the near plane", async ({
  page,
}) => {
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js");
    const { CombatFX } = await import("/src/combat-fx.js");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18232b);
    const camera = new THREE.PerspectiveCamera(65, 1.5, 0.08, 100);
    camera.position.set(0, 1.4, 4);
    camera.lookAt(0, 1.4, 0);
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(480, 320, false);
    g.renderer.autoClear = true;
    const fx = new CombatFX(scene);
    fx.points.visible = fx.decals.visible = fx.casings.visible = false;
    const gl = g.renderer.getContext();
    function draw() {
      g.renderer.render(scene, camera);
      gl.finish();
      const pixels = new Uint8Array(480 * 320 * 4);
      gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    }
    function changed(a, b) {
      let pixels = 0;
      for (let i = 0; i < a.length; i += 4)
        if (
          Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2]) >
          8
        )
          pixels++;
      return pixels;
    }
    const blank = draw();
    fx.trace(new THREE.Vector3(-0.6, 1.4, 0), new THREE.Vector3(0.8, 1.4, -6));
    const visible = changed(blank, draw());
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ color: 0x30404c }),
    );
    wall.position.z = 1;
    scene.add(wall);
    fx.traces.visible = false;
    const covered = draw();
    fx.traces.visible = true;
    const occluded = changed(covered, draw());
    scene.remove(wall);
    fx.clear();
    fx.trace(
      new THREE.Vector3(-0.2, 1.4, 4.4),
      new THREE.Vector3(1.1, 1.4, -5),
    );
    const crossing = changed(blank, draw());
    fx.clear();
    fx.trace(new THREE.Vector3(-0.2, 1.4, 4.4), new THREE.Vector3(1.1, 1.4, 8));
    const behind = changed(blank, draw()),
      glError = gl.getError();
    fx.dispose();
    wall.geometry.dispose();
    wall.material.dispose();
    return {
      visible,
      occluded,
      crossing,
      behind,
      glError,
      children: scene.children.length,
    };
  });
  console.log(JSON.stringify({ tracerRibbons: result }));
  expect(result.visible).toBeGreaterThan(30);
  expect(result.occluded).toBe(0);
  expect(result.crossing).toBeGreaterThan(0);
  expect(result.crossing).toBeLessThan(480 * 320 * 0.04);
  expect(result.behind).toBe(0);
  expect(result.glError).toBe(0);
  expect(result.children).toBe(0);
  expect(errors).toEqual([]);
});

test("live wall-ready pose preserves aim and the compact HUD displays real damage/capacity", async ({
  page,
}) => {
  const errors = await open(page);
  await page.click("#range-button");
  const result = await page.evaluate(async () => {
    const g = window.__arena;
    g.state = "playing";
    g.selectingLoadout = false;
    g.settings.shake = true;
    g.loadout[0] = "rifle";
    g.equip(0);
    g.switchTime = 0;
    g.yaw = Math.PI;
    g.pitch = 0;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 22.95,
      vx: 0,
      vy: 0,
      vz: 0,
      alive: true,
      grounded: true,
      health: 150,
    });
    g.player.yaw = g.yaw;
    const original = {
      yaw: g.yaw,
      pitch: g.pitch,
      x: g.player.x,
      y: g.player.y,
      z: g.player.z,
    };
    for (let i = 0; i < 90; i++) {
      g.clock += 1 / 120;
      g.updateCamera(1 / 120);
    }
    const tuck = g.weaponClearance.amount,
      position = g.viewModel.position.toArray();
    g.aiming = true;
    for (let i = 0; i < 360; i++) {
      g.clock += 1 / 120;
      g.updateCamera(1 / 120);
    }
    g.viewModel.updateMatrix();
    const sight = g.viewModel.userData.adsPoint
      .clone()
      .applyMatrix4(g.viewModel.matrix);
    const adsError = Math.hypot(sight.x, sight.y);
    const unchanged =
      JSON.stringify(original) ===
      JSON.stringify({
        yaw: g.yaw,
        pitch: g.pitch,
        x: g.player.x,
        y: g.player.y,
        z: g.player.z,
      });
    g.ammunition[0].mag = 15;
    g.events.update(g);
    g.player.health = 90;
    g.clock += 0.1;
    g.events.update(g);
    return { tuck, position, adsError, unchanged };
  });
  expect(result.tuck).toBeGreaterThan(0.5);
  expect(result.adsError).toBeLessThan(0.00001);
  expect(result.unchanged).toBe(true);
  await expect(page.locator("#health-value")).toHaveText("90");

  const state = await page.evaluate(() => ({
    health: document.getElementById("health-fill").getBoundingClientRect()
      .width,
    track: document.querySelector(".health-track").getBoundingClientRect()
      .width,
    trail: document.querySelector(".health-trail").getBoundingClientRect()
      .width,
    capacity: getComputedStyle(document.querySelector(".magazine-track i"))
      .transform,
  }));
  expect(state.health / state.track).toBeCloseTo(0.6, 2);
  expect(state.trail).toBeGreaterThan(state.health);
  expect(state.capacity).toContain("0.75");
  expect(errors).toEqual([]);
});

test("all three operator finishes render with readable team identity and owned patches", async ({
  page,
}) => {
  const errors = await open(page);
  const report = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js");
    const { createOperator } = await import("/src/character-model.js"),
      { operatorIdentity } = await import("/src/operator-kit.js");
    for (const id of ["lobby", "hud", "round-banner"])
      document.getElementById(id)?.classList.add("hidden");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x26343c);
    const hemi = new THREE.HemisphereLight(0xe1eff5, 0x525d64, 1.5),
      sun = new THREE.DirectionalLight(0xffedda, 2.5);
    sun.position.set(-3, 5, -4);
    scene.add(hemi, sun);
    const camera = new THREE.PerspectiveCamera(38, 1.5, 0.08, 100);
    camera.position.set(2.4, 2.1, -5.8);
    camera.lookAt(0, 1, 0);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0x5f737b, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.07;
    scene.add(floor);
    const names = new Map();
    for (let i = 0; names.size < 3; i++)
      names.set(operatorIdentity("RIVAL-" + i).kit.name, "RIVAL-" + i);
    const models = [...names.values()].map((name, i) => {
      const model = createOperator(i === 1 ? 0 : 1, name);
      scene.add(model.group);
      const e = {
        model,
        x: (i - 1) * 1.35,
        y: 0,
        z: 0,
        yaw: -0.12,
        vx: 0,
        vz: 0,
        vy: 0,
        grounded: true,
        height: 1.9,
        alive: true,
        activeWeapon: "rifle",
        meleeId: "knife",
        animationPhase: 0,
        seed: i,
      };
      for (let j = 0; j < 60; j++) g.animateBot(e, 1 / 60);
      return model;
    });
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(960, 640, false);
    g.renderer.autoClear = true;
    g.renderer.render(scene, camera);
    g.renderer.getContext().finish();
    // Preserve the final render for the screenshot; dispose after capture via hook.
    window.__operatorCleanup = () => {
      for (const model of models) g.disposeVisual(model.group);
      floor.geometry.dispose();
      floor.material.dispose();
    };
    return {
      styles: models.map((m) => m.group.userData.kitStyle),
      callsigns: models.map((m) => m.group.userData.callsign),
      gl: g.renderer.getContext().getError(),
    };
  });
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: "/tmp/broad-operator-finishes.png" });
  await page.evaluate(() => window.__operatorCleanup());
  expect(new Set(report.styles).size).toBe(3);
  expect(report.callsigns.every((n) => /^\d\d$/.test(n))).toBe(true);
  expect(report.gl).toBe(0);
  expect(errors).toEqual([]);
});
