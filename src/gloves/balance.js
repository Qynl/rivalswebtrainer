// Metres/seconds are arena adaptations, not Roblox studs or copied damage.
export const RECOVERY_WINDOW = 0.28;
export const EXTENDED_TIP = Object.freeze({
  min: 2.2,
  halfWidth: 0.48,
  height: 0.65,
});
export const ABILITY_CASTS = Object.freeze({ stun: 0.4, za_hando: 0.5 });
export const ERASURE_LANE = Object.freeze({
  min: 1.5,
  range: 9,
  halfWidth: 1.4,
});
export function inErasureLane(dx, dz, yaw, radius = 0.28) {
  const along = -Math.sin(yaw) * dx - Math.cos(yaw) * dz,
    side = Math.abs(Math.cos(yaw) * dx - Math.sin(yaw) * dz);
  return (
    along >= ERASURE_LANE.min - radius &&
    along < ERASURE_LANE.range + radius &&
    side < ERASURE_LANE.halfWidth + radius
  );
}
export const STONE_DURATION = 4;
export const STONE_REARM = 0.35;
export const SPACE_REARM = 0.35;
export const BRICK_LIFETIME = 18;
export const GHOST_DURATION = 4.5;
export const CHILL_MOVE_SCALE = 0.65;

// Preserve ordinary palm/dual sweeps. Extended contacts only its distant tip:
// its handle is not a giant melee cone, and aiming up cannot turn it into a gun.
export function contactRegion(
  glove,
  delta,
  yaw = 0,
  pitch = 0,
  radius = 0.28,
  range = glove.range,
  cone = 0.48,
) {
  const { x, y, z } = delta;
  if (![x, y, z, yaw, pitch, radius, range].every(Number.isFinite))
    return "invalid";
  const d = Math.hypot(x, y, z);
  if (d <= 0.001) return "inside";
  if (glove.key === "extended") {
    const along = -Math.sin(yaw) * x - Math.cos(yaw) * z,
      side = Math.abs(Math.cos(yaw) * x - Math.sin(yaw) * z);
    if (along <= 0) return "behind";
    if (along < EXTENDED_TIP.min - radius) return "inside";
    if (along >= range + radius) return "far";
    if (Math.abs(y) > EXTENDED_TIP.height + radius) return "vertical";
    return side < EXTENDED_TIP.halfWidth + radius ? "contact" : "side";
  }
  if (d >= range + radius) return "far";
  const dot =
    (-Math.sin(yaw) * Math.cos(pitch) * x +
      Math.sin(pitch) * y -
      Math.cos(yaw) * Math.cos(pitch) * z) /
    d;
  return dot > cone ? "contact" : "side";
}
