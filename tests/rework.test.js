import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MouseLook } from "../src/input.js";
import { Game } from "../src/game.js";
import { WEAPONS, MAPS } from "../src/data.js";
import { ARENA } from "../src/arena-layout.js";
import { EXTRA_COURTS } from "../src/map-layouts.js";
import { NavGrid } from "../src/physics.js";
import { WeaponAnimator } from "../src/animation.js";
import { createViewModel } from "../src/world.js";
import {
  createThrownModel,
  animateThrown,
  createFirePatch,
  animateFire,
} from "../src/throwables.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const warm = () => {
  const m = new MouseLook();
  m.reset(-1000);
  for (let i = 0; i < 5; i++) m.accept(4, 2, i * 8);
  return m;
};
test("normal pointer deltas remain immediate and proportional", () => {
  const m = warm();
  for (const [x, y] of [
    [3, -2],
    [12, 8],
    [-40, 8],
  ])
    assert.deepEqual(m.accept(x, y, 40), { x, y });
});
test("isolated moderate horizontal, vertical and diagonal outliers are discarded", () => {
  for (const [x, y] of [
    [170, 0],
    [0, -170],
    [150, 110],
  ]) {
    const m = warm();
    assert.equal(m.accept(x, y, 40), null);
    assert.deepEqual(m.accept(5, 2, 48), { x: 5, y: 2 });
  }
});
test("a genuine sustained fast flick resumes without replaying the suspect packet", () => {
  const m = warm();
  assert.equal(m.accept(180, 20, 40), null);
  assert.deepEqual(m.accept(190, 22, 48), { x: 190, y: 22 });
});
test("stale queued input cannot move aim after a browser stall", () => {
  const m = warm();
  assert.equal(m.accept(70, 20, 300, 50), null);
  assert.deepEqual(m.accept(8, 3, 310, 310), { x: 8, y: 3 });
});
test("idle recenter packets and pointer reacquisition clear outlier history", () => {
  const m = warm();
  assert.equal(m.accept(140, 0, 800), null);
  m.reset(1000);
  assert.equal(m.accept(140, 0, 1001), null);
  assert.deepEqual(m.accept(6, 2, 1002), { x: 6, y: 2 });
  assert.ok(m.samples.length <= 5);
});
test("invalid mouse times/deltas never contaminate valid input", () => {
  const m = warm();
  for (const [x, y, time] of [
    [NaN, 2, 40],
    [2, Infinity, 40],
    [1, 2, NaN],
  ])
    assert.equal(m.accept(x, y, time), null);
  assert.deepEqual(m.accept(4, 1, 50), { x: 4, y: 1 });
});
function game(id = "molotov") {
  const g = Object.create(Game.prototype),
    owner = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      height: 1.9,
      radius: 0.38,
      alive: true,
      health: 100,
      team: 0,
      isPlayer: true,
    };
  Object.assign(g, {
    player: owner,
    scene: new THREE.Scene(),
    weaponScene: new THREE.Scene(),
    world: { solidMeshes: [], boxes: [] },
    ray: new THREE.Raycaster(),
    entities: [owner],
    projectiles: [],
    effects: [],
    fires: [],
    smokes: [],
    audio: { play() {}, noiseHit() {} },
    events: { update() {}, hit() {}, kill() {}, hurt() {}, banner() {} },
    loadout: ["rifle", "pistol", "katana", id],
    slot: 3,
    ammunition: [{ mag: 20 }, { mag: 12 }, { mag: Infinity }, { mag: 1 }],
    cooldown: 0,
    reloadTime: 0,
    deflectTime: 0,
    quickMeleeTime: 0,
    healTime: 0,
    kick: 0,
    clock: 10,
    state: "playing",
    yaw: 0,
    pitch: 0,
    range: false,
    matchStats: { shots: 0, hits: 0, kills: 0, deaths: 0 },
    particles() {},
  });
  return g;
}
test("each utility flies as its detailed model with centered finite bounds and no hands", () => {
  for (const id of ["grenade", "molotov", "smoke", "flashbang"]) {
    const m = createThrownModel(id);
    assert.equal(m.userData.utility, id);
    const bounds = new THREE.Box3().setFromObject(m),
      center = bounds.getCenter(v());
    assert.ok(center.length() < 1e-6);
    let meshes = 0;
    m.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
      }
      assert.ok(!o.userData.hand);
    });
    assert.ok(meshes >= 2);
    Game.prototype.disposeVisual.call({}, m);
  }
});
test("a committed throw consumes once, winds up, then releases exactly once", () => {
  const g = game();
  g.firePlayer();
  assert.equal(g.ammunition[3].mag, 0);
  assert.equal(g.projectiles.length, 0);
  assert.ok(g.pendingThrow);
  g.firePlayer();
  assert.equal(g.matchStats.shots, 1);
  g.updateThrow(0.1);
  assert.equal(g.projectiles.length, 0);
  g.updateThrow(0.06);
  assert.equal(g.projectiles.length, 1);
  assert.equal(g.throwReleased, true);
  g.updateThrow(1);
  assert.equal(g.projectiles.length, 1);
  assert.equal(g.projectiles[0].mesh.userData.utility, "molotov");
  g.disposeVisual(g.projectiles[0].mesh);
});
test("cancelling before release refunds once; range cancellation never inflates ammunition", () => {
  const g = game("grenade");
  g.firePlayer();
  g.cancelThrow();
  g.cancelThrow();
  assert.equal(g.ammunition[3].mag, 1);
  assert.equal(g.projectiles.length, 0);
  g.range = true;
  g.firePlayer();
  g.cancelThrow();
  assert.equal(g.ammunition[3].mag, 1);
});
test("switching weapons cancels a held throw and restores utility ammunition", () => {
  const g = game();
  g.firePlayer();
  g.equip(0);
  assert.equal(g.pendingThrow, null);
  assert.equal(g.ammunition[3].mag, 1);
  assert.equal(g.slot, 0);
  g.disposeVisual(g.viewModel);
});
test("death before release cancels the projectile rather than throwing from a dead actor", () => {
  const g = game();
  g.firePlayer();
  g.player.alive = false;
  g.updateThrow(0.2);
  assert.equal(g.pendingThrow, null);
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.ammunition[3].mag, 0);
});
test("throw release uses the current aim and inherits bounded horizontal momentum", () => {
  const g = game();
  g.firePlayer();
  g.yaw = Math.PI / 2;
  g.player.vx = 10;
  g.updateThrow(0.16);
  const p = g.projectiles[0];
  assert.ok(p.vel.x < 0);
  assert.ok(Math.abs(p.vel.x + 18.5) < 1e-8);
  assert.ok(p.pos.x < 0);
  g.disposeVisual(p.mesh);
});
test("world utility tumbles with stable finite transforms while its flame flickers", () => {
  const mesh = createThrownModel("molotov"),
    p = { mesh, spin: v(5, 2, 3) };
  animateThrown(p, 0.1, 10);
  assert.ok(mesh.rotation.x > 0.4);
  assert.ok(mesh.userData.item.userData.pilotFlame.scale.y > 0);
  assert.ok(mesh.matrix.elements.every(Number.isFinite));
  Game.prototype.disposeVisual.call({}, mesh);
});
test("released item disappears from the held hand, returns only with available ammunition", () => {
  const m = createViewModel("molotov", WEAPONS.molotov),
    a = new WeaponAnimator();
  a.update(m, { dt: 1 / 60, throwing: 0.4, ammo: 0, throwReleased: false });
  assert.equal(m.userData.throwableBody.visible, true);
  a.update(m, { dt: 1 / 60, throwing: 0.2, ammo: 1, throwReleased: true });
  assert.equal(m.userData.throwableBody.visible, false);
  a.update(m, { dt: 1 / 60, throwing: 0, ammo: 0 });
  assert.equal(m.userData.throwableBody.visible, false);
  a.update(m, { dt: 1 / 60, throwing: 0, ammo: 1 });
  assert.equal(m.userData.throwableBody.visible, true);
  Game.prototype.disposeVisual.call({}, m);
});
test("throw animation changes the model, not the input state or aim", () => {
  const m = createViewModel("grenade", WEAPONS.grenade),
    a = new WeaponAnimator(),
    state = { dt: 1 / 60, throwing: 0.31, ammo: 1, throwReleased: false },
    before = { ...state };
  a.update(m, state);
  assert.deepEqual(state, before);
  assert.ok(Math.abs(m.rotation.z) > 0.1);
  Game.prototype.disposeVisual.call({}, m);
});
test("molotov fire is a bounded animated mesh group whose child resources are disposed", () => {
  const g = game();
  g.explosion(v(0, 0.2, -3), g.player, "molotov");
  const effect = g.effects[0];
  assert.equal(effect.mesh.name, "molotov-fire");
  assert.equal(effect.mesh.children.length, 2);
  let disposed = 0;
  effect.mesh.traverse((o) =>
    o.geometry?.addEventListener("dispose", () => disposed++),
  );
  animateFire(effect.mesh, 10, 0.3);
  assert.equal(effect.mesh.userData.fireUniforms.fade.value, 0.5);
  g.updateEffects(6);
  assert.equal(disposed, 2);
  assert.equal(g.effects.length, 0);
});
test("molotov fire rests on a raised hit surface and damages at that elevation only", () => {
  const g = game(),
    platform = new THREE.Mesh(
      new THREE.BoxGeometry(6, 2, 6),
      new THREE.MeshBasicMaterial(),
    );
  platform.position.y = 1;
  platform.updateMatrixWorld();
  g.world.solidMeshes = [platform];
  g.explosion(v(0, 2.2, 0), g.player, "molotov");
  assert.ok(Math.abs(g.fires[0].pos.y - 2) < 1e-8);
  let hits = 0;
  g.entities = [
    { ...g.player, isPlayer: false, team: 1, y: 2 },
    { ...g.player, isPlayer: false, team: 1, y: 0 },
  ];
  g.damage = () => hits++;
  g.hasLOS = () => true;
  g.updateProjectiles(0.1);
  assert.equal(hits, 1);
  g.disposeVisual(g.effects[0].mesh);
  g.disposeVisual(platform);
});
test("new map roster adds two genuinely different authored layouts", () => {
  assert.equal(MAPS.length, 5);
  for (const id of ["foundry", "courtyard"])
    assert.ok(MAPS.find((m) => m.id === id));
  assert.notDeepEqual(EXTRA_COURTS.foundry.cover, EXTRA_COURTS.courtyard.cover);
});
test("Arena rebalance sits between the cramped/towering and previous large layouts", () => {
  assert.equal(ARENA.width, 30);
  assert.equal(ARENA.depth, 38);
  assert.equal(ARENA.wallHeight, 14);
  assert.equal(ARENA.rampRise, 4.4);
  assert.ok(
    ARENA.width * ARENA.depth > 832 && ARENA.width * ARENA.depth < 1344,
  );
});
test("all court decks meet ramps and perimeter without leaving inaccessible gaps", () => {
  for (const a of [ARENA, ...Object.values(EXTRA_COURTS)]) {
    assert.ok(
      Math.abs(a.platformZ + a.platformLength / 2 - a.depth / 2) < 1e-8,
    );
    assert.ok(
      Math.abs(
        a.rampZ + a.rampLength / 2 - (a.platformZ - a.platformLength / 2),
      ) < 1e-8,
    );
    assert.ok(a.rampX + a.rampWidth / 2 + 0.4 < a.width / 2);
  }
});
test("navigation excludes capsule-clipping cells alongside the tall part of a ramp", () => {
  const b = {
      minX: 8.7,
      maxX: 12.3,
      minZ: 10.2,
      maxZ: 16.6,
      minY: 0,
      maxY: 4.4,
      ramp: { axis: "z", direction: 1, rise: 4.4 },
    },
    nav = new NavGrid([b], 30, 0.8, 38);
  assert.equal(nav.blocked[nav.index(8.6, 11)], 1);
  assert.equal(nav.blocked[nav.index(9.4, 11)], 0);
  assert.equal(nav.blocked[nav.index(8.6, 10.2)], 0);
});
