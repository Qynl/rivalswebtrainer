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

test("static-only browser-hosted match: invite, loadout, ready, real data channel, snapshots, leave and host close", async ({
  browser,
  page,
}) => {
  const other = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });
  const requests = [],
    errors = [];
  try {
    for (const p of [page, other]) await prepare(p, requests, errors);
    await expect(page.getByTestId("peer-help")).toBeVisible();
    await expect(page.getByLabel("PRIVATE · CODE ONLY")).toHaveCount(0);
    await page.locator("#online-name").fill("BROWSER HOST");
    await page.locator("#online-map").selectOption("foundry");
    await page.click("#create-lobby");
    const code = await page.getByTestId("room-code").textContent();
    expect(code).toMatch(/^[A-F0-9]{6}$/);
    await other.getByLabel("Lobby code").fill(code);
    await other.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    await other.getByLabel("Online MELEE").selectOption("katana");
    await other.click("#ready-online");
    await expect(page.locator("#start-online")).toBeEnabled();
    await page.click("#start-online");
    for (const p of [page, other]) {
      await p.waitForFunction(
        () => window.__arena?.network?.latest.players.length === 2,
      );
      await p.evaluate(() => {
        const g = window.__arena;
        g.audio.volume = 0;
        window.__netTick = setInterval(() => {
          g.simulate(1 / 120);
          g.network?.present(1 / 120);
          g.events.tick(g);
        }, 1000 / 120);
      });
    }
    await other.waitForFunction(
      () => window.__arena.network.latest.phase === "playing",
    );
    const result = await other.evaluate(() => {
      const net = window.__arena.network;
      return {
        map: net.client.state.room.map,
        melee: net.latest.players.find((p) => p.id === net.id)?.loadout?.[2],
        channel: net.client.connection.remote.dataChannel.readyState,
        transport: net.client.state.transport,
      };
    });
    expect(result.channel).toBe("open");
    expect(result.transport).toBe("peer");
    expect(result.map).toBe("foundry");
    expect(result.melee).toBe("katana");
    await page.bringToFront();
    await page.locator("#resume-button").click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    const before = await page.evaluate(() => window.__arena.player.x);
    await page.keyboard.down("KeyD");
    await expect
      .poll(() => page.evaluate(() => window.__arena.player.x))
      .toBeGreaterThan(before + 0.8);
    await page.keyboard.up("KeyD");
    await page.evaluate(() => {
      const g = window.__arena,
        present = g.presentShot.bind(g),
        trace = g.tracer.bind(g);
      g.__feedbackShots = 0;
      g.__ownTraces = 0;
      g.presentShot = (...args) => {
        g.__feedbackShots++;
        return present(...args);
      };
      g.tracer = (...args) => {
        g.__ownTraces++;
        return trace(...args);
      };
    });
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect
      .poll(() =>
        other.evaluate(() =>
          window.__arena.network.latest.players.some(
            (p) => p.id !== window.__arena.network.id && p.shot > 0,
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__arena.__feedbackShots))
      .toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.__arena.__ownTraces))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        window.__arena.combatFX.casingState.some((c) => c.life > 0),
      ),
    ).toBe(true);
    const ammo = await page.evaluate(
      () =>
        window.__arena.network.latest.players.find(
          (p) => p.id === window.__arena.network.id,
        ).ammo[3].mag,
    );
    await page.keyboard.press("g");
    await expect
      .poll(() =>
        other.evaluate(
          () =>
            window.__arena.network.latest.players.find(
              (p) => p.id !== window.__arena.network.id,
            ).ammo[3].mag,
        ),
      )
      .toBe(ammo - 1);
    await other.evaluate(() => {
      clearInterval(window.__netTick);
      window.__multiplayer.send({ type: "leave" });
    });
    await expect
      .poll(() => other.evaluate(() => window.__multiplayer.state.room))
      .toBe(null);
    await page.evaluate(() => {
      clearInterval(window.__netTick);
      window.__multiplayer.send({ type: "leave" });
      window.__multiplayer.open();
    });
    await page.click("#create-lobby");
    await other.evaluate(() => window.__multiplayer.open());
    await other.getByLabel("Lobby code").fill(code);
    await other.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    await page.evaluate(() => window.__multiplayer.connection.close());
    await expect(other.locator(".mp-error")).toContainText("host closed", {
      timeout: 10000,
    });
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("invite URL opens a prefilled join; failed code can retry; teams and loadout remain validated", async ({
  browser,
  page,
}) => {
  const other = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });
  const requests = [],
    errors = [];
  try {
    await prepare(page, requests, errors);
    await page.click("#create-lobby");
    const code = await page.getByTestId("room-code").textContent();
    await prepare(other, requests, errors, `?lobby=${code}`);
    await expect(other.getByLabel("Lobby code")).toHaveValue(code);
    await other.getByLabel("Lobby code").fill("000000");
    await other.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(other.locator(".mp-error")).toContainText(
      /not found|Could not connect|closed/,
      { timeout: 22000 },
    );
    // Invalid/unavailable hosts recover without configuring a backend.
    if (await other.getByRole("button", { name: "RETRY ↗" }).isVisible())
      await other.getByRole("button", { name: "RETRY ↗" }).click();
    await expect(other.locator(".mp-connection")).toContainText(
      "DIRECT WEBRTC",
      { timeout: 20000 },
    );
    await other.getByLabel("Lobby code").fill(code);
    await other.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    await expect(page.locator("#start-online")).toBeDisabled();
    await other.click("#ready-online");
    await expect(page.locator("#start-online")).toBeEnabled();
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("guest countdown clears while paused, HUD timer advances without render ticks, and realtime state tolerates loss/reordering", async ({
  browser,
  page,
}) => {
  const guest = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });
  const requests = [],
    errors = [];
  try {
    await prepare(page, requests, errors);
    await prepare(guest, requests, errors);
    await page.click("#create-lobby");
    const code = await page.getByTestId("room-code").textContent();
    await guest.getByLabel("Lobby code").fill(code);
    await guest.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    await guest.click("#ready-online");
    await page.click("#start-online");
    await guest.waitForFunction(
      () => window.__arena?.network?.latest.phase === "countdown",
    );
    // Neither browser manually simulates or renders. Host authority must run
    // independently, and the paused guest must not retain its old '1' banner.
    await guest.waitForFunction(
      () => window.__arena.network.latest.phase === "playing",
      null,
      { timeout: 15000 },
    );
    await expect(guest.locator("#round-banner h2")).not.toHaveText("1");
    await expect
      .poll(() => guest.locator("#timer").textContent())
      .not.toBe("1:30");
    const state = await guest.evaluate(() => {
      const n = window.__multiplayer.connection,
        c = n.remote.stateLane;
      return {
        paused: window.__arena.state === "paused",
        received: n.metrics.snapshotsReceived,
        ordered: c.ordered,
        retransmits: c.maxRetransmits,
        ready: c.readyState,
      };
    });
    expect(state.paused).toBe(true);
    expect(state.ready).toBe("open");
    expect(state.received).toBeGreaterThan(5);
    expect(state.ordered).toBe(false);
    expect(state.retransmits).toBe(0);
    expect(
      await page.evaluate(
        () => window.__multiplayer.connection.service.isWorker,
      ),
    ).toBe(true);
    const before = await guest.evaluate(() => {
      const g = window.__arena,
        lane = window.__multiplayer.connection.remote.stateLane;
      const receive = lane.onmessage;
      let sequence = 0;
      lane.onmessage = (event) => {
        sequence++;
        if (sequence % 5 === 0) return;
        if (sequence % 4 === 0) setTimeout(() => receive(event), 120);
        else receive(event);
      };
      g.network.sendInput();
      window.__acceptedTimes = [];
      const original = g.network.receive.bind(g.network);
      g.network.receive = (s) => {
        original(s);
        window.__acceptedTimes.push(g.network.latest.time);
      };
      return g.network.latest.time;
    });
    await guest.waitForFunction(
      (time) => window.__arena.network.latest.time > time + 2,
      before,
      { timeout: 10000 },
    );
    const after = await guest.evaluate(() => ({
      times: window.__acceptedTimes,
      timer: document.getElementById("timer").textContent,
      fastInputs: window.__multiplayer.connection.metrics.inputsSent,
    }));
    expect(after.times.every((t, i, a) => i === 0 || t >= a[i - 1])).toBe(true);
    expect(after.timer).not.toBe("1:30");
    expect(after.fastInputs).toBeGreaterThan(0);
    const stalledAt = await guest.evaluate(() => {
      window.__multiplayer.connection.remote.stateLane.onmessage = () => {};
      return window.__arena.network.latest.time;
    });
    await guest.waitForFunction(
      (time) => window.__arena.network.latest.time > time + 1.5,
      stalledAt,
      { timeout: 10000 },
    );
    expect(
      await page.evaluate(
        () => [...window.__multiplayer.connection.peers.values()][0].stateReady,
      ),
    ).toBe(false);
    expect(await guest.evaluate(() => window.__multiplayer.state.status)).toBe(
      "connected",
    );
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("six real RTC clients share worker-authoritative 3v3 binary state without six GPU renderers", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(async (options) => {
    window.__arena.frame = () => {};
    const Client = window.__multiplayer.constructor;
    const clients = (window.__sixPeers = []);
    const wait = (client, predicate) =>
      new Promise((resolve, reject) => {
        if (predicate(client.state)) return resolve();
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(Error("RTC lobby timed out"));
        }, 12000);
        const unsubscribe = client.subscribe(() => {
          if (predicate(client.state)) {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        });
      });
    const make = async () => {
      const client = new Client({ mode: "peer", peerOptions: options });
      const receive = client.packet.bind(client);
      client.packet = async (packet, generation) => {
        if (packet.type === "start") {
          client.activeMatchId = packet.matchId;
          client.metadata = new Map(
            packet.snapshot.players.map((p) => [
              p.index,
              { id: p.id, name: p.name, team: p.team },
            ]),
          );
          client.latestState = packet.snapshot;
        } else if (packet.type === "snapshot") {
          if (
            packet.snapshot.matchId === client.activeMatchId &&
            packet.snapshot.time > (client.latestState?.time ?? -1)
          )
            client.latestState = packet.snapshot;
          client.lastPacket = performance.now();
        } else await receive(packet, generation);
      };
      clients.push(client);
      await client.connect();
      return client;
    };
    const host = await make();
    host.send({ type: "create", name: "HOST", map: "blockout" });
    await wait(host, (state) => !!state.room);
    const code = host.state.room.code;
    for (let i = 1; i < 6; i++) {
      const client = await make();
      client.send({ type: "join", code, name: "PLAYER " + i });
      await wait(client, (state) => !!state.room);
      client.send({ type: "ready", ready: true });
    }
    await wait(
      host,
      (state) =>
        state.room.players.length === 6 &&
        state.room.players.every((p) => p.ready),
    );
    host.send({ type: "start" });
    let sequence = 0;
    window.__sixInput = setInterval(() => {
      sequence++;
      for (const client of clients)
        if (client.latestState)
          client.send({
            type: "input",
            input: {
              seq: sequence,
              yaw: 0,
              pitch: 0,
              keys: 0,
              fire: false,
              aim: false,
              paused: false,
              actions: [],
            },
          });
    }, 1000 / 30);
  }, peerOptions);
  await page.waitForFunction(
    () =>
      window.__sixPeers.every(
        (c) =>
          c.latestState?.phase === "playing" &&
          c.latestState.players.length === 6,
      ),
    null,
    { timeout: 20000 },
  );
  const result = await page.evaluate(() => {
    const clients = window.__sixPeers;
    return {
      teams: [0, 1].map(
        (team) =>
          clients[0].latestState.players.filter((p) => p.team === team).length,
      ),
      worker: clients[0].connection.service.isWorker,
      guests: clients.slice(1).map((c) => ({
        snapshots: c.connection.metrics.snapshotsReceived,
        unordered: !c.connection.remote.stateLane.ordered,
        retransmits: c.connection.remote.stateLane.maxRetransmits,
      })),
      hostSnapshots: clients[0].connection.metrics.snapshotsSent,
    };
  });
  expect(result.teams).toEqual([3, 3]);
  expect(result.worker).toBe(true);
  for (const guest of result.guests) {
    expect(guest.snapshots).toBeGreaterThan(10);
    expect(guest.unordered).toBe(true);
    expect(guest.retransmits).toBe(0);
  }
  expect(result.hostSnapshots).toBeGreaterThan(50);
  await page.evaluate(() => {
    clearInterval(window.__sixInput);
    for (const client of window.__sixPeers) {
      clearInterval(client.timer);
      client.connection?.close();
    }
  });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("host and delayed joining player keep equal responsive movement over real RTC with jitter and dropped state", async ({
  browser,
  page,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage({
    viewport: { width: 800, height: 600 },
  });
  const requests = [],
    errors = [];
  try {
    await prepare(page, requests, errors);
    await prepare(guest, requests, errors);
    await page.click("#create-lobby");
    const code = await page.getByTestId("room-code").textContent();
    await guest.getByLabel("Lobby code").fill(code);
    await guest.getByRole("button", { name: "JOIN ↗", exact: true }).click();
    await expect(page.locator(".mp-player")).toHaveCount(2);
    await guest.click("#ready-online");
    await page.click("#start-online");
    await guest.waitForFunction(
      () => window.__arena?.network?.latest.phase === "playing",
      null,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => window.__arena?.network?.latest.phase === "playing",
    );
    // Real WebRTC and worker authority; only transport latency is synthetic.
    // Hold reliable action traffic for longer than state to reproduce head-of-line
    // blocking without asking an external service to shape the network.
    await guest.evaluate(() => {
      const net = window.__multiplayer.connection;
      const sendState = net.sendState.bind(net),
        safeSend = net.safeSend.bind(net),
        deliver = net.deliver.bind(net);
      let outbound = 0,
        inbound = 0;
      net.sendState = (conn, packet) => {
        const n = ++outbound;
        if (n % 17 !== 0)
          setTimeout(
            () => sendState(conn, packet),
            80 + Math.sin(n * 0.7) * 12,
          );
        return true;
      };
      net.safeSend = (conn, packet) =>
        setTimeout(
          () => safeSend(conn, packet),
          packet.type === "input" ? 260 : 80,
        );
      net.deliver = (packet) => {
        if (packet.type !== "snapshot") return deliver(packet);
        const n = ++inbound;
        if (n % 19 !== 0)
          setTimeout(() => deliver(packet), 80 + Math.cos(n * 0.4) * 12);
      };
    });
    const run = (page) =>
      page.evaluate(() => {
        const g = window.__arena;
        Object.defineProperty(document, "pointerLockElement", {
          configurable: true,
          get: () => g.canvas,
        });
        g.state = "playing";
        g.selectingLoadout = false;
        g.keys.clear();
        g.audio.volume = 0;
        const n = g.network;
        const report = {
          distance: 0,
          reverse: 0,
          samples: 0,
          maxCorrection: 0,
          responseMs: [],
          actionAck: false,
        };
        let previous = performance.now(),
          accumulator = 0,
          elapsed = 0,
          phase = -1,
          pressedAt = 0,
          responded = true,
          jumped = false;
        window.__equalDone = false;
        const timer = setInterval(() => {
          const now = performance.now();
          accumulator += Math.min(0.08, (now - previous) / 1000);
          previous = now;
          while (accumulator >= 1 / 120 && elapsed < 5.4) {
            const next = Math.floor(elapsed / 0.6) % 3;
            if (next !== phase) {
              phase = next;
              g.keys.clear();
              if (next < 2) g.keys.add(next === 0 ? "KeyD" : "KeyA");
              pressedAt = now;
              responded = next === 2;
              n.sendInput();
            }
            if (!jumped && elapsed > 1.5) {
              jumped = true;
              n.action("jump");
              g.jump();
            }
            const x = g.player.x,
              z = g.player.z;
            g.clock += 1 / 120;
            n.step(1 / 120);
            const dx = g.player.x - x,
              dz = g.player.z - z;
            report.distance += Math.hypot(dx, dz);
            report.samples++;
            if (
              Math.hypot(g.player.vx, g.player.vz) > 3 &&
              dx * g.player.vx + dz * g.player.vz < -1e-5
            )
              report.reverse++;
            report.maxCorrection = Math.max(
              report.maxCorrection,
              Math.hypot(n.correction.x, n.correction.z),
            );
            if (!responded && Math.hypot(g.player.vx, g.player.vz) > 0.3) {
              report.responseMs.push(now - pressedAt);
              responded = true;
            }
            elapsed += 1 / 120;
            accumulator -= 1 / 120;
          }
          // Render-side skeleton/FX presentation runs once, not for every fixed tick.
          n.present(1 / 60);
          if (elapsed >= 5.4) {
            clearInterval(timer);
            g.keys.clear();
            n.sendInput();
            report.actionAck =
              n.latest.players.find((p) => p.id === n.id).lastAction >= 1;
            report.snapshots = n.buffer.frames.length;
            report.worker =
              window.__multiplayer.connection.role === "host"
                ? window.__multiplayer.connection.service.isWorker
                : true;
            window.__equalReport = report;
            window.__equalDone = true;
          }
        }, 8);
      });
    await Promise.all([run(page), run(guest)]);
    await Promise.all([
      page.waitForFunction(() => window.__equalDone),
      guest.waitForFunction(() => window.__equalDone),
    ]);
    const host = await page.evaluate(() => window.__equalReport),
      joining = await guest.evaluate(() => window.__equalReport);
    console.log(JSON.stringify({ realRtcMovementEquality: { host, joining } }));
    expect(joining.distance / host.distance).toBeGreaterThan(0.95);
    expect(joining.distance / host.distance).toBeLessThan(1.05);
    for (const report of [host, joining]) {
      expect(report.distance).toBeGreaterThan(22);
      expect(report.reverse).toBe(0);
      expect(report.maxCorrection).toBeLessThan(0.65);
      expect(Math.max(...report.responseMs)).toBeLessThan(60);
      expect(report.actionAck).toBe(true);
      expect(report.worker).toBe(true);
    }
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});
