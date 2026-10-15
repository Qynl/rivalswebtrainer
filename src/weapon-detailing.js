import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const WEAPON_FINISHES = Object.freeze({
  rifle: 0xb7a480,
  burst: 0x65775e,
  smg: 0x546d78,
  sniper: 0x778870,
  pistol: 0x91a0a5,
  revolver: 0xaab4b5,
  burstpistol: 0x537c83,
  dualpistols: 0x938477,
  uzi: 0x70818a,
  shotgun: 0x656b6d,
  shorty: 0x88745f,
  launcher: 0x9a835e,
  minigun: 0x71817d,
  paintball: 0x7ba9ac,
  flame: 0x887154,
});
// Purpose-built secondary forms, not a bigger primitive receiver. This runs once,
// before the model's normal material batching, for FPS, showroom and remote use.
export function detailWeapon(
  g,
  id,
  data,
  { box, cyl, tube, material, dark, steel, silver, grip, hands },
) {
  const ceramic = material(0xc9ceca, 0.18, 0.53),
    black = dark,
    brass = material(0xb8a06b, 0.72, 0.35);
  const panel = (x, y, z, length, height, mat) => {
    const l = length / 2,
      h = height / 2,
      c = Math.min(0.035, h * 0.55),
      s = new THREE.Shape();
    s.moveTo(-l + c, -h);
    s.lineTo(l - c, -h);
    s.lineTo(l, -h + c);
    s.lineTo(l, h - c);
    s.lineTo(l - c, h);
    s.lineTo(-l + c, h);
    s.lineTo(-l, h - c);
    s.lineTo(-l, -h + c);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.01,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.003,
      bevelThickness: 0.002,
      steps: 1,
    });
    geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x - 0.005, y, z);
    g.add(m);
    return m;
  };
  const fastener = (x, y, z) => {
    cyl(x, y, z, 0.007, 0.012, silver, "x");
    box(x + 0.007, y, z, 0.002, 0.003, 0.009, black);
  };
  if (
    data.slot < 2 &&
    !["revolver", "burstpistol", "dualpistols"].includes(id) &&
    !["bow", "flame", "rocket"].includes(data.type)
  ) {
    const compact = ["pistol", "uzi"].includes(id),
      len = compact ? 0.22 : id === "minigun" ? 0.27 : 0.34;
    for (const side of [-1, 1]) {
      const x = 0.24 + side * (id === "pistol" ? 0.059 : 0.077);
      if (id !== "pistol") panel(x, -0.184, -0.674, len, 0.087, steel);
      box(x, -0.155, -0.71, 0.012, 0.032, 0.11, black);
      box(x + side * 0.006, -0.151, -0.723, 0.006, 0.011, 0.075, silver);
      for (const z of [-0.58, -0.79]) fastener(x, -0.197, z);
      // Selector recess and mag-catch, deliberately below the sight line.
      cyl(x, -0.226, -0.59, 0.014, 0.012, dark, "x");
      box(
        x + side * 0.008,
        -0.23,
        -0.574,
        0.012,
        0.008,
        0.027,
        silver,
      ).rotation.x = -0.4;
    }
  }
  if (["rifle", "burst", "smg", "sniper"].includes(id)) {
    const c = steel;
    for (const side of [-1, 1]) {
      panel(0.24 + side * 0.072, -0.153, -0.949, 0.25, 0.105, c);
      for (let i = 0; i < 5; i++) {
        const z = -0.86 - i * 0.038;
        box(0.24 + side * 0.079, -0.15, z, 0.009, 0.035, 0.018, black);
        box(0.24 + side * 0.084, -0.143, z, 0.003, 0.012, 0.01, silver);
      }
    }
    box(0.24, -0.247, -0.66, 0.117, 0.055, 0.23, dark);
    for (let i = 0; i < 5; i++)
      box(0.24, -0.255, -0.9 - i * 0.026, 0.13, 0.015, 0.012, grip);
    if (!hands) {
      box(0.24, -0.105, -0.335, 0.11, 0.07, 0.22, c);
      box(0.24, -0.175, -0.2, 0.115, 0.19, 0.045, grip);
      cyl(0.24, -0.18, -0.43, 0.055, 0.12, black, "x");
    }
    if (id === "burst")
      for (const side of [-1, 1])
        panel(0.24 + side * 0.081, -0.175, -0.55, 0.16, 0.09, ceramic);
    if (id === "smg") {
      box(0.24, -0.28, -0.87, 0.09, 0.15, 0.075, grip).rotation.x = 0.15;
      box(0.24, -0.3, -0.872, 0.095, 0.024, 0.085, ceramic);
    }
    if (id === "sniper") {
      for (const z of [-1.12, -1.22, -1.32])
        cyl(0.24, -0.16, z, 0.033, 0.04, steel);
      for (const side of [-1, 1]) {
        const leg = box(
          0.24 + side * 0.06,
          -0.217,
          -1.05,
          0.028,
          0.028,
          0.26,
          black,
        );
        leg.rotation.y = side * 0.07;
        fastener(0.24 + side * 0.09, -0.16, -0.97);
      }
      cyl(0.24, 0.09, -0.75, 0.029, 0.05, black, "y");
      for (let i = 0; i < 7; i++)
        box(
          0.235 + (i % 2) * 0.009,
          0.118,
          -0.772 + i * 0.007,
          0.034,
          0.007,
          0.004,
          silver,
        );
    }
  }
  if (id === "pistol") {
    const slide = g.userData.bolt;
    for (const side of [-1, 1])
      for (let i = 0; i < 6; i++) {
        const m = box(
          0.24 + side * 0.058,
          -0.151,
          -0.73 + i * 0.014,
          0.006,
          0.063,
          0.006,
          black,
        );
        m.position.sub(slide.position);
        slide.add(m);
      }
    for (const side of [-1, 1]) {
      panel(0.24 + side * 0.052, -0.32, -0.52, 0.095, 0.15, black);
      for (let i = 0; i < 5; i++)
        box(
          0.24 + side * 0.059,
          -0.277 - i * 0.022,
          -0.517,
          0.007,
          0.006,
          0.065,
          steel,
        );
    }
    box(0.24, -0.239, -0.713, 0.105, 0.025, 0.105, black);
    cyl(0.24, -0.217, -0.48, 0.018, 0.09, silver, "x");
  }
  if (["shotgun", "shorty"].includes(id)) {
    const pump = g.userData.pump;
    for (let i = 0; i < 7; i++) {
      const m = box(0.24, -0.268, -0.82 - i * 0.03, 0.143, 0.065, 0.009, black);
      m.position.sub(pump.position);
      pump.add(m);
    }
    for (let i = 0; i < 4; i++)
      cyl(0.32, -0.103, -0.59 - i * 0.046, 0.0155, 0.012, brass, "y");
    if (id === "shotgun")
      for (let i = 0; i < 7; i++) {
        box(0.24, -0.106, -0.81 - i * 0.05, 0.035, 0.012, 0.035, steel);
        box(0.24, -0.094, -0.81 - i * 0.05, 0.022, 0.008, 0.021, black);
      }
  }
  if (id === "uzi") {
    box(0.24, -0.071, -0.67, 0.035, 0.04, 0.07, black);
    box(0.24, -0.045, -0.66, 0.078, 0.012, 0.045, silver);
    for (let i = 0; i < 5; i++)
      box(0.24, -0.172, -0.865 + i * 0.027, 0.15, 0.035, 0.014, black);
  }
  if (id === "rpg") {
    const olive = material(0x6d7852, 0.22, 0.7);
    for (const z of [-0.51, -0.77, -1.025]) {
      cyl(0.28, -0.16, z, 0.096, 0.031, black);
      cyl(0.28, -0.16, z - 0.018, 0.097, 0.008, brass);
    }
    for (const side of [-1, 1])
      box(0.28 + side * 0.097, -0.16, -0.75, 0.012, 0.075, 0.16, olive);
    box(0.28, -0.055, -0.64, 0.065, 0.045, 0.2, black);
    cyl(0.38, -0.155, -0.65, 0.024, 0.04, silver, "x");
    for (let i = 0; i < 5; i++)
      box(0.28, -0.329 - i * 0.025, -0.55, 0.085, 0.008, 0.06, black);
  }
  if (id === "launcher") {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      cyl(
        0.24 + Math.cos(a) * 0.097,
        -0.17 + Math.sin(a) * 0.097,
        -0.77,
        0.022,
        0.18,
        black,
      );
    }
    for (const side of [-1, 1]) {
      panel(0.24 + side * 0.13, -0.16, -0.7, 0.19, 0.19, steel);
      fastener(0.24 + side * 0.137, -0.16, -0.7);
    }
    box(0.24, -0.065, -0.91, 0.04, 0.038, 0.17, ceramic);
  }
  if (id === "minigun") {
    for (const side of [-1, 1])
      panel(0.24 + side * 0.129, -0.18, -0.54, 0.23, 0.15, ceramic);
    for (let i = 0; i < 5; i++)
      box(0.24, -0.3, -0.49 - i * 0.025, 0.26, 0.014, 0.012, black);
    for (let i = 0; i < 6; i++) {
      const z = -0.44 + i * 0.019;
      cyl(0.385, -0.245, z, 0.011, 0.07, brass, "y");
    }
  }
  if (id === "paintball") {
    cyl(0.15, -0.257, -0.68, 0.039, 0.018, brass, "x");
    cyl(0.136, -0.257, -0.68, 0.026, 0.008, ceramic, "x");
    tube(
      [
        [0.15, -0.25, -0.68],
        [0.11, -0.34, -0.6],
        [0.2, -0.36, -0.49],
      ],
      0.009,
      black,
    );
    for (const side of [-1, 1])
      panel(0.24 + side * 0.074, -0.18, -0.7, 0.22, 0.085, ceramic);
  }
  if (id === "flame") {
    for (const side of [-1, 1]) {
      panel(0.24 + side * 0.13, -0.18, -0.61, 0.21, 0.16, steel);
      for (let i = 0; i < 3; i++)
        fastener(0.24 + side * 0.138, -0.16, -0.55 - i * 0.045);
    }
    cyl(0.39, -0.1, -0.66, 0.028, 0.015, brass, "x");
    cyl(0.4, -0.1, -0.66, 0.021, 0.01, ceramic, "x");
  }
  if (id === "knife")
    for (const side of [-1, 1])
      for (const y of [-0.24, -0.32]) fastener(0.28 + side * 0.03, y, -0.66);
  if (["katana", "scythe"].includes(id))
    for (const y of [-0.22, -0.27, -0.32]) {
      box(0.28, y, -0.65, 0.057, 0.012, 0.07, brass).rotation.z = 0.24;
    }
  if (["grenade", "smoke", "flashbang"].includes(id)) {
    // Real seams/collars/rivet accents, still part of the detailed thrown body.
    for (const side of [-1, 1])
      for (const y of [-0.11, -0.22])
        cyl(0.28 + side * 0.067, y, -0.65, 0.008, 0.012, silver, "x");
  }
  if (id === "medkit")
    for (const x of [-0.04, 0.33]) {
      box(x, -0.17, -0.605, 0.025, 0.22, 0.015, dark);
      box(x, -0.115, -0.591, 0.043, 0.045, 0.021, brass);
    }
  g.userData.finishRevision = "machined-v2";
}
