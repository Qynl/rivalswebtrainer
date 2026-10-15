import { canOccupy, moveBody, verticalStep } from "./physics.js";
import { followRoute } from "./bot-tactics.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function routeLength(start, path) {
  let length = 0,
    previous = start;
  for (const p of path) {
    length += distance(previous, p);
    previous = p;
  }
  return length;
}

// A bounded search over authored walkable summits + local flank samples.
// `threat` is a perception snapshot, never a live hidden entity reference.
export function chooseFiringPosition(
  actor,
  threat,
  world,
  canSee,
  teammates = [],
  { highGround = true, flank = true } = {},
) {
  if (!threat || !world.nav) return null;
  const nav = world.nav,
    candidates = [],
    seen = new Set();
  const add = (x, z, kind) => {
    const i = nav.index(x, z);
    if (seen.has(i) || nav.blocked[i]) return;
    seen.add(i);
    const point = nav.point(i),
      range = distance(point, threat),
      travel = distance(actor, point);
    if (
      range < 7 ||
      range > 32 ||
      travel < 1.8 ||
      !canOccupy(actor, point.x, point.y || 0, point.z, world.boxes, 1.9)
    )
      return;
    if (kind === "high" && (point.y || 0) < (actor.y || 0) + 1) return;
    if (kind === "flank" && Math.abs((point.y || 0) - (actor.y || 0)) > 1)
      return;
    if (!canSee(point, threat)) return;
    const crowd = teammates.reduce((n, t) => {
      if (t === actor || !t.alive || t.team !== actor.team) return n;
      const p = t.attackPlan?.point || t.coverPlan?.point || t;
      return n + Math.max(0, 2.6 - distance(p, point)) * 3;
    }, 0);
    const score =
      (kind === "high"
        ? Math.min(5, (point.y || 0) - (actor.y || 0)) * 1.8
        : 1.5) -
      travel * 0.23 -
      crowd -
      Math.max(0, range - 23) * 0.2;
    candidates.push({ point, kind, score });
  };
  if (highGround)
    for (const b of world.boxes) {
      if (b.walkable) {
        const x = (b.minX + b.maxX) / 2,
          z = (b.minZ + b.maxZ) / 2;
        add(x, z, "high");
        const offset = Math.max(0, (b.maxX - b.minX) / 2 - 0.6);
        add(x - offset, z, "high");
        add(x + offset, z, "high");
      }
      // A ramp itself is traversable, but not a sufficiently stable firing perch.
    }
  if (flank) {
    const d = Math.max(0.01, distance(actor, threat)),
      tx = (threat.x - actor.x) / d,
      tz = (threat.z - actor.z) / d;
    for (const side of [-1, 1])
      for (const reach of [3.2, 5.6])
        add(
          actor.x + tx * reach * 0.35 + tz * reach * side,
          actor.z + tz * reach * 0.35 - tx * reach * side,
          "flank",
        );
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, 5)) {
    const path = nav.path(actor, c.point),
      end = path.at(-1);
    if (
      !end ||
      distance(end, c.point) > nav.cell * 0.75 ||
      Math.abs((end.y || 0) - (c.point.y || 0)) > 0.45
    )
      continue;
    const travel = routeLength(actor, path);
    if (travel > Math.min(34, distance(actor, c.point) * 2.5 + 5)) continue;
    return {
      ...c,
      path,
      travel,
      threat: { x: threat.x, y: threat.y || 0, z: threat.z },
    };
  }
  return null;
}

function clearWalk(actor, wish, world, length, allowDrop) {
  const n = Math.hypot(wish.x, wish.z);
  if (n < 0.001) return true;
  const probe = { ...actor, vy: 0 },
    steps = Math.ceil(length / 0.16),
    step = length / steps,
    dx = wish.x / n,
    dz = wish.z / n;
  for (let i = 0; i < steps; i++) {
    const x = probe.x,
      z = probe.z;
    moveBody(probe, dx * step, dz * step, world.boxes);
    if ((probe.x - x) * dx + (probe.z - z) * dz < step * 0.8) return false;
    verticalStep(
      probe,
      step / Math.max(7, Math.hypot(actor.vx || 0, actor.vz || 0)),
      world.boxes,
    );
    if (!probe.grounded && !allowDrop) return false; // Do not run blindly off raised cover.
    if (
      world.bounds &&
      (probe.x < world.bounds.minX ||
        probe.x > world.bounds.maxX ||
        probe.z < world.bounds.minZ ||
        probe.z > world.bounds.maxZ)
    )
      return false;
  }
  return true;
}

// Capsule/support probes choose a nearby tangent when an intended ground move
// would run into a slab or off a ledge. Does not overwrite impulses/air control.
export function chooseSafeWish(
  actor,
  wish,
  world,
  { maxDistance = Infinity, allowDrop = false } = {},
) {
  const magnitude = Math.min(1, Math.hypot(wish.x, wish.z));
  if (
    !actor.grounded ||
    actor.dashTime > 0 ||
    actor.slideTime > 0 ||
    magnitude < 0.01
  )
    return { ...wish, avoided: false };
  const length = Math.max(
    0.12,
    Math.min(
      maxDistance,
      Math.max(
        0.8,
        Math.min(1.5, Math.hypot(actor.vx || 0, actor.vz || 0) * 0.13 + 0.4),
      ),
    ),
  );
  if (clearWalk(actor, wish, world, length, allowDrop))
    return { ...wish, avoided: false };
  const angle = Math.atan2(wish.z, wish.x),
    side = actor.strafe < 0 ? -1 : 1;
  for (const turn of [
    (side * Math.PI) / 4,
    (-side * Math.PI) / 4,
    (side * Math.PI) / 2,
    (-side * Math.PI) / 2,
    Math.PI,
  ]) {
    const candidate = {
      x: Math.cos(angle + turn) * magnitude,
      z: Math.sin(angle + turn) * magnitude,
    };
    if (clearWalk(actor, candidate, world, length, allowDrop))
      return { ...candidate, avoided: true };
  }
  return { x: 0, z: 0, avoided: true };
}

