import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
import { encodeSnapshot, decodeSnapshot } from "../src/net/snapshot-codec.js";
import { THROW_DURATION, THROW_RELEASE } from "../src/throwables.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
import { setup, packet } from "./helpers/match.js";
for (const id of ["grenade", "molotov", "smoke", "flashbang"]) {
  test(`G quick ${id} reserves one utility, releases from the hand, preserves gun/aim and returns`, () => {
    const { m, g } = setup(id);
    try {
      g.cooldown = 1.2; // A slow primary recovery must not block G.
      g.reloadTime = 0.7;
      g.aiming = true;
      const yaw = g.yaw,
        pitch = g.pitch,
        rounds = g.ammunition[0].mag;
      assert.equal(g.quickUtility(), true);
      assert.equal(g.slot, 0);
      assert.equal(g.quickModelId, id);
      assert.equal(g.quickUtilityTime, THROW_DURATION);
      assert.equal(g.ammunition[3].mag, 1);
      assert.equal(g.ammunition[0].mag, rounds);
      assert.equal(g.reloadTime, 0);
      assert.equal(g.cooldown, 1.2);
      assert.equal(g.quickUtility(), false);
      assert.equal(g.meleeAbility(true), false);
      assert.equal(g.firePlayer(), undefined);
      assert.equal(g.projectiles.length, 0);
      g.updateThrow(THROW_RELEASE - 0.001);
      assert.equal(g.projectiles.length, 0);
      g.updateThrow(0.002);
      assert.equal(g.projectiles.length, 1);
      assert.equal(g.projectiles[0].id, id);
      assert.ok(g.projectiles[0].vel.z < -20);
      assert.equal(g.throwReleased, true);
      g.updateThrow(1);
      assert.equal(g.projectiles.length, 1);
      g.updateSupport(THROW_DURATION);
      assert.equal(g.quickUtilityTime, 0);
      assert.equal(g.quickModelId, null);
      assert.equal(g.slot, 0);
      assert.equal(g.yaw, yaw);
      assert.equal(g.pitch, pitch);
    } finally {
      m.dispose();
    }
  });
}
test("quick Medkit uses utility ammo, heals 25 after the channel, not immediately, and preserves the gun", () => {
  const { m, g } = setup("medkit");
  try {
    g.player.health = 80;
    g.ammunition[0].mag = 7;
    assert.equal(g.quickUtility(), true);
    assert.equal(g.healTime, 0.8);
    assert.equal(g.ammunition[3].mag, 0);
    assert.equal(g.ammunition[0].mag, 7);
    g.updateSupport(0.79);
    assert.equal(g.player.health, 80);
    g.updateSupport(0.011);
    assert.equal(g.player.health, 105);
    assert.equal(g.quickUtilityTime, 0);
    assert.equal(g.slot, 0);
    assert.equal(g.quickUtility(), false);
  } finally {
    m.dispose();
  }
});
test("full-health and empty utility rejection do not interrupt reload, ADS or Bow charge", () => {
  for (const id of ["medkit", "grenade"]) {
    const { m, g } = setup(id);
    try {
      if (id === "grenade") g.ammunition[3].mag = 0;
      g.reloadTime = 0.7;
      g.aiming = true;
      g.bowCharge = 0.6;
      assert.equal(g.quickUtility(), false);
      assert.equal(g.reloadTime, 0.7);
      assert.equal(g.aiming, true);
      assert.equal(g.bowCharge, 0.6);
      assert.equal(g.ammunition[0].mag, WEAPONS.rifle.mag);
    } finally {
      m.dispose();
    }
  }
});
test("damage interrupts G Medkit without healing/refunding or leaving the gun hidden", () => {
  const { m, g, other } = setup("medkit");
  try {
    g.player.health = 70;
    g.quickUtility();
    m.damage(g.player, 10, other.player);
    g.updateSupport(1);
    assert.equal(g.player.health, 60);
    assert.equal(g.healTime, 0);
    assert.equal(g.quickUtilityTime, 0);
    assert.equal(g.ammunition[3].mag, 0);
  } finally {
    m.dispose();
  }
});
test("switching before release refunds once, switching after release never duplicates utility", () => {
  for (const released of [false, true]) {
    const { m, g } = setup();
    try {
      g.quickUtility();
      if (released) g.updateThrow(THROW_RELEASE);
      g.equip(1);
      g.updateThrow(1);
      g.cancelThrow();
      g.cancelThrow();
      assert.equal(g.ammunition[3].mag, released ? 1 : 2);
      assert.equal(g.projectiles.length, released ? 1 : 0);
      assert.equal(g.quickUtilityTime, 0);
      assert.equal(g.quickModelId, null);
    } finally {
      m.dispose();
    }
  }
});
test("G and manual slot-4 throws share recovery and finite inventory", () => {
  const { m, g } = setup("flashbang");
  try {
    g.equip(3);
    g.cooldown = 0;
    assert.equal(g.quickUtility(), true);
    assert.equal(g.cooldown, WEAPONS.flashbang.interval);
    g.updateThrow(THROW_RELEASE);
    g.updateSupport(THROW_DURATION);
    const before = g.ammunition[3].mag;
    g.firePlayer();
    assert.equal(g.ammunition[3].mag, before);
    g.clock = 1;
    g.cooldown = 0;
    g.firePlayer();
    assert.equal(g.ammunition[3].mag, 0);
    assert.equal(g.quickUtility(), false);
  } finally {
    m.dispose();
  }
});
test("G is ignored while dead, paused, selecting, guarding, melee-winding or already throwing", () => {
  for (const change of [
    (g) => (g.player.alive = false),
    (g) => (g.state = "paused"),
    (g) => (g.selectingLoadout = true),
    (g) => (g.deflectTime = 1),
    (g) => (g.quickMeleeTime = 0.2),
    (g) => (g.playerMeleePending = {}),
    (g) => (g.pendingThrow = {}),
  ]) {
    const { m, g } = setup();
    try {
      change(g);
      assert.equal(g.quickUtility(), false);
      assert.equal(g.ammunition[3].mag, 2);
    } finally {
      g.pendingThrow = null;
      m.dispose();
    }
  }
});
test("range G is inexhaustible but still respects shared utility recovery", () => {
  const { m, g } = setup();
  try {
    g.range = true;
    assert.equal(g.quickUtility(), true);
    assert.equal(g.ammunition[3].mag, 2);
    g.updateThrow(THROW_RELEASE);
    g.updateSupport(THROW_DURATION);
    assert.equal(g.quickUtility(), false);
    g.clock = 1.01;
    assert.equal(g.quickUtility(), true);
    assert.equal(g.ammunition[3].mag, 2);
  } finally {
    m.dispose();
  }
});
test("online utility action is validated, acknowledged once and cannot be replayed or used while paused", () => {
  const { m, g } = setup();
  try {
    m.input("p0", packet(1, [{ id: 1, type: "utility" }]));
    assert.equal(g.ammunition[3].mag, 1);
    m.input("p0", packet(2, [{ id: 1, type: "utility" }]));
    assert.equal(g.ammunition[3].mag, 1);
    m.input("p0", packet(3, [{ id: 2, type: "utility" }], { paused: true }));
    assert.equal(g.ammunition[3].mag, 1);
    assert.equal(g.lastAction, 2);
    g.updateThrow(THROW_RELEASE);
    assert.equal(g.projectiles.length, 1);
  } finally {
    m.dispose();
  }
});
test("compact binary snapshots preserve quick utility without expanding the packet or mislabeling a gun shot", () => {
  for (const id of ["grenade", "medkit"]) {
    const { m, g } = setup(id);
    try {
      g.player.health = 90;
      g.quickUtility();
      const snap = m.snapshot(),
        bytes = encodeSnapshot(snap),
        decoded = decodeSnapshot(
          bytes,
          new Map(snap.players.map((p) => [p.index, p])),
        ),
        self = decoded.players[0];
      assert.equal(bytes.length, 23 + 94 * 2);
      assert.ok(
        Math.abs(self.quickUtility - (id === "medkit" ? 0.8 : 0.48)) < 0.001,
      );
      assert.equal(self.slot, 0);
      assert.equal(self.weapon, "rifle");
      assert.equal(self.shot, -1);
      assert.equal(self.ammo[3].mag, id === "medkit" ? 0 : 1);
      assert.equal(self.quickMelee, 0);
    } finally {
      m.dispose();
    }
  }
});
test("visual quick utility hides/restores the selected model and releases its bounded cache on cleanup", () => {
  const { m, g } = setup();
  try {
    g.headless = false;
    g.viewModel = createViewModel("rifle", WEAPONS.rifle);
    g.weaponScene.add(g.viewModel);
    g.quickUtility();
    assert.equal(g.quickModel.userData.weaponId, "grenade");
    assert.equal(g.viewModel.visible, false);
    let disposed = 0;
    g.quickModel.traverse((o) =>
      o.geometry?.addEventListener("dispose", () => disposed++),
    );
    g.updateSupport(THROW_DURATION);
    assert.equal(g.quickModel, null);
    assert.equal(g.viewModel.visible, true);
    assert.equal(disposed, 0); // retained for the next press, not reallocated each time
    assert.equal(g.quickModels.size, 1);
    g.disposeQuickModels();
    assert.equal(g.quickModels.size, 0);
    assert.ok(disposed > 0);
    Game.prototype.disposeVisual.call(g, g.viewModel);
  } finally {
    m.dispose();
  }
});
test("remote operators show quick utility, then their original gun, with no ghost muzzle flash", () => {
  const model = createCharacter(1, "UTILITY"),
    e = {
      netId: "remote",
      activeWeapon: "rifle",
      meleeId: "knife",
      utilityId: "molotov",
      quickUtilityTime: 0.3,
    };
  updateBotWeapon(model, e, 10);
  assert.equal(model.parts.onlineSocket.userData.id, "molotov");
  assert.equal(model.parts.gun.visible, false);
  e.quickUtilityTime = 0;
  updateBotWeapon(model, e, 10.5);
  assert.equal(model.parts.onlineSocket.userData.id, "rifle");
  Game.prototype.disposeVisual.call({}, model.group);
});

