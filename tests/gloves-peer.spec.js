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
          return { type: b.type, children: b.mesh.children.length };
        }),
      ).toEqual({ type: "brick", children: 5 });
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
