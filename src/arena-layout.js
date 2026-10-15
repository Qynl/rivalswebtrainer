// Original reconstruction from the Arena gallery + mirrored-map descriptions.
// These are trainer metres, not claimed Roblox stud measurements.
export const ARENA = Object.freeze({
  width: 32,
  depth: 42,
  wallHeight: 19.2,
  wallThickness: 1.3,
  panelSize: 2.4,
  spawnZ: 18.8,
  rampRise: 4.4,
});
// One half, repeated by a 180-degree rotation. Keep gameplay fair by construction.
export const HALF_COVER = Object.freeze([
  { x: -5, z: -8.3, w: 7.2, h: 4.6, d: 1.4, angle: -0.48 },
  { x: 5.3, z: -8.7, w: 6.5, h: 4.6, d: 2.7, angle: 0.55 },
  { x: -11.2, z: -0.9, w: 5, h: 4.1, d: 2.2, angle: 0 },
]);
