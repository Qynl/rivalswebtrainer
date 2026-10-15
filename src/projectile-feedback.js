// Short, depth-tested travel traces share the fixed CombatFX pool. They show
// only a path already travelled, never a through-wall or predicted landing aid.
export const PROJECTILE_TRAILS = Object.freeze({
  bow: { color: 0xe8d6a5, interval: 0.03 },
  rpg: { color: 0xb79465, interval: 0.035 },
  launcher: { color: 0xaaa483, interval: 0.04 },
  grenade: { color: 0x9b9d84, interval: 0.05 },
  flashbang: { color: 0xa4adb3, interval: 0.05 },
  smoke: { color: 0x8c9b91, interval: 0.065 },
  molotov: { color: 0xc57f46, interval: 0.05 },
});
export function updateProjectileTrail(p, fx, dt, team = 0) {
  const profile = PROJECTILE_TRAILS[p.weapon || p.id];
  if (!profile || !fx) return;
  const position = p.mesh.position;
  p.trailFrom ||= position.clone();
  p.trailTime = (p.trailTime || 0) - dt;
  if (p.trailTime > 0) return;
  const distance = p.trailFrom.distanceToSquared(position);
  if (distance > 0.00001 && distance < 64)
    fx.trace(p.trailFrom, position, team, profile.color);
  p.trailFrom.copy(position);
  p.trailTime = profile.interval;
}
