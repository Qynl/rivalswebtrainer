// Viewmodel-only impulses. Never rotate the player's camera or rewrite aim.
const profile = (kick, pitch, roll, ads = 34) =>
  Object.freeze({ kick, pitch, roll, ads });
const DEFAULT = profile(0.025, 0.047, 0.012);
export const WEAPON_FEEL = Object.freeze({
  rifle: profile(0.027, 0.045, 0.012),
  burst: profile(0.033, 0.055, 0.013),
  smg: profile(0.02, 0.037, 0.018, 38),
  revolver: profile(0.059, 0.145, 0.022, 38),
  burstpistol: profile(0.026, 0.065, 0.012, 42),
  dualpistols: profile(0.018, 0.04, 0.008, 40),
  pistol: profile(0.038, 0.1, 0.016, 40),
  uzi: profile(0.024, 0.055, 0.023, 40),
  shotgun: profile(0.075, 0.13, 0.025, 32),
  shorty: profile(0.066, 0.16, 0.035, 38),
  sniper: profile(0.061, 0.12, 0.014, 28),
  rpg: profile(0.074, 0.11, 0.024, 28),
  launcher: profile(0.06, 0.095, 0.025, 30),
  minigun: profile(0.014, 0.025, 0.01, 30),
  paintball: profile(0.024, 0.042, 0.014, 38),
  flame: profile(0.003, 0.005, 0.003),
  bow: profile(0.018, 0.025, 0.006, 36),
});
export const weaponFeel = (id) => WEAPON_FEEL[id] || DEFAULT;
