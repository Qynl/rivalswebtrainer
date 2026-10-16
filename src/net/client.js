import { readMultiplayerHealth } from "./health.js";
import { decodeSnapshot } from "./snapshot-codec.js";
import { PROTOCOL } from "./protocol.js";
const initial = {
  open: false,
  status: "offline",
  transport: null,
  id: null,
  rooms: [],
  room: null,
  error: "",
  ping: 0,
};
export class MultiplayerClient {
  constructor({ mode, peerOptions } = {}) {
    this.mode =
      mode ||
      (typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("network") === "server"
        ? "server"
        : "peer");
    this.peerOptions = peerOptions;
    this.state = { ...initial };
    this.listeners = new Set();
    this.connection = null;
    this.session = null;
    this.generation = 0;
    this.pendingSnapshot = null;
    this.started = false;
    this.timer = null;
    this.lastPacket = 0;
    this.rtt = 0;
    this.metadata = new Map();
    this.pendingEvents = [];
    this.membership = 0;
    this.matchRevision = 0;
    this.activeMatchId = null;
    this.seenMatches = new Set();
  }
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  patch(value) {
    this.state = { ...this.state, ...value };
    for (const fn of this.listeners) fn();
  }
  open() {
    this.patch({ open: true, error: "" });
    if (!this.connection) this.connect();
    else this.send({ type: "list" });
  }
  hide() {
    this.patch({ open: false });
  }
  async connect() {
    const generation = ++this.generation;
    clearInterval(this.timer);
    this.connection?.close();
    this.connection = null;
    this.pendingPeer?.close();
    this.pendingPeer = null;
    this.patch({ status: "connecting", error: "" });
    try {
      if (this.mode === "peer") {
        const { BrowserPeerNetwork } = await import("./peer-network.js");
        if (generation !== this.generation) return;
        const network = new BrowserPeerNetwork(this, generation, {
          peerOptions: this.peerOptions,
        });
        this.pendingPeer = network;
        await network.start();
        if (generation !== this.generation) {
          network.close();
          return;
        }
        this.pendingPeer = null;
        this.installConnection(network);
        return;
      }
      const health = await fetch("/api/health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      }).then(readMultiplayerHealth);
      if (generation !== this.generation) return;
      if (health.protocol !== PROTOCOL)
        throw Error("Client/server versions differ. Reload the page.");
      let connection;
      if (health.geckos && typeof RTCPeerConnection !== "undefined")
        try {
          connection = await this.connectGeckos(generation);
        } catch {
          connection = null;
        }
      if (generation !== this.generation) {
        connection?.close();
        return;
      }
      connection ||= await this.connectWebSocket(generation);
      if (generation !== this.generation) {
        connection.close();
        return;
      }
      this.installConnection(connection);
    } catch (error) {
      if (generation !== this.generation) return;
      this.pendingPeer?.close();
      this.pendingPeer = null;
      if (generation === this.generation)
        this.patch({
          status: "error",
          error: `Multiplayer is unavailable. ${error.message}. Offline play still works.`,
        });
    }
  }
  installConnection(connection) {
    this.connection = connection;
    this.patch({ status: "connected", transport: connection.transport });
    this.lastPacket = performance.now();
    this.send({ type: "list" });
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.send({ type: "ping", sent: performance.now() });
      if (this.state.open && !this.state.room) this.send({ type: "list" });
      if (
        this.state.status === "connected" &&
        performance.now() - this.lastPacket > 12000
      )
        this.disconnected(
          "Connection lost. Your offline game is still available.",
        );
    }, 2000);
  }
  connectWebSocket(generation) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live`,
        ),
        timer = setTimeout(() => {
          ws.close();
          reject(Error("Connection timed out"));
        }, 4000);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        try {
          const packet =
            typeof e.data === "string"
              ? JSON.parse(e.data)
              : {
                  type: "snapshot",
                  snapshot: decodeSnapshot(e.data, this.metadata),
                };
          this.packet(packet, generation).catch((error) =>
            this.patch({ error: error.message }),
          );
        } catch (error) {
          this.patch({ error: error.message });
        }
      };
      ws.onopen = () => {
        clearTimeout(timer);
        resolve({
          transport: "websocket",
          send: (p) => {
            if (ws.readyState === 1 && ws.bufferedAmount < 32768)
              ws.send(JSON.stringify(p));
          },
          close: () => ws.close(),
        });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(Error("Cannot reach multiplayer server"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.connection && generation === this.generation)
          this.disconnected("Disconnected from the multiplayer server.");
      };
    });
  }
  async connectGeckos(generation) {
    const { default: geckos } = await import("@geckos.io/client");
    return new Promise((resolve, reject) => {
      const channel = geckos({ url: location.origin, port: null });
      let active = true;
      const timer = setTimeout(() => {
        active = false;
        try {
          channel.close();
        } catch {}
        reject(Error("UDP unavailable"));
      }, 4000);
      channel.on("packet", (p) => {
        if (active)
          this.packet(p, generation).catch((error) =>
            this.patch({ error: error.message }),
          );
      });
      channel.onRaw((data) => {
        if (active)
          try {
            this.packet(
              {
                type: "snapshot",
                snapshot: decodeSnapshot(data, this.metadata),
              },
              generation,
            ).catch(() => {});
          } catch {}
      });
      channel.onConnect((error) => {
        if (!active) return;
        clearTimeout(timer);
        if (error) {
          active = false;
          try {
            channel.close();
          } catch {}
          reject(error);
        } else
          resolve({
            transport: "geckos",
            send: (p) =>
              channel.emit("packet", p, { reliable: p.type !== "input" }),
            close: () => {
              active = false;
              channel.close();
            },
          });
      });
      channel.onDisconnect(() => {
        if (
          active &&
          this.connection?.transport === "geckos" &&
          generation === this.generation
        )
          this.disconnected(
            "WebRTC connection lost. Reconnect to join another lobby.",
          );
      });
    });
  }
  send(packet) {
    this.connection?.send(packet);
  }
  async packet(packet, generation) {
    if (
      generation !== this.generation ||
      !packet ||
      typeof packet.type !== "string"
    )
      return;
    this.lastPacket = performance.now();
    if (packet.type === "probe")
      this.send({ type: "probeReply", token: packet.token });
    if (packet.type === "hello") {
      this.membership = 0;
      this.activeMatchId = null;
      this.matchRevision = 0;
      this.metadata.clear();
      this.patch({ id: packet.id, transport: packet.transport });
    }
    if (packet.type === "list") this.patch({ rooms: packet.rooms });
    if (packet.type === "error") {
      if (this.session) {
        this.session.pendingLoadout = null;
        this.session.game.events.toast(packet.message);
      }
      this.patch({ error: packet.message });
      return;
    }
    if (packet.type === "pong" && Number.isFinite(packet.sent)) {
      const ping = Math.min(3000, Math.max(0, performance.now() - packet.sent));
      this.rtt = this.rtt ? this.rtt * 0.7 + ping * 0.3 : ping;
      this.patch({ ping: Math.round(this.rtt) });
    }
    if (packet.type === "room") {
      if (packet.membership < this.membership) return;
      if (
        packet.membership === this.membership &&
        packet.room.revision <
          Math.max(this.state.room?.revision || 0, this.matchRevision)
      )
        return;
      this.membership = packet.membership;
      this.patch({ room: packet.room, error: "" });
      if (packet.room.phase === "lobby") {
        this.activeMatchId = null;
        this.matchRevision = 0;
        if (this.session) await this.stopSession(true);
      }
    }
    if (packet.type === "left") {
      if (packet.membership < this.membership) return;
      this.membership = packet.membership;
      this.activeMatchId = null;
      this.matchRevision = 0;
      this.pendingEvents = [];
      this.patch({ room: null });
      await this.stopSession(true);
      this.send({ type: "list" });
    }
    if (packet.type === "events") {
      if (packet.matchId !== this.activeMatchId) return;
      if (this.session) this.session.processEvents(packet.events);
      else this.pendingEvents.push(...packet.events);
      if (this.pendingEvents.length > 128)
        this.pendingEvents.splice(0, this.pendingEvents.length - 128);
    }
    if (packet.type === "snapshot") {
      if (packet.snapshot.matchId !== this.activeMatchId) return;
      if (this.session) this.session.receive(packet.snapshot);
      else this.pendingSnapshot = packet.snapshot;
    }
    if (packet.type === "start") {
      if (
        packet.membership < this.membership ||
        this.seenMatches.has(packet.matchId)
      )
        return;
      this.membership = packet.membership;
      this.activeMatchId = packet.matchId;
      this.matchRevision = packet.roomRevision;
      this.seenMatches.add(packet.matchId);
      if (this.seenMatches.size > 16)
        this.seenMatches.delete(this.seenMatches.values().next().value);
      this.started = true;
      this.metadata = new Map(
        packet.snapshot.players.map((p) => [
          p.index,
          { id: p.id, name: p.name, team: p.team },
        ]),
      );
      this.pendingSnapshot = packet.snapshot;
      this.patch({ open: false, error: "" });
      const isCurrent = () =>
        generation === this.generation && this.activeMatchId === packet.matchId;
      try {
        const { startOnlineMatch } = await import("../ui-session.js");
        if (!isCurrent()) return;
        await startOnlineMatch(this, packet.map, this.pendingSnapshot);
        if (!isCurrent()) return;
        this.session?.processEvents(this.pendingEvents);
        this.pendingEvents = [];
        this.pendingSnapshot = null;
      } catch (error) {
        if (!isCurrent()) return;
        this.patch({
          open: true,
          error: `Could not start online match: ${error.message}`,
        });
        this.send({ type: "leave" });
      } finally {
        if (isCurrent()) this.started = false;
      }
    }
  }
  async stopSession(open = false) {
    if (this.session) {
      this.session.dispose();
      this.session = null;
      const { backToLobby } = await import("../ui-session.js");
      backToLobby();
    }
    if (open) this.patch({ open: true });
  }
  disconnected(message) {
    if (!this.connection) return;
    const wasOnline = !!this.session || !!this.activeMatchId || this.state.open;
    this.generation++;
    this.activeMatchId = null;
    const connection = this.connection;
    this.connection = null;
    connection.close();
    clearInterval(this.timer);
    this.patch({
      status: "error",
      room: null,
      rooms: [],
      open: wasOnline,
      error: message,
    });
    this.stopSession(wasOnline);
  }
  leave() {
    this.send({ type: "leave" });
  }
}
export const multiplayer = new MultiplayerClient();

// Companion to window.__arena for connection diagnostics and browser tests.
if (typeof window !== "undefined") window.__multiplayer = multiplayer;
