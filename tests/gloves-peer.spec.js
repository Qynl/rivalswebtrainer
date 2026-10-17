import { test, expect } from "@playwright/test";
import { PeerServer } from "peer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

// A static frontend (no /api) and test-only signaling replace the externally
// hosted discovery service. Data channels and browser match authority are real.
let signaling, staticSite, origin, peerOptions;
test.beforeAll(async () => {
  signaling = await new Promise((done) =>
    PeerServer({ port: 0, host: "127.0.0.1" }, done),
  );
  peerOptions = {
    host: "localhost",
    port: signaling.address().port,
    path: "/",
    secure: false,
    config: { iceServers: [] },
  };
  staticSite = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path.startsWith("/api/")) {
        res.writeHead(500);
        return res.end("NO BACKEND");
      }
      const file = resolve("dist", path === "/" ? "index.html" : path.slice(1));
      if (!file.startsWith(resolve("dist") + "/")) throw Error("Invalid path");
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".bin": "application/octet-stream",
        }[extname(file)] || "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => staticSite.listen(0, "127.0.0.1", done));
  origin = `http://localhost:${staticSite.address().port}`;
});
test.afterAll(async () => {
  staticSite?.closeAllConnections();
  signaling?.closeAllConnections();
  await Promise.all(
    [staticSite, signaling]
      .filter(Boolean)
      .map((server) => new Promise((done) => server.close(done))),
  );
});

async function prepare(page, requests, errors, path = "") {
  await page.addInitScript((options) => {
    let client;
    Object.defineProperty(window, "__multiplayer", {
      configurable: true,
      get: () => client,
      set: (value) => {
        client = value;
        client.peerOptions = options;
      },
    });
  }, peerOptions);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + path);
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  // Only tests override hosted discovery. Normal users supply no configuration.
  await page.evaluate((options) => {
    window.__arena.frame = () => {};
  }, peerOptions);
  if (!(await page.locator(".mp-overlay").isVisible()))
    await page.click("#multiplayer-button");
  await expect(page.locator(".mp-connection")).toContainText("DIRECT WEBRTC", {
    timeout: 20000,
  });
}

test("static-only real RTC glove match: unlocked selection, authority hits, launch replication and earned slaps", async ({
  browser,
  page,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    for (const p of [page, guest]) await prepare(p, requests, errors);
    await expect(page.getByLabel("Online glove")).toHaveCount(0);
    await page.click("#create-lobby");
    const code = await page.getByTestId("room-code").textContent();
    await guest.getByLabel("Lobby code").fill(code);
    await guest.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    for (const p of [page, guest]) {
      await expect(p.locator(".mp-loadout select")).toHaveCount(1);
      await expect(p.getByLabel("Online glove").locator("option")).toHaveCount(
        1,
      );
    }
    await guest.click("#ready-online");
    await page.click("#start-online");
    for (const p of [page, guest])
      await p.waitForFunction(
        () => window.__arena?.network?.latest.phase === "playing",
        null,
        { timeout: 25000 },
      );
    for (const p of [page, guest])
      await p.evaluate(() => {
        const g = window.__arena,
          n = g.network;
        g.audio.volume = 0;
        let seq = 5000;
        window.__gloveDriver = setInterval(() => {
          const snapshot = n.latest,
            self = snapshot?.players.find((p) => p.id === n.id),
            target = snapshot?.players.find((p) => p.id !== n.id && p.alive);
          if (!self?.alive || !target || snapshot.phase !== "playing") return;
          const dx = target.x - self.x,
            dz = target.z - self.z,
            distance = Math.hypot(dx, dz),
            path = g.world.nav.path(self, target);
          let wish =
            path.find((p) => Math.hypot(p.x - self.x, p.z - self.z) > 0.4) ||
            target;
          const close = distance < 3.1;
          if (close) wish = target;
          const yaw = Math.atan2(-(wish.x - self.x), -(wish.z - self.z));
          n.client.send({
            type: "input",
            input: {
              seq: ++seq,
              yaw,
              pitch: 0,
              keys: distance > 2.2 ? 1 : 0,
              fire: close,
              aim: false,
              paused: false,
              actions: [],
            },
          });
        }, 16);
      });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.__arena.network.latest.players.reduce(
              (sum, p) => sum + p.stats.hits,
              0,
            ),
          ),
        { timeout: 35000 },
      )
      .toBeGreaterThan(0);
    const states = await Promise.all(
      [page, guest].map((p) =>
        p.evaluate(() => {
          const n = window.__arena.network,
            self = n.latest.players.find((p) => p.id === n.id);
          return {
            channel:
              n.client.connection.remote?.dataChannel?.readyState || "host",
            weapon: self.weapon,
            gloveRoom: n.client.state.room.gloves,
            hits: self.stats.hits,
            slaps:
              JSON.parse(localStorage.getItem("slap-arena-profile-v1") || "{}")
                .slaps || 0,
            players: n.latest.players.map((p) => ({
              health: p.health,
              ragdoll: p.dash,
              vz: p.vz,
            })),
          };
        }),
      ),
    );
    expect(
      states.every((s) => s.weapon === "glove_default" && s.gloveRoom),
    ).toBe(true);
    expect(states.some((s) => s.hits > 0 && s.slaps >= s.hits)).toBe(true);
    expect(states.some((s) => s.players.some((p) => p.health < 150))).toBe(
      true,
    );
    expect(states[1].channel).toBe("open");
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    console.log("RTC GLOVE RESULT", JSON.stringify(states));
  } finally {
    for (const p of [page, guest])
      await p
        .evaluate(() => clearInterval(window.__gloveDriver))
        .catch(() => {});
    await guest.close();
  }
});

