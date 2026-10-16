import { test, expect } from "@playwright/test";
test("actual F dagger reverses its grip at contact, stays visible and returns to the gun", async ({
  page,
}) => {
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
      loadout: ["sniper", "revolver", "knife", "grenade"],
      capture: false,
    });
    g.audio.volume = 0;
    g.state = "playing";
    g.clock = 10;
    g.cooldown = 0;
    g.switchTime = 0;
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
    g.events.banner("", "", "", 0.001);
  });
  await page.keyboard.press("f");
  const pose = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js");
    for (let i = 0; i < 13; i++) {
      g.clock += 1 / 120;
      g.swingTime = Math.max(0, g.swingTime - 1 / 120);
      g.knifeQuickTime -= 1 / 120;
      g.updateSupport(1 / 120);
      g.updatePlayer(1 / 120);
    }
    g.updateCamera(1 / 60);
    const model = g.quickModel,
      rig = model.userData.knifeRig;
    model.updateMatrixWorld(true);
    const p = rig.getWorldPosition(new THREE.Vector3()).project(g.weaponCamera);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(
      rig.getWorldQuaternion(new THREE.Quaternion()),
    );
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
    return {
      id: model.userData.weaponId,
      down: direction.y,
      forward: direction.z,
      x: p.x,
      y: p.y,
      arc: model.userData.slashTrail.visible,
      gl: g.renderer.getContext().getError(),
    };
  });
  expect(pose.id).toBe("knife");
  expect(pose.down).toBeLessThan(-0.7);
  expect(pose.forward).toBeLessThan(0);
  expect(Math.abs(pose.x)).toBeLessThan(1);
  expect(Math.abs(pose.y)).toBeLessThan(1);
  expect(pose.arc).toBe(false);
  expect(pose.gl).toBe(0);
  await page.screenshot({ path: "/tmp/knife-reverse-contact.png" });
  const restored = await page.evaluate(() => {
    const g = window.__arena;
    for (let i = 0; i < 60; i++) {
      g.updateSupport(1 / 120);
      g.quickMeleeTime = Math.max(0, g.quickMeleeTime - 1 / 120);
      if (!g.quickMeleeTime) g.clearQuickMelee();
    }
    return { quick: !!g.quickModel, gun: g.viewModel.visible, slot: g.slot };
  });
  expect(restored).toEqual({ quick: false, gun: true, slot: 0 });
  expect(errors).toEqual([]);
});
test("white glint really draws only during ADS and is occluded by opaque cover", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createCharacter } = await import("/src/world.js");
    const { updateBotWeapon } = await import("/src/bot-visuals.js");
    const { updateScopeGlint } = await import("/src/scope-glint.js");
    const g = window.__arena;
    g.frame = () => {};
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080a0e);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1));
    const model = createCharacter(1, "GLINT"),
      actor = { alive: true, activeWeapon: "sniper", aiming: true };
    scene.add(model.group);
    updateBotWeapon(model, actor, 10);
    const glint = model.parts.onlineSocket.userData.weapon.userData.scopeGlint;
    const center = glint.getWorldPosition(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.copy(center).add(new THREE.Vector3(0, 0, -5));
    camera.lookAt(center);
    const target = new THREE.WebGLRenderTarget(256, 256),
      pixels = new Uint8Array(256 * 256 * 4);
    const draw = () => {
      g.renderer.setRenderTarget(target);
      g.renderer.autoClear = true;
      g.renderer.render(scene, camera);
      g.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      let white = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220)
          white++;
      return white;
    };
    updateScopeGlint(model, actor, camera.position, 10);
    const on = draw();
    actor.aiming = false;
    updateScopeGlint(model, actor, camera.position, 10);
    const off = draw();
    actor.aiming = true;
    updateScopeGlint(model, actor, camera.position, 10);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x202020 }),
    );
    wall.position.copy(center).add(new THREE.Vector3(0, 0, -1));
    scene.add(wall);
    const blocked = draw();
    const gl = g.renderer.getContext().getError();
    g.renderer.setRenderTarget(null);
    target.dispose();
    g.disposeVisual(model.group);
    g.disposeVisual(wall);
    return { on, off, blocked, gl };
  });
  expect(result.on).toBeGreaterThan(result.off + 5);
  expect(result.blocked).toBeLessThan(result.on - 5);
  expect(result.gl).toBe(0);
});
