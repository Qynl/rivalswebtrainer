import test from "node:test";
import assert from "node:assert/strict";
import { WorkerLobby } from "../src/net/worker-lobby.js";
class FakeWorker {
  messages = [];
  postMessage(message) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage({ data });
  }
}
async function withWorker(run) {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    await run();
  } finally {
    if (original) globalThis.Worker = original;
    else delete globalThis.Worker;
  }
}
test("worker authority routes private tokens, updates host room state and owns its lifecycle", () =>
  withWorker(async () => {
    const lobby = new WorkerLobby("ABC123");
    const packets = [];
    let closed = 0;
    const token = lobby.connect(
      (p) => packets.push(p),
      "peer",
      () => closed++,
    );
    const worker = lobby.worker;
    worker.emit({ type: "ready" });
    await lobby.ready;
    worker.emit({
      type: "packet",
      token,
      packet: { type: "hello", id: "actual-player-id" },
    });
    assert.equal(packets[0].id, "actual-player-id");
    assert.notEqual(token, packets[0].id);
    worker.emit({
      type: "packet",
      token,
      packet: { type: "room", room: { code: "ABC123", phase: "playing" } },
    });
    assert.equal(lobby.rooms.get("ABC123").match, true);
    lobby.receive(token, { type: "ping" });
    assert.deepEqual(worker.messages.at(-1), {
      type: "receive",
      token,
      packet: { type: "ping" },
    });
    lobby.dispose();
    assert.equal(worker.terminated, true);
    assert.equal(closed, 1);
    assert.equal(lobby.clients.size, 0);
    assert.equal(lobby.rooms.size, 0);
    worker.emit({ type: "packet", token, packet: { type: "left" } });
    assert.equal(packets.length, 2);
  }));
test("pending worker startup cancels promptly instead of hanging a reconnect", () =>
  withWorker(async () => {
    const lobby = new WorkerLobby("ABC123");
    lobby.dispose();
    await assert.rejects(lobby.ready, /cancelled/);
  }));
test("worker facade bounds its client callbacks to six people", () =>
  withWorker(async () => {
    const lobby = new WorkerLobby("ABC123");
    try {
      for (let i = 0; i < 6; i++) assert.ok(lobby.connect(() => {}, "peer"));
      assert.equal(
        lobby.connect(() => {}, "peer"),
        null,
      );
    } finally {
      lobby.dispose();
    }
  }));
