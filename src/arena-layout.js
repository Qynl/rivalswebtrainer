// Original, reference-inspired reconstruction, not measured Roblox studs.
// Full-size actors/movement: compactness comes from actual geometry, not FOV.
export const ARENA = Object.freeze({
  width: 30,
  depth: 38,
  wallHeight: 14,
  wallThickness: 1.3,
  panelSize: 2.4,
  spawnZ: 17.3,
  spawnSpread: 5.5,
  rampRise: 4.4,
  rampLength: 6.4,
  rampWidth: 3.6,
  rampX: 10.5,
  rampZ: 13.4,
  platformLength: 2.4,
  platformZ: 17.8,
});
// One half, repeated by a 180-degree rotation. Fair by construction.
export const HALF_COVER = Object.freeze(
  [
    { x: -4.5, z: -7.7, w: 6, h: 4.8, d: 1.15, angle: -0.48 },
    { x: 4.8, z: -8, w: 5.5, h: 4.8, d: 2.1, angle: 0.55 },
    { x: -10.8, z: -0.7, w: 4.2, h: 4.2, d: 1.8, angle: 0 },
  ].map(Object.freeze),
);
export const HALF_WINDOWS = Object.freeze(
  [
    { x: -1.2, z: -14.2, w: 6, h: 4.4, d: 1.6, axis: "x" },
    { x: 9, z: -14, w: 4.4, h: 4.2, d: 1.5, axis: "x" },
    { x: -1.6, z: -0.8, w: 4.8, h: 4.8, d: 1.6, axis: "z" },
  ].map(Object.freeze),
);