test("production cache supports a genuinely disconnected reload and glove practice", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__arena?.state === "lobby");
    await expect(page.locator(".slap-glove-grid button")).toHaveCount(24);
    await page.evaluate(() => {
      const g = window.__arena;
      g.frame = () => {};
      g.renderer.render = () => {};
    });
    await page.click("#range-button");
    await page.waitForFunction(
      () => !!document.pointerLockElement || window.__arena.state === "paused",
    );
    if (!(await page.evaluate(() => !!document.pointerLockElement)))
      await page.click("#resume-button");
    await page.waitForFunction(
      () => !!document.pointerLockElement && window.__arena.state === "playing",
    );
    const result = await page.evaluate(() => {
      const g = window.__arena;
      for (let i = 0; i < 10; i++) g.simulate(1 / 120);
      return {
        health: g.player.health,
        weapon: g.loadout[g.slot],
        entities: g.entities.length,
      };
    });
    expect(result).toEqual({
      health: 150,
      weapon: "glove_default",
      entities: 6,
    });
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

// Tests freeze rendering and use two tabs, so neither page can retain pointer
// lock/focus. Send genuine unpaused action inputs, exactly like the RTC driver
// above, rather than asking sendInput() to transmit a deliberately paused tab.
async function expandedAbility(page) {
  await page.evaluate(() => {
    const g = window.__arena,
      n = g.network;
    n.seq = Math.max(n.seq, 7000) + 1;
    n.client.send({
      type: "input",
      input: {
        seq: n.seq,
        yaw: g.yaw,
        pitch: g.pitch,
        keys: 0,
        fire: false,
        aim: false,
        paused: false,
        actions: [{ id: ++n.actionId, type: "ability" }],
      },
    });
  });
}

async function expandedRoom(
  page,
  guest,
  hostGlove,
  guestGlove,
  requests,
  errors,
) {
  for (const [p, id] of [
    [page, hostGlove],
    [guest, guestGlove],
  ])
    await p.addInitScript(
      (id) =>
        localStorage.setItem(
          "slap-arena-profile-v1",
          JSON.stringify({ version: 1, slaps: 5500, selected: id }),
        ),
      id,
    );
  await prepare(page, requests, errors);
  await prepare(guest, requests, errors);
  await page.click("#create-lobby");
  const code = await page.getByTestId("room-code").textContent();
  await guest.getByLabel("Lobby code").fill(code);
  await guest.getByRole("button", { name: "JOIN ↗", exact: true }).click();
  await expect(page.locator(".mp-player")).toHaveCount(2);
  for (const [p, id] of [
    [page, hostGlove],
    [guest, guestGlove],
  ]) {
    await expect(p.getByLabel("Online glove").locator("option")).toHaveCount(
      24,
    );
    await p.getByLabel("Online glove").selectOption(id);
  }
  await guest.click("#ready-online");
  await page.click("#start-online");
  for (const p of [page, guest])
    await p.waitForFunction(
      () => window.__arena?.network?.latest.phase === "playing",
      null,
      { timeout: 25000 },
    );
}

