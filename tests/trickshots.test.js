import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
import { BOW_DRAW_TIME } from "../src/combat-rules.js";
import { createCharacter, createViewModel } from "../src/world.js";
import { WeaponAnimator } from "../src/animation.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const actor = (team, z = 0, yaw = 0) => ({
  x: 0,
  y: 0,
  z,
  yaw,
  team,
  height: 1.9,
  radius: 0.38,
  health: 150,
  maxHealth: 150,
  alive: true,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: true,
});
function harness(primary = "rpg") {
  const g = Object.create(Game.prototype),
    p = actor(0);
  p.isPlayer = true;
  Object.assign(g, {
    headless: true,
    state: "playing",
    player: p,
    entities: [p],
    loadout: [primary, "pistol", "knife", "grenade"],
    slot: 0,
    ammunition: [
      { mag: 5, reserve: 20 },
      { mag: 12, reserve: 60 },
      { mag: Infinity, reserve: Infinity },
      { mag: 1, reserve: 0 },
    ],
    cooldown: 1.25,
    quickMeleeTime: 0,
    deflectTime: 0,
    reloadTime: 0,
    healTime: 0,
    clock: 0,
    keys: new Set(),
    yaw: 0,
    pitch: 0,
    ray: new THREE.Raycaster(),
    scene: new THREE.Scene(),
    world: { boxes: [], solidMeshes: [] },
    effects: [],
    fires: [],
    smokes: [],
    projectiles: [],
    matchStats: { shots: 0, hits: 0, kills: 0, deaths: 0 },
    audio: { play() {}, noiseHit() {} },
    events: {
      update() {},
      hit() {},
      hurt() {},
      kill() {},
      banner() {},
      confirmKill() {},
    },
    particles() {},
    checkRound() {},
    hasLOS: () => true,
    showQuickMelee(id, duration) {
      this.quickModelId = id;
      this.quickMeleeTime = duration;
    },
    range: false,
  });
  return g;
}
for (const id of ["rpg", "launcher", "grenade"])
  test(`${id} launch is health-free but still damages a rival`, () => {
    const g = harness(),
      enemy = actor(1, -1);
    g.entities.push(enemy);
    g.explosion(v(0, 0.2, -0.5), g.player, id);
    assert.equal(g.player.health, 150);
    assert.equal(g.player.vy, 15);
    assert.equal(g.player.grounded, false);
    assert.ok(enemy.health < 150);
    assert.equal(g.matchStats.deaths, 0);
  });
test("self-owned damage and self flashes are ignored; enemy damage still applies", () => {
  const g = harness();
  g.damage(g.player, 999, g.player);
  assert.equal(g.player.health, 150);
  g.explosion(v(0, 1, -1), g.player, "flashbang");
  assert.ok(!(g.blindTime > 0));
  g.damage(g.player, 20, actor(1));
  assert.equal(g.player.health, 130);
});
test("standing in your own molotov is safe without protecting enemies", () => {
  const g = harness(),
    enemy = actor(1, 0.5);
  g.entities.push(enemy);
  g.explosion(v(0, 0, 0), g.player, "molotov");
  g.updateProjectiles(0.31);
  assert.equal(g.player.health, 150);
  assert.equal(enemy.health, 142);
});
for (const rear of [false, true])
  test(`F quick knife uses real windup, no gun ammo and ${rear ? "rear-only 150" : "front-only 40"} damage`, () => {
    const g = harness(),
      e = actor(1, -2, rear ? 0 : Math.PI);
    g.entities.push(e);
    const ammo = g.ammunition[0].mag;
    assert.ok(g.meleeAbility(true));
    assert.equal(g.slot, 0);
    assert.equal(g.ammunition[0].mag, ammo);
    assert.equal(e.health, 150);
    assert.equal(g.meleeAbility(true), false);
    g.updatePlayerMelee(0.1);
    assert.equal(e.health, 150);
    g.updatePlayerMelee(0.01);
    assert.equal(e.health, rear ? 0 : 110);
    g.updatePlayerMelee(1);
    assert.equal(e.health, rear ? 0 : 110);
    assert.equal(g.matchStats.shots, 0);
  });
