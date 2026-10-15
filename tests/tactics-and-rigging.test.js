import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  chooseCover,
  followRoute,
  selectOpponent,
} from "../src/bot-tactics.js";
import { NavGrid } from "../src/physics.js";
import { solveTwoBone } from "../src/rigging.js";
import { createCharacter } from "../src/world.js";
import { Game } from "../src/game.js";

test("target selection prefers visible opponents without dropping a visible current target unnecessarily", () => {
  const a = { x: 0, z: 0 },
    near = { x: 0, z: 2 },
    far = { x: 0, z: 8 };
  assert.equal(selectOpponent(a, [near, far], (e) => e === far).target, far);
  assert.equal(selectOpponent(a, [near, far], () => false).visible, false);
  a.targetEntity = far;
  const other = { x: 0, z: 6 };
  assert.equal(selectOpponent(a, [other, far], () => true).target, far);
});
test("cover search returns a reachable occluded position, or holds an existing safe position", () => {
  const boxes = [
      { minX: -2, maxX: 2, minZ: -0.5, maxZ: 0.5, minY: 0, maxY: 3 },
    ],
    nav = new NavGrid(boxes, 20, 1, 20);
  const world = { boxes, nav },
    actor = { x: 5, y: 0, z: 3, radius: 0.38, height: 1.9 },
    threat = { x: 0, y: 0, z: -6 };
  const box = new THREE.Box3(
    new THREE.Vector3(-2, 0, -0.5),
    new THREE.Vector3(2, 3, 0.5),
  );
  const hidden = (p) => {
    const from = new THREE.Vector3(threat.x, 1.66, threat.z),
      to = new THREE.Vector3(p.x, (p.y || 0) + 1.66, p.z),
      distance = from.distanceTo(to);
    const ray = new THREE.Ray(from, to.sub(from).normalize()),
      hit = ray.intersectBox(box, new THREE.Vector3());
    return !!hit && hit.distanceTo(from) < distance;
  };
  assert.equal(hidden(actor), false);
  const result = chooseCover(actor, threat, world, hidden);
  assert.ok(result);
  assert.ok(hidden(result.point));
  assert.ok(result.path.length > 0);
  assert.ok(
    Math.hypot(
      result.path.at(-1).x - result.point.x,
      result.path.at(-1).z - result.point.z,
    ) < 1.5,
  );
  const sheltered = { ...actor, x: 0, z: 3 };
  const hold = chooseCover(sheltered, threat, world, hidden);
  assert.deepEqual(hold.path, []);
  assert.equal(
    chooseCover(actor, threat, world, () => false),
    null,
  );
});
test("route following consumes reached nodes and never divides by zero", () => {
  const actor = { x: 1, z: 2 },
    path = [
      { x: 1, z: 2 },
      { x: 1, z: 4 },
    ];
  assert.deepEqual(followRoute(actor, path), { x: 0, z: 1 });
  assert.equal(path.length, 1);
  actor.z = 4;
  assert.deepEqual(followRoute(actor, path), { x: 0, z: 0 });
  assert.equal(path.length, 0);
});
test("two-bone IK preserves bone lengths at reachable, unreachable and singular targets", () => {
  const shoulder = new THREE.Vector3(0.5, 0.4, 0),
    pole = new THREE.Vector3(1, -0.4, 0.3);
  for (const target of [
    new THREE.Vector3(0.2, 0.1, -0.3),
    new THREE.Vector3(20, 5, -5),
    shoulder.clone(),
    new THREE.Vector3(0.5, -0.2, 0),
  ]) {
    const { elbow, end } = solveTwoBone(shoulder, target, pole);
    assert.ok(Math.abs(elbow.distanceTo(shoulder) - 0.34) < 1e-7);
    assert.ok(Math.abs(elbow.distanceTo(end) - 0.4) < 1e-7);
    assert.ok([...elbow.toArray(), ...end.toArray()].every(Number.isFinite));
    if (
      shoulder.distanceTo(target) > 0.061 &&
      shoulder.distanceTo(target) < 0.739
    )
      assert.ok(end.distanceTo(target) < 1e-8);
  }
});
test("bot hands hold the actual rifle rig and hidden opponents do not drive head pitch", () => {
  const model = createCharacter(1),
    g = Object.create(Game.prototype);
  g.clock = 2;
  const e = {
    model,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    grounded: true,
    seed: 0,
    reload: 0,
    visible: true,
    targetEntity: { alive: true, x: 0, y: 0, z: -5 },
  };
  g.animateBot(e, 1 / 60);
  model.group.updateMatrixWorld(true);
  for (const [side, point] of [
    ["left", new THREE.Vector3(-0.12, -0.1, -0.17)],
    ["right", new THREE.Vector3(0, -0.13, -0.01)],
  ]) {
    const expected = model.parts.weaponRig.localToWorld(point),
      hand = model.parts[side + "Hand"].getWorldPosition(new THREE.Vector3());
    assert.ok(
      hand.distanceTo(expected) < 0.02,
      `${side}: ${hand.distanceTo(expected)}`,
    );
  }
  e.targetEntity.y = 4;
  e.visible = false;
  for (let i = 0; i < 60; i++) g.animateBot(e, 1 / 60);
  assert.ok(Math.abs(model.parts.head.rotation.x) < 1e-8);
  g.disposeVisual(model.group);
});

test("losing sight between decisions immediately clears visibility and reaction progress", () => {
  const g = Object.create(Game.prototype),
    actor = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      height: 1.9,
      radius: 0.38,
      alive: true,
      health: 100,
      team: 1,
      grounded: true,
      seed: 1,
      yaw: 0.7,
      pathTimer: 1,
      shootTimer: 1,
      decision: 0.3,
      reload: 0,
      sliding: 0,
      path: [],
      seen: 1,
      visible: true,
    },
    opponent = { x: 0, y: 0, z: -8, alive: true, team: 0, height: 1.9 };
  actor.targetEntity = opponent;
  Object.assign(g, {
    clock: 2,
    config: { difficulty: "regular", mode: 1 },
    entities: [actor, opponent],
    world: { boxes: [] },
    audio: { play() {} },
    hasLOS: () => false,
  });
  g.updateBot(actor, 1 / 120);
  assert.equal(actor.visible, false);
  assert.equal(actor.seen, 0);
  assert.equal(actor.yaw, 0.7);
});

test("ADS centres both the rear notch and front fibre sight without changing camera aim", async () => {
  const { WeaponAnimator } = await import("../src/animation.js");
  const { createViewModel } = await import("../src/world.js");
  const { WEAPONS } = await import("../src/data.js");
  for (const id of [
    "rifle",
    "smg",
    "pistol",
    "uzi",
    "shotgun",
    "shorty",
    "launcher",
  ]) {
    const model = createViewModel(id, WEAPONS[id]);
    model.scale.setScalar(0.78);
    const animator = new WeaponAnimator();
    for (let i = 0; i < 180; i++)
      animator.update(model, { dt: 1 / 60, aim: true, shake: false });
    model.updateMatrixWorld(true);
    for (const name of ["adsPoint", "frontSight"]) {
      assert.ok(model.userData[name], `${id}: ${name}`);
      const point = model.localToWorld(model.userData[name].clone());
      assert.ok(
        Math.abs(point.x) < 1e-5 && Math.abs(point.y) < 1e-5,
        `${id}: ${name} ${point.toArray()}`,
      );
    }
    Game.prototype.disposeVisual.call({}, model);
  }
});
