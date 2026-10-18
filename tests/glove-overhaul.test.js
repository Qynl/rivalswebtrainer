import { GloveFX, presentGloveAbility } from "../src/gloves/fx.js";
import { playGloveAbilityAudio } from "../src/gloves/audio.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { setup, packet } from "./helpers/match.js";
import { GLOVES, GLOVE_ROSTER, gloveLoadout } from "../src/gloves/catalog.js";
import {
  useGloveAbility,
  tickGloves,
  tickBody,
  updateGloveBot,
} from "../src/gloves/combat.js";
import { abilityTarget } from "../src/gloves/ability-targets.js";
import { rollDirection, settleGloveTeleport } from "../src/gloves/mobility.js";
import { castCounterplay } from "../src/gloves/bot-counterplay.js";
import { glovePerceivedTarget } from "../src/gloves/bot-awareness.js";
import { gloveAbilityReadout } from "../src/gloves/status-readout.js";
import { lowGravity } from "../src/gloves/states.js";
import { abilityPose } from "../src/gloves/ability-motion.js";
import { GLOVE_GUIDE } from "../src/gloves/field-guide.js";
import { MultiplayerSession } from "../src/net/session.js";
function fixture(id = "glove_default") {
  const s = setup();
  for (const [i, g] of [s.g, s.other].entries()) {
    g.loadout = gloveLoadout(i === 0 ? id : "glove_default");
    g.state = "playing";
    g.clock = 10;
    g.yaw = g.pitch = 0;
    g.keys.clear();
    g.world.boxes = [];
    g.hasLOS = () => true;
    Object.assign(g.player, {
      x: 0,
      y: 0,
      z: i === 0 ? 0 : -5,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      health: 150,
      alive: true,
      height: 1.9,
      radius: 0.28,
      ragdollTime: 0,
      slapGrace: 0,
      stoneTime: 0,
    });
  }
  return s;
}
test("Acrobat chooses forward, backward, sideways and normalized diagonals while preserving camera and fallback direction", () => {
  for (const [keys, expected] of [
    [[], [0, -18]],
    [["KeyD"], [18, 0]],
    [["KeyA"], [-18, 0]],
    [["KeyS"], [0, 18]],
    [
      ["KeyW", "KeyD"],
      [18 / Math.sqrt(2), -18 / Math.sqrt(2)],
    ],
  ]) {
    const { g } = fixture("glove_acrobat");
    for (const key of keys) g.keys.add(key);
    g.pitch = 0.3;
    g.player.vy = -8;
    assert.equal(useGloveAbility(g), true);
    assert.ok(Math.abs(g.player.vx - expected[0]) < 1e-8);
    assert.ok(Math.abs(g.player.vz - expected[1]) < 1e-8);
    assert.equal(g.player.vy, 0);
    assert.equal(g.yaw, 0);
    assert.equal(g.pitch, 0.3);
    assert.equal(g.matchStats.hits, 0);
    assert.equal(useGloveAbility(g), false);
  }
  const { g } = fixture("glove_acrobat");
  g.keys.add("KeyD");
  const direction = rollDirection(g, g.player, Math.PI / 2);
  assert.ok(Math.abs(direction.x) < 1e-8);
  assert.ok(Math.abs(direction.z + 1) < 1e-8);
});
test("real authority input decodes held WASD before the Acrobat action, rather than using host-only local keys", () => {
  const { m, g } = fixture("glove_acrobat");
  m.input("p0", packet(1, [{ id: 1, type: "ability" }], { keys: 8 }));
  assert.equal(g.player.vx, 18);
  assert.ok(Math.abs(g.player.vz) < 1e-8);
  assert.equal(g.player.boostTime, 0.5);
  assert.equal(g.player.abilityCooldown, 5);
});
test("Space can end early after rearm, keeps cooldown and momentum, and actually restores normal gravity", () => {
  const { g } = fixture("glove_space");
  assert.equal(useGloveAbility(g), true);
  assert.equal(useGloveAbility(g), false);
  assert.equal(
    gloveAbilityReadout(g.player, GLOVES.glove_space, "playing").label,
    "REARM",
  );
  tickGloves(g, 0.36);
  const read = gloveAbilityReadout(g.player, GLOVES.glove_space, "playing");
  assert.equal(read.label, "END");
  assert.equal(read.progress, 1);
  const cooldown = g.player.abilityCooldown,
    vy = g.player.vy;
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.player.spaceTime, 0);
  assert.equal(g.player.abilityCooldown, cooldown);
  assert.equal(g.player.vy, vy);
  lowGravity(g.player, 1 / 120);
  assert.equal(g.player.vy, vy);
  assert.equal(useGloveAbility(g), false);
  assert.equal(g.player.health, 150);
});
test("Space end events cannot accidentally relaunch the network owner or reenable low gravity", () => {
  const { g } = fixture("glove_space");
  g.player.spaceTime = 2;
  g.player.vy = -3;
  g.player.grounded = true;
  const n = {
    game: g,
    id: g.player.id,
    round: 1,
    lastEvent: 0,
    entities: new Map(),
  };
  MultiplayerSession.prototype.processEvents.call(n, [
    {
      id: 1,
      type: "gloveAbility",
      phase: "exit",
      glove: "glove_space",
      player: g.player.id,
      round: 1,
      time: 10,
      position: [0, 0.6, 0],
      velocity: [0, -3, 0],
    },
  ]);
  assert.equal(g.player.spaceTime, 0);
  assert.equal(g.player.vy, -3);
  assert.equal(g.player.grounded, true);
});
test("Magnet cannot blindly lock behind you; authority target is visible, forward and aim-biased with no invalid-target cooldown", () => {
  const { g, other } = fixture("glove_magnet");
  other.player.z = 5;
  assert.equal(abilityTarget(g, g.player, "magnet"), null);
  assert.equal(useGloveAbility(g), false);
  assert.ok(!g.player.abilityCooldown);
  other.player.z = -5;
  assert.equal(abilityTarget(g, g.player, "magnet"), other.player);
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.player.vz, -22);
  assert.equal(other.player.vz, 0);
  assert.equal(other.player.health, 150);
});
test("target selection excludes hidden/protected/down/allied/covered enemies before exposing them to an advisory cue", () => {
  for (const key of ["magnet", "swapper"])
    for (const flag of ["ghostTime", "stoneTime", "goldTime", "ragdollTime"]) {
      const { g, other } = fixture("glove_" + key);
      other.player[flag] = 1;
      Object.defineProperty(other.player, "x", {
        get() {
          throw new Error("ineligible position read");
        },
      });
      assert.equal(abilityTarget(g, g.player, key), null);
    }
  const { g, other } = fixture("glove_swapper");
  g.hasLOS = () => false;
  assert.equal(abilityTarget(g, g.player, "swapper"), null);
  g.hasLOS = () => true;
  other.player.team = g.player.team;
  assert.equal(abilityTarget(g, g.player, "swapper"), null);
});
test("Swapper chooses the centered opponent rather than a nearer edge target and rejects unsafe destinations without spending cooldown", () => {
  const { g, other } = fixture("glove_swapper");
  const edge = { ...other.player, id: "edge", context: null, x: 0.7, z: -3 };
  g.entities.push(edge);
  assert.equal(abilityTarget(g, g.player, "swapper"), other.player);
  g.world.boxes = [{ minX: -1, maxX: 1, minZ: -6, maxZ: -4, minY: 0, maxY: 3 }];
  g.entities.pop();
  assert.equal(useGloveAbility(g), false);
  assert.ok(!g.player.abilityCooldown);
  assert.equal(g.player.z, 0);
});
test("Swapper into the air clears phantom grounding and stale slide/coyote/jump buffers for both participants, without healing", () => {
  const { g, other } = fixture("glove_swapper");
  other.player.y = 3.5;
  other.player.grounded = false;
  g.pitch = Math.atan2(3.5, 5);
  g.slideTime = 1.5;
  g.jumpBuffer = g.coyoteTime = 0.1;
  other.slideTime = 1.5;
  other.jumpBuffer = 0.1;
  g.player.health = 83;
  assert.equal(useGloveAbility(g), true);
  assert.equal(g.player.y, 3.5);
  assert.equal(g.player.grounded, false);
  assert.equal(g.player.jumps, 1);
  assert.equal(g.coyoteTime, 0);
  assert.equal(g.jumpBuffer, 0);
  assert.equal(g.slideTime, 0);
  assert.equal(other.player.y, 0);
  assert.equal(other.player.grounded, true);
  assert.equal(other.player.jumps, 0);
  assert.equal(other.jumpBuffer, 0);
  assert.equal(other.slideTime, 0);
  assert.equal(g.player.health, 83);
});
test("teleport settling respects elevated support and ramps without advancing time or snapping a floating body", () => {
  const body = {
    x: 0,
    y: 2,
    z: 0,
    radius: 0.28,
    height: 1.9,
    vy: 8,
    vx: 12,
    vz: 3,
    grounded: false,
  };
  const box = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 2 };
  settleGloveTeleport(body, [box]);
  assert.equal(body.grounded, true);
  assert.equal(body.y, 2);
  body.y = 2.2;
  settleGloveTeleport(body, [box]);
  assert.equal(body.grounded, false);
  assert.equal(body.y, 2.2);
  const ramp = {
    ...box,
    minY: 0,
    maxY: 2,
    ramp: { axis: "z", rise: 2, direction: 1 },
  };
  body.y = 1;
  settleGloveTeleport(body, [ramp]);
  assert.equal(body.grounded, true);
  assert.equal(body.y, 1);
});
test("network teleport events use the same support settlement and preserve authoritative Flash momentum instead of zeroing only the joiner", () => {
  const { g } = fixture("glove_swapper");
  const n = {
    game: g,
    id: g.player.id,
    round: 1,
    lastEvent: 0,
    entities: new Map(),
    correction: new THREE.Vector3(),
    prediction: { clear() {} },
  };
  g.jumpBuffer = 0.1;
  g.coyoteTime = 0.1;
  const event = {
    id: 1,
    type: "gloveAbility",
    glove: "glove_swapper",
    player: g.player.id,
    round: 1,
    time: 10,
    position: [0, 0.6, 0],
    destination: [0, 3, 0],
  };
  MultiplayerSession.prototype.processEvents.call(n, [event]);
  assert.equal(g.player.grounded, false);
  assert.equal(g.coyoteTime, 0);
  assert.equal(g.jumpBuffer, 0);
  MultiplayerSession.prototype.processEvents.call(n, [
    {
      ...event,
      id: 2,
      glove: "glove_flash",
      destination: [2, 3, 0],
      velocity: [5, -2, 3],
    },
  ]);
  assert.deepEqual([g.player.vx, g.player.vy, g.player.vz], [5, -2, 3]);
});
test("perception copies a visible cast tell, then removes it without reading a hidden pending ability", () => {
  const { g, other } = fixture();
  const bot = { x: 0, y: 0, z: -4, seed: 0 };
  other.player.gloveAbilityPending = {
    id: "glove_stun",
    yaw: 0,
    remaining: 0.4,
  };
  const seen = glovePerceivedTarget(g, bot, other.player, true);
  assert.notEqual(seen.abilityCast, other.player.gloveAbilityPending);
  assert.equal(seen.abilityCast.remaining, 0.4);
  Object.defineProperty(other.player, "gloveAbilityPending", {
    get() {
      throw new Error("hidden cast read");
    },
  });
  const hidden = glovePerceivedTarget(g, bot, other.player, false);
  assert.equal(hidden.abilityCast, null);
  assert.equal(
    castCounterplay(
      g,
      { ...bot, alive: true },
      GLOVES.glove_default,
      new Proxy(
        {},
        {
          get() {
            throw new Error("hidden perceived cast");
          },
        },
      ),
      false,
      { x: 0, z: 0 },
    ),
    null,
  );
});
test("NPCs spend a real difficulty reaction window before ordinary EMP jump and never gain a jump under a low ceiling", () => {
  const { g } = fixture();
  g.config.difficulty = "regular";
  const bot = {
      id: "bot",
      x: 0,
      y: 0,
      z: -4,
      yaw: Math.PI,
      alive: true,
      grounded: true,
      radius: 0.28,
      height: 1.9,
    },
    target = {
      id: "caster",
      x: 0,
      y: 0,
      z: 0,
      abilityCast: { id: "glove_stun", yaw: 0, remaining: 0.4 },
    },
    wish = { x: 0, z: 1 };
  assert.equal(
    castCounterplay(g, bot, GLOVES.glove_default, target, true, wish),
    null,
  );
  g.clock += 0.18;
  target.abilityCast.remaining = 0.22;
  const result = castCounterplay(
    g,
    bot,
    GLOVES.glove_default,
    target,
    true,
    wish,
  );
  assert.equal(result.jumped, true);
  assert.equal(bot.vy, 9.7);
  assert.equal(bot.grounded, false);
  assert.equal(bot.jumps, 1);
  bot.grounded = true;
  g.world.boxes = [{ minX: -2, maxX: 2, minZ: -6, maxZ: -2, minY: 2, maxY: 3 }];
  assert.equal(
    castCounterplay(g, bot, GLOVES.glove_default, target, true, wish),
    null,
  );
  assert.equal(bot.grounded, true);
});
test("Erasure dodge is a real sideways wish, rejects blocked sides/bounds and cannot override a committed roll", () => {
  const { g } = fixture();
  g.config.difficulty = "elite";
  const bot = {
      id: "bot",
      x: 0,
      y: 0,
      z: -5,
      yaw: Math.PI,
      alive: true,
      grounded: true,
      radius: 0.28,
      height: 1.9,
      strafe: 1,
    },
    target = {
      id: "caster",
      x: 0,
      y: 0,
      z: 0,
      abilityCast: { id: "glove_za_hando", yaw: 0, remaining: 0.5 },
    };
  castCounterplay(g, bot, GLOVES.glove_default, target, true, { x: 0, z: 1 });
  g.clock += 0.1;
  target.abilityCast.remaining = 0.4;
  const result = castCounterplay(g, bot, GLOVES.glove_default, target, true, {
    x: 0,
    z: 1,
  });
  assert.deepEqual(result.wish, { x: 1, z: -0 });
  assert.equal(bot.x, 0);
  g.world.bounds = { minX: -0.5, maxX: 0.5, minZ: -10, maxZ: 10 };
  assert.equal(
    castCounterplay(g, bot, GLOVES.glove_default, target, true, { x: 0, z: 1 }),
    null,
  );
  g.world.bounds = null;
  bot.boostTime = 0.4;
  assert.equal(
    castCounterplay(g, bot, GLOVES.glove_acrobat, target, true, { x: 0, z: 1 }),
    null,
  );
});
test("actual bot simulation jumps EMP or sidesteps Erasure using normal physics, with no immunity, damage or rewarded hit manufactured", () => {
  for (const key of ["stun", "za_hando"]) {
    const { g, other } = fixture("glove_" + key),
      bot = other.player;
    Object.assign(bot, {
      isPlayer: false,
      target: false,
      activeWeapon: "glove_default",
      yaw: Math.PI,
      z: key === "stun" ? -4 : -5,
      abilityCooldown: 99,
      gloveCooldown: 99,
      strafe: 1,
      seed: 0,
    });
    g.config.difficulty = "regular";
    g.animateBot = () => {};
    useGloveAbility(g);
    let dodged = false,
      maxY = 0;
    for (let i = 0; i < 67; i++) {
      g.clock += 1 / 120;
      tickGloves(g, 1 / 120);
      tickBody(bot, 1 / 120);
      updateGloveBot(g, bot, 1 / 120);
      dodged ||= !!bot.gloveCounterplay;
      maxY = Math.max(maxY, bot.y);
    }
    assert.equal(dodged, true, key);
    assert.equal(bot.ragdollTime, 0, key);
    assert.equal(bot.health, 150);
    assert.equal(g.matchStats.hits, 0);
    if (key === "stun") assert.ok(maxY > 1);
    else assert.ok(Math.abs(bot.x) > 1.68);
  }
});
test("charge, release and cancellation have distinct hand poses; all stages stay finite and presentation-only", () => {
  for (const key of ["stun", "za_hando"]) {
    assert.equal(abilityPose(key, 0.25, "windup").weight, 1);
    assert.equal(abilityPose(key, 0, "release").weight, 1);
    assert.notDeepEqual(
      abilityPose(key, 0.25, "windup"),
      abilityPose(key, 0, "release"),
    );
    assert.equal(abilityPose(key, 0.2, "cancel").weight, 0);
    assert.equal(abilityPose(key, 2, "release").weight, 0);
    for (const phase of ["windup", "release", "cancel", "exit"])
      for (const age of [NaN, Infinity, -1, 0, 0.05, 0.5, 10])
        assert.ok(
          Object.values(abilityPose(key, age, phase)).every(Number.isFinite),
        );
  }
});
test("every earned glove has concise play/counterplay guidance without fake rankings, and rearm readouts stay finite for malformed cooldowns", () => {
  assert.equal(Object.keys(GLOVE_GUIDE).length, 24);
  for (const glove of GLOVE_ROSTER) {
    assert.ok(GLOVE_GUIDE[glove.key].play.length > 30);
    assert.ok(GLOVE_GUIDE[glove.key].counter.length > 30);
    assert.ok(Object.isFrozen(GLOVE_GUIDE[glove.key]));
  }
  assert.equal(
    gloveAbilityReadout(
      { alive: true, stoneTime: 1, abilityCooldown: NaN },
      GLOVES.glove_diamond,
      "playing",
    ).progress,
    0,
  );
});

