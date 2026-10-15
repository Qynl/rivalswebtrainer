import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  initBotActions,
  tickBotActions,
  botCanShoot,
  botDash,
  botGuard,
  botSlide,
  botJump,
  botSwing,
  equipBotWeapon,
  decideBotAction,
  moveBotVelocity,
  botTravelClear,
} from "../src/bot-actions.js";
import { Game } from "../src/game.js";
import { createCharacter } from "../src/world.js";
import { moveBody, verticalStep } from "../src/physics.js";
import { WEAPONS } from "../src/data.js";
const dt = 1 / 120,
  world = { boxes: [], bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } };
function actor(id = "scythe") {
  const e = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: -10,
    radius: 0.38,
    height: 1.9,
    grounded: true,
    alive: true,
    jumps: 0,
    team: 1,
    health: 100,
    yaw: 0,
    seed: 0.5,
    reload: 0,
    ammo: 20,
  };
  initBotActions(e, id);
  return e;
}
const context = (e, extra = {}) => ({
  world,
  target: { x: 0, y: 0, z: -16 },
  distance: 16,
  visible: true,
  reacted: true,
  reaction: 0.12,
  skill: 3,
  underFire: false,
  defensive: false,
  wish: { x: 0, z: -1 },
  speed: 12.5,
  ...extra,
});

test("Scythe quick ability is a real directional dash with a 3-second cooldown, not a melee hit", () => {
  const e = actor();
  assert.equal(botDash(e, { x: 1, z: 0 }, world), true);
  assert.equal(e.vx, 28);
  assert.equal(e.vz, 0);
  assert.equal(e.vy, 3);
  assert.equal(e.grounded, false);
  assert.equal(e.dashCooldown, 3);
  assert.equal(e.activeWeapon, "rifle");
  assert.equal(e.ammo, 20);
  assert.equal(e.meleePending, undefined);
  assert.equal(e.actionCounts.quickAbilities, 1);
  assert.equal(botCanShoot(e), false);
  assert.equal(botDash(e, { x: 0, z: -1 }, world), false);
  tickBotActions(e, 0.4);
  assert.equal(botCanShoot(e), true);
  assert.equal(botDash(e, { x: 0, z: -1 }, world), false);
  tickBotActions(e, 2.61);
  assert.equal(botDash(e, { x: 0, z: -1 }, world), true);
});
test("equipped Scythe uses the same dash but does not fake a quick-switch or consume ammo", () => {
  const e = actor();
  e.activeWeapon = "scythe";
  assert.ok(botDash(e, { x: 0, z: -1 }, world));
  assert.equal(e.quickMeleeTime, 0);
  assert.equal(e.actionCounts.quickAbilities, undefined);
  assert.equal(e.ammo, 20);
});
test("dash impulses survive steering updates, but a blocked wall cannot regenerate momentum", () => {
  const e = actor();
  botDash(e, { x: 1, z: 0 }, world);
  moveBotVelocity(e, { x: -1, z: 0 }, 12.2, dt, world);
  assert.equal(e.vx, 28);
  const wall = { minX: 1, maxX: 1.2, minZ: -20, maxZ: 20, minY: 0, maxY: 5 };
  moveBody(e, 5, 0, [wall]);
  assert.ok(e.x < 0.63);
  assert.ok(Math.abs(e.vx) < 1e-8);
  moveBotVelocity(e, { x: 1, z: 0 }, 12.2, dt, { boxes: [wall] });
  assert.ok(Math.abs(e.vx) < 1e-8);
});
test("wide-capsule travel probes reject frontal walls, map bounds and rotated slabs", () => {
  const e = actor(),
    wall = { minX: -4, maxX: 4, minZ: -3, maxZ: -2.8, minY: 0, maxY: 4 };
  assert.equal(botDash(e, { x: 0, z: -1 }, { boxes: [wall] }), false);
  assert.equal(e.dashCooldown, 0);
  assert.equal(
    botTravelClear(
      e,
      { x: 1, z: 0 },
      { boxes: [], bounds: { minX: -1, maxX: 1, minZ: -10, maxZ: 10 } },
      6,
    ),
    false,
  );
  const rotated = {
    cx: 0,
    cz: -3,
    angle: Math.PI / 4,
    halfX: 4,
    halfZ: 0.15,
    minY: 0,
    maxY: 4,
  };
  assert.equal(
    botTravelClear(e, { x: 0, z: -1 }, { boxes: [rotated] }, 6),
    false,
  );
});
test("Katana quick guard has the actual duration/cooldown and never fires or swings during guard", () => {
  const e = actor("katana");
  assert.ok(botGuard(e));
  assert.equal(e.deflectTime, 1.1);
  assert.equal(e.deflectCooldown, 3.5);
  assert.equal(e.quickMeleeTime, 1.1);
  assert.equal(e.ammo, 20);
  assert.equal(botCanShoot(e), false);
  assert.equal(botSwing(e), false);
  assert.equal(botGuard(e), false);
  tickBotActions(e, 1.11);
  assert.equal(botCanShoot(e), true);
  assert.equal(botGuard(e), false);
  tickBotActions(e, 2.4);
  assert.ok(botGuard(e));
});
for (const id of ["fists", "knife"])
  test(`${id} has no invented F secondary`, () => {
    const e = actor(id);
    assert.equal(botGuard(e), false);
    assert.equal(botDash(e, { x: 0, z: -1 }, world), false);
    assert.equal(e.quickMeleeTime, 0);
  });
