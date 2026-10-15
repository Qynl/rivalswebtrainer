import test from "node:test";
import assert from "node:assert/strict";
import { NavGrid, moveBody, canOccupy } from "../src/physics.js";
import {
  chooseFiringPosition,
  chooseSafeWish,
  positionBot,
  routeLength,
  steerBotWish,
} from "../src/bot-positioning.js";
import { followRoute } from "../src/bot-tactics.js";
import { decideBotAction, initBotActions } from "../src/bot-actions.js";
const actor = (extra = {}) => ({
  x: 5,
  y: 0,
  z: -4.2,
  vx: 0,
  vz: 0,
  vy: 0,
  grounded: true,
  height: 1.9,
  radius: 0.38,
  health: 100,
  alive: true,
  team: 1,
  seed: 0.3,
  strafe: 1,
  activeWeapon: "rifle",
  meleeId: "katana",
  actionCounts: {},
  ...extra,
});
function stage() {
  const boxes = [
    {
      minX: -2,
      maxX: 2,
      minZ: -3.2,
      maxZ: 3.2,
      minY: 0,
      maxY: 6.2,
      ramp: { axis: "z", direction: 1, rise: 6.2 },
    },
    {
      minX: -2,
      maxX: 2,
      minZ: 3.2,
      maxZ: 5.2,
      minY: 0,
      maxY: 6.2,
      walkable: true,
    },
  ];
  return {
    boxes,
    nav: new NavGrid(boxes, 20, 0.4, 32),
    bounds: { minX: -9.5, maxX: 9.5, minZ: -15.5, maxZ: 15.5 },
  };
}
const threat = { x: 0, y: 0, z: -14 };