test("a charge after an earlier impact still follows its actor, and cancellation immediately clears the hand charge phase", () => {
  const scene = new THREE.Scene(),
    player = { id: "caster", x: 0, y: 0, z: 0, alive: true },
    g = {
      scene,
      player,
      entities: [player],
      clock: 10,
      state: "playing",
      gloveFX: new GloveFX(scene),
    };
  presentGloveAbility(g, {
    glove: "glove_stun",
    player: "caster",
    phase: "windup",
    position: [0, 0.6, 0],
    windup: 0.4,
  });
  player.x = 3;
  g.gloveFX.update(0.1);
  assert.ok(
    g.gloveFX.rings.states
      .filter((s) => s.castOwner === "caster")
      .every((s) => s.p.x === 3),
  );
  presentGloveAbility(g, {
    glove: "glove_stun",
    player: "caster",
    phase: "cancel",
    position: [3, 0.6, 0],
  });
  assert.equal(player.gloveCastPhase, "cancel");
  assert.equal(abilityPose("stun", 0, player.gloveCastPhase).weight, 0);
  g.gloveFX.dispose();
});
test("ending a form emits a quiet contracting cue, not another successful ability impact burst", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene);
  fx.ability({
    glove: "glove_space",
    player: "local",
    phase: "exit",
    position: [0, 0.6, 0],
  });
  assert.equal(
    fx.rings.states.filter((s) => s.life > 0 && s.start > s.end).length,
    1,
  );
  assert.equal(
    fx.rays.states.some((s) => s.life > 0),
    false,
  );
  assert.equal(
    fx.puffs.states.some((s) => s.life > 0),
    false,
  );
  const calls = [],
    g = {
      state: "playing",
      headless: false,
      player: { id: "local", alive: true },
      audio: { volume: 1, play: (name, level) => calls.push({ name, level }) },
    };
  playGloveAbilityAudio(g, {
    glove: "glove_space",
    player: "local",
    phase: "exit",
    position: [0, 0.6, 0],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].level, 0.3);
  fx.dispose();
});

test("an Erasure sidestep sweeps its short path instead of aiming through a thin wall to a clear endpoint", () => {
  const { g } = fixture();
  g.config.difficulty = "elite";
  const bot = {
      id: "bot",
      x: 0,
      y: 0,
      z: -5,
      yaw: Math.PI,
      alive: true,
      grounded: true,
      radius: 0.28,
      height: 1.9,
      strafe: 1,
    },
    target = {
      id: "caster",
      x: 0,
      y: 0,
      z: 0,
      abilityCast: { id: "glove_za_hando", yaw: 0, remaining: 0.5 },
    };
  castCounterplay(g, bot, GLOVES.glove_default, target, true, { x: 0, z: 1 });
  g.clock += 0.1;
  target.abilityCast.remaining = 0.4;
  g.world.boxes = [
    { minX: 0.35, maxX: 0.45, minZ: -7, maxZ: -3, minY: 0, maxY: 3 },
  ];
  const counter = castCounterplay(g, bot, GLOVES.glove_default, target, true, {
    x: 0,
    z: 1,
  });
  assert.equal(counter.wish.x, -1);
  assert.equal(bot.x, 0);
});
