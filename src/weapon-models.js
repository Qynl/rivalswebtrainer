import { rememberPart, muzzleFlash } from "./animation.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Original, purpose-built silhouettes. World units are metres, muzzle is -Z.
// Named moving parts are shared by the live view and the loadout turntable.
export function detailedWeapon(id, data, { hands = true } = {}) {
  if (data.slot === 2 || ["grenade", "smoke", "molotov", "rpg"].includes(id))
    return null;
  const g = new THREE.Group();
  const mats = {};
  const material = (color, metal = 0.45, rough = 0.4) => {
    const key = `${color}:${metal}:${rough}`;
    return (mats[key] ||= new THREE.MeshStandardMaterial({
      color,
      metalness: metal,
      roughness: rough,
    }));
  };
  const dark = material(0x202832, 0.35, 0.6),
    steel = material(
      id === "rifle" ? 0xb3a582 : 0x596777,
      id === "rifle" ? 0.25 : 0.7,
      id === "rifle" ? 0.65 : 0.3,
    ),
    silver = material(0xb8c6ce, 0.7, 0.25);
  const grip = material(0x363d43, 0.05, 0.9),
    accent = material(data.color, 0.35, 0.45),
    wood = material(0x8b6b4b, 0.05, 0.75);
  const add = (geometry, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (x, y, z, w, h, d, mat = steel, parent = g) =>
    add(
      new RoundedBoxGeometry(w, h, d, 1, Math.min(0.012, w / 5, h / 5, d / 5)),
      mat,
      x,
      y,
      z,
      parent,
    );
  const cyl = (x, y, z, r, len, mat = steel, axis = "z", parent = g) => {
    const m = add(
      new THREE.CylinderGeometry(r, r, len, 16),
      mat,
      x,
      y,
      z,
      parent,
    );
    if (axis === "z") m.rotation.x = Math.PI / 2;
    if (axis === "x") m.rotation.z = Math.PI / 2;
    return m;
  };
  const tube = (points, r, mat, parent = g) =>
    add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
        24,
        r,
        6,
        false,
      ),
      mat,
      0,
      0,
      0,
      parent,
    );
  const hand = (x, y, z) => {
    const h = new THREE.Group();
    h.position.set(x, y, z);
    h.userData.hand = true;
    g.add(h);
    const skin = material(0xbfa58b, 0, 0.83),
      fabric = material(0x293740, 0, 0.95);
    box(0, 0, 0, 0.11, 0.095, 0.15, skin, h);
    box(0, -0.025, 0.07, 0.12, 0.09, 0.09, fabric, h);
    box(0, -0.04, 0.22, 0.105, 0.105, 0.24, skin, h);
    // A thumb, knuckle strip and separate finger ridges make a readable grip.
    box(-0.052, -0.025, -0.02, 0.035, 0.06, 0.065, skin, h).rotation.z = -0.35;
    for (let i = 0; i < 3; i++)
      box(-0.031 + i * 0.031, 0.04, -0.035, 0.026, 0.026, 0.072, fabric, h);
    (g.userData.hands ||= []).push(rememberPart(h));
    return h;
  };
  const screws = (z0, length) => {
    for (let i = 0; i < 4; i++)
      cyl(0.307, -0.16, z0 - (i * length) / 4, 0.008, 0.008, silver, "x");
  };
  const guard = (z) =>
    tube(
      [
        [0.24, -0.22, z + 0.08],
        [0.24, -0.31, z + 0.07],
        [0.24, -0.31, z - 0.05],
        [0.24, -0.23, z - 0.08],
      ],
      0.012,
      dark,
    );
  const sights = (zFront, zRear) => {
    box(0.24, -0.071, zRear, 0.065, 0.04, 0.035, dark);
    box(0.24, -0.034, zFront, 0.018, 0.055, 0.025, silver);
  };
  const receiver = (length = 0.34) => {
    box(0.24, -0.16, -0.72, 0.14, 0.14, length);
    box(0.24, -0.23, -0.71, 0.115, 0.06, length, dark);
    box(0.24, -0.103, -0.72, 0.11, 0.015, length + 0.03, dark);
    for (let i = 0; i < 8; i++)
      box(0.24, -0.089, -0.56 - i * 0.041, 0.114, 0.012, 0.016, steel);
    box(0.24, -0.34, -0.59, 0.075, 0.19, 0.105, grip).rotation.x = -0.22;
    guard(-0.71);
    screws(-0.57, length);
    box(0.314, -0.15, -0.72, 0.007, 0.046, 0.11, dark);
    g.userData.bolt = rememberPart(
      box(0.321, -0.145, -0.69, 0.012, 0.023, 0.054, silver),
    );
  };
  const stock = () => {
    // The shoulder stock is outside the first-person frustum, but stays in the showroom.
    if (hands) return;
    box(0.24, -0.17, -0.4, 0.06, 0.07, 0.24, dark);
    box(0.24, -0.21, -0.28, 0.09, 0.15, 0.1, grip);
    box(0.24, -0.13, -0.4, 0.085, 0.035, 0.19, steel);
  };
  const barrel = (z, r = 0.025, len = 0.3) => {
    cyl(0.24, -0.16, z, r, len, dark);
    cyl(0.24, -0.16, z - len / 2, 0.036, 0.045, steel);
    cyl(
      0.24,
      -0.16,
      z - len / 2 - 0.025,
      0.021,
      0.008,
      material(0x080c10, 0.1, 0.8),
    );
  };

  if (id === "bow") {
    g.userData.limbs = tube(
      [
        [0.24, 0.42, -0.86],
        [0.31, 0.3, -0.8],
        [0.34, 0.02, -0.75],
        [0.31, -0.3, -0.8],
        [0.24, -0.47, -0.86],
      ],
      0.028,
      wood,
    );

    const string = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.24, 0.42, -0.86),
        new THREE.Vector3(0.2, -0.04, -0.6),
        new THREE.Vector3(0.24, -0.47, -0.86),
      ]),
      new THREE.LineBasicMaterial({ color: 0xcad3d5 }),
    );
    string.frustumCulled = false;
    g.add(string);
    g.userData.string = string;
    box(0.34, -0.07, -0.75, 0.055, 0.16, 0.06, grip);
    const arrow = new THREE.Group();
    g.add(arrow);
    g.userData.arrow = arrow;
    cyl(0.23, -0.055, -0.9, 0.006, 0.7, wood, "z", arrow);
    const tip = add(
      new THREE.ConeGeometry(0.021, 0.065, 4),
      silver,
      0.23,
      -0.055,
      -1.27,
      arrow,
    );
    tip.rotation.x = -Math.PI / 2;
    for (const a of [0, Math.PI / 2])
      box(0.23, -0.055, -0.62, 0.045, 0.004, 0.085, silver, arrow).rotation.z =
        a;
    for (const y of [-0.32, 0.29])
      cyl(0.3, y, -0.805, 0.043, 0.022, steel, "x");
    if (hands) hand(0.34, -0.11, -0.7);
  } else if (id === "minigun") {
    box(0.24, -0.16, -0.57, 0.24, 0.22, 0.31, steel);
    box(0.24, -0.31, -0.46, 0.12, 0.16, 0.09, grip);
    const rotor = new THREE.Group();
    rotor.position.set(0.24, -0.15, 0);
    g.add(rotor);
    g.userData.rotor = rotor;
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3,
        x = Math.cos(angle) * 0.071,
        y = Math.sin(angle) * 0.071;
      cyl(x, y, -0.98, 0.022, 0.72, steel, "z", rotor);
      cyl(x, y, -1.34, 0.018, 0.04, dark, "z", rotor);
      cyl(x, y, -0.81, 0.025, 0.05, silver, "z", rotor);
    }
    cyl(0, 0, -0.73, 0.102, 0.085, dark, "z", rotor);
    cyl(0, 0, -1.21, 0.102, 0.05, silver, "z", rotor);
    cyl(0.12, -0.31, -0.7, 0.135, 0.18, dark, "x");
    cyl(0.018, -0.31, -0.7, 0.11, 0.025, accent, "x");
    for (let i = 0; i < 7; i++)
      box(
        0.13 + i * 0.024,
        -0.31,
        -0.64 - i * 0.017,
        0.022,
        0.055,
        0.05,
        material(0xa99153, 0.65, 0.4),
      );
    box(0.24, 0.0, -0.63, 0.03, 0.08, 0.03, dark);
    box(0.24, 0.03, -0.54, 0.14, 0.035, 0.16, dark);
    if (hands) {
      hand(0.24, -0.34, -0.38);
      hand(0.39, -0.07, -0.7);
    }
  } else if (id === "paintball") {
    receiver(0.29);
    barrel(-0.99, 0.026, 0.36);
    box(0.24, -0.16, -0.86, 0.135, 0.09, 0.13, accent);
    cyl(0.24, -0.0, -0.68, 0.02, 0.11, dark, "y");
    const hopper = add(
      new THREE.SphereGeometry(0.1, 24, 12),
      accent,
      0.24,
      0.095,
      -0.71,
    );
    hopper.scale.set(1, 0.75, 1.35);
    box(0.24, 0.17, -0.72, 0.13, 0.02, 0.11, dark);
    cyl(0.24, -0.32, -0.41, 0.068, 0.26, silver);
    cyl(0.24, -0.32, -0.28, 0.07, 0.035, dark);
    tube(
      [
        [0.24, -0.38, -0.54],
        [0.34, -0.42, -0.49],
        [0.34, -0.3, -0.42],
      ],
      0.012,
      dark,
    );
    if (hands) {
      hand(0.24, -0.34, -0.55);
      hand(0.24, -0.24, -0.84);
    }
  } else if (id === "launcher") {
    receiver(0.33);
    stock();
    barrel(-1.02, 0.067, 0.35);
    cyl(0.24, -0.23, -0.75, 0.135, 0.22, dark, "x");
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      box(
        0.24,
        -0.23 + Math.cos(a) * 0.122,
        -0.75 + Math.sin(a) * 0.122,
        0.23,
        0.034,
        0.034,
        accent,
      );
    }
    sights(-1.06, -0.6);
    if (hands) {
      hand(0.24, -0.34, -0.52);
      hand(0.28, -0.36, -0.79);
    }
  } else if (id === "flame") {
    receiver(0.36);
    barrel(-1.0, 0.048, 0.4);
    cyl(0.24, -0.16, -1.2, 0.064, 0.045, accent);
    for (const x of [0.14, 0.36]) {
      cyl(x, -0.37, -0.68, 0.066, 0.26, accent, "y");
      cyl(x, -0.24, -0.68, 0.038, 0.035, dark, "y");
    }
    tube(
      [
        [0.38, -0.3, -0.65],
        [0.46, -0.34, -0.78],
        [0.43, -0.16, -0.93],
      ],
      0.018,
      dark,
    );
    const pilot = add(
      new THREE.ConeGeometry(0.019, 0.085, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb64c }),
      0.24,
      -0.23,
      -1.23,
    );
    pilot.rotation.x = -Math.PI / 2;
    if (hands) {
      hand(0.24, -0.34, -0.5);
      hand(0.3, -0.27, -0.9);
    }
  } else if (id === "flashbang") {
    cyl(0.27, -0.24, -0.63, 0.065, 0.24, silver, "y");
    cyl(0.27, -0.12, -0.63, 0.045, 0.025, dark, "y");
    for (const y of [-0.3, -0.19]) cyl(0.27, y, -0.63, 0.068, 0.035, dark, "y");
    box(0.34, -0.17, -0.63, 0.016, 0.15, 0.022, steel).rotation.z = -0.15;
    add(
      new THREE.TorusGeometry(0.025, 0.004, 6, 16),
      silver,
      0.31,
      -0.105,
      -0.63,
    );
    if (hands) hand(0.27, -0.35, -0.58);
  } else if (id === "medkit") {
    box(0.14, -0.16, -0.7, 0.49, 0.3, 0.16, material(0xe6e8e7, 0.05, 0.65));
    box(0.14, -0.16, -0.61, 0.5, 0.02, 0.012, silver);
    tube(
      [
        [0.06, 0.0, -0.7],
        [0.06, 0.055, -0.7],
        [0.23, 0.055, -0.7],
        [0.23, 0.0, -0.7],
      ],
      0.016,
      dark,
    );
    const red = material(0xd34d4c, 0.05, 0.6);
    box(0.14, -0.16, -0.608, 0.06, 0.16, 0.008, red);
    box(0.14, -0.16, -0.607, 0.16, 0.06, 0.008, red);
    for (const x of [-0.04, 0.33])
      box(x, -0.05, -0.6, 0.038, 0.025, 0.018, steel);
    if (hands) {
      hand(-0.08, -0.3, -0.6);
      hand(0.37, -0.3, -0.6);
    }
  } else if (id === "pistol") {
    g.userData.bolt = rememberPart(
      box(0.24, -0.15, -0.65, 0.11, 0.115, 0.31, steel),
    );
    box(0.24, -0.22, -0.62, 0.11, 0.035, 0.29, dark);
    box(0.24, -0.32, -0.52, 0.095, 0.2, 0.12, grip).rotation.x = -0.23;
    barrel(-0.81, 0.025, 0.07);
    guard(-0.63);
    sights(-0.77, -0.51);
    for (let i = 0; i < 5; i++)
      box(0.3, -0.15, -0.55 + i * 0.011, 0.012, 0.075, 0.005, dark);
    if (hands) hand(0.24, -0.36, -0.49);
  } else if (id === "uzi") {
    receiver(0.29);
    box(0.24, -0.18, -0.6, 0.145, 0.15, 0.2, dark);
    barrel(-0.93, 0.022, 0.22);
    g.userData.magazine = rememberPart(
      box(0.24, -0.43, -0.58, 0.08, 0.21, 0.095, steel),
    );
    tube(
      [
        [0.32, -0.19, -0.46],
        [0.36, -0.15, -0.24],
        [0.28, -0.15, -0.2],
        [0.28, -0.3, -0.2],
      ],
      0.012,
      silver,
    );
    sights(-0.85, -0.57);
    if (hands) hand(0.24, -0.34, -0.56);
  } else if (id === "shotgun" || id === "shorty") {
    receiver(0.3);
    if (id === "shotgun") stock();
    const len = id === "shotgun" ? 0.55 : 0.26;
    cyl(0.24, -0.15, -0.95, 0.031, len, dark);
    cyl(0.24, -0.22, -0.95, 0.024, len - 0.07, steel);
    g.userData.pump = rememberPart(
      box(0.24, -0.25, -0.91, 0.13, 0.11, 0.22, wood),
    );
    for (let i = 0; i < 7; i++)
      box(0.24, -0.21, -0.82 - i * 0.029, 0.138, 0.012, 0.012, dark);
    for (let i = 0; i < 4; i++)
      cyl(
        0.32,
        -0.16,
        -0.59 - i * 0.046,
        0.015,
        0.08,
        material(0xa34735, 0.2, 0.7),
        "y",
      );
    sights(-1.13, -0.58);
    if (hands) {
      hand(0.24, -0.34, -0.52);
      if (id === "shotgun") hand(0.24, -0.32, -0.9);
    }
  } else {
    receiver();
    stock();
    barrel(
      id === "sniper" ? -1.23 : -1.07,
      0.026,
      id === "sniper" ? 0.58 : 0.37,
    );
    box(0.24, -0.16, -0.94, 0.13, 0.11, 0.22, dark);
    for (let i = 0; i < 6; i++) {
      box(0.31, -0.14, -0.86 - i * 0.034, 0.012, 0.04, 0.018, steel);
      box(0.24, -0.094, -0.85 - i * 0.037, 0.14, 0.012, 0.018, steel);
    }
    if (id === "sniper") {
      g.userData.magazine = rememberPart(
        box(0.24, -0.31, -0.75, 0.1, 0.12, 0.15, dark),
      );
      cyl(0.24, 0.028, -0.74, 0.053, 0.34, dark);
      cyl(0.24, 0.028, -0.91, 0.063, 0.035, steel);
      cyl(0.24, 0.028, -0.57, 0.055, 0.04, steel);
      const lens = new THREE.MeshStandardMaterial({
        color: 0x4f91a9,
        metalness: 0.65,
        roughness: 0.1,
      });
      cyl(0.24, 0.028, -0.545, 0.048, 0.005, lens);
      box(0.24, -0.06, -0.7, 0.036, 0.095, 0.1, dark);
      cyl(0.3, 0.028, -0.74, 0.025, 0.06, steel, "x");
      tube(
        [
          [0.31, -0.15, -0.57],
          [0.36, -0.15, -0.53],
          [0.36, -0.21, -0.52],
        ],
        0.011,
        silver,
      );
    } else {
      const magazine = new THREE.Group();
      magazine.position.set(0.24, -0.245, -0.76);
      g.add(magazine);
      const profile = new THREE.Shape();
      profile.moveTo(-0.06, 0);
      profile.lineTo(0.06, 0);
      profile.quadraticCurveTo(0.04, -0.1, 0.095, -0.21);
      profile.lineTo(0.06, -0.27);
      profile.quadraticCurveTo(-0.025, -0.25, -0.06, -0.1);
      profile.closePath();
      const geometry = new THREE.ExtrudeGeometry(profile, {
        depth: 0.085,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.005,
        bevelThickness: 0.004,
        steps: 1,
      });
      geometry.translate(0, 0, -0.0425);
      geometry.rotateY(Math.PI / 2);
      add(geometry, steel, 0, 0, 0, magazine);
      for (let i = 0; i < 4; i++)
        box(
          0.045,
          -0.05 - i * 0.048,
          -0.006,
          0.006,
          0.021,
          0.09,
          dark,
          magazine,
        );
      box(0, -0.263, -0.015, 0.102, 0.022, 0.13, dark, magazine);
      g.userData.magazine = rememberPart(magazine);
      sights(-1.06, -0.56);
      cyl(0.24, -0.068, -0.67, 0.029, 0.035, dark);
      box(0.24, -0.071, -0.68, 0.07, 0.04, 0.048, dark);
    }
    if (hands) {
      hand(0.24, -0.34, -0.5);
      hand(0.24, -0.29, -0.94);
    }
  }
  if (data.slot < 2 && data.type !== "bow" && data.type !== "flame") {
    const flash = muzzleFlash(
      new THREE.MeshBasicMaterial({
        color: 0xffdb85,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const muzzleZ =
      id === "minigun"
        ? -1.39
        : id === "sniper"
          ? -1.55
          : id === "pistol"
            ? -0.865
            : id === "shotgun"
              ? -1.25
              : id === "shorty"
                ? -1.11
                : id === "uzi"
                  ? -1.07
                  : -1.29;
    flash.position.set(0.24, -0.16, muzzleZ);
    g.add(flash);
    g.userData.muzzleFlash = flash;
  }
  const moving = new Set(
    Object.values(g.userData).filter((x) => x?.isObject3D),
  );
  for (const h of g.userData.hands || []) mergeStatic(h, new Set());
  mergeStatic(g, moving);
  g.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  g.position.y = -0.03;
  g.userData.detailed = true;
  return g;
}

function mergeStatic(group, moving) {
  const batches = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || moving.has(mesh) || !mesh.geometry.attributes.uv)
      continue;
    mesh.updateMatrix();
    const geo = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);
    let batch = batches.get(mesh.material);
    if (!batch) {
      batch = { geometries: [], meshes: [] };
      batches.set(mesh.material, batch);
    }
    batch.geometries.push(geo);
    batch.meshes.push(mesh);
  }
  for (const [material, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries, false);
    if (!geometry) {
      batch.geometries.forEach((g) => g.dispose());
      continue;
    }
    for (const m of batch.meshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    batch.geometries.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(geometry, material));
  }
}
