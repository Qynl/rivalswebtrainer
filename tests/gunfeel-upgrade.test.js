import { setup } from "./helpers/match.js";
import * as THREE from "three";
import test from "node:test";
import assert from "node:assert/strict";
import { WEAPONS } from "../src/data.js";
import { WEAPON_FEEL, shotEnvelope } from "../src/weapon-feel.js";
import { operatorPose } from "../src/operator-pose.js";
import { Game } from "../src/game.js";
import { MultiplayerSession } from "../src/net/session.js";
import { createCharacter, createViewModel } from "../src/world.js";
import { WeaponAnimator } from "../src/animation.js";

for (const [id, w] of Object.entries(WEAPONS).filter(([, w]) => w.slot < 2)) {
  test(`${id}: distinct bounded impulse, visible gun kick, return to rest`, () => {
    const feel = WEAPON_FEEL[id];
    assert.ok(feel && feel.kick > 0 && feel.pitch > 0);
    assert.equal(shotEnvelope(0, id), 1);
    assert.equal(shotEnvelope(1, id), 0);
    assert.equal(shotEnvelope(-1, id), 0);
    assert.equal(shotEnvelope(NaN, id), 0);
    const model = createViewModel(id, w),
      animator = new WeaponAnimator();
    const state = { dt: 1 / 120, shotAge: 10, shake: false, ammo: w.mag };
    for (let i = 0; i < 180; i++) animator.update(model, state);
    const rest = model.position.z;
    animator.update(model, { ...state, shotAge: 0, shotSequence: 1 });
    assert.ok(
      model.position.z > rest + feel.kick * 0.7,
      `${id} did not kick back`,
    );
    assert.ok(model.rotation.x > feel.pitch * 0.7);
    for (let i = 0; i < 180; i++) animator.update(model, state);
    assert.ok(Math.abs(model.position.z - rest) < 0.002);
    Game.prototype.disposeVisual.call({}, model);
  });
}
function session(id = "rifle") {
  const w = WEAPONS[id],
    calls = [];
  const self = {
    id: "me",
    slot: w.slot,
    shot: -1,
    weapon: id,
    ammo: [{ mag: 30 }, { mag: 12 }],
  };
  const game = {
    clock: 10,
    state: "playing",
    loadout: [id, id],
    slot: w.slot,
    player: { alive: true },
    presentShot: (...args) => calls.push(args),
  };
  const net = Object.create(MultiplayerSession.prototype);
  Object.assign(net, {
    game,
    id: "me",
    latest: { players: [self] },
    predictedShots: [],
    feedbackReadyAt: 0,
    lastReceived: performance.now() / 1000,
    lastSelfShot: -1,
  });
  return { net, game, self, calls };
}
test("online trigger predicts presentation immediately, and the authoritative echo never doubles it", () => {
  const { net, calls, self } = session("sniper");
  assert.equal(net.predictShot(), true);
  assert.equal(calls.length, 1);
  assert.equal(net.predictShot(), false);
  net.confirmShot({ ...self, shot: 5 }, { time: 5.01 });
  net.confirmShot({ ...self, shot: 5 }, { time: 5.02 });
  assert.equal(calls.length, 1);
  assert.equal(net.predictedShots.length, 0);
  assert.equal(
    self.ammo[0].mag,
    30,
    "presentation cannot spend authoritative ammo",
  );
});
test("confirmed unpredicted shots still show feedback (burst tails and released bow)", () => {
  const { net, calls, self } = session("bow");
  assert.equal(net.predictShot(), false);
  net.confirmShot({ ...self, shot: 5 }, { time: 5.01 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "bow");
});
for (const condition of [
  "empty",
  "reload",
  "paused",
  "selection",
  "switch",
  "utility",
  "stale",
  "dead",
]) {
  test(`online presentation does not invent a shot while ${condition}`, () => {
    const { net, game, self, calls } = session();
    if (condition === "empty") self.ammo[0].mag = 0;
    if (condition === "reload") game.reloadTime = 1;
    if (condition === "paused") game.state = "paused";
    if (condition === "selection") game.selectingLoadout = true;
    if (condition === "switch") game.switchTime = 0.1;
    if (condition === "utility") game.quickUtilityTime = 0.4;
    if (condition === "stale") net.lastReceived -= 1;
    if (condition === "dead") game.player.alive = false;
    assert.equal(net.predictShot(), false);
    assert.equal(calls.length, 0);
  });
}
test("operator expression is bounded and never mutates physics; new rig has articulated feet/lids", () => {
  const actor = {
    x: 1,
    y: 0,
    z: 3,
    yaw: 0.4,
    vx: 7,
    vz: 3,
    grounded: true,
    hitReact: 0.11,
  };
  const before = structuredClone(actor);
  for (let i = 0; i < 1000; i++) {
    const pose = operatorPose(actor, i / 60, Math.sin(i));
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.blink >= 0 && pose.blink <= 1);
    assert.ok(Math.abs(pose.leftFoot) <= 0.22);
  }
  assert.deepEqual(actor, before);
  const model = createCharacter(1, "RIVAL");
  for (const name of ["leftFoot", "rightFoot", "leftLid", "rightLid"])
    assert.ok(model.parts[name]?.isGroup);
  assert.equal(model.group.userData.rigRevision, 3);
  assert.ok(model.parts.head.position.y < 0.65);
  Game.prototype.disposeVisual.call({}, model.group);
});

