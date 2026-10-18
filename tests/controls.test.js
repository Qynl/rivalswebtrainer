import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";
import { MultiplayerSession } from "../src/net/session.js";
import {
  CONTROL_SCHEMA_VERSION,
  DEFAULT_CONTROLS,
  createControlsRecord,
  formatControl,
  isBindableCode,
  rebindControl,
  sanitizeControls,
} from "../src/controls.js";

test("default bindings preserve familiar movement, combat and slide alternatives", () => {
  const controls = sanitizeControls(null);
  assert.deepEqual(controls, DEFAULT_CONTROLS);
  assert.equal(formatControl(controls, "moveForward"), "W");
  assert.equal(formatControl(controls, "jump"), "SPACE");
  assert.equal(formatControl(controls, "slide"), "C / SHIFT / CTRL");
});

test("rebinding swaps duplicate keys instead of making an action unreachable", () => {
  const { ok, controls, swapped } = rebindControl(
    DEFAULT_CONTROLS,
    "quickMelee",
    "KeyG",
  );
  assert.equal(ok, true);
  assert.equal(swapped, true);
  assert.deepEqual(controls.quickMelee, ["KeyG"]);
  assert.deepEqual(controls.quickUtility, ["KeyF"]);
  assert.equal(
    sanitizeControls(controls).quickUtility.includes("KeyG"),
    false,
  );
});

test("reserved browser shortcuts and duplicate saved data are safely rejected or repaired", () => {
  assert.equal(isBindableCode("Escape"), false);
  assert.equal(isBindableCode("Tab"), false);
  assert.equal(isBindableCode("F5"), false);
  assert.equal(isBindableCode("KeyQ"), true);
  assert.equal(rebindControl(DEFAULT_CONTROLS, "jump", "Tab").ok, false);
  const clean = sanitizeControls({
    moveForward: ["KeyQ"],
    moveBackward: ["KeyQ"],
    slide: ["Escape", "KeyC"],
  });
  assert.deepEqual(clean.moveForward, ["KeyQ"]);
  assert.deepEqual(clean.moveBackward, ["KeyS"]);
  assert.deepEqual(clean.slide, ["KeyC"]);
});

test("custom slide bindings remove old aliases while reset-ready defaults stay available", () => {
  const rebound = rebindControl(DEFAULT_CONTROLS, "slide", "KeyV");
  assert.equal(rebound.ok, true);
  assert.deepEqual(rebound.controls.slide, ["KeyV"]);
  assert.equal(formatControl(rebound.controls, "slide"), "V");
  assert.deepEqual(sanitizeControls(null).slide, [
    "KeyC",
    "ShiftLeft",
    "ShiftRight",
    "ControlLeft",
    "ControlRight",
  ]);
});

test("custom physical movement keys feed the same normalized game movement", () => {
  const game = Object.create(Game.prototype);
  game.controls = rebindControl(DEFAULT_CONTROLS, "moveForward", "ArrowUp").controls;
  game.keys = new Set(["ArrowUp"]);
  game.yaw = 0;
  assert.equal(game.controlDown("moveForward"), true);
  const forward = game.moveDirection();
  assert.ok(Math.abs(forward.x) < 1e-8);
  assert.equal(forward.z, -1);
  game.keys = new Set(["KeyA"]);
  const left = game.moveDirection();
  assert.equal(left.x, -1);
  assert.ok(Math.abs(left.z) < 1e-8);
});

test("remapped action names keep the existing multiplayer ability protocol", () => {
  const sent = [],
    session = Object.create(MultiplayerSession.prototype);
  session.action = (action) => sent.push(action);
  for (const control of ["jump", "slide", "quickMelee", "quickUtility", "reload"])
    session.keyAction(control);
  session.keyAction("moveForward");
  assert.deepEqual(sent, ["jump", "slide", "ability", "utility", "reload"]);
});

test("control preferences are schema-versioned and retain a legacy flat-map migration", () => {
  const record = createControlsRecord(DEFAULT_CONTROLS);
  assert.deepEqual(record, {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    bindings: DEFAULT_CONTROLS,
  });
  assert.deepEqual(sanitizeControls(record), DEFAULT_CONTROLS);
  assert.deepEqual(sanitizeControls({ moveForward: ["KeyI"] }).moveForward, ["KeyI"]);
  assert.deepEqual(
    sanitizeControls({ schemaVersion: CONTROL_SCHEMA_VERSION + 1, bindings: { moveForward: ["KeyI"] } }),
    DEFAULT_CONTROLS,
  );
});
