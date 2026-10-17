import test from "node:test";
import assert from "node:assert/strict";
import { releaseEndedNodes } from "../src/audio-node-lifetime.js";
test("ended oscillator/sample graphs explicitly release every owned node exactly once", () => {
  const nodes = Array.from({ length: 3 }, () => ({
    count: 0,
    disconnect() {
      this.count++;
    },
  }));
  releaseEndedNodes(...nodes);
  const done = nodes[0].onended;
  done();
  done();
  assert.deepEqual(
    nodes.map((n) => n.count),
    [1, 1, 1],
  );
  assert.equal(nodes[0].onended, null);
});
test("a detached or closing source cannot prevent gain/filter cleanup", () => {
  let gains = 0;
  const source = {
      disconnect() {
        throw Error("already detached");
      },
    },
    gain = {
      disconnect() {
        gains++;
      },
    },
    filter = {
      disconnect() {
        gains++;
      },
    };
  releaseEndedNodes(source, gain, filter);
  source.onended();
  assert.equal(gains, 2);
  assert.equal(source.onended, null);
});

test("GameAudio oscillator and noise one-shots wire the real source-ended cleanup hook", async () => {
  const { GameAudio } = await import("../src/audio.js");
  const audio = new GameAudio(),
    nodes = [];
  const make = () => {
    const param = () => ({
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    });
    const n = {
      gain: param(),
      frequency: param(),
      disconnected: false,
      connect(other) {
        return other;
      },
      disconnect() {
        this.disconnected = true;
      },
      start() {},
      stop() {},
    };
    nodes.push(n);
    return n;
  };
  audio.ctx = {
    currentTime: 1,
    destination: {},
    createGain: make,
    createOscillator: make,
    createBufferSource: make,
    createBiquadFilter: make,
  };
  audio.noise = {};
  audio.tone(440, 0.1);
  const oscillator = nodes[0];
  assert.equal(typeof oscillator.onended, "function");
  oscillator.onended();
  assert.ok(nodes.every((n) => n.disconnected));
  nodes.length = 0;
  audio.noiseHit(0.1, 0.2);
  const sample = nodes[0];
  assert.equal(typeof sample.onended, "function");
  sample.onended();
  assert.ok(nodes.every((n) => n.disconnected));
});
