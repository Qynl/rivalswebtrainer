import { PROTOCOL } from "../src/net/protocol.js";
import { encodeSnapshot } from "../src/net/snapshot-codec.js";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { LobbyService } from "./lobbies.js";
export async function createMultiplayerServer({
  geckos = process.env.GECKOS !== "0",
  origins = process.env.ORIGINS,
  staticRoot = process.env.SERVE_DIST === "1" ? resolve("dist") : null,
  geckosFactory = null,
} = {}) {
  const service = new LobbyService();
  let geckosActive = false,
    geckosError = null;
  const allowed = (origin) => {
    if (!origin) return false;
    try {
      const u = new URL(origin);
      if (origins)
        return origins
          .split(",")
          .map((s) => s.trim())
          .includes(u.origin);
      return (
        ["localhost", "127.0.0.1"].includes(u.hostname) ||
        u.hostname.endsWith(".e2b.app")
      );
    } catch {
      return false;
    }
  };
  const server = createServer(async (req, res) => {
    // Native geckos wraps this listener and intercepts its own signalling routes.
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.url?.split("?")[0] === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          protocol: PROTOCOL,
          websocket: true,
          geckos: geckosActive,
          rooms: service.rooms.size,
          players: service.clients.size,
        }),
      );
      return;
    }
    const route = req.url?.split("?")[0] || "/";
    if (
      !staticRoot ||
      route === "/api" ||
      route.startsWith("/api/") ||
      route.startsWith("/.wrtc/")
    ) {
      if (route === "/api" || route.startsWith("/api/")) {
        res.writeHead(404, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error: "Unknown multiplayer API route" }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("Method not allowed");
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://local").pathname,
      );
      let file = resolve(staticRoot, "." + pathname);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep))
        throw Error("Invalid path");
      if ((await stat(file).catch(() => null))?.isDirectory())
        file = resolve(file, "index.html");
      let data = await readFile(file).catch(() => null);
      if (!data && !extname(pathname)) {
        file = resolve(staticRoot, "index.html");
        data = await readFile(file);
      }
      if (!data) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".webmanifest": "application/manifest+json",
          ".json": "application/json",
          ".bin": "application/octet-stream",
        }[extname(file)] || "application/octet-stream",
      );
      res.setHeader(
        "Cache-Control",
        file.includes(`${sep}assets${sep}`)
          ? "public,max-age=31536000,immutable"
          : "no-cache",
      );
      res.end(data);
    } catch {
      res.writeHead(400);
      res.end("Bad request");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/api/live" ||
      !allowed(req.headers.origin) ||
      service.clients.size >= service.maxClients
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws) => {
    const id = service.connect(
      (packet) => {
        if (ws.readyState !== 1) return;
        if (ws.bufferedAmount > 262144) {
          ws.close(1013, "Connection too slow");
          return;
        }
        if (packet.type === "snapshot") {
          if (ws.bufferedAmount < 65536)
            ws.send(encodeSnapshot(packet.snapshot));
        } else ws.send(JSON.stringify(packet));
      },
      "websocket",
      () => {
        if (ws.readyState === 1) ws.close(1000, "Disconnected");
      },
    );
    if (!id) {
      ws.close(1013, "Server full");
      return;
    }
    ws.on("message", (data) => {
      try {
        service.receive(id, JSON.parse(data.toString()));
      } catch {
        service.error(id, "Invalid packet.");
      }
    });
    ws.on("close", () => service.disconnect(id));
    ws.on("error", () => service.disconnect(id));
  });
  let io;
  if (geckos) {
    try {
      const createGeckos =
        geckosFactory || (await import("@geckos.io/server")).default;
      const iceServers = process.env.ICE_SERVERS
        ? JSON.parse(process.env.ICE_SERVERS)
        : [];
      if (
        !Array.isArray(iceServers) ||
        iceServers.some((s) => typeof s.urls !== "string")
      )
        throw Error(
          "ICE_SERVERS must be a JSON array of objects with string urls",
        );
      io = createGeckos({
        iceServers,
        portRange: { min: 10000, max: 10100 },
        authorization: (_auth, req) =>
          allowed(req.headers.origin) &&
          service.clients.size < service.maxClients,
        cors: {
          origin: (req) =>
            allowed(req.headers.origin) ? req.headers.origin : "null",
        },
      });
      io.addServer(server);
      io.onConnection((channel) => {
        const id = service.connect(
          (packet) => {
            if (packet.type === "snapshot")
              channel.raw.emit(encodeSnapshot(packet.snapshot));
            else channel.emit("packet", packet, { reliable: true });
          },
          "geckos",
          () => channel.close().catch(() => {}),
        );
        if (!id) {
          channel.close();
          return;
        }
        channel.on("packet", (packet) => {
          try {
            service.receive(id, packet);
          } catch {
            service.error(id, "Invalid packet.");
          }
        });
        channel.onDisconnect(() => service.disconnect(id));
      });
      geckosActive = true;
    } catch (error) {
      geckosError = error.message;
      console.warn(
        "geckos.io native transport unavailable; WebSocket transport remains available:",
        error.message,
      );
    }
  }
  let previous = performance.now(),
    accumulator = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    accumulator = Math.min(0.1, accumulator + (now - previous) / 1000);
    previous = now;
    try {
      while (accumulator >= 1 / 120) {
        service.step(1 / 120);
        accumulator -= 1 / 120;
      }
    } catch (error) {
      console.error("Match simulation error:", error);
      for (const room of service.rooms.values()) {
        if (room.match) {
          for (const id of room.members.keys())
            service.error(id, "Match ended because of a server error.");
          room.match.dispose();
          room.match = null;
          service.publish(room);
        }
      }
    }
  }, 1000 / 120);
  tick.unref();
  const sweep = setInterval(() => service.sweep(), 5000);
  sweep.unref();
  return {
    server,
    service,
    geckos: () => geckosActive,
    geckosError,
    close: async () => {
      clearInterval(tick);
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      for (const channel of io?.connectionsManager?.connections?.values?.() ||
        [])
        await channel.channel?.close?.();
      service.dispose();
      await new Promise((resolve) => server.close(resolve));
      wss.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = await createMultiplayerServer();
  app.server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
    console.log(
      `Multiplayer server listening on 0.0.0.0:${process.env.PORT || 3001} (${app.geckos() ? "geckos.io + WebSocket" : "WebSocket; GECKOS=1 enables optional native WebRTC"})`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
}
