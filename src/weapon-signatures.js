// Larger, functional silhouette details. Runs once before material batching;
// nothing here allocates during play or changes weapon stats/projectiles.
const DESIGNS = Object.freeze({
  rifle: "sandstone-carbine",
  burst: "olive-match-rifle",
  smg: "slate-compact",
  sniper: "long-range-chassis",
  shotgun: "ribbed-pump",
  shorty: "breacher",
  rpg: "olive-launch-tube",
  launcher: "indexed-drum",
  minigun: "belt-fed-rotary",
  paintball: "cyan-competition",
  flame: "pressure-fed-brass",
  bow: "machined-compound",
  pistol: "two-tone-service",
  uzi: "folding-stock-compact",
  revolver: "heavy-underlug",
  burstpistol: "ported-match",
  dualpistols: "paired-two-tone",
});
export function signatureWeapon(
  g,
  id,
  data,
  { box, cyl, tube, material, dark, steel, silver, grip, hands },
) {
  if (data.slot > 1) return;
  const ivory = material(0xc8d0c9, 0.22, 0.5);
  const brass = material(0xb99b61, 0.65, 0.4);
  // Restrained registration inlays: a readable material break, not neon outlines.
  if (!["bow", "dualpistols", "revolver"].includes(id)) {
    const axis = id === "rpg" ? 0.28 : 0.24;
    const width = ["flame", "minigun", "launcher"].includes(id)
      ? 0.148
      : id === "sniper"
        ? 0.121
        : ["pistol", "uzi", "burstpistol"].includes(id)
          ? 0.071
          : 0.101;
    for (const side of [-1, 1]) {
      const x = axis + side * width;
      box(x, -0.205, -0.61, 0.007, 0.045, 0.135, dark);
      box(x + side * 0.004, -0.194, -0.617, 0.003, 0.006, 0.09, ivory);
      for (let i = 0; i < 3; i++)
        box(
          x + side * 0.004,
          -0.214,
          -0.576 - i * 0.013,
          0.003,
          0.009,
          0.006,
          brass,
        );
    }
  }
  if (["rifle", "burst", "smg"].includes(id)) {
    const length = id === "smg" ? 0.21 : 0.31;
    for (const side of [-1, 1]) {
      box(0.24 + side * 0.083, -0.164, -0.965, 0.018, 0.105, length, steel);
      for (let i = 0; i < 4; i++) {
        const z = -0.875 - i * 0.047;
        box(0.24 + side * 0.094, -0.151, z, 0.009, 0.025, 0.026, dark);
        box(0.24 + side * 0.1, -0.14, z, 0.003, 0.005, 0.025, silver);
      }
      box(0.24 + side * 0.082, -0.22, -0.79, 0.008, 0.022, 0.23, dark);
    }
    if (id === "burst") box(0.24, -0.205, -0.975, 0.155, 0.04, 0.27, grip);
    if (id === "rifle") box(0.24, -0.226, -0.5, 0.135, 0.065, 0.15, steel);
  }
  if (id === "sniper") {
    // A real wide chassis and oversized optic, not the generic carbine in green.
    box(0.24, -0.213, -0.865, 0.205, 0.085, 0.48, steel);
    // The shoulder stock belongs behind the FPS camera, not a huge near-plane slab.
    if (!hands) {
      box(0.24, -0.188, -0.48, 0.19, 0.12, 0.17, steel);
      box(0.24, -0.114, -0.485, 0.153, 0.025, 0.15, grip);
    }
    for (const side of [-1, 1]) {
      box(0.24 + side * 0.108, -0.169, -1.02, 0.018, 0.098, 0.3, steel);
      for (let i = 0; i < 4; i++)
        box(
          0.24 + side * 0.12,
          -0.158,
          -0.93 - i * 0.057,
          0.008,
          0.032,
          0.036,
          dark,
        );
      tube(
        [
          [0.24 + side * 0.1, -0.238, -1.04],
          [0.24 + side * 0.15, -0.28, -1.17],
          [0.24 + side * 0.15, -0.28, -1.35],
        ],
        0.014,
        dark,
      );
      box(0.24 + side * 0.15, -0.28, -1.35, 0.04, 0.033, 0.045, grip);
    }
    box(0.24, -0.16, -1.535, 0.095, 0.09, 0.145, steel);
    for (const side of [-1, 1])
      for (const z of [-1.505, -1.55, -1.585])
        box(0.24 + side * 0.049, -0.16, z, 0.006, 0.045, 0.017, dark);
    cyl(0.24, -0.16, -1.612, 0.028, 0.009, dark);
    g.userData.muzzleZ = -1.622;
    // Scope adjustment ticks stay below the lens; actual glint is on the front glass.
    for (const z of [-0.823, -0.633])
      for (const side of [-1, 1])
        cyl(0.24 + side * 0.069, 0.027, z, 0.009, 0.012, silver, "x");
  }
  if (["shotgun", "shorty"].includes(id)) {
    const pump = g.userData.pump;
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++)
        box(
          side * 0.069,
          -0.012,
          -0.075 + i * 0.035,
          0.014,
          0.066,
          0.018,
          grip,
          pump,
        );
    box(0.24, -0.22, -0.73, 0.16, 0.055, 0.25, steel);
    const z = id === "shotgun" ? -1.2 : -1.075;
    cyl(0.24, -0.15, z, 0.04, 0.045, steel);
    cyl(0.24, -0.15, z - 0.024, 0.031, 0.006, dark);
  }
  if (["pistol", "burstpistol"].includes(id)) {
    const slide = g.userData.bolt;
    for (const side of [-1, 1]) {
      box(side * 0.064, -0.008, -0.035, 0.006, 0.032, 0.17, dark, slide);
      for (let i = 0; i < 3; i++)
        box(
          side * 0.068,
          0.011,
          -0.075 + i * 0.028,
          0.003,
          0.011,
          0.013,
          silver,
          slide,
        );
    }
    if (id === "burstpistol")
      for (const side of [-1, 1])
        for (const z of [-0.85, -0.88])
          box(0.24 + side * 0.025, -0.126, z, 0.018, 0.007, 0.015, dark);
  }
  if (id === "revolver") {
    box(0.24, -0.2, -0.87, 0.095, 0.053, 0.29, steel);
    cyl(0.306, -0.204, -0.82, 0.013, 0.24, silver);
    for (const side of [-1, 1]) {
      box(0.24 + side * 0.064, -0.164, -0.55, 0.009, 0.07, 0.11, steel);
      cyl(0.24 + side * 0.07, -0.188, -0.525, 0.009, 0.006, dark, "x");
    }
  }
  if (id === "dualpistols")
    for (const slide of g.userData.bolts)
      for (const side of [-1, 1]) {
        box(side * 0.058, -0.008, -0.035, 0.006, 0.031, 0.16, dark, slide);
        for (let i = 0; i < 3; i++)
          box(
            side * 0.062,
            0.011,
            -0.075 + i * 0.027,
            0.003,
            0.009,
            0.013,
            brass,
            slide,
          );
      }
  if (id === "uzi")
    for (const side of [-1, 1]) {
      box(0.24 + side * 0.082, -0.18, -0.78, 0.014, 0.09, 0.25, steel);
      for (let i = 0; i < 4; i++)
        box(
          0.24 + side * 0.091,
          -0.16,
          -0.85 + i * 0.035,
          0.006,
          0.022,
          0.018,
          dark,
        );
    }
  if (id === "rpg") {
    box(0.28, -0.225, -0.48, 0.17, 0.055, 0.24, grip);
    for (const z of [-0.57, -0.86]) cyl(0.28, -0.16, z, 0.097, 0.016, steel);
    for (const side of [-1, 1])
      box(0.28 + side * 0.101, -0.15, -0.84, 0.008, 0.04, 0.095, ivory);
  }
  if (id === "launcher") {
    for (const side of [-1, 1]) {
      cyl(0.24 + side * 0.145, -0.23, -0.75, 0.055, 0.019, steel, "x");
      cyl(0.24 + side * 0.157, -0.23, -0.75, 0.027, 0.007, dark, "x");
    }
    box(0.24, -0.1, -0.87, 0.155, 0.03, 0.28, steel);
  }
  if (id === "minigun") {
    box(0.24, -0.115, -0.56, 0.29, 0.075, 0.27, steel);
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++)
        box(
          0.24 + side * 0.151,
          -0.16,
          -0.47 - i * 0.043,
          0.009,
          0.047,
          0.024,
          dark,
        );
  }
  if (id === "paintball") {
    cyl(0.24, -0.32, -0.35, 0.072, 0.022, steel);
    for (const side of [-1, 1])
      box(0.24 + side * 0.082, -0.183, -0.77, 0.016, 0.055, 0.2, steel);
  }
  if (id === "flame") {
    for (const x of [0.14, 0.36])
      for (const y of [-0.3, -0.425])
        cyl(x, y, -0.68, 0.071, 0.025, steel, "y");
    for (const side of [-1, 1])
      for (const z of [-0.9, -0.97, -1.04])
        box(0.24 + side * 0.062, -0.152, z, 0.012, 0.047, 0.032, brass);
  }
  if (id === "bow") {
    // Preserve the corrected forward limb curvature and string/arrow rig.
    for (const y of [-0.17, -0.06]) {
      cyl(-0.24, y, -0.7, 0.023, 0.062, silver, "x");
      box(-0.24, y, -0.727, 0.073, 0.016, 0.014, dark);
    }
  }
  g.userData.visualRevision = "arsenal-v3";
  g.userData.designName = DESIGNS[id];
}
