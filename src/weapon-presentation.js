// First-person proportions only. Keep the receiver in the same screen region
// while bringing the larger model forward; uniform scaling alone barely changes
// apparent size when a model's authored geometry is already far along -Z.
const view = (scale, anchorX = 0.24, lower = 0) =>
  Object.freeze({
    scale,
    x: anchorX * (0.78 - scale),
    y: 0.16 * (scale - 0.78) + lower,
    z: 0.72 * (scale - 0.78),
  });
export const WEAPON_PRESENTATION = Object.freeze({
  rifle: view(0.94),
  burst: view(0.94),
  smg: view(0.92),
  sniper: view(1.04, 0.24, -0.025),
  shotgun: view(0.96),
  shorty: view(0.94),
  rpg: view(0.86, 0.28),
  launcher: view(0.94),
  minigun: view(0.9),
  paintball: view(0.92),
  flame: view(0.9),
  bow: view(0.82, 0),
  pistol: view(0.9),
  uzi: view(0.9),
  revolver: view(0.94),
  burstpistol: view(0.91),
  dualpistols: view(0.84, 0),
});
const DEFAULT = view(0.78);
export const weaponPresentation = (id) => WEAPON_PRESENTATION[id] || DEFAULT;
