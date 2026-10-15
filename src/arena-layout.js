// Original, reference-inspired reconstruction, not measured Roblox studs.
// Full-size actors and two genuine playable levels; dimensions are world metres.
export const ARENA = Object.freeze({
  width: 40,
  depth: 50,
  wallHeight: 14,
  wallThickness: 1.3,
  panelSize: 2.4,
  spawnZ: 23.3,
  spawnSpread: 5.5,
  rampRise: 3.2,
  rampLength: 6.4,
  rampWidth: 3.6,
  rampX: 15,
  rampZ: 19.4,
  platformLength: 2.4,
  platformZ: 23.8,
  galleries: Object.freeze(
    [-1, 1].map((side) =>
      Object.freeze({ x: side * 15, z: 0, w: 5, d: 20, h: 3.2 }),
    ),
  ),
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
    { x: -1.2, z: -20.2, w: 6, h: 4.4, d: 1.6, axis: "x" },
    { x: 9, z: -20, w: 4.4, h: 4.2, d: 1.5, axis: "x" },
    { x: -1.6, z: -0.8, w: 4.8, h: 4.8, d: 1.6, axis: "z" },
  ].map(Object.freeze),
);