test("switching from a recoiling Sniper does not delay another gun's feedback", () => {
  const { net, game, self, calls } = session("sniper");
  assert.equal(net.predictShot(), true);
  game.loadout[1] = "pistol";
  game.slot = self.slot = 1;
  assert.equal(net.predictShot(), true);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["sniper", "pistol"],
  );
});
test("your own authoritative tracer and wall impacts are no longer skipped online", () => {
  const { net, game } = session();
  let traces = 0,
    impacts = 0;
  game.player = {};
  game.visualMuzzle = (_, fallback) => fallback;
  game.tracer = () => traces++;
  game.combatFX = { impact: () => impacts++ };
  net.lastEvent = 0;
  net.processEvents([
    { id: 1, type: "trace", owner: "me", a: [0, 1, 0], b: [0, 1, -5], team: 0 },
    { id: 2, type: "impact", position: [0, 1, -5], normal: [0, 0, 1] },
  ]);
  assert.equal(traces, 1);
  assert.equal(impacts, 1);
  net.processEvents([
    { id: 1, type: "trace", owner: "me", a: [0, 1, 0], b: [0, 1, -5] },
  ]);
  assert.equal(traces, 1, "duplicate confirmed effects are ignored");
});
test("body edge shots use the same slightly more forgiving silhouette without changing aim", () => {
  const source = { team: 0, alive: true },
    target = { x: 0.43, y: 0, z: -5, height: 1.9, alive: true, team: 1 };
  let damage = 0;
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    ray: new THREE.Raycaster(),
    world: { solidMeshes: [] },
    entities: [source, target],
    damage: (_, amount) => {
      damage += amount;
    },
    tracer: () => {},
    visualMuzzle: (_, from) => from,
  });
  const dir = new THREE.Vector3(0, 0, -1);
  assert.equal(
    g.bullet(source, new THREE.Vector3(0, 1, 0), dir, WEAPONS.rifle),
    true,
  );
  assert.ok(damage > 0);
  assert.deepEqual(dir.toArray(), [0, 0, -1]);
});

test("projectile silhouette bounds are symmetric on the left and right body edge", () => {
  for (const x of [-0.43, 0.43]) {
    const { m, g, other } = setup();
    try {
      m.world.solidMeshes = [];
      m.world.boxes = [];
      Object.assign(g.player, { x: 0, y: 0, z: 2, vx: 0, vy: 0, vz: 0 });
      Object.assign(other.player, { x, y: 0, z: -4, vx: 0, vy: 0, vz: 0 });
      g.spawnProjectile(
        g.player,
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, -1),
        "bow",
        0.8,
      );
      for (let i = 0; i < 40; i++) m.step(1 / 120);
      assert.ok(other.player.health < 150, `projectile missed body edge ${x}`);
    } finally {
      m.dispose();
    }
  }
});
