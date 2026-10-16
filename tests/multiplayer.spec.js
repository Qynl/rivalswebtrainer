import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 800, height: 600 } });
test("two real browser clients join a private lobby, ready up and share an authoritative match", async ({
  browser,
  page,
}) => {
  const other = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    errors = [];
  for (const p of [page, other]) {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.waitForFunction(() => window.__arena?.state === "lobby");
    await p.evaluate(() => {
      window.__arena.frame = () => {};
    });
    await p.click("#multiplayer-button");
    await expect(p.locator(".mp-connection")).toContainText("WEBSOCKET", {
      timeout: 15000,
    });
  }
  await page.locator("#online-name").fill("HOST");
  await page.getByLabel("PRIVATE · CODE ONLY").check();
  await page.click("#create-lobby");
  const code = await page.getByTestId("room-code").textContent();
  await other.locator("#online-name").fill("RIVAL");
  await other.getByLabel("Lobby code").fill(code);
  await other.getByRole("button", { name: "JOIN ↗", exact: true }).click();
  await expect(page.locator(".mp-player")).toHaveCount(2);
  await expect(page.locator("#start-online")).toBeDisabled();
  await other.getByLabel("Online MELEE").selectOption("katana");
  await other.click("#ready-online");
  await expect(page.locator("#start-online")).toBeEnabled();
  await page.screenshot({ path: "/tmp/multiplayer-lobby.png" });
  await page.click("#start-online");
  for (const p of [page, other]) {
    await p.waitForFunction(
      () => window.__arena?.network && window.__arena.entities.length === 2,
    );
    await p.evaluate(() => {
      const g = window.__arena;
      g.audio.volume = 0;
      window.__netTick = setInterval(() => {
        g.simulate(1 / 120);
        g.events.tick(g);
      }, 1000 / 120);
    });
  }
  await page.bringToFront();
  await page.locator("#resume-button").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => window.__arena.beginSelection());
  await expect(page.locator("#match-setup")).toBeVisible();
  await page.waitForFunction(
    () => window.__arena.network.latest.phase === "playing",
    {
      timeout: 12000,
    },
  );
  await other.waitForFunction(
    () => window.__arena.network.latest.phase === "playing",
  );
  await page.locator('[data-pick-weapon="sniper"]').click();
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await page.locator('[data-pick-weapon="knife"]').click();
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__arena.network.latest.players.find(
            (p) => p.id === window.__arena.network.id,
          ).loadout[0],
      ),
    )
    .toBe("sniper");
  const before = await page.evaluate(() => window.__arena.player.z);
  await page.waitForFunction(
    () => !!document.pointerLockElement || window.__arena.state === "paused",
    { timeout: 10000 },
  );
  if (!(await page.evaluate(() => !!document.pointerLockElement)))
    await page.locator("#resume-button").click();
  await page.waitForFunction(() => document.pointerLockElement !== null, {
    timeout: 10000,
  });
  await page.keyboard.down("KeyD");
  await expect
    .poll(() => page.evaluate(() => window.__arena.player.x))
    .toBeGreaterThan(2);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => window.__arena.player.z))
    .toBeLessThan(before - 1.2);
  await page.keyboard.up("KeyW");
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id).x;
      }),
    )
    .toBeGreaterThan(1.5);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.__arena.ammunition[0].mag))
    .toBeLessThan(5);
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id).netShot || 0;
      }),
    )
    .toBeGreaterThan(0);
  expect(
    await other.evaluate(() => {
      const g = window.__arena;
      return g.entities.find((e) => e.netId !== g.network.id).model.parts
        .onlineSocket?.userData.id;
    }),
  ).toBe("sniper");
  // G is an actual reliable server action, not a local fake grenade/ammo edit.
  const utilityBefore = await page.evaluate(() => {
    const g = window.__arena,
      self = g.network.latest.players.find((p) => p.id === g.network.id);
    g.yaw = -Math.PI / 2;
    g.pitch = 0.4; // throw toward the side wall, not the idle rival
    return {
      utility: self.ammo[3].mag,
      gun: self.ammo[0].mag,
      slot: self.slot,
    };
  });
  await page.keyboard.press("g");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const g = window.__arena;
        return g.network.latest.players.find((p) => p.id === g.network.id)
          .ammo[3].mag;
      }),
    )
    .toBe(utilityBefore.utility - 1);
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id).model.parts
          .onlineSocket?.userData.id;
      }),
    )
    .toBe("grenade");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const g = window.__arena;
        return g.network.latest.projectiles.some(
          (p) => p.owner === g.network.id && p.weapon === "grenade",
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => !!window.__arena.quickModel))
    .toBe(false);
  expect(await page.evaluate(() => window.__arena.slot)).toBe(
    utilityBefore.slot,
  );
  expect(await page.evaluate(() => window.__arena.ammunition[0].mag)).toBe(
    utilityBefore.gun,
  );
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id).model.parts
          .onlineSocket?.userData.id;
      }),
    )
    .toBe("sniper");
  // ADS is authoritative and crosses the binary wire to the other operator.
  await page.evaluate(() => {
    window.__arena.aiming = true;
  });
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id)?.aiming;
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.__arena.aiming = false;
  });
  await expect
    .poll(() =>
      other.evaluate(() => {
        const g = window.__arena;
        return g.entities.find((e) => e.netId !== g.network.id)?.aiming;
      }),
    )
    .toBe(false);
  // A forged position/HP/kill packet is ignored: server accepts controls only.
  await page.evaluate(() => {
    const g = window.__arena;
    g.network.client.send({
      type: "input",
      input: {
        seq: 999999,
        yaw: 0,
        pitch: 0,
        keys: 0,
        fire: false,
        aim: false,
        paused: false,
        x: 999,
        health: 99999,
        damage: 99999,
      },
    });
  });
  await page.waitForTimeout(150);
  expect(
    await other.evaluate(() =>
      window.__arena.entities.every(
        (e) => e.health === 150 && Math.abs(e.x) < 20,
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => document.exitPointerLock());
  await other.evaluate(() => {
    clearInterval(window.__netTick);
    window.__arena.quit();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__arena.entities.find(
            (e) => e.netId !== window.__arena.network.id,
          )?.alive,
      ),
    )
    .toBe(false);
  expect(errors).toEqual([]);
  await other.close();
});