test("death before quick release clears the pending action, never spawns a ghost grenade and never refunds", () => {
  const { m, g, other } = setup();
  try {
    g.quickUtility();
    m.damage(g.player, 200, other.player);
    assert.equal(g.quickUtilityTime, 0);
    assert.equal(g.quickModelId, null);
    assert.equal(g.pendingThrow, null);
    assert.equal(g.ammunition[3].mag, 1);
    g.updateThrow(1);
    assert.equal(g.projectiles.length, 0);
    assert.equal(
      m.snapshot().players.find((p) => p.id === g.player.id).quickUtility,
      0,
    );
  } finally {
    m.dispose();
  }
});

test("repeated F/G actions reuse the same two model/geometry sets and never retain old loadout items", () => {
  const { m, g } = setup();
  try {
    g.headless = false;
    g.viewModel = createViewModel("rifle", WEAPONS.rifle);
    g.weaponScene.add(g.viewModel);
    g.showQuickAction("knife", 0.4);
    const knife = g.quickModel;
    g.clearQuickMelee();
    g.showQuickAction("grenade", 0.48, true);
    const grenade = g.quickModel,
      geometries = [];
    grenade.traverse((o) => {
      if (o.geometry) geometries.push(o.geometry);
    });
    g.clearQuickMelee();
    for (let i = 0; i < 100; i++) {
      g.showQuickAction(i % 2 ? "knife" : "grenade", 0.4, !(i % 2));
      assert.equal(g.quickModel, i % 2 ? knife : grenade);
      assert.equal(g.quickModels.size, 2);
      g.clearQuickMelee();
      assert.equal(g.weaponScene.children.length, 1);
    }
    const after = [];
    grenade.traverse((o) => {
      if (o.geometry) after.push(o.geometry);
    });
    assert.deepEqual(after, geometries);
    let released = 0;
    grenade.traverse((o) =>
      o.geometry?.addEventListener("dispose", () => released++),
    );
    g.loadout[3] = "smoke";
    g.showQuickAction("smoke", 0.48, true);
    assert.ok(released > 0);
    assert.equal(g.quickModels.has("grenade"), false);
    assert.equal(g.quickModels.size, 2);
    g.disposeQuickModels();
    assert.equal(g.weaponScene.children.length, 1);
    assert.equal(g.quickModels.size, 0);
    Game.prototype.disposeVisual.call(g, g.viewModel);
  } finally {
    m.dispose();
  }
});
