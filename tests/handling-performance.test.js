import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  reloadHandling,
  ReloadCues,
  MUZZLE_PROFILES,
  animateMuzzle,
} from "../src/weapon-handling.js";
import { presentationEqual } from "../src/presentation-equality.js";
import { createStore } from "../src/ui-store.js";
import { aimArm, solveTwoBone } from "../src/rigging.js";
import { WeaponAnimator } from "../src/animation.js";
import { createViewModel, createCharacter } from "../src/world.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
import { Game } from "../src/game.js";
import { CombatFX } from "../src/combat-fx.js";
import { WEAPONS } from "../src/data.js";

for (const [id, w] of Object.entries(WEAPONS).filter(([, w]) => w.slot < 2)) {
  test(`${id}: new handling stays finite through reload and restores every moving magazine`, () => {
    const model = createViewModel(id, w),
      animator = new WeaponAnimator();
    const baseline = { dt: 1 / 120, shotAge: 10, shake: false, ammo: w.mag };
    const original = structuredClone(w);
    for (let i = 0; i <= 120; i++) {
      const pose = reloadHandling(id, i / 120);
      assert.ok(
        Object.values(pose)
          .filter((v) => typeof v === "number")
          .every(Number.isFinite),
      );
      animator.update(model, { ...baseline, reload: i / 120, reloading: true });
      assert.ok(
        [...model.position.toArray(), ...model.quaternion.toArray()].every(
          Number.isFinite,
        ),
      );
    }
    for (let i = 0; i < 180; i++) animator.update(model, baseline);
    for (const mag of model.userData.magazines ||
      (model.userData.magazine ? [model.userData.magazine] : []))
      assert.ok(mag.position.distanceTo(mag.userData.restPosition) < 1e-9);
    assert.equal(reloadHandling(id, 0).cant, 0);
    assert.equal(reloadHandling(id, 1).reach, 0);
    assert.deepEqual(w, original, "cosmetics cannot rewrite weapon stats");
    Game.prototype.disposeVisual.call({}, model);
  });
}
test("weapon-specific muzzle profiles decay deterministically, expire and never move the muzzle socket", () => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.set(0.24, -0.16, -1.2);
  const position = mesh.position.clone();
  for (const [id, profile] of Object.entries(MUZZLE_PROFILES)) {
    animateMuzzle(mesh, id, 0.001, 12);
    assert.equal(mesh.visible, true);
    const width = mesh.scale.x;
    animateMuzzle(mesh, id, profile.duration * 0.8, 12);
    assert.ok(mesh.scale.x < width);
    assert.deepEqual(mesh.position, position);
    assert.equal(mesh.material.color.getHex(), profile.color);
    animateMuzzle(mesh, id, profile.duration, 12);
    assert.equal(mesh.visible, false);
    animateMuzzle(mesh, id, 0, 12, false);
    assert.equal(mesh.visible, false);
  }
  assert.ok(MUZZLE_PROFILES.sniper.length > MUZZLE_PROFILES.pistol.length * 2);
  assert.ok(MUZZLE_PROFILES.shotgun.width > MUZZLE_PROFILES.smg.width * 2);
  animateMuzzle(mesh, "rifle", NaN);
  assert.equal(mesh.visible, false);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
test("remote reload uses the same magazine phases, moves the support grip and resets on cancellation", () => {
  for (const id of ["rifle", "dualpistols", "revolver", "shotgun", "sniper"]) {
    const m = createCharacter(1),
      e = { activeWeapon: id, reload: 0, fireFlash: 0 };
    updateBotWeapon(m, e, 5);
    const restGrip = m.parts.botLeftGrip.clone();
    e.reload = WEAPONS[id].reload * 0.55;
    updateBotWeapon(m, e, 5);
    assert.ok(m.parts.botLeftGrip.distanceTo(restGrip) > 0.01);
    const weapon = m.parts.onlineSocket.userData.weapon;
    if (weapon.userData.magazine)
      assert.ok(
        weapon.userData.magazine.position.y <
          weapon.userData.magazine.userData.restPosition.y - 0.2,
      );
    e.reload = 0;
    updateBotWeapon(m, e, 5);
    assert.ok(m.parts.botLeftGrip.distanceTo(restGrip) < 1e-9);
    assert.equal(weapon.rotation.z, 0);
    Game.prototype.disposeVisual.call({}, m.group);
  }
});
test("reload audio follows progress, never repeats under stale state and cancels without delayed timers", () => {
  const cues = new ReloadCues();
  assert.equal(cues.sample("rifle", 2, 2, 0), null);
  assert.equal(cues.sample("rifle", 1.6, 2, 0.4), "reload-release");
  assert.equal(cues.sample("rifle", 1.7, 2, 0.5), null);
  assert.equal(cues.sample("rifle", 0.6, 2, 1.4), "reload-seat");
  assert.equal(cues.sample("rifle", 0.2, 2, 1.8), "reload-ready");
  assert.equal(cues.sample("rifle", 0, 2, 2), null);
  assert.equal(
    cues.sample("pistol", 0.1, 2, 3),
    null,
    "late first snapshot cannot play missed stages",
  );
  assert.equal(cues.sample("rifle", 2, 2, 0), null, "round rewind resets cues");
  assert.equal(cues.sample("rifle", 0, 2, 0.2), null);
  assert.equal(cues.sample("rifle", 1, 2, 0.3), null);
});
test("HUD structurally shares unchanged small records and notifies only for actual displayed changes", () => {
  const store = createStore(
    {
      team: [{ name: "A", health: 150, alive: true }],
      stats: { hits: 0 },
      health: 150,
    },
    presentationEqual,
  );
  let calls = 0;
  const unsub = store.subscribe(() => calls++),
    before = store.get();
  for (let i = 0; i < 600; i++)
    store.set({
      team: [{ name: "A", health: 150, alive: true }],
      stats: { hits: 0 },
      health: 150,
    });
  assert.equal(calls, 0);
  assert.equal(store.get(), before);
  store.set({ team: [{ name: "A", health: 110, alive: true }], health: 110 });
  assert.equal(calls, 1);
  assert.equal(store.get().stats, before.stats);
  assert.equal(
    before.team[0].health,
    150,
    "old external-store snapshot stays immutable",
  );
  store.set({ marker: "head", markerPulse: 1 }, true);
  assert.equal(calls, 2);
  unsub();
  store.set({ health: 0 });
  assert.equal(calls, 2);
  assert.equal(presentationEqual(new Array(2), []), false);
  assert.equal(presentationEqual(new Date(0), new Date(0)), false);
  assert.equal(
    presentationEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }),
    false,
  );
});
test("warmed arm solver reuses storage without vector or quaternion cloning and retains exact bone lengths", () => {
  const arm = new THREE.Object3D(),
    elbow = new THREE.Object3D(),
    target = new THREE.Vector3(0.3, -0.4, -0.2);
  arm.position.set(-0.3, 0.2, 0);
  const first = aimArm(arm, elbow, target, -1);
  const cloneV = THREE.Vector3.prototype.clone,
    cloneQ = THREE.Quaternion.prototype.clone;
  try {
    THREE.Vector3.prototype.clone = THREE.Quaternion.prototype.clone = () => {
      throw Error("per-frame clone");
    };
    for (let i = 0; i < 2000; i++) {
      target.set(Math.sin(i * 0.01), -0.4, Math.cos(i * 0.01));
      const pose = aimArm(arm, elbow, target, -1);
      assert.equal(pose, first);
      assert.ok(Math.abs(pose.elbow.distanceTo(arm.position) - 0.34) < 1e-7);
      assert.ok(Math.abs(pose.end.distanceTo(pose.elbow) - 0.4) < 1e-7);
    }
  } finally {
    THREE.Vector3.prototype.clone = cloneV;
    THREE.Quaternion.prototype.clone = cloneQ;
  }
  const separate = solveTwoBone(
    arm.position,
    target,
    new THREE.Vector3(1, 0, 0),
  );
  const copy = separate.end.clone();
  solveTwoBone(arm.position, new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
  assert.deepEqual(
    separate.end,
    copy,
    "standalone solver retains independent outputs",
  );
});
test("weapon-specific cases use the same persistent instanced pool and preserve cover collision", () => {
  const fx = new CombatFX(new THREE.Scene()),
    v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  fx.eject(v(0, 3, 0), v(), v(), "pistol");
  fx.eject(v(0, 3, 0), v(), v(), "shotgun");
  assert.ok(fx.casingState[1].size.y > fx.casingState[0].size.y * 2);
  const matrix = fx.casings.instanceMatrix.array,
    colors = fx.casings.instanceColor.array;
  for (let i = 0; i < 100; i++)
    fx.update(1 / 120, [
      { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 2 },
    ]);
  assert.ok(fx.casingState[1].p.y >= 2 + fx.casingState[1].clearance - 1e-9);
  assert.equal(fx.casings.instanceMatrix.array, matrix);
  assert.equal(fx.casings.instanceColor.array, colors);
  fx.dispose();
});

test("actual fixed-step reload emits ordered mechanism cues without changing completion or reserve accounting", async () => {
  const { setup } = await import("./helpers/match.js");
  const { m, g } = setup();
  try {
    const sounds = [];
    g.audio.play = (name) => sounds.push(name);
    g.ammunition[0].mag = 1;
    const reserve = g.ammunition[0].reserve;
    g.reload();
    const total = g.reloadTotal;
    for (let i = 0; i < Math.ceil((total + 0.1) * 120); i++) m.step(1 / 120);
    assert.deepEqual(
      sounds.filter((s) => s.startsWith("reload")),
      ["reload", "reload-release", "reload-seat", "reload-ready"],
    );
    assert.equal(g.ammunition[0].mag, WEAPONS.rifle.mag);
    assert.equal(g.ammunition[0].reserve, reserve - (WEAPONS.rifle.mag - 1));
  } finally {
    m.dispose();
  }
});
test("reload audio start has no delayed callback and mechanism cues remain short local sounds", async () => {
  const { GameAudio } = await import("../src/audio.js");
  const audio = new GameAudio(),
    sounds = [];
  audio.noiseHit = (...args) => sounds.push(args);
  audio.tone = () => {};
  const schedule = globalThis.setTimeout;
  try {
    globalThis.setTimeout = () => {
      throw Error("reload cannot schedule stale callback");
    };
    for (const cue of [
      "reload",
      "reload-release",
      "reload-seat",
      "reload-ready",
    ])
      audio.play(cue);
  } finally {
    globalThis.setTimeout = schedule;
  }
  assert.equal(sounds.length, 4);
  assert.ok(sounds.every(([duration]) => duration <= 0.1));
});
