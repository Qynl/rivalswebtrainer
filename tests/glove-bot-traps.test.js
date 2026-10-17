import test from "node:test";
import assert from "node:assert/strict";
import { considerGloveTrapJump } from "../src/gloves/bot-traps.js";
import { MOVEMENT } from "../src/movement.js";
function fixture() {
  const actor = {
    id: "bot",
    team: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: -10,
    yaw: 0,
    height: 1.9,
    radius: 0.38,
    grounded: true,
  };
  const owner = { team: 0 };
  for (const key of ["x", "y", "z", "ghostTime"])
    Object.defineProperty(owner, key, {
      get() {
        throw Error("hidden owner state read");
      },
    });
  const brick = { owner, x: 0, y: 0, z: -3, life: 9, armedAt: 0 };
  const g = {
    player: { team: 0 },
    clock: 1,
    config: { difficulty: "regular" },
    world: { boxes: [] },
    gloveBricks: [brick],
    eye: (e) => ({ x: e.x, y: e.y + (e.height || 1.9) * 0.88, z: e.z }),
    hasLOS: () => true,
  };
  return { g, actor, brick, glove: { key: "default" } };
}
test("visible armed traps get a real reaction delay and an ordinary late approach jump, never an early or instantaneous dodge", () => {
  const f = fixture(),
    { g, actor, glove, brick } = f;
  assert.equal(considerGloveTrapJump(g, actor, glove), false);
  assert.equal(actor.grounded, true);
  brick.z = -1.7;
  g.clock += 0.1;
  assert.equal(considerGloveTrapJump(g, actor, glove), false);
  g.clock += 0.08;
  assert.equal(considerGloveTrapJump(g, actor, glove), true);
  assert.equal(actor.vy, MOVEMENT.jumpSpeed);
  assert.equal(actor.grounded, false);
  assert.equal(actor.jumps, 1);
  assert.equal(actor.gloveTrapNotice, null);
  assert.equal(brick.life, 9);
  assert.equal(brick.armedAt, 0);
});
test("allied, unarmed, expired, covered, off-route, behind, distant and other-storey traps cannot grant a jump or leak their owner", () => {
  for (const mode of [
    "allied",
    "unarmed",
    "expired",
    "covered",
    "off-route",
    "behind",
    "distant",
    "storey",
    "no-owner",
  ]) {
    const { g, actor, brick, glove } = fixture();
    if (mode === "allied") brick.owner = { team: 1 };
    if (mode === "unarmed") brick.armedAt = 2;
    if (mode === "expired") brick.life = 0;
    if (mode === "covered") g.hasLOS = () => false;
    if (mode === "off-route") brick.x = 2;
    if (mode === "behind") brick.z = 2;
    if (mode === "distant") brick.z = -5;
    if (mode === "storey") brick.y = 3;
    if (mode === "no-owner") brick.owner = null;
    considerGloveTrapJump(g, actor, glove);
    g.clock += 0.4;
    assert.equal(considerGloveTrapJump(g, actor, glove), false, mode);
    assert.equal(actor.grounded, true, mode);
    assert.equal(actor.gloveTrapNotice, null, mode);
  }
});
test("losing sight, changing traps and crowd control reset reaction; no local-player, network or committed-ability jumps", () => {
  for (const mode of [
    "lost",
    "changed",
    "ragdoll",
    "stone",
    "airborne",
    "player",
    "network",
    "committed",
  ]) {
    const { g, actor, brick, glove } = fixture();
    considerGloveTrapJump(g, actor, glove);
    g.clock += 1;
    brick.z = -1.5;
    if (mode === "lost") g.hasLOS = () => false;
    if (mode === "changed") g.gloveBricks = [{ ...brick }];
    if (mode === "ragdoll") actor.ragdollTime = 1;
    if (mode === "stone") actor.stoneTime = 1;
    if (mode === "airborne") actor.grounded = false;
    if (mode === "player") g.player = actor;
    if (mode === "network") g.network = {};
    if (mode === "committed") actor.boostTime = 1.3;
    assert.equal(considerGloveTrapJump(g, actor, glove), false, mode);
    assert.equal(actor.vy, 0, mode);
  }
});
test("low ceilings deny a dodge and Spring keeps its existing jump speed rather than inventing a special jump", () => {
  for (const ceiling of [true, false]) {
    const { g, actor, brick } = fixture(),
      glove = { key: "spring" };
    considerGloveTrapJump(g, actor, glove);
    g.clock += 0.3;
    brick.z = -1.5;
    if (ceiling)
      g.world.boxes = [
        { minX: -2, maxX: 2, minY: 2.1, maxY: 3, minZ: -2, maxZ: 2 },
      ];
    assert.equal(considerGloveTrapJump(g, actor, glove), !ceiling);
    assert.equal(actor.vy, ceiling ? 0 : 13.4);
  }
});
