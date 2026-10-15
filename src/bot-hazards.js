import { canOccupy } from "./physics.js";

const radii = { grenade: 6, molotov: 3.2, rpg: 4.5, launcher: 4.5 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Uses only visible hostile hazards. No hidden-player coordinates, future
// collision knowledge or perfect projectile simulation is exposed to the bot.
export function visibleHazards(
  actor,
  projectiles = [],
  fires = [],
  canSee = () => true,
) {
  const threats = [];
  for (const p of projectiles.slice(-64)) {
    const radius = radii[p.id];
    if (
      !radius ||
      !p.owner ||
      p.owner.team === actor.team ||
      p.owner === actor ||
      p.fuse <= 0 ||
      distance(actor, p.pos) > 13 ||
      !canSee(p.pos)
    )
      continue;
    if (p.id === "grenade" && p.fuse > 1.1) continue;
    const velocity = p.vel || { x: 0, y: 0, z: 0 },
      speed2 = velocity.x ** 2 + velocity.z ** 2,
      approach =
        speed2 > 1
          ? Math.max(
              0,
              Math.min(
                0.3,
                ((actor.x - p.pos.x) * velocity.x +
                  (actor.z - p.pos.z) * velocity.z) /
                  speed2,
              ),
            )
          : 0,
      t = Math.min(approach, p.fuse),
      point = {
        x: p.pos.x + velocity.x * t,
        y: Math.max(0, p.pos.y + velocity.y * t - (p.rocket ? 0 : 9 * t * t)),
        z: p.pos.z + velocity.z * t,
      };
    if (
      Math.abs(point.y - actor.y) > 3 ||
      distance(actor, point) > radius + 1.8
    )
      continue;
    // A departing rocket is not a reason to chase it or break useful cover.
    if (p.rocket && approach === 0 && distance(actor, p.pos) > 2) continue;
    threats.push({ source: p, point, radius, weight: p.rocket ? 1.3 : 1 });
  }
  for (const fire of fires.slice(-24)) {
    if (
      fire.owner?.team === actor.team ||
      fire.effect.life <= 0 ||
      Math.abs(fire.pos.y - actor.y) > 1.5 ||
      distance(actor, fire.pos) > 4.8 ||
      !canSee(fire.pos)
    )
      continue;
    threats.push({ source: fire, point: fire.pos, radius: 3.2, weight: 1.1 });
  }
  return threats
    .sort(
      (a, b) =>
        distance(actor, a.point) -
        a.radius -
        (distance(actor, b.point) - b.radius),
    )
    .slice(0, 4);
}

export function hazardEscape(actor, threats, world) {
  if (!threats.length) return null;
  const nearest = threats[0].point,
    away = Math.atan2(actor.z - nearest.z, actor.x - nearest.x),
    risk = (point) =>
      threats.reduce(
        (sum, h) =>
          sum +
          Math.max(0, h.radius + 1 - distance(point, h.point)) ** 2 * h.weight,
        0,
      ),
    startRisk = risk(actor);
  let best = null;
  for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI]) {
    const angle = away + turn,
      x = Math.cos(angle),
      z = Math.sin(angle),
      point = { x: actor.x + x * 1.4, y: actor.y, z: actor.z + z * 1.4 };
    const b = world.bounds;
    if (
      b &&
      (point.x < b.minX ||
        point.x > b.maxX ||
        point.z < b.minZ ||
        point.z > b.maxZ)
    )
      continue;
    if (
      ![0.5, 1].every((t) =>
        canOccupy(
          actor,
          actor.x + x * 1.4 * t,
          actor.y,
          actor.z + z * 1.4 * t,
          world.boxes,
        ),
      )
    )
      continue;
    if (world.nav) {
      const index = world.nav.index(point.x, point.z);
      if (
        world.nav.blocked[index] ||
        Math.abs((world.nav.heights[index] || 0) - actor.y) > 0.7
      )
        continue;
    }
    const score = risk(point) + Math.abs(turn) * 0.08;
    if (score < startRisk - 0.02 && (!best || score < best.score))
      best = { x, z, score };
  }
  return best;
}

// Tactical search is capped at ~8 Hz per bot, independent of simulation rate.
// A visible threat requires the difficulty's reaction time before steering.
export function evadeHazards(
  actor,
  { clock, projectiles, fires, world, canSee, reaction = 0.2 },
) {
  if (clock < (actor.hazardCheckAt || 0)) return actor.hazardWish || null;
  actor.hazardCheckAt = clock + 0.12;
  const threats = visibleHazards(actor, projectiles, fires, canSee);
  if (!threats.length) {
    actor.hazardSeen = actor.hazardWish = null;
    return null;
  }
  const source = threats[0].source;
  if (actor.hazardSeen?.source !== source)
    actor.hazardSeen = { source, at: clock };
  if (clock - actor.hazardSeen.at < reaction) return (actor.hazardWish = null);
  return (actor.hazardWish = hazardEscape(actor, threats, world));
}
