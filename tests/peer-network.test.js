import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BrowserPeerNetwork, peerId } from "../src/net/peer-network.js";
import { MultiplayerClient } from "../src/net/client.js";
import { PROTOCOL } from "../src/net/protocol.js";
class Connection extends EventEmitter {
  constructor() {
    super();
    this.metadata = { protocol: PROTOCOL };
    this.sent = [];
    this.open = false;
    this.dataChannel = { bufferedAmount: 0 };
  }
  send(packet) {
    this.sent.push(structuredClone(packet));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit("close");
  }
  activate() {
    this.open = true;
    this.emit("open");
  }
}
class FakePeer extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    queueMicrotask(() => this.emit("open", id));
  }
  destroy() {
    this.destroyed = true;
  }
  connect(id) {
    this.target = id;
    return (this.outgoing = new Connection());
  }
}
async function network() {
  const client = new MultiplayerClient();
  const net = new BrowserPeerNetwork(client, client.generation, {
    Peer: FakePeer,
  });
  net.Peer = FakePeer;
  await net.register();
  net.localLobby();
  client.connection = net;
  await Promise.resolve();
  return { net, client };
}
test("peer invitations use normalized protocol-scoped IDs and default requires no API", () => {
  assert.equal(peerId("ABC123"), "rivalsweb-v2-abc123");
  assert.equal(new MultiplayerClient().mode, "peer");
  assert.equal(new MultiplayerClient({ mode: "server" }).mode, "server");
});
test("browser authority creates a private room using its registered invite code", async () => {
  const { net, client } = await network();
  try {
    net.send({ type: "create", name: "HOST", map: "foundry", private: false });
    await Promise.resolve();
    assert.match(net.code, /^[A-F0-9]{6}$/);
    assert.equal(client.state.room.code, net.code);
    assert.equal(client.state.room.private, true);
    assert.equal(client.state.room.host, client.state.id);
    assert.equal(client.state.room.map, "foundry");
  } finally {
    net.close();
  }
});
test("remote guests cannot replace host room, and normal validated join works", async () => {
  const { net } = await network();
  try {
    net.send({ type: "create", name: "HOST", map: "blockout" });
    const conn = new Connection();
    net.accept(conn);
    conn.activate();
    const hello = conn.sent.find((p) => p.type === "hello");
    conn.emit("data", { type: "create", name: "ATTACKER", map: "foundry" });
    assert.equal(net.service.rooms.size, 1);
    assert.equal(net.service.rooms.get(net.code).host, net.localId);
    conn.emit("data", { type: "join", code: net.code, name: "GUEST" });
    assert.equal(net.service.rooms.get(net.code).members.size, 2);
    assert.notEqual(hello.id, net.localId);
    conn.emit("data", { type: "start" });
    assert.equal(net.service.rooms.get(net.code).match, null);
    conn.emit("data", { type: "input", junk: "x".repeat(9000) });
    assert.equal(conn.closed, true);
    assert.equal(net.peers.size, 0);
  } finally {
    net.close();
  }
});
test("unknown/full lobby join failure restores a working local host", async () => {
  const { net, client } = await network();
  try {
    const oldId = client.state.id;
    net.send({ type: "join", code: "123ABC", name: "GUEST" });
    const conn = net.peer.outgoing;
    conn.activate();
    assert.equal(net.role, "guest");
    conn.emit("data", { type: "error", message: "Lobby is full." });
    await Promise.resolve();
    assert.equal(client.state.error, "Lobby is full.");
    assert.equal(net.role, "host");
    assert.notEqual(client.state.id, oldId);
    net.send({ type: "create", name: "HOST", map: "courtyard" });
    await Promise.resolve();
    assert.equal(client.state.room.code, net.code);
    assert.equal(conn.closed, true);
  } finally {
    net.close();
  }
});
test("host leave closes guests rather than pretending authority migrated", async () => {
  const { net } = await network();
  try {
    net.send({ type: "create", name: "HOST", map: "blockout" });
    const conn = new Connection();
    net.accept(conn);
    conn.activate();
    conn.emit("data", { type: "join", code: net.code, name: "GUEST" });
    net.send({ type: "leave" });
    assert.equal(conn.closed, true);
    assert.equal(net.service.rooms.size, 0);
    assert.equal(net.peers.size, 0);
  } finally {
    net.close();
  }
});
test("snapshot backpressure is bounded while control messages can pass", async () => {
  const { net } = await network();
  try {
    const conn = new Connection();
    conn.activate();
    conn.dataChannel.bufferedAmount = 300000;
    net.safeSend(conn, { type: "snapshot" });
    net.safeSend(conn, { type: "input" });
    net.safeSend(conn, { type: "room" });
    assert.deepEqual(conn.sent, [{ type: "room" }]);
    conn.dataChannel.bufferedAmount = 3000000;
    net.safeSend(conn, { type: "room" });
    assert.equal(conn.closed, true);
  } finally {
    net.close();
  }
});
test("closing a pending signaling registration cancels its timer promptly", async () => {
  class SilentPeer extends EventEmitter {
    destroy() {}
  }
  const client = new MultiplayerClient();
  const net = new BrowserPeerNetwork(client, client.generation);
  net.Peer = SilentPeer;
  const pending = net.register();
  net.close();
  await assert.rejects(pending, /cancelled/);
});

test("pending and open guest connections share the five-guest capacity limit", async () => {
  const { net } = await network();
  try {
    net.send({ type: "create", name: "HOST", map: "blockout" });
    const pending = Array.from({ length: 5 }, () => new Connection());
    for (const conn of pending) net.accept(conn);
    const excess = new Connection();
    net.accept(excess);
    assert.equal(excess.closed, true);
    assert.equal(net.pending.size, 5);
    pending[0].activate();
    assert.equal(net.pending.size, 4);
    assert.equal(net.peers.size, 1);
    net.stopLocal();
    assert.equal(net.pending.size, 0);
    assert.equal(net.peers.size, 0);
    assert.ok(pending.every((conn) => conn.closed));
  } finally {
    net.close();
  }
});
test("cloud ID collisions retry automatically without attaching the wrong peer", async () => {
  let attempts = 0;
  class CollidingPeer extends EventEmitter {
    constructor() {
      super();
      const collide = attempts++ < 2;
      queueMicrotask(() =>
        this.emit(
          collide ? "error" : "open",
          collide ? { type: "unavailable-id" } : "ok",
        ),
      );
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const client = new MultiplayerClient();
  const net = new BrowserPeerNetwork(client, client.generation);
  net.Peer = CollidingPeer;
  try {
    await net.register();
    assert.equal(attempts, 3);
    assert.equal(net.peer.destroyed, undefined);
    assert.equal(net.peer.listenerCount("connection"), 1);
  } finally {
    net.close();
  }
});

test("a stale failed connection cannot cancel a newer join or a live room", async () => {
  const { net, client } = await network();
  try {
    net.send({ type: "join", code: "123ABC", name: "GUEST" });
    const old = net.remote;
    net.joinFailed("not found");
    await Promise.resolve();
    net.send({ type: "join", code: "456DEF", name: "GUEST" });
    const current = net.remote;
    old.emit("error", new Error("late failure"));
    assert.equal(net.remote, current);
    assert.equal(net.role, "guest");
    client.patch({ room: { code: "456DEF" } });
    net.joinFailed("late discovery failure");
    assert.equal(net.remote, current);
    assert.equal(client.state.room.code, "456DEF");
  } finally {
    net.close();
  }
});
