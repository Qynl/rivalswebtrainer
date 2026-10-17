import { MOVEMENT } from "../movement.js";
import { canOccupy } from "../physics.js";
import { duelBotSkill } from "./bot-dueling.js";

// Offline opponents can react to an actual visible, armed floor trap. This is
// an ordinary jump, never immunity, a teleport or knowledge of its hidden owner.
export function considerGloveTrapJump(g, actor, glove) {
  const committed =
    actor.boostTime > 0 &&
    (["acrobat", "magnet"].includes(glove.key) ||
      (glove.key === "default" && actor.boostTime > 1));
  if (
    g.network ||
    actor === g.player ||
    !actor.grounded ||
    actor.ragdollTime > 0 ||
    actor.stoneTime > 0 ||
    committed
  ) {
    actor.gloveTrapNotice = null;
    return false;
  }
  const speed = Math.hypot(actor.vx, actor.vz);
  let nearest = null,
    travel = Infinity;
  if (speed > 1)
    for (const brick of g.gloveBricks || []) {
      if (
        !brick.owner ||
        brick.owner.team == null ||
        brick.owner.team === actor.team ||
        !(brick.life > 0) ||
        !(brick.armedAt <= g.clock) ||
        Math.abs(actor.y - brick.y) > 0.45
      )
        continue;
      const dx = brick.x - actor.x,
        dz = brick.z - actor.z,
        distance = Math.hypot(dx, dz);
      if (
        distance < 0.85 ||
        distance > 4.5 ||
        (-Math.sin(actor.yaw || 0) * dx - Math.cos(actor.yaw || 0) * dz) /
          distance <
          0.15
      )
        continue;
      const along = (dx * actor.vx + dz * actor.vz) / speed,
        across = Math.abs(dx * actor.vz - dz * actor.vx) / speed;
      if (
        along <= 0 ||
        across > 0.9 ||
        along >= travel ||
        !g.hasLOS(
          g.eye(actor),
          g.eye({ x: brick.x, y: brick.y, z: brick.z, height: 0.25 }),
        )
      )
        continue;
      nearest = brick;
      travel = along;
    }
  if (!nearest) {
    actor.gloveTrapNotice = null;
    return false;
  }
  let notice = actor.gloveTrapNotice;
  if (notice?.brick !== nearest)
    notice = actor.gloveTrapNotice = { brick: nearest, seenAt: g.clock };
  if (
    g.clock - notice.seenAt < duelBotSkill(g.config?.difficulty).reaction ||
    travel > Math.max(1.25, speed * 0.18)
  )
    return false;
  if (
    !canOccupy(
      actor,
      actor.x,
      actor.y + 0.6,
      actor.z,
      g.world.boxes,
      actor.height,
    )
  )
    return false;
  actor.vy = glove.key === "spring" ? 13.4 : MOVEMENT.jumpSpeed;
  actor.grounded = false;
  actor.jumps = 1;
  actor.gloveTrapNotice = null;
  return true;
}
