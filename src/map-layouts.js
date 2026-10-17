// Authored symmetric layouts; shared rendering kit, distinct playable geometry.
export const EXTRA_COURTS = {
  foundry: {
    width: 34,
    depth: 42,
    wallHeight: 10,
    wallThickness: 1.3,
    spawnZ: 19.2,
    spawnSpread: 5.5,
    rampRise: 3.4,
    rampLength: 6.4,
    rampWidth: 3.6,
    rampX: 12,
    rampZ: 15.4,
    platformLength: 2.4,
    platformZ: 19.8,
    cover: [
      { x: -3.5, z: -7, w: 8, h: 3.4, d: 2.2 },
      { x: 7, z: -3, w: 3, h: 4.2, d: 6 },
      { x: -11, z: -1, w: 3, h: 2.3, d: 5 },
    ],
    windows: [
      { x: 0, z: -15, w: 7, h: 3.8, d: 1.4, axis: "x" },
      { x: -2, z: -1.5, w: 4, h: 3.8, d: 1.2, axis: "z" },
    ],
    theme: {
      name: "FOUNDRY",
      wall: 0x587180,
      floor: 0x68777b,
      accent: 0xb98751,
      trim: 0x283d4c,
    },
  },
  courtyard: {
    width: 36,
    depth: 40,
    wallHeight: 8.5,
    wallThickness: 1.3,
    spawnZ: 18.2,
    spawnSpread: 5.5,
    rampRise: 2.8,
    rampLength: 6.4,
    rampWidth: 3.6,
    rampX: 13.5,
    rampZ: 14.4,
    platformLength: 2.4,
    platformZ: 18.8,
    cover: [
      { x: -5, z: -7, w: 6.2, h: 3, d: 1.2, angle: -0.22 },
      { x: 6, z: -3, w: 5, h: 1.3, d: 3 },
      { x: 11, z: 0, w: 2.4, h: 3.6, d: 5 },
    ],
    windows: [
      { x: -1.2, z: -14, w: 6.4, h: 3.5, d: 1.3, axis: "x" },
      { x: 4, z: -0.8, w: 4.4, h: 3.5, d: 1.3, axis: "z" },
    ],
    theme: {
      name: "COURTYARD",
      wall: 0xb5a07d,
      floor: 0x979585,
      accent: 0x6e8871,
      trim: 0x6c756a,
    },
  },
};

export function dressCourt(world, layout) {
  const { theme, width, depth } = layout,
    hw = width / 2,
    hd = depth / 2;
  const detail = (x, y, z, w, h, d, c) => world.box(x, y, z, w, h, d, c, false);
  const before = world.boxes.length;
  for (const side of [-1, 1]) {
    // Recessed wall panels, coping and vertical reveals use the same PBR textures.
    for (let z = -hd + 3; z < hd; z += 4.8) {
      detail(side * (hw - 0.035), 2.6, z, 0.055, 3.8, 3.5, theme.trim);
      detail(side * (hw - 0.075), 2.6, z, 0.025, 3.45, 3.12, theme.wall);
    }
    for (let z = -hd + 2.4; z < hd; z += 4.8)
      detail(
        side * (hw - 0.08),
        layout.wallHeight / 2,
        z,
        0.08,
        layout.wallHeight,
        0.07,
        theme.trim,
      );
    world.label(
      theme.name,
      0,
      5.8,
      side * (hd - 0.06),
      8,
      1,
      side > 0 ? Math.PI : 0,
      "#394a53",
      "#e0d7bf",
    );
    world.floorMark(0, side * (hd - 3), 12, 0.14, theme.accent, 3);
    for (let i = 0; i < 7; i++)
      world.floorMark(-2.4 + i * 0.8, side * 7, 0.34, 1.2, theme.accent, 3);
    if (theme.name === "FOUNDRY") {
      // Gantries are above all playable cover; no fake walkable bridge surfaces.
      detail(0, 8.8, side * 10, width, 0.35, 0.45, theme.trim);
      for (const x of [-10, -5, 0, 5, 10]) {
        detail(x, 8.35, side * 10, 1.4, 0.16, 0.65, theme.wall);
        world.glow(x, 8.24, side * 10, 1.15, 0.045, 0.38, 0xffdcac);
      }
      for (const x of [-hw + 0.15, hw - 0.15]) {
        world.cylinder(x, 4.4, side * 5, 0.12, 8.8, theme.trim);
        world.glow(x, 4.7, side * 5, 0.035, 0.8, 0.06, 0xb6d5d6);
      }
      for (const x of [-8, 8]) {
        detail(x, 1.7, side * 7, 5.5, 0.09, 0.05, theme.accent);
      }
    } else {
      // Low planted islands are actual cover; foliage is deliberately cosmetic.
      detail(side * 6, 1.32, side * -3, 4.6, 0.06, 2.6, 0x485846);
      for (const x of [-1.4, 0, 1.4]) {
        const foliage = world.cylinder(
          side * (6 + x),
          1.55,
          side * -3,
          0.5,
          0.4,
          0x637b57,
          7,
        );
        foliage.scale.z = 0.8;
      }
      for (let z = -hd + 4; z < hd; z += 8) {
        detail(side * (hw - 0.18), 4.9, z, 0.26, 0.18, 1.1, theme.trim);
        detail(side * (hw - 0.28), 4.55, z, 0.28, 0.5, 0.35, theme.trim);
        world.glow(side * (hw - 0.46), 4.55, z, 0.04, 0.29, 0.19, 0xffe1ae);
      }
      detail(side * 11, 3.65, 0, 2.6, 0.12, 5.2, theme.trim);
    }
  }
  if (before !== world.boxes.length)
    throw Error("Map dressing must not add hidden collision");
}