test("slide lowers the actual hitbox; slide-jump cancels the slide and preserves launch momentum", () => {
  const e = actor();
  assert.ok(botSlide(e, { x: 0, z: -1 }, world, true));
  assert.equal(e.height, 1.15);
  assert.equal(e.slideTime, 0.36);
  assert.equal(e.slideCooldown, 0.5);
  for (let i = 0; i < 18; i++) {
    tickBotActions(e, dt);
    moveBotVelocity(e, { x: 0, z: -1 }, 12.2, dt, world);
    moveBody(e, e.vx * dt, e.vz * dt, world.boxes);
    verticalStep(e, dt, world.boxes);
  }
  assert.equal(e.actionCounts.slideJumps, 1);
  assert.equal(e.slideTime, 0);
  assert.equal(e.sliding, 0);
  assert.equal(e.grounded, false);
  assert.ok(e.vy > 10);
  assert.ok(Math.hypot(e.vx, e.vz) > 16);
  assert.equal(e.height, 1.9);
});
test("low ceilings prevent a queued slide-jump and standing back up into geometry", () => {
  const e = actor(),
    ceiling = { minX: -8, maxX: 8, minZ: -20, maxZ: 5, minY: 1.3, maxY: 2 };
  assert.ok(botSlide(e, { x: 0, z: -1 }, { boxes: [ceiling] }, true));
  for (let i = 0; i < 45; i++) {
    tickBotActions(e, dt);
    moveBotVelocity(e, { x: 0, z: -1 }, 12.2, dt, { boxes: [ceiling] });
  }
  assert.equal(e.grounded, true);
  assert.equal(e.actionCounts.slideJumps, undefined);
  assert.equal(e.height, 1.15);
});
test("Fists extra jump is only available while equipped, once per airtime", () => {
  const e = actor("fists");
  e.grounded = false;
  e.jumps = 1;
  e.jumpAge = 0.3;
  e.vy = 2;
  assert.equal(botJump(e, world, true), false);
  e.activeWeapon = "fists";
  assert.ok(botJump(e, world, true));
  assert.equal(e.vy, 10.8);
  assert.equal(e.jumps, 2);
  assert.equal(botJump(e, world, true), false);
});
test("equipping melee and windup have real attack locks, and quick-secondary never starts a swing", () => {
  const e = actor();
  assert.ok(equipBotWeapon(e, "scythe"));
  assert.equal(botSwing(e), false);
  assert.equal(botCanShoot(e), false);
  tickBotActions(e, 0.19);
  assert.ok(botSwing(e));
  assert.equal(e.meleePending.remaining, 0.12);
  assert.equal(e.meleeCooldown, 0.7);
  assert.equal(tickBotActions(e, 0.1), null);
  const hit = tickBotActions(e, 0.021);
  assert.equal(hit.id, "scythe");
  assert.equal(tickBotActions(e, 0.01), null);
  assert.equal(equipBotWeapon(e, "rifle"), false);
});
test("the planner guards only a perceived, reacted-to threat and uses quick dash for an open gap", () => {
  const k = actor("katana");
  decideBotAction(k, context(k, { reacted: false, underFire: true }));
  assert.equal(k.deflectTime, 0);
  k.actionThinkTime = 0;
  assert.equal(decideBotAction(k, context(k, { underFire: true })), "guard");
  assert.equal(k.activeWeapon, "rifle");
  const s = actor();
  assert.equal(decideBotAction(s, context(s)), "dash");
  assert.equal(s.actionCounts.quickAbilities, 1);
});
test("the planner switches into close melee before attacking and prioritises a Fists air combo", () => {
  const e = actor("knife");
  const c = context(e, { distance: 2, target: { x: 0, y: 0, z: -2 } });
  assert.equal(decideBotAction(e, c), "equip");
  assert.equal(e.activeWeapon, "knife");
  tickBotActions(e, 0.3);
  assert.equal(decideBotAction(e, c), "swing");
  const fists = actor("fists");
  fists.activeWeapon = "fists";
  fists.grounded = false;
  fists.jumps = 1;
  fists.jumpAge = 0.3;
  fists.vy = 2;
  fists.slideJumpCombo = true;
  assert.equal(decideBotAction(fists, context(fists)), "doubleJump");
  assert.equal(fists.jumps, 2);
});
function combatGame(e, target, boxes = []) {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    entities: [e, target],
    world: { boxes, solidMeshes: [] },
    clock: 1,
    ray: new THREE.Raycaster(),
    smokes: [],
    particles() {},
    audio: { play() {} },
    events: { update() {}, hurt() {}, kill() {} },
    range: true,
    damage(v, amount) {
      v.health -= amount;
    },
  });
  return g;
}
test("melee windup resolves against current range, a committed cone and real line of sight", () => {
  const e = actor(),
    target = {
      x: 0,
      y: 0,
      z: -2,
      height: 1.9,
      alive: true,
      health: 100,
      team: 0,
      yaw: 0,
    };
  e.activeWeapon = "scythe";
  const g = combatGame(e, target);
  g.resolveBotMelee(e, { id: "scythe", yaw: 0 });
  assert.equal(target.health, 65);
  target.z = -8;
  g.resolveBotMelee(e, { id: "scythe", yaw: 0 });
  assert.equal(target.health, 65);
  target.z = 2;
  g.resolveBotMelee(e, { id: "scythe", yaw: 0 });
  assert.equal(target.health, 65);
  target.z = -2;
  g.hasLOS = () => false;
  g.resolveBotMelee(e, { id: "scythe", yaw: 0 });
  assert.equal(target.health, 65);
  e.alive = false;
  g.hasLOS = () => true;
  g.resolveBotMelee(e, { id: "scythe", yaw: 0 });
  assert.equal(target.health, 65);
});
test("Knife backstabs use facing while guards do not magically block melee", () => {
  const e = actor("knife"),
    target = {
      x: 0,
      y: 0,
      z: -2,
      height: 1.9,
      alive: true,
      health: 200,
      team: 0,
      yaw: 0,
      deflectTime: 1,
    };
  e.activeWeapon = "knife";
  const g = combatGame(e, target);
  g.resolveBotMelee(e, { id: "knife", yaw: 0 });
  assert.equal(target.health, 50);
  target.yaw = Math.PI;
  g.resolveBotMelee(e, { id: "knife", yaw: 0 });
  assert.equal(target.health, 10);
});
test("NPC guard reflects frontal bullets with ownership intact, but not rear attacks", () => {
  const guard = actor("katana"),
    shooter = {
      x: 0,
      y: 0,
      z: -8,
      height: 1.9,
      alive: true,
      health: 100,
      team: 0,
      yaw: Math.PI,
    };
  guard.z = 0;
  guard.vz = 0;
  botGuard(guard);
  const g = combatGame(guard, shooter);
  g.tracer = () => {};
  g.visualMuzzle = (e, p) => p;
  g.bullet(shooter, new THREE.Vector3(0, 1, -8), new THREE.Vector3(0, 0, 1), {
    damage: 13,
    head: 1.65,
    range: 100,
  });
  assert.equal(guard.health, 100);
  assert.ok(shooter.health < 100);
  assert.equal(guard.actionCounts.deflections, 1);
  shooter.z = 8;
  g.bullet(shooter, new THREE.Vector3(0, 1, 8), new THREE.Vector3(0, 0, -1), {
    damage: 13,
    head: 1.65,
    range: 100,
  });
  assert.equal(guard.health, 87);
});
test("NPC melee visuals are cached, hide the rifle during quick abilities and restore it", () => {
  const e = actor("katana"),
    model = createCharacter(1);
  e.model = model;
  const g = Object.create(Game.prototype);
  g.clock = 1;
  botGuard(e);
  g.animateBot(e, dt);
  const socket = model.parts.meleeSocket;
  assert.ok(socket.visible);
  assert.equal(socket.userData.weaponId, "katana");
  assert.equal(model.parts.gun.visible, false);
  assert.equal(model.parts.muzzleFlash.visible, false);
  for (let i = 0; i < 30; i++) g.animateBot(e, dt);
  assert.equal(model.parts.meleeSocket, socket);
  tickBotActions(e, 1.2);
  g.animateBot(e, dt);
  assert.equal(socket.visible, false);
  assert.equal(model.parts.gun.visible, false);
  assert.equal(model.parts.onlineSocket.visible, true);
  g.disposeVisual(model.group);
});

