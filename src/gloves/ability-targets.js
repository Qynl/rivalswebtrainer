import { canOccupy } from "../physics.js";
// A single eligibility/aim policy drives authority and the advisory reticle.
// Never expose an occluded/invisible actor, its name, health or private marker.
export function abilityTarget(g, body, key) {
  if (!["magnet", "swapper"].includes(key)) return null;
  const origin = g.eye(body),
    context = body.context,
    yaw = context?.yaw ?? (body === g.player ? g.yaw : body.yaw) ?? 0,
    pitch = context?.pitch ?? (body === g.player ? g.pitch : 0) ?? 0;
  const forward = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  let best = null,
    score = Infinity;
  for (const e of g.entities || []) {
    if (
      e === body ||
      !e.alive ||
      e.team === body.team ||
      e.ghostTime > 0 ||
      e.stoneTime > 0 ||
      e.goldTime > 0 ||
      e.ragdollTime > 0 ||
      (key === "swapper" && e.slapGrace > 0)
    )
      continue;
    const target = g.eye(e),
      dx = target.x - origin.x,
      dy = target.y - origin.y,
      dz = target.z - origin.z,
      d = Math.hypot(dx, dy, dz);
    if (d < 0.1 || d > (key === "magnet" ? 14 : 20)) continue;
    const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
    if (dot < (key === "magnet" ? 0.35 : 0.97) || !g.hasLOS(origin, target))
      continue;
    if (
      key === "swapper" &&
      (!canOccupy(body, e.x, e.y, e.z, g.world.boxes, body.height) ||
        !canOccupy(e, body.x, body.y, body.z, g.world.boxes, e.height))
    )
      continue;
    const rank =
      key === "swapper"
        ? (1 - dot) * 100 + d * 0.0001
        : d * (1.45 - 0.45 * dot);
    if (rank < score) {
      score = rank;
      best = e;
    }
  }
  return best;
}
export function abilityTargetCue(g) {
  const p = g.player,
    key = g.loadout?.[0]?.replace("glove_", "");
  if (
    !p?.alive ||
    g.state !== "playing" ||
    p.ragdollTime > 0 ||
    p.stoneTime > 0 ||
    p.abilityCooldown > 0 ||
    p.gloveAbilityPending
  )
    return null;
  const target = abilityTarget(g, p, key);
  if (!target) return null;
  const point = g.eye(target).project(g.camera);
  // The cue cannot point through the viewer or disclose an off-screen actor.
  if (
    point.z < -1 ||
    point.z > 1 ||
    Math.abs(point.x) > 0.94 ||
    Math.abs(point.y) > 0.86
  )
    return null;
  return {
    x: (point.x * 0.5 + 0.5) * innerWidth,
    y: (0.5 - point.y * 0.5) * innerHeight,
    distance: Math.round(g.eye(p).distanceTo(g.eye(target)) * 10) / 10,
    label: key === "magnet" ? "E · RUSH TARGET" : "E · SWAP TARGET",
  };
}
