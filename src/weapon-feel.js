// Viewmodel-only impulses. Never rotate the player's camera or rewrite aim.
const profile = (kick, pitch, roll, ads = 34, recovery = 24, fov = 0.7) =>
  Object.freeze({ kick, pitch, roll, ads, recovery, fov });
const DEFAULT = profile(0.025, 0.047, 0.012);
export const WEAPON_FEEL = Object.freeze({
  rifle: profile(0.055, 0.105, 0.022),
  burst: profile(0.062, 0.12, 0.02),
  smg: profile(0.039, 0.078, 0.025, 38, 30, 0.4),
  revolver: profile(0.105, 0.255, 0.035, 38, 20, 1.4),
  burstpistol: profile(0.05, 0.125, 0.022, 42),
  dualpistols: profile(0.044, 0.1, 0.02, 40, 28, 0.5),
  pistol: profile(0.07, 0.18, 0.024, 40, 23, 0.85),
  uzi: profile(0.042, 0.09, 0.028, 40, 29, 0.45),
  shotgun: profile(0.135, 0.235, 0.04, 32, 18, 1.8),
  shorty: profile(0.12, 0.275, 0.045, 38, 19, 1.6),
  sniper: profile(0.145, 0.245, 0.025, 28, 17, 2.5),
  rpg: profile(0.12, 0.19, 0.035, 28, 18, 1.8),
  launcher: profile(0.105, 0.18, 0.035, 30, 20, 1.5),
  minigun: profile(0.032, 0.06, 0.018, 30, 32, 0.4),
  paintball: profile(0.045, 0.085, 0.02, 38, 28, 0.5),
  flame: profile(0.006, 0.012, 0.005, 34, 30, 0.08),
  bow: profile(0.038, 0.055, 0.012, 36, 22, 0.5),
});
export const weaponFeel = (id) => WEAPON_FEEL[id] || DEFAULT;

// Bounded, time-based impulses shared by viewmodels, scope and remote rigs.
export function shotEnvelope(age, id) {
  if (!Number.isFinite(age) || age < 0 || age > 0.5) return 0;
  return Math.exp(-age * weaponFeel(id).recovery);
}
