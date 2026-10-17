import { GLOVES, DEFAULT_GLOVE, gloveLoadout } from "./catalog.js";
export const PRACTICE_MODES = Object.freeze({
  strafe: "Strafing targets",
  stationary: "Stationary targets",
  sparring: "Fighting opponents",
});
export function practiceOptions(value = {}) {
  if (!value || typeof value !== "object") value = {};
  return {
    mode: Object.hasOwn(PRACTICE_MODES, value.mode) ? value.mode : "strafe",
    count: [1, 3, 5].includes(value.count) ? value.count : 5,
    opponent: GLOVES[value.opponent] ? value.opponent : DEFAULT_GLOVE,
  };
}
export function freshPracticeStats() {
  return { damage: 0, contacts: 0, launches: 0, peak: 0 };
}
// Later accepted impulses (for example Boomerang's return) can raise the real
// peak without inventing another contact, damage value or earned slap.
export function recordPracticeImpulse(g, source, velocity) {
  if (
    !g.range ||
    g.network ||
    source !== g.player ||
    !Array.isArray(velocity) ||
    velocity.length !== 3 ||
    !velocity.every(Number.isFinite)
  )
    return;
  const stats = (g.practiceStats ||= freshPracticeStats());
  stats.peak = Math.max(stats.peak, Math.hypot(...velocity));
}
export function recordPracticeImpact(
  g,
  source,
  healthBefore,
  target,
  velocity,
  direct,
) {
  if (!g.range || g.network || source !== g.player) return;
  const stats = (g.practiceStats ||= freshPracticeStats());
  const damage = Math.max(0, healthBefore - target.health);
  const peak = Math.hypot(...velocity);
  if (Number.isFinite(damage)) stats.damage += damage;
  if (direct) stats.contacts++;
  stats.launches++;
  if (Number.isFinite(peak)) stats.peak = Math.max(stats.peak, peak);
}
export function resetPracticeTarget(e) {
  for (const key of [
    "ragdollTime",
    "slapGrace",
    "stoneTime",
    "chillTime",
    "gloveCooldown",
    "abilityCooldown",
    "boostTime",
    "ghostTime",
    "goldTime",
    "reverseTime",
    "spaceTime",
    "markTime",
  ])
    e[key] = 0;
  e.slapPending =
    e.gloveMark =
    e.boomerangAt =
    e.boomerangOwner =
    e.gloveDuel =
      null;
  e.gloveAwareness = e.gloveNavigation = e.targetEntity = null;
  e.path = [];
  e.pathTimer = e.gloveRetargetAt = e.steerReadyAt = 0;
  e.avoidanceSince = null;
  e.visible = false;
  e.gloveBlockedFor = 0;
  e.footDistance = e.nextGloveStep = e.diceRoll = 0;
  e.diceRollAt = undefined;
  e.animationPhase = e.seed || 0;
  e.alive = true;
  e.health = e.maxHealth || 150;
  e.height = 1.9;
  e.vx = e.vy = e.vz = 0;
  e.y = 0;
  e.grounded = true;
  if (e.practiceSpawn) {
    e.x = e.practiceSpawn.x;
    e.z = e.practiceSpawn.z;
  }
}
export function resetPractice(g) {
  if (
    !g.range ||
    g.network ||
    !g.player ||
    !GLOVES[g.loadout?.[0]] ||
    !["playing", "paused"].includes(g.state)
  )
    return false;
  const paused = g.state === "paused";
  g.startRound();
  if (paused) {
    g.state = "paused";
    g.previousState = "playing";
  }
  g.events.update?.(g);
  return true;
}
export function configurePractice(g, { glove, ...options }) {
  if (
    !GLOVES[glove] ||
    !g.range ||
    g.network ||
    !g.player ||
    !["playing", "paused"].includes(g.state)
  )
    return false;
  g.practiceOptions = practiceOptions(options);
  g.testDrive = true;
  g.loadout = gloveLoadout(glove);
  g.config = {
    ...g.config,
    loadout: [...g.loadout],
    testDrive: true,
    practiceOptions: { ...g.practiceOptions },
  };
  return resetPractice(g);
}