export function steerBotWish(actor, wish, world, clock, options = {}) {
  if (!actor.grounded || actor.dashTime > 0 || actor.slideTime > 0) return wish;
  const changed =
    !actor.steerIntent ||
    Math.hypot(wish.x - actor.steerIntent.x, wish.z - actor.steerIntent.z) >
      0.35;
  if (clock >= (actor.steerReadyAt || 0) || changed) {
    actor.steerReadyAt = clock + 0.1;
    actor.steerIntent = { ...wish };
    actor.safeWish = chooseSafeWish(actor, wish, world, options);
    if (actor.safeWish.avoided && Math.hypot(wish.x, wish.z) > 0.1) {
      actor.avoidanceSince ??= clock;
      actor.actionCounts ||= {};
      actor.actionCounts.obstacleAvoids =
        (actor.actionCounts.obstacleAvoids || 0) + 1;
    } else actor.avoidanceSince = null;
  }
  return actor.safeWish?.avoided ? actor.safeWish : wish;
}

// Per-actor tactical lifecycle; expensive route searches are cooldown-gated.
export function positionBot(actor, c) {
  const {
    clock,
    world,
    visible,
    reacted,
    defensive,
    skill,
    teammates,
    canSee,
    targetKey,
  } = c;
  const known = actor.lastKnown;
  if (visible && reacted) {
    actor.lastReactedAt = clock;
    actor.lastReactedTarget = targetKey;
  }
  let plan = actor.attackPlan;
  const cancel = () => {
    actor.attackPlan = null;
    actor.attackReadyAt = clock + 2.5;
  };
  if (
    plan &&
    (defensive ||
      !known ||
      actor.activeWeapon !== "rifle" ||
      plan.targetKey !== targetKey ||
      distance(actor, known) < 7 ||
      clock > plan.expires ||
      distance(known, plan.threat) > 5)
  ) {
    cancel();
    plan = null;
  }
  if (
    !plan &&
    known &&
    !defensive &&
    actor.activeWeapon === "rifle" &&
    skill > 0 &&
    distance(actor, known) >= 9 &&
    clock >= (actor.attackReadyAt || 0)
  ) {
    const recentReaction =
      actor.lastReactedTarget === targetKey &&
      clock - (actor.lastReactedAt ?? -Infinity) < 1.2;
    const highGround = actor.meleeId === "katana" || actor.meleeId === "knife";
    const flank =
      (actor.stuckTime || 0) > 0.12 ||
      !visible ||
      clock - (actor.avoidanceSince ?? clock) > 0.4;
    if (recentReaction && (highGround || flank)) {
      actor.attackReadyAt = clock + 3.5 + ((actor.seed || 0) % 1) * 2;
      plan = chooseFiringPosition(actor, known, world, canSee, teammates, {
        highGround,
        flank,
      });
      if (plan) {
        Object.assign(plan, {
          targetKey,
          expires:
            clock + Math.min(7, plan.travel / Math.max(7, c.speed) + 2.2),
        });
        actor.attackPlan = plan;
        actor.actionCounts ||= {};
        const key = plan.kind === "high" ? "highGroundPlans" : "flankPlans";
        actor.actionCounts[key] = (actor.actionCounts[key] || 0) + 1;
      }
    }
  }
  if (!plan) return null;
  if (plan.path.length) {
    const direction = followRoute(actor, plan.path, 0.12);
    if (plan.path.length)
      return { ...direction, path: plan.path, moving: true };
  }
  const back = distance(actor, plan.point);
  const recenter = () => {
    const speed = Math.min(0.6, back * 4);
    return {
      x: back > 0.001 ? ((plan.point.x - actor.x) / back) * speed : 0,
      z: back > 0.001 ? ((plan.point.z - actor.z) / back) * speed : 0,
      path: [plan.point],
      moving: !plan.arrived,
    };
  };
  // A nav cell is not a whole firing angle: finish a tight peek precisely.
  if (!canSee(actor, known)) {
    if (back > 0.04) return recenter();
    cancel();
    return null;
  }
  if (!plan.arrived) {
    plan.arrived = true;
    plan.holdUntil = clock + 1.6 + ((actor.seed || 0) % 1) * 0.6;
    const key = plan.kind === "high" ? "highGroundArrivals" : "flankArrivals";
    actor.actionCounts[key] = (actor.actionCounts[key] || 0) + 1;
  }
  if (visible) plan.lostAt = null;
  else plan.lostAt ??= clock;
  if (clock > plan.holdUntil || (!visible && clock - plan.lostAt > 0.65)) {
    cancel();
    return null;
  }
  if (back > 0.45) return recenter();
  if (clock >= (plan.strafeReadyAt || 0)) {
    plan.strafeReadyAt = clock + 0.1;
    const d = Math.max(0.1, distance(actor, known)),
      tx = (known.z - actor.z) / d,
      tz = -(known.x - actor.x) / d;
    const open = (side) =>
      canSee(
        {
          x: actor.x + tx * 0.45 * side,
          y: actor.y,
          z: actor.z + tz * 0.45 * side,
        },
        known,
      );
    let side = actor.strafe;
    if (!open(side)) {
      side = -side;
      if (!open(side)) side = 0;
    }
    if (side) actor.strafe = side;
    plan.holdWish = { x: tx * side * 0.2, z: tz * side * 0.2 };
  }
  return { ...plan.holdWish, moving: false };
}