test("sustained Flamethrower renders a bounded volumetric-looking plume with animated pilot and heated nozzle", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const report = await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.audio.volume = 0;
    g.start({
      map: "blockout",
      mode: 1,
      difficulty: "regular",
      range: true,
      loadout: ["flame", "pistol", "knife", "molotov"],
    });
    g.world.build("blockout");
    g.state = "playing";
    g.cooldown = 0;
    g.events.banner("", "", "", 0.001);
    g.player.x = 0;
    g.player.z = 12;
    g.yaw = 0;
    g.pitch = 0.02;
    g.mouseDown = true;
    for (let i = 0; i < 180; i++) {
      g.simulate(1 / 120);
      g.updateCamera(1 / 120);
    }
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.autoClear = false;
    g.renderer.clearDepth();
    g.renderer.render(g.weaponScene, g.weaponCamera);
    g.renderer.autoClear = true;
    return {
      active: g.flameFX.active,
      pool: g.flameFX.states.length,
      weapon: g.viewModel.userData.weaponId,
      heat: g.viewModel.userData.nozzleGlow.material.emissiveIntensity,
      pilot: !!g.viewModel.userData.pilotFlame,
      draws: g.renderer.info.render.calls,
      finite: g.flameFX.states.every((p) =>
        [p.p.x, p.p.y, p.p.z].every(Number.isFinite),
      ),
    };
  });
  await page.screenshot({ path: "/tmp/flamethrower-upgrade.png" });
  expect(report.active).toBeGreaterThan(10);
  expect(report.pool).toBe(192);
  expect(report.heat).toBeGreaterThan(1);
  expect(report.pilot).toBe(true);
  expect(report.finite).toBe(true);
  expect(report.weapon).toBe("flame");
  expect(errors).toEqual([]);
});

test("all online collision layouts and line-of-fire meshes agree between browser and headless server", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const reports = await page.evaluate(async () => {
    const g = window.__arena;
    g.frame = () => {};
    const { createServerWorld } = await import("/server/world.js"),
      THREE = await import("/node_modules/three/build/three.module.js");
    const reports = [];
    for (const map of ["blockout", "foundry", "courtyard"]) {
      g.world.build(map);
      const server = createServerWorld(map),
        ray = new THREE.Raycaster(),
        normalize = (boxes) => boxes.map((b) => JSON.stringify(b)).sort();
      let misses = 0,
        maxDistanceError = 0;
      for (let i = 0; i < 100; i++) {
        const origin = new THREE.Vector3(
            Math.sin(i * 12.9) * server.layout.width * 0.4,
            i % 2 ? 1.66 : 4.86,
            Math.cos(i * 8.3) * server.layout.depth * 0.4,
          ),
          direction = new THREE.Vector3(
            Math.sin(i * 1.4),
            Math.sin(i * 0.3) * 0.4,
            Math.cos(i * 1.4),
          ).normalize();
        ray.set(origin, direction);
        ray.far = 100;
        const a = ray.intersectObjects(g.world.solidMeshes, false)[0],
          b = ray.intersectObjects(server.solidMeshes, false)[0];
        if (!!a !== !!b) misses++;
        if (a && b)
          maxDistanceError = Math.max(
            maxDistanceError,
            Math.abs(a.distance - b.distance),
          );
      }
      reports.push({
        map,
        browser: normalize(g.world.boxes),
        server: normalize(server.boxes),
        spawnsMatch:
          JSON.stringify(g.world.spawns) === JSON.stringify(server.spawns),
        misses,
        maxDistanceError,
      });
      server.dispose();
    }
    return reports;
  });
  for (const r of reports) {
    expect(r.browser, r.map).toEqual(r.server);
    expect(r.spawnsMatch, r.map).toBe(true);
    expect(r.misses, r.map).toBe(0);
    expect(r.maxDistanceError, r.map).toBeLessThan(0.001);
  }
});