test("real RTC replicates expanded Golden status and Thanos marks/returns without false reload or flash effects", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_thanos",
      "glove_golden",
      requests,
      errors,
    );
    await expandedAbility(page);
    await expect
      .poll(() => page.evaluate(() => window.__arena.player.gloveMark))
      .not.toBeNull();
    const point = await page.evaluate(() => ({
      ...window.__arena.player.gloveMark,
    }));
    await expect
      .poll(() =>
        guest.evaluate((point) => {
          const mark = window.__arena.network.latest.players.find(
            (p) => p.weapon === "glove_thanos",
          ).gloveMark;
          return mark
            ? Math.hypot(mark.x - point.x, mark.y - point.y, mark.z - point.z)
            : Infinity;
        }, point),
      )
      .toBeLessThan(0.0001);
    await expandedAbility(guest);
    for (const p of [page, guest])
      await expect
        .poll(() =>
          p.evaluate(
            () =>
              window.__arena.network.latest.players.find(
                (p) => p.weapon === "glove_golden",
              ).blind,
          ),
        )
        .toBeGreaterThan(1);
    const status = await guest.evaluate(() => ({
      gold: window.__arena.player.goldTime,
      flash: window.__arena.blindTime,
      reload: window.__arena.reloadTime,
    }));
    expect(status.gold).toBeGreaterThan(1);
    expect(status.flash).toBe(0);
    expect(status.reload).toBe(0);
    await page.evaluate(() => {
      const n = window.__arena.network;
      n.client.send({
        type: "input",
        input: {
          seq: ++n.seq,
          yaw: 0,
          pitch: 0,
          keys: 1,
          fire: false,
          aim: false,
          paused: false,
          actions: [],
        },
      });
    });
    await expect
      .poll(() =>
        page.evaluate((point) => {
          const n = window.__arena.network,
            p = n.latest.players.find((p) => p.id === n.id);
          return Math.hypot(p.x - point.x, p.z - point.z);
        }, point),
      )
      .toBeGreaterThan(0.5);
    await page.evaluate(() => {
      const n = window.__arena.network;
      n.client.send({
        type: "input",
        input: {
          seq: ++n.seq,
          yaw: 0,
          pitch: 0,
          keys: 0,
          fire: false,
          aim: false,
          paused: false,
          actions: [],
        },
      });
    });
    await expect
      .poll(() => page.evaluate(() => window.__arena.player.abilityCooldown))
      .toBe(0);
    await expandedAbility(page);
    await expect
      .poll(() => page.evaluate(() => window.__arena.player.gloveMark))
      .toBeNull();
    await expect
      .poll(() =>
        guest.evaluate((point) => {
          const p = window.__arena.network.latest.players.find(
            (p) => p.weapon === "glove_thanos",
          );
          return Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z);
        }, point),
      )
      .toBeLessThan(0.08);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("real RTC carries visible Brick trap geometry and Ghost invisibility through compact snapshots", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_brick",
      "glove_ghost",
      requests,
      errors,
    );
    const startZ = await page.evaluate(() => {
      const n = window.__arena.network,
        p = n.latest.players.find((p) => p.id === n.id);
      n.client.send({
        type: "input",
        input: {
          seq: ++n.seq,
          yaw: 0,
          pitch: 0,
          keys: 1,
          fire: false,
          aim: false,
          paused: false,
          actions: [],
        },
      });
      return p.z;
    });
    await expect
      .poll(() =>
        page.evaluate((z) => {
          const n = window.__arena.network;
          return z - n.latest.players.find((p) => p.id === n.id).z;
        }, startZ),
      )
      .toBeGreaterThan(0.8);
    await page.evaluate(() => {
      const n = window.__arena.network;
      n.client.send({
        type: "input",
        input: {
          seq: ++n.seq,
          yaw: 0,
          pitch: 0,
          keys: 0,
          fire: false,
          aim: false,
          paused: false,
          actions: [],
        },
      });
    });
    await expandedAbility(page);
    await expandedAbility(guest);
    for (const p of [page, guest])
      await expect
        .poll(() =>
          p.evaluate(
            () =>
              window.__arena.network.latest.zones.filter(
                (z) => z.type === "brick",
              ).length,
          ),
        )
        .toBe(1);
    for (const p of [page, guest])
      expect(
        await p.evaluate(() => {
          const b = [...window.__arena.network.zones.values()].find(
            (z) => z.type === "brick",
          );
          return {
            type: b.type,
            children: b.mesh.children.length,
            signal: !!b.mesh.userData.brickRig,
            vertices: b.mesh.children.reduce(
              (sum, o) => sum + (o.geometry?.attributes.position.count || 0),
              0,
            ),
          };
        }),
      ).toEqual({
        type: "brick",
        children: 3,
        signal: true,
        vertices: expect.any(Number),
      });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__arena.network.latest.players.find(
              (p) => p.weapon === "glove_ghost",
            ).reload,
        ),
      )
      .toBeGreaterThan(1);
    // Status rendering follows the same bounded interpolation delay as bodies.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const g = window.__arena;
          g.network.present(1 / 120);
          return !g.entities.find((e) => e.activeWeapon === "glove_ghost").model
            .group.visible;
        }),
      )
      .toBe(true);
    const visible = await page.evaluate(() => {
      const e = window.__arena.entities.find(
        (e) => e.activeWeapon === "glove_ghost",
      );
      return { ghost: e.ghostTime, reload: e.reload };
    });
    expect(visible.ghost).toBeGreaterThan(1);
    expect(visible.reload).toBe(0);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("real RTC Default launches from rest in third person and both peers see ability cues without earned slaps", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_default",
      "glove_default",
      requests,
      errors,
    );
    const before = await page.evaluate(() => {
      const g = window.__arena,
        n = g.network,
        self = n.latest.players.find((p) => p.id === n.id);
      // The real arena contains cover two meters in front of some spawns.
      // Choose a genuinely clear launch direction, never remove authority walls
      // or teleport the player to make a displacement assertion pass.
      const clearance = (yaw) => {
        for (let d = 0.2; d <= 8; d += 0.2) {
          const x = self.x - Math.sin(yaw) * d,
            z = self.z - Math.cos(yaw) * d;
          const bounds = g.world.bounds;
          if (
            bounds &&
            (x < bounds.minX + 0.3 ||
              x > bounds.maxX - 0.3 ||
              z < bounds.minZ + 0.3 ||
              z > bounds.maxZ - 0.3)
          )
            return d - 0.2;
          if (
            g.world.boxes.some((b) => {
              if (self.y >= b.maxY || self.y + 1.9 <= b.minY) return false;
              let px = x,
                pz = z,
                loX = b.minX,
                hiX = b.maxX,
                loZ = b.minZ,
                hiZ = b.maxZ;
              if (b.angle) {
                const c = Math.cos(b.angle),
                  s = Math.sin(b.angle);
                px = (x - b.cx) * c - (z - b.cz) * s;
                pz = (x - b.cx) * s + (z - b.cz) * c;
                loX = -b.halfX;
                hiX = b.halfX;
                loZ = -b.halfZ;
                hiZ = b.halfZ;
              }
              const dx = px - Math.max(loX, Math.min(hiX, px)),
                dz = pz - Math.max(loZ, Math.min(hiZ, pz));
              return dx * dx + dz * dz < 0.3 * 0.3;
            })
          )
            return d - 0.2;
        }
        return 8;
      };
      const direction = Array.from({ length: 32 }, (_, i) => ({
        yaw: (i * Math.PI) / 16,
        clear: clearance((i * Math.PI) / 16),
      })).sort((a, b) => b.clear - a.clear)[0];
      g.yaw = direction.yaw;
      g.cameraZoom = 6;
      g.updateCamera(1 / 60);
      return {
        x: self.x,
        z: self.z,
        count: g.entities.length,
        model: !!g.player.model,
        clear: direction.clear,
      };
    });
    expect(before.clear).toBeGreaterThan(4);
    expect(before.model).toBe(true);
    expect(before.count).toBe(2);
    await expandedAbility(page);
    await expect
      .poll(
        () =>
          page.evaluate(({ x, z }) => {
            const n = window.__arena.network,
              p = n.latest.players.find((p) => p.id === n.id);
            return Math.hypot(p.x - x, p.z - z);
          }, before),
        { timeout: 5000 },
      )
      .toBeGreaterThan(3);
    for (const p of [page, guest]) {
      const observed = await p.evaluate(() => {
        const g = window.__arena;
        g.updateCamera(1 / 60);
        return {
          fx: !!g.gloveFX,
          puffs: g.gloveFX?.puffs.cursor || 0,
          hits: g.network.latest.players.reduce((a, p) => a + p.stats.hits, 0),
          slaps: g.network.latest.players.reduce(
            (a, p) => a + (p.stats.slaps || 0),
            0,
          ),
          count: g.entities.length,
        };
      });
      expect(observed.fx).toBe(true);
      expect(observed.puffs).toBeGreaterThan(0);
      expect(observed.hits).toBe(0);
      expect(observed.slaps).toBe(0);
      expect(observed.count).toBe(2);
    }
    expect(
      await page.evaluate(() => window.__arena.gloveNotice?.text),
    ).toContain("BOOSTING");
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("real RTC denied Magnet casts explain the authority decision only to the correct player, with no cooldown or rewards", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });
  const requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_magnet",
      "glove_magnet",
      requests,
      errors,
    );
    await expandedAbility(page);
    await expect
      .poll(() => page.evaluate(() => window.__arena.gloveNotice?.text || ""), {
        timeout: 10000,
      })
      .toContain("NO VISIBLE TARGET");
    expect(
      await guest.evaluate(() => window.__arena.gloveNotice?.text || ""),
    ).toBe("");
    for (const p of [page, guest]) {
      expect(
        await p.evaluate(() => {
          const g = window.__arena,
            n = g.network;
          return {
            trial: !!g.testDrive,
            cooldown: n.latest.players.find((p) => p.id === n.id).dashCooldown,
            slaps: n.latest.players.reduce(
              (s, p) => s + (p.stats.slaps || 0),
              0,
            ),
          };
        }),
      ).toMatchObject({ trial: false, cooldown: 0, slaps: 0 });
    }
    const filtered = await guest.evaluate(() => {
      const g = window.__arena,
        n = g.network,
        start = n.lastEvent;
      n.processEvents([
        {
          type: "gloveDenied",
          id: start + 1,
          player: "not-self",
          round: n.round,
          reason: "WRONG PLAYER",
        },
        {
          type: "gloveDenied",
          id: start + 2,
          player: n.id,
          round: n.round - 1,
          reason: "STALE ROUND",
        },
      ]);
      // Keep this fixture from consuming IDs that the real authority will emit next.
      n.lastEvent = start;
      return g.gloveNotice?.text || "";
    });
    expect(filtered).toBe("");
    await expandedAbility(guest);
    await expect
      .poll(
        () => guest.evaluate(() => window.__arena.gloveNotice?.text || ""),
        { timeout: 10000 },
      )
      .toContain("NO VISIBLE TARGET");
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("RTC viewers get team-relative nameplates and third-person avatars reattach after snapshot rebuilds", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_default",
      "glove_default",
      requests,
      errors,
    );
    for (const p of [page, guest]) {
      const observed = await p.evaluate(() => {
        const g = window.__arena,
          n = g.network;
        const sprites = (model) => {
          let count = 0;
          model?.group.traverse((o) => {
            if (o.isSprite) count++;
          });
          return count;
        };
        const enemy = [...n.entities.values()].find((e) => e !== g.player);
        const enemyTags = sprites(enemy.model);
        const ally = g.createEntity(
          g.player.team,
          { x: 0, z: 0 },
          99,
          false,
          false,
          "ALLY PROBE",
        );
        const allyTags = sprites(ally.model);
        g.entities.pop();
        g.scene.remove(ally.model.group);
        g.disposeVisual(ally.model.group);
        g.cameraZoom = 6;
        g.updateCamera(1 / 60);
        const oldModel = g.player.model;
        // Rehydrate from the genuinely received authority body through the same
        // build path used on a new round. No authority health/position is authored.
        n.build(n.latest);
        g.updateCamera(1 / 60);
        g.renderWorld();
        return {
          team: g.player.team,
          enemyTags,
          allyTags,
          rebuilt: g.player.model !== oldModel,
          inScene: g.player.model?.group.parent === g.scene,
          localTags: sprites(g.player.model),
          count: g.entities.length,
        };
      });
      expect(observed.enemyTags).toBe(0);
      expect(observed.allyTags).toBe(1);
      expect(observed.localTags).toBe(0);
      expect(observed.rebuilt).toBe(true);
      expect(observed.inScene).toBe(true);
      expect(observed.count).toBe(2);
    }
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("real RTC authority Dice outcome reaches the owning and remote pip models once, with only earned contact rewards", async ({
  browser,
  page,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_dice",
      "glove_default",
      requests,
      errors,
    );
    const hostId = await page.evaluate(() => window.__arena.network.id);
    for (const p of [page, guest])
      await p.evaluate(() => {
        const g = window.__arena,
          n = g.network;
        g.audio.volume = 0;
        window.__diceDriver = setInterval(() => {
          const s = n.latest,
            self = s?.players.find((e) => e.id === n.id),
            other = s?.players.find((e) => e.id !== n.id && e.alive);
          if (!self?.alive || !other || s.phase !== "playing") return;
          const distance = Math.hypot(self.x - other.x, self.z - other.z),
            path = g.world.nav.path(self, other),
            goal =
              distance < 3.1
                ? other
                : path.find(
                    (p) => Math.hypot(p.x - self.x, p.z - self.z) > 0.4,
                  ) || other;
          const yaw = Math.atan2(-(goal.x - self.x), -(goal.z - self.z));
          n.seq = Math.max(n.seq, 9000) + 1;
          n.client.send({
            type: "input",
            input: {
              seq: n.seq,
              yaw,
              pitch: 0,
              keys: distance > 2.2 ? 1 : 0,
              fire: self.weapon === "glove_dice" && distance < 3.1,
              aim: false,
              paused: false,
              actions: [],
            },
          });
        }, 16);
      });
    for (const p of [page, guest])
      await p.waitForFunction(
        (id) => window.__arena.network.entities.get(id)?.diceRoll > 0,
        hostId,
        { timeout: 35000 },
      );
    for (const p of [page, guest])
      await p.evaluate(() => {
        clearInterval(window.__diceDriver);
        const g = window.__arena,
          n = g.network;
        n.client.send({
          type: "input",
          input: {
            seq: ++n.seq,
            yaw: g.yaw,
            pitch: g.pitch,
            keys: 0,
            fire: false,
            aim: false,
            paused: false,
            actions: [],
          },
        });
      });
    await guest.waitForFunction(() => {
      const n = window.__arena.network;
      return n.latest.players.find((p) => p.id === n.id).health < 150;
    });
    const views = await Promise.all(
      [page, guest].map((p) =>
        p.evaluate((hostId) => {
          const g = window.__arena,
            n = g.network,
            source = n.entities.get(hostId);
          if (source === g.player) g.cameraZoom = 6;
          for (let i = 0; i < 6; i++) {
            n.present(1 / 60);
            g.updateCamera(1 / 60);
          }
          g.renderWorld();
          const panel =
              source.model.parts.onlineSocket.userData.weapon.userData.gloveRig
                .dicePanel,
            self = n.latest.players.find((e) => e.id === n.id);
          return {
            roll: source.diceRoll,
            model: panel.userData.roll,
            indexCount: panel.children[0].geometry.drawRange.count,
            sourceHits: n.latest.players.find((e) => e.id === hostId).stats
              .hits,
            slaps: JSON.parse(localStorage.getItem("slap-arena-profile-v1"))
              .slaps,
            selfHits: self.stats.hits,
          };
        }, hostId),
      ),
    );
    expect(views[0].roll).toBeGreaterThanOrEqual(1);
    expect(views[0].roll).toBeLessThanOrEqual(6);
    expect(views[1].roll).toBe(views[0].roll);
    for (const v of views) {
      expect(v.model).toBe(v.roll);
      expect(v.sourceHits).toBeGreaterThan(0);
      expect(v.slaps).toBe(5500 + v.selfHits);
    }
    expect(views[1].indexCount).toBe(views[0].indexCount);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    console.log("RTC CONFIRMED DICE", JSON.stringify(views));
  } finally {
    for (const p of [page, guest])
      await p
        .evaluate(() => clearInterval(window.__diceDriver))
        .catch(() => {});
    await guest.close();
  }
});

