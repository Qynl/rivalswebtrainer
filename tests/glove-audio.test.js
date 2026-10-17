import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  playGloveAbilityAudio,
  playGloveImpactAudio,
  gloveAbilitySound,
} from "../src/gloves/audio.js";
function fixture() {
  const calls = [],
    p = { id: "self", alive: true, x: 0, y: 0, z: 0 };
  return {
    calls,
    player: p,
    state: "playing",
    yaw: 0.7,
    eye: (e) => new THREE.Vector3(e.x, e.y + 1.6, e.z),
    hasLOS: () => true,
    audio: {
      volume: 1,
      play: (...args) => calls.push(["local", ...args]),
      playAt: (...args) => calls.push(["spatial", ...args]),
    },
  };
}
test("own confirmed abilities use the centered cue while distant bot/remote casts use world position, pan and real cover", () => {
  const g = fixture();
  playGloveAbilityAudio(g, {
    player: "self",
    glove: "glove_default",
    position: [0, 0.6, 0],
  });
  assert.equal(g.calls[0][0], "local");
  assert.equal(g.calls[0][1], "slapBlast");
  g.hasLOS = () => false;
  playGloveAbilityAudio(g, {
    player: "bot",
    glove: "glove_stun",
    position: [12, 0.6, 3],
  });
  const call = g.calls[1];
  assert.equal(call[0], "spatial");
  assert.equal(call[1], "gloveEMP");
  assert.deepEqual(call[2].toArray(), [12, 0.6, 3]);
  assert.equal(call[4], 0.7);
  assert.equal(call[6], true);
});
test("undefined identities cannot turn an NPC cast into the local full-volume cue", () => {
  const g = fixture();
  delete g.player.id;
  playGloveAbilityAudio(g, { glove: "glove_default", position: [2, 0.6, 0] });
  assert.equal(g.calls[0][0], "spatial");
});
test("teleports create quiet positional departure/arrival cues, not map-wide playback", () => {
  const g = fixture();
  playGloveAbilityAudio(g, {
    player: "other",
    glove: "glove_flash",
    origin: [0, 0.6, 0],
    position: [0, 0.6, 7],
  });
  assert.equal(g.calls.length, 2);
  assert.ok(g.calls.every((c) => c[0] === "spatial"));
  assert.equal(gloveAbilitySound("ghost"), "gloveGhost");
});
test("a spectator listens at the actual camera with its current heading without changing saved player aim", () => {
  const g = fixture();
  g.player.alive = false;
  g.camera = new THREE.PerspectiveCamera();
  g.camera.position.set(10, 4, 3);
  g.camera.lookAt(10, 4, 2);
  playGloveImpactAudio(g, { position: [12, 1, 3] }, {}, {});
  const call = g.calls[0];
  assert.equal(call[3], g.camera.position);
  assert.ok(Math.abs(call[4]) < 1e-9);
  assert.equal(g.yaw, 0.7);
});
test("mute, pause, headless contexts and malformed coordinates cannot produce spatial voices", () => {
  for (const patch of [
    { headless: true },
    { state: "paused" },
    { audio: { volume: 0 } },
  ]) {
    const g = { ...fixture(), ...patch };
    playGloveAbilityAudio(g, {
      player: "other",
      glove: "glove_default",
      position: [0, 1, 2],
    });
    assert.equal(g.calls.length, 0);
  }
  const g = fixture();
  playGloveAbilityAudio(g, {
    player: "other",
    glove: "glove_default",
    position: [Infinity, 0, 0],
  });
  assert.equal(g.calls.length, 0);
});

test("real swing starts are local for the player and positional for offline bots without claiming hits", async () => {
  const { playGloveSwingAudio } = await import("../src/gloves/audio.js");
  const g = fixture();
  playGloveSwingAudio(g, g.player);
  playGloveSwingAudio(g, { x: 4, y: 0, z: 2 });
  assert.equal(g.calls[0][0], "local");
  assert.equal(g.calls[0][1], "slapSwing");
  assert.equal(g.calls[1][0], "spatial");
  assert.equal(g.calls[1][1], "slapSwing");
  assert.equal(g.matchStats, undefined);
});
