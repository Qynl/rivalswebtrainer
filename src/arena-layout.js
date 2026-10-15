// Original, reference-inspired reconstruction, not measured Roblox studs.
// Full-size actors/movement: compactness comes from actual geometry, not FOV.
export const ARENA = Object.freeze({
  width: 26,
  depth: 32,
  wallHeight: 24,
  wallThickness: 1.3,
  panelSize: 2.4,
  spawnZ: 14.3,
  spawnSpread: 4.6,
  rampRise: 6.2,
  rampLength: 6.4,
  rampWidth: 3.6,
  rampX: 8.5,
  rampZ: 10.4,
  platformLength: 2.4,
  platformZ: 14.8,
});
// One half, repeated by a 180-degree rotation. Fair by construction.
export const HALF_COVER = Object.freeze(
  [
    { x: -4.05, z: -6.35, w: 5.85, h: 6.6, d: 1.15, angle: -0.48 },
    { x: 4.3, z: -6.65, w: 5.28, h: 6.6, d: 2.1, angle: 0.55 },
    { x: -9.1, z: -0.7, w: 4.05, h: 5.8, d: 1.8, angle: 0 },
  ].map(Object.freeze),
);
export const HALF_WINDOWS = Object.freeze(
  [
    { x: -1.2, z: -12.2, w: 5.7, h: 6.2, d: 1.6, axis: "x" },
    { x: 8.1, z: -11.8, w: 4.3, h: 5.8, d: 1.5, axis: "x" },
    { x: -1.6, z: -0.8, w: 4.8, h: 6.6, d: 1.6, axis: "z" },
  ].map(Object.freeze),
);
