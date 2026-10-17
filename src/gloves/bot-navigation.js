import { steerBotWish } from "../bot-positioning.js";
import { followRoute } from "../bot-tactics.js";
import { playGloveStepAudio } from "./audio.js";
// Offline movement planning only. Capsule collision/acceleration, damage and
// accepted player movement constants remain the sole movement implementation.
export function gloveBotWish(
  g,
  actor,
  target,
  intent,
  visible,
  distance,
  range,
  dt,
) {
  let nav = actor.gloveNavigation;
  if (!nav || nav.target !== target) {
    nav = actor.gloveNavigation = { target, until: 0 };
    actor.path = [];
    actor.pathTimer = 0;
    actor.gloveBlockedFor = 0;
    actor.avoidanceSince = null;
    actor.steerReadyAt = 0;
  }
  const closing = intent.tactic === "approach" && distance > range * 0.96;
  const avoiding =
    actor.avoidanceSince != null && g.clock - actor.avoidanceSince > 0.32;
  if (!visible) nav.until = Math.max(nav.until, g.clock + 0.8);
  else if (closing && (avoiding || actor.gloveBlockedFor > 0.24))
    nav.until = Math.max(nav.until, g.clock + 1.8);
  const route = !visible || (closing && g.clock < nav.until);
  let wish = intent.wish;
  if (route && g.world.nav) {
    actor.pathTimer = (actor.pathTimer || 0) - dt;
    if (actor.pathTimer <= 0) {
      actor.pathTimer = 0.6;
      actor.path = g.world.nav.path(actor, target);
    }
    if (actor.path?.length) wish = followRoute(actor, actor.path);
  }
  return steerBotWish(actor, wish, g.world, g.clock);
}
export function recordGloveBotTravel(
  g,
  actor,
  startX,
  startZ,
  requested,
  dt,
  glove,
) {
  const moved = Math.hypot(actor.x - startX, actor.z - startZ);
  actor.animationPhase =
    (actor.animationPhase ?? actor.seed ?? 0) + moved * 2.7;
  actor.gloveBlockedFor =
    actor.grounded && requested > 0.002 && moved < requested * 0.25
      ? Math.min(1, (actor.gloveBlockedFor || 0) + dt)
      : Math.max(0, (actor.gloveBlockedFor || 0) - dt * 2);
  if (
    !actor.grounded ||
    (["acrobat", "magnet"].includes(glove.key) && actor.boostTime > 0)
  )
    return moved;
  actor.footDistance = (actor.footDistance || 0) + moved;
  if (actor.footDistance >= 3.4 && g.clock >= (actor.nextGloveStep || 0)) {
    actor.footDistance %= 3.4;
    actor.nextGloveStep = g.clock + 0.16;
    playGloveStepAudio(g, actor);
  }
  return moved;
}
