import test from "node:test";
import assert from "node:assert/strict";
import {
  DamageCompass,
  relativeBearing,
  reticleGap,
  spatialMix,
} from "../src/combat-feedback.js";
import { GameAudio } from "../src/audio.js";
const origin = { x: 0, y: 1.6, z: 0 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("damage bearings are viewer-relative and distinguish front, back, left and right", () => {
  near(relativeBearing(origin, { x: 0, z: -10 }), 0);
  near(relativeBearing(origin, { x: 10, z: 0 }), Math.PI / 2);
  near(relativeBearing(origin, { x: -10, z: 0 }), -Math.PI / 2);
  near(Math.abs(relativeBearing(origin, { x: 0, z: 10 })), Math.PI);
  near(relativeBearing(origin, { x: -10, z: 0 }, Math.PI / 2), 0);
});
test("the four-slot compass follows camera turns, merges nearby sources, fades and clears", () => {
  const c = new DamageCompass();
  c.add(origin, { x: 8, z: 0 }, 12);
  c.add(origin, { x: 9, z: 0.1 }, 20);
  assert.equal(c.slots.filter((s) => s.life > 0).length, 1);
  c.update(0.1, origin, Math.PI / 2);
  near(Math.abs(c.slots[0].bearing), Math.PI - Math.atan(0.1 / 9));
  for (let i = 0; i < 20; i++)
    c.add(origin, { x: Math.sin(i) * 10, z: Math.cos(i) * 10 }, 35);
  assert.equal(c.slots.length, 4);
  c.update(1, origin, 0);
  assert.ok(c.slots.every((s) => s.life === 0));
  c.add(origin, { x: 2, z: -4 });
  c.clear();
  assert.ok(c.slots.every((s) => s.life === 0));
  c.add(origin, origin);
  c.add(origin, { x: NaN, z: 0 });
  assert.ok(c.slots.every((s) => s.life === 0));
});
test("reticle gap uses actual ADS/air spread, viewport projection and a bounded maximum", () => {
  const w = { spread: 0.01 },
    ground = reticleGap(w, true, false, 800, 90) - 4;
  near(reticleGap(w, false, false, 800, 90) - 4, ground * 1.5);
  near(reticleGap(w, true, true, 800, 90) - 4, ground * 0.25);
  near(reticleGap({ spread: 0 }, false, false, 800, 90), 4);
  assert.ok(reticleGap(w, true, false, 800, 110) < ground + 4);
  assert.equal(reticleGap({ spread: 100 }, false, false, 800, 90), 24);
});
test("spatial gunfire pans with heading, attenuates with distance and muffles through cover", () => {
  const right = spatialMix(origin, { x: 10, y: 1.6, z: 0 }),
    left = spatialMix(origin, { x: -10, y: 1.6, z: 0 });
  near(right.pan, -left.pan);
  assert.ok(right.pan > 0);
  assert.ok(spatialMix(origin, { x: 10, z: 0 }, Math.PI).pan < 0);
  assert.ok(spatialMix(origin, { x: 40, z: 0 }).gain < right.gain);
  const muffled = spatialMix(origin, { x: 10, y: 1.6, z: 0 }, 0, true);
  near(muffled.gain, right.gain * 0.32);
  assert.ok(muffled.cutoff < right.cutoff);
});
function audioHarness() {
  const audio = new GameAudio(),
    nodes = [];
  const node = () => {
    const n = {
      pan: {},
      gain: {},
      frequency: {},
      connect(other) {
        return other;
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    nodes.push(n);
    return n;
  };
  audio.ctx = {
    destination: {},
    createStereoPanner: node,
    createGain: node,
    createBiquadFilter: node,
  };
  audio.play = function () {
    assert.ok(this.output);
  };
  return { audio, nodes };
}
test("spatial audio has a 32-voice cap and releases every channel on clear", () => {
  const { audio, nodes } = audioHarness();
  for (let i = 0; i < 100; i++) audio.playAt("rifle", { x: 2, z: 1 }, origin);
  assert.equal(audio.spatialVoices.size, 32);
  assert.equal(nodes.length, 96);
  assert.equal(audio.output, null);
  audio.clearSpatial();
  assert.equal(audio.spatialVoices.size, 0);
  assert.ok(nodes.every((n) => n.disconnected));
  audio.volume = 0;
  audio.playAt("rifle", { x: 2, z: 0 }, origin);
  assert.equal(nodes.length, 96);
});
test("an interrupted spatial sound restores the routing channel and remains cleanable", () => {
  const { audio, nodes } = audioHarness(),
    previous = {};
  audio.output = previous;
  audio.play = () => {
    throw Error("test interruption");
  };
  assert.throws(() => audio.playAt("rifle", { x: 2, z: 0 }, origin));
  assert.equal(audio.output, previous);
  audio.clearSpatial();
  assert.ok(nodes.every((n) => n.disconnected));
});