test("rifle ammo is refilled only on completion; switching to melee cancels a reload without granting ammo", () => {
  const e = actor(),
    g = Object.create(Game.prototype);
  e.ammo = 0;
  g.fireBotRifle(e, null, {}, 1);
  assert.equal(e.ammo, 0);
  assert.equal(e.reload, WEAPONS.rifle.reload);
  tickBotActions(e, 0.4);
  assert.equal(e.ammo, 0);
  assert.ok(equipBotWeapon(e, "scythe"));
  assert.equal(e.reload, 0);
  tickBotActions(e, 2);
  assert.equal(e.ammo, 0);
  assert.ok(equipBotWeapon(e, "rifle"));
  tickBotActions(e, 0.2);
  g.fireBotRifle(e, null, {}, 1);
  tickBotActions(e, WEAPONS.rifle.reload + 0.01);
  assert.equal(e.ammo, WEAPONS.rifle.mag);
  assert.ok(botCanShoot(e));
});
test("a hidden opponent elevation cannot trigger a Fists double jump", () => {
  const e = actor("fists");
  e.activeWeapon = "fists";
  e.grounded = false;
  e.jumps = 1;
  e.jumpAge = 0.4;
  e.vy = 2;
  decideBotAction(
    e,
    context(e, { visible: false, target: { x: 0, y: 5, z: -16 } }),
  );
  assert.equal(e.actionCounts.doubleJumps, undefined);
});

test("a perceived close firefight prompts a real evasive jump, but not on cooldown", () => {
  const e = actor("knife");
  assert.equal(
    decideBotAction(e, context(e, { distance: 8, underFire: true })),
    "jump",
  );
  assert.equal(e.grounded, false);
  assert.equal(e.actionCounts.jumps, 1);
  e.grounded = true;
  e.actionThinkTime = 0;
  decideBotAction(e, context(e, { distance: 8, underFire: true }));
  assert.equal(e.actionCounts.jumps, 1);
});