test("firing-position search chooses a reachable authored summit, not an arbitrary unwalkable roof", () => {
  const e = actor(),
    world = stage(),
    p = chooseFiringPosition(e, threat, world, () => true, [], {
      flank: false,
    });
  assert.ok(p);
  assert.equal(p.kind, "high");
  assert.ok(Math.abs(p.point.y - 6.2) < 1e-5);
  assert.ok(p.path.length > 10);
  assert.ok(p.travel > 0 && p.travel < 34);
  assert.deepEqual(p.threat, threat);
  const entry = p.path.find(
    (n) => Math.abs(n.x) < 2 && n.z > -3.2 && n.z < 3.2,
  );
  assert.ok(entry.y <= 0.4);
});
test("firing positions require prospective LOS and a complete reachable route", () => {
  const e = actor(),
    world = stage();
  assert.equal(
    chooseFiringPosition(e, threat, world, () => false),
    null,
  );
  world.nav.path = () => [];
  assert.equal(
    chooseFiringPosition(e, threat, world, () => true),
    null,
  );
  assert.equal(
    chooseFiringPosition(e, null, world, () => true),
    null,
  );
});
test("flanks use bounded local positions and avoid a teammate already claiming a perch", () => {
  const e = actor({ x: 0, z: 0 }),
    world = { boxes: [], nav: new NavGrid([], 32, 0.8) },
    target = { x: 0, y: 0, z: -15 };
  const p = chooseFiringPosition(e, target, world, () => true, [], {
    highGround: false,
  });
  assert.equal(p.kind, "flank");
  assert.ok(Math.abs(p.point.x) > 2);
  const mate = actor({
    x: p.point.x,
    z: p.point.z,
    attackPlan: { point: p.point },
  });
  const other = chooseFiringPosition(e, target, world, () => true, [e, mate], {
    highGround: false,
  });
  assert.ok(
    Math.hypot(other.point.x - p.point.x, other.point.z - p.point.z) > 2.6,
  );
});
test("position lifecycle uses a memory snapshot and never reads hidden live coordinates", () => {
  const e = actor({ lastKnown: { ...threat } }),
    world = stage();
  const key = {
    get x() {
      throw Error("hidden x read");
    },
    get y() {
      throw Error("hidden y read");
    },
    get z() {
      throw Error("hidden z read");
    },
  };
  const c = {
    clock: 1,
    world,
    visible: true,
    reacted: true,
    defensive: false,
    skill: 3,
    teammates: [],
    canSee: () => true,
    targetKey: key,
    speed: 12.5,
  };
  assert.ok(positionBot(e, c)?.moving);
  assert.equal(e.actionCounts.highGroundPlans, 1);
  assert.deepEqual(e.attackPlan.threat, threat);
  const existing = e.attackPlan;
  positionBot(e, { ...c, clock: 1.1, visible: false, reacted: false });
  assert.equal(e.attackPlan, existing);
});
test("defense, a different opponent, close combat and stale plans cancel an offensive route", () => {
  for (const reason of ["defense", "target", "close", "expired"]) {
    const e = actor({ lastKnown: { ...threat } }),
      world = stage(),
      key = {};
    const c = {
      clock: 1,
      world,
      visible: true,
      reacted: true,
      defensive: false,
      skill: 3,
      teammates: [],
      canSee: () => true,
      targetKey: key,
      speed: 12.5,
    };
    positionBot(e, c);
    assert.ok(e.attackPlan);
    const next = { ...c, clock: 1.1 };
    if (reason === "defense") next.defensive = true;
    if (reason === "target") next.targetKey = {};
    if (reason === "close") e.lastKnown = { x: e.x, y: 0, z: e.z - 3 };
    if (reason === "expired") next.clock = 10;
    assert.equal(positionBot(e, next), null, reason);
    assert.equal(e.attackPlan, null);
  }
});
test("arrival holds and strafes briefly, then returns to the ordinary controller", () => {
  const e = actor({ lastKnown: { ...threat } }),
    world = stage(),
    key = {};
  const c = {
    clock: 1,
    world,
    visible: true,
    reacted: true,
    defensive: false,
    skill: 3,
    teammates: [],
    canSee: () => true,
    targetKey: key,
    speed: 12.5,
  };
  positionBot(e, c);
  const p = e.attackPlan;
  Object.assign(e, p.point);
  p.path = [];
  const hold = positionBot(e, { ...c, clock: 1.1 });
  assert.equal(hold.moving, false);
  assert.equal(e.actionCounts.highGroundArrivals, 1);
  assert.ok(Math.hypot(hold.x, hold.z) > 0.1);
  assert.equal(positionBot(e, { ...c, clock: p.holdUntil + 0.01 }), null);
  assert.equal(e.attackPlan, null);
});
test("Rookie and unreacted bots cannot start a tactical position plan", () => {
  const world = stage();
  for (const extra of [{ skill: 0 }, { reacted: false }]) {
    const e = actor({ lastKnown: { ...threat } });
    assert.equal(
      positionBot(e, {
        clock: 1,
        world,
        visible: true,
        reacted: true,
        defensive: false,
        skill: 3,
        teammates: [],
        canSee: () => true,
        targetKey: {},
        speed: 12.5,
        ...extra,
      }),
      null,
    );
  }
});
test("wall avoidance chooses a nearby physical tangent without changing actor state", () => {
  const e = actor({ x: 0, z: 0, vz: -12 }),
    world = {
      boxes: [{ minX: -4, maxX: 4, minZ: -1.2, maxZ: -1, minY: 0, maxY: 6 }],
    };
  const before = JSON.stringify(e),
    wish = chooseSafeWish(e, { x: 0, z: -1 }, world);
  assert.equal(wish.avoided, true);
  assert.ok(Math.abs(wish.x) > 0.5);
  assert.ok(Math.abs(Math.hypot(wish.x, wish.z) - 1) < 1e-8);
  assert.equal(JSON.stringify(e), before);
});
test("ledge avoidance changes an unsafe ground wish, but leaves intentional drops and airborne input alone", () => {
  const e = actor({ x: 0, z: 0, y: 3, vz: -12 }),
    world = {
      boxes: [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 3 }],
    };
  assert.equal(chooseSafeWish(e, { x: 0, z: -1 }, world).avoided, true);
  assert.equal(
    chooseSafeWish(e, { x: 0, z: -1 }, world, { allowDrop: true }).avoided,
    false,
  );
  e.grounded = false;
  assert.equal(chooseSafeWish(e, { x: 0, z: -1 }, world).avoided, false);
});
test("steering is waypoint-bounded so a legitimate route corner is not avoided too early", () => {
  const e = actor({ x: 0, z: 0, vz: -12 }),
    world = {
      boxes: [{ minX: -3, maxX: 3, minZ: -1.2, maxZ: -1, minY: 0, maxY: 6 }],
    };
  assert.equal(
    chooseSafeWish(e, { x: 0, z: -1 }, world, { maxDistance: 0.3 }).avoided,
    false,
  );
  const wish = steerBotWish(e, { x: 0, z: -1 }, world, 1);
  assert.ok(wish.avoided);
  assert.equal(e.actionCounts.obstacleAvoids, 1);
  steerBotWish(e, { x: 0, z: -1 }, world, 1.05);
  assert.equal(e.actionCounts.obstacleAvoids, 1);
});
test("fully boxed actors stop rather than choosing a blocked escape", () => {
  const e = actor({ x: 0, z: 0 }),
    boxes = [
      { minX: -2, maxX: 2, minZ: -1, maxZ: -0.7, minY: 0, maxY: 6 },
      { minX: -2, maxX: 2, minZ: 0.7, maxZ: 1, minY: 0, maxY: 6 },
      { minX: -1, maxX: -0.7, minZ: -2, maxZ: 2, minY: 0, maxY: 6 },
      { minX: 0.7, maxX: 1, minZ: -2, maxZ: 2, minY: 0, maxY: 6 },
    ];
  assert.deepEqual(chooseSafeWish(e, { x: 0, z: -1 }, { boxes }), {
    x: 0,
    z: 0,
    avoided: true,
  });
});
test("route progress respects height and close corner waypoints, including singular points", () => {
  const e = actor({ x: 0, z: 0, y: 0 }),
    path = [
      { x: 0, z: 0, y: 3 },
      { x: 0, z: 2, y: 3 },
    ];
  assert.deepEqual(followRoute(e, path), { x: 0, z: 0 });
  assert.equal(path.length, 2);
  e.y = 3;
  assert.deepEqual(followRoute(e, path), { x: 0, z: 1 });
  assert.equal(path.length, 1);
  assert.equal(routeLength(e, path), 2);
  const corner = [
    { x: 0.5, z: 0, y: 3 },
    { x: 0.5, z: 1, y: 3 },
  ];
  followRoute(e, corner);
  assert.equal(corner.length, 2);
});
test("a committed high-ground route does not get interrupted by a dash or slide off its ramp", () => {
  const e = actor({ meleeId: "scythe", x: 0, z: 0, vz: -12 });
  initBotActions(e);
  const c = {
    world: { boxes: [] },
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
    positioning: true,
  };
  assert.equal(decideBotAction(e, c), null);
  assert.equal(e.dashTime, 0);
  assert.equal(e.slideTime, 0);
});

