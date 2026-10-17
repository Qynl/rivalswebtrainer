import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOVE_IMPACT_PROFILES,
  gloveImpactSound,
} from "../src/gloves/impact-sounds.js";
import { GLOVE_ROSTER } from "../src/gloves/catalog.js";
test("every glove selects a deliberate accepted-contact sound, retaining the classic Default palm and a genuine six-only Dice accent", () => {
  const names = new Set(GLOVE_ROSTER.map((g) => gloveImpactSound(g.key)));
  assert.ok(names.size >= 8);
  for (const name of names)
    assert.ok(name === "slapImpact" || GLOVE_IMPACT_PROFILES[name]);
  assert.equal(gloveImpactSound("default"), "slapImpact");
  assert.equal(gloveImpactSound("bull"), "slapHeavy");
  assert.equal(gloveImpactSound("snow"), "slapFrost");
  assert.equal(gloveImpactSound("dice", 6), "slapDiceHigh");
  for (const roll of [0, 1, 5, 7, "6", NaN])
    assert.equal(gloveImpactSound("dice", roll), "slapDice");
  assert.equal(gloveImpactSound("missing"), "slapImpact");
});
test("authored contact families use finite, bounded one-shots within their advertised spatial-bus lifetime and headroom", () => {
  const signatures = new Set();
  for (const p of Object.values(GLOVE_IMPACT_PROFILES)) {
    assert.ok(Object.isFrozen(p));
    assert.ok(p.duration > 0 && p.duration <= 0.3);
    assert.ok(p.noise.duration <= p.duration);
    let peak = p.noise.level;
    for (const t of p.tones) {
      assert.ok(t.duration > 0 && t.duration <= p.duration);
      assert.ok(t.frequency > 20 && t.frequency < 8000);
      assert.ok(t.end > 20 && t.end < 8000);
      assert.ok(["sine", "triangle"].includes(t.type));
      peak += t.level;
    }
    assert.ok(peak < 0.95);
    signatures.add(JSON.stringify(p));
  }
  assert.equal(signatures.size, Object.keys(GLOVE_IMPACT_PROFILES).length);
});

test("GameAudio renders each declared contact profile through owned tone/noise one-shots with the requested level", async () => {
  const { GameAudio } = await import("../src/audio.js");
  const audio = new GameAudio(),
    layers = [];
  audio.tone = (...args) => layers.push(["tone", ...args]);
  audio.noiseHit = (...args) => layers.push(["noise", ...args]);
  for (const [name, p] of Object.entries(GLOVE_IMPACT_PROFILES)) {
    layers.length = 0;
    audio.play(name, 0.4);
    assert.equal(layers.length, p.tones.length + 1);
    assert.deepEqual(layers[0], [
      "noise",
      p.noise.duration,
      p.noise.level * 0.4,
      p.noise.cutoff,
    ]);
    for (let i = 0; i < p.tones.length; i++) {
      const t = p.tones[i];
      assert.deepEqual(layers[i + 1], [
        "tone",
        t.frequency,
        t.duration,
        t.type,
        t.level * 0.4,
        t.end,
      ]);
    }
  }
  assert.doesNotThrow(() => audio.play("__proto__"));
  assert.doesNotThrow(() => audio.play("toString"));
});

test("spatial contact buses last through their exact source tails and release, rather than retaining the generic 800ms slot", async (t) => {
  const { GameAudio } = await import("../src/audio.js"),
    originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  let delay = 0,
    cleared = 0;
  globalThis.setTimeout = (_, ms) => {
    delay = ms;
    return { unref() {} };
  };
  globalThis.clearTimeout = () => cleared++;
  t.after(() => {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  });
  for (const [name, p] of Object.entries(GLOVE_IMPACT_PROFILES)) {
    let disconnected = 0;
    const node = () => ({
        pan: {},
        gain: {},
        frequency: {},
        connect(other) {
          return other;
        },
        disconnect() {
          disconnected++;
        },
      }),
      audio = new GameAudio();
    audio.ctx = {
      destination: {},
      createStereoPanner: node,
      createGain: node,
      createBiquadFilter: node,
    };
    audio.play = () => {};
    audio.playAt(
      name,
      new (await import("three")).Vector3(2, 1, 0),
      new (await import("three")).Vector3(0, 1, 0),
    );
    assert.equal(audio.spatialVoices.size, 1);
    assert.ok(delay >= p.duration * 1000);
    assert.ok(Math.abs(delay - (p.duration + 0.06) * 1000) < 0.001);
    audio.clearSpatial();
    assert.equal(audio.spatialVoices.size, 0);
    assert.equal(disconnected, 3);
  }
  assert.equal(cleared, Object.keys(GLOVE_IMPACT_PROFILES).length);
});