test("real RTC Boomerang return cues reach both viewers from the second authority impulse without a second contact award", async ({
  browser,
  page,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage({
      viewport: { width: 800, height: 600 },
    }),
    requests = [],
    errors = [];
  try {
    await expandedRoom(
      page,
      guest,
      "glove_boomerang",
      "glove_default",
      requests,
      errors,
    );
    for (const p of [page, guest])
      await p.evaluate(() => {
        const g = window.__arena,
          n = g.network;
        g.audio.volume = 0;
        window.__returnCues = 0;
        let value = g.gloveFX;
        const wrap = (fx) => {
          if (!fx || fx.__returnObserved) return fx;
          fx.__returnObserved = true;
          const show = fx.returnPull.bind(fx);
          fx.returnPull = (...args) => {
            window.__returnCues++;
            return show(...args);
          };
          return fx;
        };
        value = wrap(value);
        Object.defineProperty(g, "gloveFX", {
          configurable: true,
          get: () => value,
          set: (v) => {
            value = wrap(v);
          },
        });
        window.__boomerangDriver = setInterval(() => {
          const s = n.latest,
            self = s?.players.find((e) => e.id === n.id),
            other = s?.players.find((e) => e.id !== n.id && e.alive),
            attacker = s?.players.find((e) => e.weapon === "glove_boomerang");
          if (!self?.alive || !other || s.phase !== "playing") return;
          const hit = attacker?.stats.hits > 0,
            distance = Math.hypot(other.x - self.x, other.z - self.z),
            path = g.world.nav.path(self, other),
            goal =
              distance < 3.1
                ? other
                : path.find(
                    (p) => Math.hypot(p.x - self.x, p.z - self.z) > 0.4,
                  ) || other,
            yaw = Math.atan2(-(goal.x - self.x), -(goal.z - self.z));
          n.seq = Math.max(n.seq, 19000) + 1;
          n.client.send({
            type: "input",
            input: {
              seq: n.seq,
              yaw,
              pitch: 0,
              keys: !hit && distance > 2.2 ? 1 : 0,
              fire: !hit && self.weapon === "glove_boomerang" && distance < 3.1,
              aim: false,
              paused: false,
              actions: [],
            },
          });
        }, 16);
      });
    for (const p of [page, guest])
      await p.waitForFunction(() => window.__returnCues > 0, null, {
        timeout: 35000,
      });
    const views = await Promise.all(
      [page, guest].map((p) =>
        p.evaluate(() => {
          clearInterval(window.__boomerangDriver);
          const g = window.__arena,
            n = g.network;
          n.client.send({
            type: "input",
            input: {
              seq: ++n.seq,
              yaw: g.yaw,
              pitch: g.pitch,
              keys: 0,
              fire: false,
              aim: false,
              paused: false,
              actions: [],
            },
          });
          n.present(1 / 60);
          g.updateCamera(1 / 60);
          g.renderWorld();
          const self = n.latest.players.find((e) => e.id === n.id),
            attacker = n.latest.players.find(
              (e) => e.weapon === "glove_boomerang",
            ),
            victim = n.latest.players.find((e) => e.id !== attacker.id);
          return {
            cues: window.__returnCues,
            hits: attacker.stats.hits,
            health: victim.health,
            slaps: JSON.parse(localStorage.getItem("slap-arena-profile-v1"))
              .slaps,
            selfHits: self.stats.hits,
            finite: g.gloveFX.rings.mesh.instanceMatrix.array.every(
              Number.isFinite,
            ),
          };
        }),
      ),
    );
    for (const v of views) {
      expect(v.cues).toBe(1);
      expect(v.hits).toBe(1);
      expect(v.health).toBe(125);
      expect(v.slaps).toBe(5500 + v.selfHits);
      expect(v.finite).toBe(true);
    }
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    console.log("RTC ACTUAL BOOMERANG RETURN", JSON.stringify(views));
  } finally {
    for (const p of [page, guest])
      await p
        .evaluate(() => clearInterval(window.__boomerangDriver))
        .catch(() => {});
    await guest.close();
  }
});