test("rotated-slab avoidance uses capsule collision, not an axis-aligned shortcut", () => {
  const e = actor({ x: 0, z: 0, vz: -12 }),
    b = {
      minX: -2,
      maxX: 2,
      minZ: -4,
      maxZ: 1,
      minY: 0,
      maxY: 6,
      cx: 0,
      cz: -1.7,
      halfX: 2,
      halfZ: 0.15,
      angle: Math.PI / 4,
    },
    world = { boxes: [b] };
  const wish = chooseSafeWish(e, { x: 0, z: -1 }, world);
  assert.equal(wish.avoided, true);
  moveBody(e, wish.x * 0.3, wish.z * 0.3, world.boxes);
  assert.ok(canOccupy(e, e.x, e.y, e.z, world.boxes));
});
test("firing-position search caps expensive route solves even when candidates are unreachable", () => {
  const e = actor(),
    world = stage();
  let routes = 0,
    rays = 0;
  world.nav.path = () => {
    routes++;
    return [];
  };
  assert.equal(
    chooseFiringPosition(e, threat, world, () => {
      rays++;
      return true;
    }),
    null,
  );
  assert.ok(routes > 0 && routes <= 5);
  assert.ok(rays <= 10);
});
test("continuous obstacle avoidance can trigger a local flank before the actor is fully stuck", () => {
  const e = actor({
      x: 0,
      z: 0,
      meleeId: "scythe",
      lastKnown: { ...threat },
      avoidanceSince: 0.1,
    }),
    world = { boxes: [], nav: new NavGrid([], 32, 0.8) };
  const result = positionBot(e, {
    clock: 1,
    world,
    visible: true,
    reacted: true,
    defensive: false,
    skill: 3,
    teammates: [],
    canSee: () => true,
    targetKey: {},
    speed: 12.5,
  });
  assert.ok(result?.moving);
  assert.equal(e.attackPlan.kind, "flank");
  assert.equal(e.actionCounts.flankPlans, 1);
});
test("hidden recovery flanks require a recent reaction to that same target", () => {
  const key = {},
    world = { boxes: [], nav: new NavGrid([], 32, 0.8) },
    c = {
      clock: 1.1,
      world,
      visible: false,
      reacted: false,
      defensive: false,
      skill: 3,
      teammates: [],
      canSee: () => true,
      targetKey: key,
      speed: 12.5,
    };
  const e = actor({
    x: 0,
    z: 0,
    meleeId: "scythe",
    lastKnown: { ...threat },
    lastReactedAt: 1,
    lastReactedTarget: key,
  });
  assert.ok(positionBot(e, c));
  for (const extra of [
    { lastReactedAt: -2, lastReactedTarget: key },
    { lastReactedAt: 1, lastReactedTarget: {} },
  ]) {
    const unreacted = actor({
      x: 0,
      z: 0,
      meleeId: "scythe",
      lastKnown: { ...threat },
      ...extra,
    });
    assert.equal(positionBot(unreacted, c), null);
  }
});