test("quick knife cancels on slot change, target leaving range, or cover", () => {
  for (const mode of ["slot", "range", "cover"]) {
    const g = harness(),
      e = actor(1, -2);
    g.entities.push(e);
    g.meleeAbility(true);
    if (mode === "slot") g.slot = 1;
    if (mode === "range") e.z = -20;
    if (mode === "cover") g.hasLOS = () => false;
    g.updatePlayerMelee(0.11);
    assert.equal(e.health, 150);
  }
});
test("F does not reset recovery through repeated presses or consume pending reload ammo", () => {
  const g = harness();
  g.reloadTime = 2;
  g.healTime = 2;
  g.meleeAbility(true);
  assert.equal(g.reloadTime, 0);
  assert.equal(g.healTime, 0);
  g.updatePlayerMelee(0.11);
  g.quickMeleeTime = 0;
  assert.equal(g.meleeAbility(true), false);
  g.updateSupport(0.56);
  g.clock += 0.56;
  assert.ok(g.meleeAbility(true));
  assert.equal(g.ammunition[0].mag, 5);
});
test("Bow full draw visibly bends both limbs, pulls the actual nock/hand and keeps string endpoints attached", () => {
  const m = createViewModel("bow", WEAPONS.bow),
    a = new WeaponAnimator();
  a.update(m, { dt: 1 / 60, draw: 0, ammo: 1 });
  const rest = m.userData.drawHand.position.z;
  a.update(m, { dt: 1 / 60, draw: BOW_DRAW_TIME, ammo: 1 });
  assert.ok(m.userData.bowUpper.rotation.x > 0);
  assert.ok(m.userData.bowLower.rotation.x < 0);
  assert.ok(m.userData.drawHand.position.z > rest + 0.3);
  assert.ok(
    Math.abs(
      m.userData.string.geometry.attributes.position.getZ(1) -
        (-0.54 + m.userData.arrow.position.z),
    ) < 1e-6,
  );
  a.update(m, { dt: 1 / 60, draw: 0, ammo: 0, reloading: true, reload: 0.1 });
  assert.equal(m.userData.arrow.visible, false);
  Game.prototype.disposeVisual.call({}, m);
});
test("every weapon receives the new finish pass; sustained rendering does not allocate new geometry", () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    const m = createViewModel(id, w),
      a = new WeaponAnimator(),
      before = new Set();
    m.traverse((o) => {
      if (o.geometry) before.add(o.geometry);
    });
    assert.equal(m.userData.finishRevision, "machined-v2", id);
    for (let i = 0; i < 20; i++)
      a.update(m, {
        dt: 1 / 120,
        time: i / 120,
        shotAge: i / 120,
        ammo: 1,
        draw: 0,
      });
    m.traverse((o) => {
      if (o.geometry) assert.ok(before.has(o.geometry), id);
    });
    Game.prototype.disposeVisual.call({}, m);
  }
});
test("new operator skins preserve skeleton anchors, team separation, real held rifles and bounded detail", () => {
  const a = createCharacter(1, "A"),
    b = createCharacter(1, "B");
  assert.equal(a.group.userData.characterStyle, "striker-v2");
  assert.equal(a.parts.visor.parent, a.parts.head);
  assert.equal(a.parts.leftKnee.parent, a.parts.leftLeg);
  assert.equal(a.parts.onlineSocket.userData.id, "rifle");
  assert.equal(a.parts.gun.visible, false);
  let meshes = 0;
  a.group.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
    }
  });
  assert.ok(meshes < 100, meshes);
  Game.prototype.disposeVisual.call({}, a.group);
  Game.prototype.disposeVisual.call({}, b.group);
});

test("local shot sequence is not reset by an authoritative statistics correction", () => {
  const g = harness("rifle");
  g.cooldown = 0;
  g.firePlayer();
  assert.equal(g.shotSequence, 1);
  g.matchStats.shots = 0;
  g.cooldown = 0;
  g.firePlayer();
  assert.equal(g.shotSequence, 2);
});
