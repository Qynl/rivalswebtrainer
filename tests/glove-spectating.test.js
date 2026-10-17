import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  spectatorTargets,
  spectatorTarget,
  cycleSpectator,
  spectatorInfo,
  updateSpectatorCamera,
} from "../src/gloves/spectating.js";
function fixture() {
  const p = { id: "p", team: 1, alive: false };
  const a = {
      id: "a",
      name: "ALLY A",
      team: 1,
      alive: true,
      x: 0,
      y: 0,
      z: 0,
      activeWeapon: "glove_snow",
    },
    b = { ...a, id: "b", name: "ALLY B", x: 10 };
  const enemy = { ...a, id: "enemy", team: 0, name: "RIVAL", ghostTime: 2 };
  return {
    player: p,
    entities: [p, enemy, a, b],
    yaw: 0.7,
    pitch: 0.1,
    camera: new THREE.PerspectiveCamera(),
    world: { boxes: [] },
  };
}
test("team-one elimination never follows the old hard-coded team-zero rival", () => {
  const g = fixture();
  assert.deepEqual(
    spectatorTargets(g).map((p) => p.id),
    ["a", "b"],
  );
  assert.equal(spectatorTarget(g).name, "ALLY A");
  assert.equal(spectatorInfo(g).count, 2);
});
test("manual teammate selection wraps and recovers when the selected teammate is eliminated", () => {
  const g = fixture();
  spectatorTarget(g);
  assert.equal(cycleSpectator(g, 1).id, "b");
  assert.equal(cycleSpectator(g, 1).id, "a");
  assert.equal(cycleSpectator(g, -1).id, "b");
  g.entities.find((p) => p.id === "b").alive = false;
  assert.equal(spectatorTarget(g).id, "a");
});
test("with no allies standing the death camera freezes rather than revealing an enemy or Ghost", () => {
  const g = fixture();
  g.entities.filter((e) => e.team === 1).forEach((e) => (e.alive = false));
  g.camera.position.set(7, 2, 3);
  updateSpectatorCamera(g, 1 / 60);
  assert.deepEqual(g.camera.position.toArray(), [7, 2, 3]);
  assert.equal(spectatorInfo(g), null);
  assert.equal(cycleSpectator(g, 1), null);
});
test("live players cannot select spectator targets or change their camera through this path", () => {
  const g = fixture();
  g.player.alive = true;
  assert.deepEqual(spectatorTargets(g), []);
  assert.equal(cycleSpectator(g, 1), null);
});
test("spectator boom retracts before a real wall without touching aim or first-person zoom", () => {
  const g = fixture();
  g.cameraZoom = 0;
  g.world.boxes = [
    { minX: 1, maxX: 2, minY: 0, maxY: 10, minZ: -10, maxZ: 10 },
  ];
  updateSpectatorCamera(g, 1 / 60);
  assert.ok(g.camera.position.x < 0.8);
  assert.ok(g.camera.position.x > 0);
  assert.equal(g.yaw, 0.7);
  assert.equal(g.pitch, 0.1);
  assert.equal(g.cameraZoom, 0);
  g.world.boxes = [];
  updateSpectatorCamera(g, 1 / 60);
  assert.ok(g.camera.position.x > 0.8);
  g.spectatorZoom = 2;
  g.spectatorFollow = null;
  updateSpectatorCamera(g, 1 / 60);
  assert.ok(g.camera.position.distanceTo(new THREE.Vector3(0, 2.1, 0)) < 2.2);
});
