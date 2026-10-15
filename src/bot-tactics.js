import { canOccupy } from "./physics.js";

// Prefer an actually visible opponent, with modest target stickiness. Hidden
// opponents never provide live aiming or cover coordinates to the planner.
export function selectOpponent(actor, enemies, canSee) {
  const ranked = [...enemies].sort(
    (a, b) =>
      Math.hypot(a.x - actor.x, a.z - actor.z) -
      (a === actor.targetEntity ? 3 : 0) -
      (Math.hypot(b.x - actor.x, b.z - actor.z) -
        (b === actor.targetEntity ? 3 : 0)),
  );
  for (const target of ranked.slice(0, 3))
    if (canSee(target)) return { target, visible: true };
  return { target: ranked[0], visible: false };
}

// Bounded 24-candidate local search, performed only at tactical intervals.
// A point must both break line of sight and have a complete walkable route.
export function chooseCover(
  actor,
  threat,
  world,
  hiddenFromThreat,
  teammates = [],
) {
  const nav = world.nav;
  if (!nav || !threat) return null;
  if (hiddenFromThreat(actor))
    return { point: { x: actor.x, y: actor.y, z: actor.z }, path: [] };
  const candidates = [],
    seen = new Set();
  for (const radius of [2.4, 4.8, 7.2])
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4,
        index = nav.index(
          actor.x + Math.cos(angle) * radius,
          actor.z + Math.sin(angle) * radius,
        );
      if (seen.has(index) || nav.blocked[index]) continue;
      seen.add(index);
      const point = nav.point(index),
        y = point.y || 0;
      if (
        Math.abs(y - actor.y) > 1.8 ||
        !canOccupy(actor, point.x, y, point.z, world.boxes)
      )
        continue;
      if (!hiddenFromThreat(point)) continue;
      const travel = Math.hypot(point.x - actor.x, point.z - actor.z),
        distance = Math.hypot(point.x - threat.x, point.z - threat.z);
      if (distance < 3 || travel < 1) continue;
      const crowd = teammates.reduce((sum, mate) => {
        if (mate === actor || !mate.alive || mate.team !== actor.team)
          return sum;
        const occupied = mate.coverPlan?.point || mate;
        return (
          sum +
          Math.max(
            0,
            2 - Math.hypot(occupied.x - point.x, occupied.z - point.z),
          ) *
            4
        );
      }, 0);
      candidates.push({
        point,
        score: travel + crowd + Math.max(0, 9 - distance) * 1.5,
      });
    }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates.slice(0, 3)) {
    const path = nav.path(actor, candidate.point),
      end = path.at(-1);
    if (
      end &&
      Math.hypot(end.x - candidate.point.x, end.z - candidate.point.z) <
        nav.cell * 1.5
    )
      return { point: candidate.point, path };
  }
  return null;
}

export function followRoute(actor, path) {
  while (
    path.length &&
    Math.hypot(actor.x - path[0].x, actor.z - path[0].z) < 0.65
  )
    path.shift();
  if (!path.length) return { x: 0, z: 0 };
  const dx = path[0].x - actor.x,
    dz = path[0].z - actor.z,
    length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
}
