import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";

const noop = () => {};

function fixture() {
  const removed = [],
    events = [],
    game = Object.create(Game.prototype);
  Object.assign(game, {
    activeDrill: { id: "tracking", duration: 60 },
    state: "playing",
    drillElapsed: 59.9,
    keys: new Set(["KeyW", "Space"]),
    mouseDown: true,
    trigger: true,
    aiming: true,
    fireBufferedUntil: 4,
    burstCount: 2,
    bowCharge: 0.4,
    bowRelease: true,
    projectiles: [{ mesh: { id: "projectile" } }],
    effects: [{ mesh: { id: "effect" } }],
    smokes: [{ id: "smoke" }],
    fires: [{ id: "fire" }],
    scene: { remove: (object) => removed.push(object.id) },
    disposeVisual: noop,
    cancelThrow: (refund) => events.push(["cancelThrow", refund]),
    clearQuickMelee: () => events.push(["clearQuickMelee"]),
    combatFX: { clear: () => events.push(["combatFX.clear"]) },
    flameFX: { clear: () => events.push(["flameFX.clear"]) },
    events: {
      drillComplete: (value) => events.push(["drillComplete", value.state]),
      update: (value) => events.push(["update", value.state]),
    },
  });
  return { game, events, removed };
}

test("finishing a drill freezes input, clears transient effects, unlocks, and publishes once", () => {
  const { game, events, removed } = fixture(),
    oldDocument = globalThis.document;
  globalThis.document = {
    exitPointerLock: () => events.push(["exitPointerLock"]),
  };
  try {
    assert.equal(game.finishDrill(), true);
    assert.equal(game.state, "drillend");
    assert.equal(game.drillElapsed, 60);
    assert.deepEqual([...game.keys], []);
    assert.equal(game.mouseDown, false);
    assert.equal(game.trigger, false);
    assert.equal(game.aiming, false);
    assert.equal(game.fireBufferedUntil, 0);
    assert.equal(game.burstCount, 0);
    assert.equal(game.bowCharge, 0);
    assert.equal(game.bowRelease, false);
    assert.deepEqual(removed.sort(), ["effect", "projectile"]);
    assert.deepEqual(game.projectiles, []);
    assert.deepEqual(game.effects, []);
    assert.deepEqual(game.smokes, []);
    assert.deepEqual(game.fires, []);
    assert.deepEqual(events.slice(-2), [
      ["drillComplete", "drillend"],
      ["update", "drillend"],
    ]);
    assert.equal(events.filter(([name]) => name === "drillComplete").length, 1);
    assert.equal(game.finishDrill(), false);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
  assert.ok(events.some(([name]) => name === "exitPointerLock"));
  assert.ok(events.some(([name]) => name === "combatFX.clear"));
  assert.ok(events.some(([name]) => name === "flameFX.clear"));
});

test("drill completion is a no-op unless a live drill is actively playing", () => {
  for (const state of ["paused", "results", "drillend", "playing"]) {
    const { game } = fixture();
    game.state = state;
    if (state === "playing") game.activeDrill = null;
    assert.equal(game.finishDrill(), false);
    assert.equal(game.state, state);
    assert.equal(game.drillElapsed, 59.9);
  }
});
