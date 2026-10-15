export const MAX_HEALTH = 150;
export const ROUND_COUNTDOWN = 5;
export const BOW_DRAW_TIME = 0.8;
// Same rule for player and bot attacks, evaluated from the struck actor's facing.
export function isBackstab(attacker, victim) {
  const dx = attacker.x - victim.x,
    dz = attacker.z - victim.z,
    d = Math.hypot(dx, dz);
  return (
    d > 1e-6 &&
    (-Math.sin(victim.yaw || 0) * dx - Math.cos(victim.yaw || 0) * dz) / d <
      -0.45
  );
}
export function knifeDamage(attacker, victim) {
  return isBackstab(attacker, victim) ? 150 : 40;
}
