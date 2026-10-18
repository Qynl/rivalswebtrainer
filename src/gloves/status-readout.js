import { STONE_REARM, SPACE_REARM, ABILITY_CASTS } from "./balance.js";
// Read the actual authoritative/predicted-local timers; never start a cosmetic
// countdown that could claim protection, recovery or a rush after it ended.
const STATUSES = Object.freeze([
  ["stoneTime", "STONE FORM"],
  ["ragdollTime", "RAGDOLL"],
  ["goldTime", "POWERUP"],
  ["reverseTime", "REFLECTING"],
  ["ghostTime", "HIDDEN"],
  ["spaceTime", "ZERO-G"],
  ["chillTime", "CHILLED"],
]);
const BOOST_LABELS = Object.freeze({
  default: "BOOSTING",
  acrobat: "DODGE ROLL",
  magnet: "MAGNET RUSH",
});
function read(label, value) {
  return { label, remaining: Math.max(0.1, Math.ceil(value * 10 - 1e-6) / 10) };
}
export function gloveStatusReadout(body, key) {
  if (!body || body.alive === false) return { label: "", remaining: 0 };
  for (const [field, label] of STATUSES) {
    const value = body[field];
    if (Number.isFinite(value) && value > 0) return read(label, value);
  }
  if (
    Object.hasOwn(BOOST_LABELS, key) &&
    Number.isFinite(body.boostTime) &&
    body.boostTime > 0
  )
    return read(BOOST_LABELS[key], body.boostTime);
  return { label: "", remaining: 0 };
}

// Availability is separate from cooldown completion: a recovered cooldown does
// not make a cast legal during prep, a ragdoll, stone form or elimination.
export function gloveAbilityReadout(body, glove, phase) {
  const cooldown = body?.abilityCooldown ?? 0;
  const total =
    glove?.key === "thanos" && body?.markTime > 0
      ? 0.4
      : glove?.abilityCooldown;
  const duration = Number.isFinite(total) && total > 0 ? total : 1;
  const progress = Number.isFinite(cooldown)
    ? Math.max(0, Math.min(1, 1 - Math.max(0, cooldown) / duration))
    : 0;
  let label;
  if (!body || body.alive === false) label = "OUT";
  else if (glove?.activation !== "active") label = "PASSIVE";
  else if (phase === "countdown") label = "PREP";
  else if (phase !== "playing") label = "WAIT";
  else if (body.stoneTime > 0)
    label =
      glove.key === "diamond"
        ? cooldown <= glove.abilityCooldown - STONE_REARM + 1e-8
          ? "EXIT"
          : "REARM"
        : "STONE";
  else if (body.ragdollTime > 0) label = "RECOVER";
  else if (body.gloveAbilityPending?.remaining > 0) label = "CAST";
  else if (glove.key === "space" && body.spaceTime > 0)
    label =
      cooldown > glove.abilityCooldown - SPACE_REARM + 1e-8 ? "REARM" : "END";
  else if (!Number.isFinite(cooldown)) label = "WAIT";
  else if (cooldown > 0) label = `${read("", cooldown).remaining.toFixed(1)}s`;
  else if (glove.key === "thanos" && body.markTime > 0) label = "RETURN";
  else label = "READY";
  const readyProgress =
    label === "PASSIVE" || label === "EXIT" || label === "END"
      ? 1
      : label === "REARM"
        ? (glove.abilityCooldown - cooldown) /
          (glove.key === "space" ? SPACE_REARM : STONE_REARM)
        : label === "CAST"
          ? 1 -
            body.gloveAbilityPending.remaining / (ABILITY_CASTS[glove.key] || 1)
          : progress;
  return {
    label,
    progress: Number.isFinite(readyProgress)
      ? Math.max(0, Math.min(1, readyProgress))
      : 0,
  };
}
