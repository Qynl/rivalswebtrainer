import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 1000, height: 700 } });
test("real explosive launch and F quick rear stab retain HP, gun slot and camera aim", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const result = await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.start({
      mode: 1,
      map: "blockout",
      range: true,
      difficulty: "regular",
      loadout: ["rpg", "pistol", "knife", "grenade"],
      capture: false,
    });
    g.state = "playing";
    g.audio.volume = 0;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: 0,
      health: 150,
      vy: 0,
      vx: 0,
      vz: 0,
    });
    g.yaw = 0;
    g.pitch = 0;
    const foe = g.entities.find((e) => e.team !== g.player.team);
    Object.assign(foe, { x: 0, y: 0, z: -2, yaw: 0, health: 150, alive: true });
    g.cooldown = 1.2;
    g.explosion(g.eye(g.player).set(0, 0.2, 0.5), g.player, "rpg");
    const launch = {
      hp: g.player.health,
      vy: g.player.vy,
      grounded: g.player.grounded,
    };
    const ammo = g.ammunition[0].mag;
    const began = g.meleeAbility(true);
    g.updatePlayerMelee(0.11);
    g.updateCamera(1 / 60);
    g.renderWorld();
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    return {
      launch,
      began,
      slot: g.slot,
      ammoBefore: ammo,
      ammoAfter: g.ammunition[0].mag,
      enemy: foe.health,
      backstab: g.backstabTime,
      model: g.quickModel?.userData.weaponId,
      yaw: g.yaw,
      pitch: g.pitch,
      gl: g.renderer.getContext().getError(),
    };
  });
  expect(result.launch).toEqual({ hp: 150, vy: 15, grounded: false });
  expect(result.began).toBe(true);
  expect(result.slot).toBe(0);
  expect(result.ammoAfter).toBe(result.ammoBefore);
  expect(result.enemy).toBe(0);
  expect(result.backstab).toBeGreaterThan(0);
  expect(result.model).toBe("knife");
  expect(result.yaw).toBe(0);
  expect(result.pitch).toBe(0);
  expect(result.gl).toBe(0);
  expect(errors).toEqual([]);
});
test("new operator rig and all 23 finished weapons actually render, with an attached full-draw Bow", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const result = await page.evaluate(async () => {
    const g = window.__arena;
    g.frame = () => {};
    const THREE = await import("/node_modules/.vite/deps/three.js"),
      { createCharacter, createViewModel } = await import("/src/world.js"),
      { WEAPONS } = await import("/src/data.js"),
      { WeaponAnimator } = await import("/src/animation.js");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x26343d);
    scene.environment = g.scene.environment;
    scene.add(new THREE.HemisphereLight(0xd2e5ee, 0x424338, 2.3));
    const key = new THREE.DirectionalLight(0xffeddb, 3);
    key.position.set(-3, 6, -4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fbfc9, 2);
    rim.position.set(3, 3, 3);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(34, 1000 / 700, 0.01, 50);
    cam.position.set(-2.7, 2.25, -6);
    cam.lookAt(0, 1, 0);
    const models = [];
    for (const [i, name] of ["STRIKER", "RIVAL", "VECTOR"].entries()) {
      const m = createCharacter(i === 0 ? 0 : 1, name);
      scene.add(m.group);
      g.animateBot(
        {
          model: m,
          x: (i - 1) * 1.15,
          y: 0,
          z: 0,
          vx: 0,
          vz: 0,
          height: 1.9,
          grounded: true,
          yaw: i === 1 ? -0.25 : 0.35,
          seed: 0,
          visible: false,
          activeWeapon: "rifle",
        },
        1,
      );
      models.push(m);
    }
    g.renderer.setSize(1000, 700, false);
    g.renderer.clear();
    g.renderer.render(scene, cam);
    const characterGL = g.renderer.getContext().getError();
    window.__showroom = { scene, cam, models };
    document
      .querySelectorAll(".screen,#hud,#startup-status")
      .forEach((e) => (e.style.display = "none"));
    return {
      characterGL,
      styles: models.map((m) => m.group.userData.characterStyle),
    };
  });
  expect(result.characterGL).toBe(0);
  expect(result.styles).toEqual(["striker-v2", "striker-v2", "striker-v2"]);
  await page.screenshot({ path: "/tmp/operators-front-v2.png" });
  const weapons = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js"),
      { createViewModel } = await import("/src/world.js"),
      { WEAPONS } = await import("/src/data.js"),
      { WeaponAnimator } = await import("/src/animation.js");
    const s = window.__showroom;
    for (const m of s.models) {
      s.scene.remove(m.group);
      g.disposeVisual(m.group);
    }
    const ids = Object.keys(WEAPONS),
      results = [];
    for (const id of ids) {
      const w = createViewModel(id, WEAPONS[id]),
        a = new WeaponAnimator();
      w.scale.setScalar(0.78);
      s.scene.add(w);
      for (let i = 0; i < 20; i++)
        a.update(w, {
          dt: 1 / 60,
          ammo: 1,
          draw: id === "bow" ? 0.8 : 0,
          shotAge: 10,
        });
      s.cam.position.set(1.2, 0.45, 1.5);
      s.cam.lookAt(0.05, -0.16, -0.75);
      g.renderer.clear();
      g.renderer.render(s.scene, s.cam);
      results.push({
        id,
        finish: w.userData.finishRevision,
        gl: g.renderer.getContext().getError(),
      });
      if (id === "bow") {
        window.__bow = w;
        window.__bowAnimator = a;
      } else {
        s.scene.remove(w);
        g.disposeVisual(w);
      }
    }
    g.renderer.clear();
    g.renderer.render(s.scene, s.cam);
    return results;
  });
  expect(weapons).toHaveLength(23);
  expect(weapons.every((w) => w.finish === "machined-v2" && w.gl === 0)).toBe(
    true,
  );
  await page.screenshot({ path: "/tmp/bow-redesign-v2.png" });
  const ads = await page.evaluate(async () => {
    const g = window.__arena,
      THREE = await import("/node_modules/.vite/deps/three.js"),
      { WeaponAnimator } = await import("/src/animation.js");
    const m = window.__bow,
      scene = window.__showroom.scene,
      cam = new THREE.PerspectiveCamera(74, 1000 / 700, 0.01, 30),
      a = new WeaponAnimator();
    for (let i = 0; i < 90; i++)
      a.update(m, { dt: 1 / 60, aim: true, ammo: 1, draw: 0.8, shotAge: 10 });
    m.updateMatrixWorld(true);
    const sight = m.localToWorld(m.userData.adsPoint.clone()).project(cam),
      ray = new THREE.Raycaster(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
      );
    g.renderer.clear();
    g.renderer.render(scene, cam);
    return {
      error: Math.hypot(sight.x, sight.y),
      handHits: ray.intersectObject(m.userData.drawHand, true).length,
      gl: g.renderer.getContext().getError(),
    };
  });
  expect(ads.error).toBeLessThan(0.001);
  expect(ads.handHits).toBe(0);
  expect(ads.gl).toBe(0);
  await page.screenshot({ path: "/tmp/bow-full-draw-ads-v2.png" });
  expect(errors).toEqual([]);
});
