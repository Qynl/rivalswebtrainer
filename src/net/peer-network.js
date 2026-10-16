import { LobbyService } from "../../server/lobbies.js";
import { PROTOCOL } from "./protocol.js";
const PREFIX = `rivalsweb-v${PROTOCOL}-`;
export const peerId = (code) => PREFIX + code.toLowerCase();
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(3)), (n) =>
    n.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();

// Only discovery/ICE uses the hosted PeerJS infrastructure. Lobby authority,
// physics, health and damage run in the host's browser, never at /api/*.
export class BrowserPeerNetwork {
  constructor(client, generation, options = {}) {
    this.client = client;
    this.generation = generation;
    this.options = options;
    this.transport = "peer";
    this.peers = new Map();
    this.pending = new Map();
    this.epoch = 0;
    this.closed = false;
    this.role = "host";
  }
  async start() {
    const { Peer } = await import("peerjs");
    if (this.closed) return this;
    this.Peer = this.options.Peer || Peer;
    await this.register();
    if (this.closed) return this;
    this.localLobby();
    return this;
  }
  async register(attempt = 0) {
    this.code = newCode();
    const peer = new this.Peer(
      peerId(this.code),
      this.options.peerOptions || {},
    );
    this.peer = peer;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Invite service did not respond. Check your connection and retry; no game server setup is needed.",
            ),
          ),
        15000,
      );
      this.cancelRegistration = () => {
        clearTimeout(timeout);
        reject(new Error("Invite connection cancelled"));
      };
      const onError = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      peer.once("error", onError);
      peer.once("open", () => {
        clearTimeout(timeout);
        peer.off("error", onError);
        resolve();
      });
    }).catch(async (error) => {
      peer.destroy();
      if (error.type === "unavailable-id" && attempt < 4 && !this.closed)
        return this.register(attempt + 1);
      throw error;
    });
    this.cancelRegistration = null;
    if (this.peer !== peer || this.closed) return;
    peer.on("open", () => {
      if (
        !this.closed &&
        this.client.state.error.startsWith("Invite service disconnected")
      )
        this.client.patch({ error: "" });
    });
    peer.on("connection", (conn) => this.accept(conn));
    peer.on("error", (error) => {
      if (this.closed) return;
      if (error.type === "peer-unavailable")
        this.joinFailed(
          "Lobby not found. Ask the host for the current invite code and keep their game open.",
        );
      else this.client.patch({ error: "Peer connection: " + error.message });
    });
    peer.on("disconnected", () => {
      if (!this.closed && !peer.destroyed) {
        this.client.patch({
          error:
            "Invite service disconnected. Existing matches can continue; retrying discovery…",
        });
        try {
          peer.reconnect();
        } catch {
          /* A subsequent retry starts a fresh peer. */
        }
      }
    });
  }
  deliver(packet) {
    if (!this.closed && this.generation === this.client.generation)
      this.client
        .packet(packet, this.generation)
        .catch((error) => this.client.patch({ error: error.message }));
  }
  localLobby() {
    this.role = "host";
    const epoch = ++this.epoch;
    this.service = new LobbyService({
      maxClients: 6,
      maxRooms: 1,
      roomCode: () => this.code,
    });
    this.localId = this.service.connect((packet) => {
      const copy = structuredClone(packet);
      queueMicrotask(() => {
        if (this.epoch === epoch) this.deliver(copy);
      });
    }, "peer");
    let previous = performance.now(),
      accumulator = 0,
      sweep = 0;
    this.tick = setInterval(() => {
      const now = performance.now(),
        elapsed = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      accumulator += elapsed;
      sweep += elapsed;
      while (accumulator >= 1 / 120 && this.service) {
        this.service.step(1 / 120);
        accumulator -= 1 / 120;
      }
      if (sweep > 5) {
        sweep = 0;
        this.service?.sweep();
      }
    }, 1000 / 120);
  }
  safeSend(conn, packet) {
    if (!conn?.open) return;
    const buffered = conn.dataChannel?.bufferedAmount || 0;
    if (buffered > 262144 && ["snapshot", "input"].includes(packet.type))
      return;
    if (buffered > 2097152) {
      conn.close();
      return;
    }
    try {
      conn.send(packet);
    } catch {
      conn.close();
    }
  }
  accept(conn) {
    const room = this.service?.rooms.get(this.code);
    if (
      this.role !== "host" ||
      !room ||
      room.match ||
      this.peers.size + this.pending.size >= 5 ||
      conn.metadata?.protocol !== PROTOCOL
    ) {
      conn.close();
      return;
    }
    let id;
    const epoch = this.epoch;
    this.pending.set(
      conn,
      setTimeout(() => conn.close(), 18000),
    );
    const cleanup = () => {
      clearTimeout(this.pending.get(conn));
      this.pending.delete(conn);
      if (id) {
        this.peers.delete(id);
        this.service?.disconnect(id);
        id = null;
      }
    };
    conn.on("open", () => {
      clearTimeout(this.pending.get(conn));
      this.pending.delete(conn);
      if (this.closed || this.epoch !== epoch || !this.service)
        return conn.close();
      id = this.service.connect(
        (packet) => this.safeSend(conn, packet),
        "peer",
        () => conn.close(),
      );
      if (!id) return conn.close();
      this.peers.set(id, conn);
    });
    conn.on("data", (packet) => {
      if (!id || !packet || typeof packet !== "object") return;
      // Guests cannot create/replace the host's single room. LobbyService
      // validates permissions, input values, teams and request rate limits.
      if (packet.type === "create") return;
      try {
        if (JSON.stringify(packet).length > 8192) return conn.close();
        this.service?.receive(id, packet);
      } catch {
        conn.close();
      }
    });
    conn.on("close", cleanup);
    conn.on("error", cleanup);
  }
  join(packet) {
    const code = String(packet.code || "")
      .trim()
      .toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(code))
      return this.client.patch({
        error: "Enter the six-character invite code.",
      });
    if (code === this.code)
      return this.client.patch({
        error: "That is your own code. Create a lobby to invite a friend.",
      });
    this.stopLocal();
    this.role = "guest";
    this.client.patch({
      status: "connecting",
      room: null,
      id: null,
      error: "",
    });
    const conn = this.peer.connect(peerId(code), {
      reliable: true,
      serialization: "json",
      metadata: { protocol: PROTOCOL },
    });
    this.remote = conn;
    this.joinTimer = setTimeout(
      () =>
        this.joinFailed(
          "Could not connect to the host. Keep both game tabs open; some networks block direct WebRTC or its relay.",
        ),
      18000,
    );
    conn.on("data", (packet) => {
      if (this.remote !== conn || this.role !== "guest") return;
      if (packet?.type === "error" && !this.client.state.room)
        return this.joinFailed(packet.message);
      if (packet?.type === "room") clearTimeout(this.joinTimer);
      this.deliver(packet);
    });
    conn.on("open", () => {
      if (this.closed || this.remote !== conn) return conn.close();
      this.client.patch({ status: "connected", transport: "peer", error: "" });
      this.safeSend(conn, { ...packet, code });
    });
    conn.on("error", () => {
      if (this.remote === conn)
        this.joinFailed(
          "Could not reach that host. Check the invite code and retry.",
        );
    });
    conn.on("close", () => {
      if (!this.closed && this.role === "guest" && this.remote === conn)
        this.client.disconnected(
          "The host closed the match or the peer connection was lost. Create or join another lobby.",
        );
    });
  }
  joinFailed(message) {
    if (this.closed || this.role !== "guest" || this.client.state.room) return;
    clearTimeout(this.joinTimer);
    this.role = "host";
    this.remote?.close();
    this.remote = null;
    this.client.patch({ room: null, status: "connected", error: message });
    this.localLobby();
  }
  send(packet) {
    if (this.closed) return;
    if (this.role === "guest") {
      if (packet.type === "leave") {
        clearTimeout(this.joinTimer);
        this.safeSend(this.remote, packet);
        this.role = "host";
        this.remote?.close();
        this.remote = null;
        this.client.stopSession(true);
        this.client.patch({ room: null, error: "" });
        this.localLobby();
      } else this.safeSend(this.remote, packet);
      return;
    }
    if (packet.type === "join") {
      this.join(packet);
      return;
    }
    if (packet.type === "leave") {
      // Host migration cannot preserve a simulation that lives in this browser.
      for (const id of [...this.peers.keys()]) this.service?.disconnect(id);
      this.peers.clear();
    }
    this.service?.receive(
      this.localId,
      packet.type === "create" ? { ...packet, private: true } : packet,
    );
  }
  stopLocal() {
    clearInterval(this.tick);
    this.epoch++;
    for (const [conn, timer] of this.pending) {
      clearTimeout(timer);
      conn.close();
    }
    this.pending.clear();
    this.service?.dispose();
    this.service = null;
    this.peers.clear();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.cancelRegistration?.();
    clearTimeout(this.joinTimer);
    this.stopLocal();
    this.remote?.close();
    this.peer?.destroy();
  }
}
