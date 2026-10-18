import { MOVEMENT } from "../movement.js";
import { canOccupy } from "../physics.js";
import { duelBotSkill } from "./bot-dueling.js";
import { inErasureLane } from "./balance.js";
// Perceived, visible tells only. This module never consults a hidden actor,
// changes immunity, cancels an enemy cast or teleports an opponent out of danger.
export function castCounterplay(g, actor, glove, perceived, visible, wish) {
  actor.gloveCounterplay = null;
  const cast = visible ? perceived?.abilityCast : null;
  const committed =
    actor.boostTime > 0 &&
    (["acrobat", "magnet"].includes(glove.key) ||
      (glove.key === "default" && actor.boostTime > 1));
  if (
    g.network ||
    actor === g.player ||
    !actor.alive ||
    actor.ragdollTime > 0 ||
    actor.stoneTime > 0 ||
    actor.gloveAbilityPending ||
    committed ||
    !cast ||
    cast.remaining <= 0 ||
    !["glove_stun", "glove_za_hando"].includes(cast.id)
  ) {
    actor.gloveCastNotice = null;
    return null;
  }
  const dx = actor.x - perceived.x,
    dz = actor.z - perceived.z,
    distance = Math.hypot(dx, dz);
  if (
    distance > 9.5 ||
    Math.abs(actor.y - perceived.y) > 2.4 ||
    (-Math.sin(actor.yaw || 0) * -dx - Math.cos(actor.yaw || 0) * -dz) /
      Math.max(0.001, distance) <
      0.1
  ) {
    actor.gloveCastNotice = null;
    return null;
  }
  let notice = actor.gloveCastNotice;
  // Remaining time grows on a genuinely new cast, even for the same opponent.
  if (
    !notice ||
    notice.target !== perceived.id ||
    notice.id !== cast.id ||
    cast.remaining > notice.remaining + 0.03
  )
    notice = actor.gloveCastNotice = {
      target: perceived.id,
      id: cast.id,
      seenAt: g.clock,
      remaining: cast.remaining,
    };
  notice.remaining = cast.remaining;
  if (g.clock - notice.seenAt < duelBotSkill(g.config?.difficulty).reaction)
    return null;
  if (cast.id === "glove_stun") {
    if (
      distance > 5.9 ||
      !actor.grounded ||
      !canOccupy(
        actor,
        actor.x,
        actor.y + 0.6,
        actor.z,
        g.world.boxes,
        actor.height,
      )
    )
      return null;
    actor.vy = glove.key === "spring" ? 13.4 : MOVEMENT.jumpSpeed;
    actor.grounded = false;
    actor.jumps = 1;
    actor.gloveCounterplay = "jump-emp";
    return { wish, speed: 1, jumped: true };
  }
  if (!inErasureLane(dx, dz, cast.yaw, actor.radius + 0.3)) return null;
  const side = Math.cos(cast.yaw) * dx - Math.sin(cast.yaw) * dz,
    preferred = Math.abs(side) > 0.1 ? Math.sign(side) : actor.strafe || 1;
  for (const sign of [preferred, -preferred]) {
    const dodge = {
        x: Math.cos(cast.yaw) * sign,
        z: -Math.sin(cast.yaw) * sign,
      },
      x = actor.x + dodge.x * 0.8,
      z = actor.z + dodge.z * 0.8,
      b = g.world.bounds;
    if (
      b &&
      (x < b.minX + actor.radius ||
        x > b.maxX - actor.radius ||
        z < b.minZ + actor.radius ||
        z > b.maxZ - actor.radius)
    )
      continue;
    if (
      [0.2, 0.4, 0.6, 0.8].some(
        (distance) =>
          !canOccupy(
            actor,
            actor.x + dodge.x * distance,
            actor.y,
            actor.z + dodge.z * distance,
            g.world.boxes,
            actor.height,
          ),
      )
    )
      continue;
    actor.gloveCounterplay = "sidestep-erasure";
    return { wish: dodge, speed: 1 };
  }
  return null;
}