test("a tight peek finishes precisely before arrival and strafes only toward an open firing angle", () => {
  const e = actor({ lastKnown: { ...threat } }),
    world = stage(),
    key = {};
  const c = {
    clock: 1,
    world,
    visible: true,
    reacted: true,
    defensive: false,
    skill: 3,
    teammates: [],
    canSee: () => true,
    targetKey: key,
    speed: 12.5,
  };
  positionBot(e, c);
  const p = e.attackPlan;
  Object.assign(e, p.point);
  e.x -= 0.1;
  p.path = [];
  const tight = {
    ...c,
    clock: 1.1,
    canSee: (point) => point.x >= p.point.x - 0.03,
  };
  const finish = positionBot(e, tight);
  assert.equal(finish.moving, true);
  assert.ok(finish.x > 0);
  assert.equal(e.actionCounts.highGroundArrivals, undefined);
  e.x = p.point.x;
  const hold = positionBot(e, { ...tight, clock: 1.2 });
  assert.equal(e.actionCounts.highGroundArrivals, 1);
  assert.ok(hold.x > 0);
  assert.equal(
    positionBot(e, { ...tight, clock: 1.3, canSee: () => false }),
    null,
  );
  assert.equal(e.attackPlan, null);
});
test("offensive route endpoints use a tighter tolerance than ordinary navigation", () => {
  const e = actor({ x: 0, y: 0, z: 0 }),
    normal = [{ x: 0.2, y: 0, z: 0 }],
    precise = [...normal];
  followRoute(e, normal);
  assert.equal(normal.length, 0);
  assert.deepEqual(followRoute(e, precise, 0.12), { x: 1, z: 0 });
  assert.equal(precise.length, 1);
});
