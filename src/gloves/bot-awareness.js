import { selectOpponent } from "../bot-tactics.js";
import { canOccupy } from "../physics.js";

// Sensor queries may inspect physical positions to establish sight/contact.
// Once a query fails, planners receive only this bot's own remembered snapshot.
export function gloveEnemyVisible(g, actor, other) {
  if (other.ghostTime > 0) {
    const touching =
      Math.hypot(other.x - actor.x, other.z - actor.z) <
        (actor.radius || 0.38) + (other.radius || 0.38) + 0.1 &&
      other.y < actor.y + (actor.height || 1.9) &&
      actor.y < other.y + (other.height || 1.9);
    if (!touching) return false;
  }
  return g.hasLOS(g.eye(actor), g.eye(other));
}
function spawnGoal(g, target) {
  return (
    target.spawnPoint ||
    g.world.spawns?.[target.team]?.[0] || { x: 0, y: 0, z: 0 }
  );
}
export function selectGloveOpponent(g, actor, enemies) {
  const visible = enemies.filter((other) => gloveEnemyVisible(g, actor, other));
  if (visible.length) return selectOpponent(actor, visible, () => true).target;
  if (enemies.includes(actor.targetEntity)) return actor.targetEntity;
  // Spawn layout and team identities are public. Never rank covered opponents
  // using their current, hidden positions.
  return [...enemies].sort((a, b) => {
    const pa = spawnGoal(g, a),
      pb = spawnGoal(g, b);
    return (
      Math.hypot(pa.x - actor.x, pa.z - actor.z) -
      Math.hypot(pb.x - actor.x, pb.z - actor.z)
    );
  })[0];
}
export function glovePerceivedTarget(g, actor, target, visible) {
  let memory = actor.gloveAwareness;
  if (!memory || memory.target !== target) {
    const spawn = spawnGoal(g, target);
    memory = actor.gloveAwareness = {
      target,
      seenAt: null,
      base: { x: spawn.x, y: spawn.y || 0, z: spawn.z },
      goal: {
        id: target.id,
        team: target.team,
        x: spawn.x,
        y: spawn.y || 0,
        z: spawn.z,
      },
      searchStep: 0,
      nextSearch: 0,
    };
  }
  const goal = memory.goal;
  if (visible) {
    Object.assign(goal, {
      x: target.x,
      y: target.y,
      z: target.z,
      vx: target.vx || 0,
      vz: target.vz || 0,
      goldTime: target.goldTime || 0,
      stoneTime: target.stoneTime || 0,
      reverseTime: target.reverseTime || 0,
      slapPending: target.slapPending,
    });
    Object.assign(memory.base, { x: goal.x, y: goal.y, z: goal.z });
    memory.seenAt = g.clock;
    memory.searchStep = 0;
    memory.nextSearch = g.clock + 0.8;
  } else {
    // No target coordinates, motion or protection state is read in this branch.
    goal.vx = goal.vz = 0;
    goal.slapPending = null;
    goal.goldTime = goal.stoneTime = goal.reverseTime = 0;
    if (
      g.clock >= memory.nextSearch &&
      Math.hypot(actor.x - goal.x, actor.z - goal.z) < 1.3
    ) {
      memory.nextSearch = g.clock + 1.5;
      const nav = g.world.nav;
      let searches = 0;
      if (nav)
        for (let i = 0; i < 8; i++) {
          const step = memory.searchStep++,
            angle = step * Math.PI * 0.75 + (actor.seed || 0),
            radius = 2.5 + (Math.floor(step / 8) % 3) * 2;
          // After local sweeps, roam public walkable map space instead of
          // orbiting one empty last-known location forever. No opponent data.
          const patrol = step >= 16;
          const x = patrol
            ? (((step * 0.61803398875 + (actor.seed || 0) * 0.01) % 1) - 0.5) *
              (nav.size - nav.cell * 2)
            : memory.base.x + Math.cos(angle) * radius;
          const z = patrol
            ? (((step * 0.41421356237 + (actor.seed || 0) * 0.017) % 1) - 0.5) *
              (nav.sizeZ - nav.cell * 2)
            : memory.base.z + Math.sin(angle) * radius;
          const index = nav.index(x, z);
          if (nav.blocked[index]) continue;
          const point = nav.point(index);
          if (
            Math.hypot(point.x - actor.x, point.z - actor.z) < 1.5 ||
            !canOccupy(actor, point.x, point.y || 0, point.z, g.world.boxes)
          )
            continue;
          const path = nav.path(actor, point),
            end = path.at(-1);
          searches++;
          if (
            !end ||
            Math.abs((end.y || 0) - (point.y || 0)) > 0.5 ||
            Math.hypot(end.x - point.x, end.z - point.z) >
              Math.max(nav.cell * 1.5, 1.2)
          ) {
            if (searches >= 2) break;
            continue;
          }
          Object.assign(goal, point);
          actor.pathTimer = 0;
          break;
        }
    }
  }
  return goal;
}
