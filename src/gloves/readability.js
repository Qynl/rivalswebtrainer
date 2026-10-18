import { contactRegion } from "./balance.js";
import { GLOVES } from "./catalog.js";
// Advisory presentation only. No aim correction, damage, rewards or hidden-enemy
// detection. The authority still validates actual contact at windup completion.
export function gloveReachCue(g) {
  const p = g.player,
    glove = GLOVES[g.loadout?.[0]];
  if (
    !p?.alive ||
    !glove ||
    g.state !== "playing" ||
    p.ragdollTime > 0 ||
    p.stoneTime > 0
  )
    return null;
  const origin = g.eye(p),
    yaw = g.yaw || 0,
    pitch = g.pitch || 0;
  const f = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  let best = null;
  for (const e of g.entities || []) {
    if (e === p || !e.alive || e.team === p.team || e.ghostTime > 0) continue;
    const target = g.eye(e),
      dx = target.x - origin.x,
      dy = target.y - origin.y,
      dz = target.z - origin.z,
      d = Math.hypot(dx, dy, dz);
    if (
      d < 0.001 ||
      d > glove.range + (e.radius || 0.28) + 1.6 ||
      (best && d >= best.distance)
    )
      continue;
    if (
      (dx * f.x + dy * f.y + dz * f.z) / d < 0.93 ||
      !g.hasLOS(origin, target)
    )
      continue;
    const region = contactRegion(
      glove,
      { x: dx, y: dy, z: dz },
      yaw,
      pitch,
      e.radius || 0.28,
    );
    const near = region === "contact",
      guarded = e.goldTime > 0 || e.stoneTime > 0;
    best = {
      distance: d,
      state: guarded
        ? "protected"
        : glove.key === "extended" && region === "inside"
          ? "too-close"
          : glove.key === "extended" && ["side", "vertical"].includes(region)
            ? "align"
            : near && e.reverseTime > 0
              ? "reflecting"
              : near && !(e.slapGrace > 0)
                ? "ready"
                : "approach",
    };
  }
  return best
    ? {
        state: best.state,
        label: {
          ready: "IN REACH",
          "too-close": "BACK UP · HANDLE BLIND SPOT",
          align: "AIM THE TIP",
          protected: "PROTECTED",
          reflecting: "REFLECTING",
          approach: "CLOSE THE GAP",
        }[best.state],
        distance: Math.round(best.distance * 10) / 10,
      }
    : null;
}
export function denyGloveAbility(g, body, reason) {
  if (
    g.network ||
    body !== g.player ||
    g.clock < (g.lastGloveDeniedAt ?? -100) + 0.3
  )
    return false;
  g.lastGloveDeniedAt = g.clock;
  const event = {
    type: "gloveDenied",
    player: body.id,
    reason,
    round: g.round,
    time: g.clock,
  };
  if (g.emitGlove) g.emitGlove(event);
  else {
    g.gloveNotice = { text: reason, until: g.clock + 1.1 };
    g.events?.update?.(g);
  }
  return false;
}
