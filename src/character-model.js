import { GeometryCopyCache } from "./geometry-copy-cache.js";
import * as THREE from "three";
import { operatorIdentity, callsignTexture } from "./operator-kit.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { batchFixedMeshes } from "./batching.js";
import { muzzleFlash } from "./animation.js";
import { detailedWeapon } from "./weapon-models.js";
import { COMBAT_ITEMS as WEAPONS } from "./data.js";

const operatorShapes = new GeometryCopyCache(96);

// Original articulated Striker operators. Cosmetic geometry never defines hitboxes.
// Each actor owns its tiny textile map, so normal character disposal is sufficient.
function textile() {
  const size = 64,
    bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        n =
          222 +
          ((x * 17 + y * 31) % 11) +
          (x % 4 < 2 ? 9 : 0) -
          (y % 4 < 2 ? 7 : 0);
      bytes[i] = bytes[i + 1] = bytes[i + 2] = n;
      bytes[i + 3] = 255;
    }
  const t = new THREE.DataTexture(bytes, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.needsUpdate = true;
  return t;
}
export function createOperator(team, name = "BOT", { unarmed = false } = {}) {
  const group = new THREE.Group();
  group.name = "striker-operator";
  const { seed, kit, callsign } = operatorIdentity(name);
  const weave = textile(),
    friendly = team === 0;
  const mat = (name, color, roughness = 0.65, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    m.name = name;
    return m;
  };
  const cloth = mat("woven-charcoal", kit.cloth, 0.96);
  cloth.map = weave;
  cloth.bumpMap = weave;
  cloth.bumpScale = 0.006;
  const trim = mat("rubber-and-webbing", 0x121c23, 0.88),
    armor = mat("ceramic-ivory", kit.armor, 0.46, 0.16),
    teamMat = mat(
      friendly ? "jade-team-panels" : "copper-team-panels",
      friendly ? 0x259b9b : 0xdc6843,
      0.52,
      0.15,
    ),
    metal = mat("titanium-fasteners", 0x79878d, 0.31, 0.7),
    skin = mat(
      "warm-skin",
      [0xc68f6c, 0x9c6b50, 0xd8aa88, 0xb87c59][seed % 4],
      0.86,
    ),
    hair = mat("sculpted-hair", [0x262323, 0x3a2820, 0x514031][seed % 3], 0.95),
    eye = mat("eye-white", 0xe4d9c6, 0.55),
    iris = mat("eye-and-brow", 0x171d20, 0.75);
  const lens = new THREE.MeshPhysicalMaterial({
    color: friendly ? 0x387b88 : 0xa47a4b,
    metalness: 0.25,
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  lens.name = "smoked-optical-glass";
  teamMat.emissive.setHex(friendly ? 0x195c60 : 0x70301d);
  teamMat.emissiveIntensity = 0.12;
  const parts = {
    armorMaterial: armor,
    materialPalette: { armor, cloth, trim, skin, team: teamMat },
  };
  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    parts[name] = g;
    return g;
  };
  const box = (parent, w, h, d, x, y, z, m, r = 0.014) => {
    const radius = Math.min(r, w / 4, h / 4, d / 4);
    const geometry = operatorShapes.copy(
      `box:${w}:${h}:${d}:${radius}`,
      () => new RoundedBoxGeometry(w, h, d, 1, radius),
    );
    const mesh = new THREE.Mesh(geometry, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (parent, r, len, x, y, z, m, axis = "y") => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
    o.position.set(x, y, z);
    if (axis === "x") o.rotation.z = Math.PI / 2;
    if (axis === "z") o.rotation.x = Math.PI / 2;
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  const upper = joint("upperBody", group, 0, 1, 0);
  const torso = joint("torso", upper, 0, 0.08, 0);
  box(torso, 0.68, 0.65, 0.36, 0, 0, 0, cloth, 0.045);
  // Layered plate carrier, collar, side ribs, harness and actual recessed seams.
  box(torso, 0.59, 0.43, 0.09, 0, 0.025, -0.216, trim, 0.034);
  box(torso, 0.54, 0.33, 0.055, 0, 0.05, -0.279, armor, 0.025);
  for (const x of [-0.198, 0.198]) {
    box(torso, 0.095, 0.49, 0.038, x, 0.04, -0.258, teamMat);
    box(torso, 0.034, 0.43, 0.018, x, 0.04, -0.289, trim);
  }
  for (const y of [-0.03, 0.025, 0.08])
    box(torso, 0.29, 0.012, 0.008, 0, y, -0.312, trim, 0.002);
  box(torso, 0.27, 0.066, 0.014, 0, 0.167, -0.313, teamMat);
  // Broad team patches remain legible at combat distance, with real depth testing.
  box(torso, 0.29, 0.13, 0.018, 0, 0.055, -0.317, teamMat, 0.009);
  for (const x of [-0.075, 0.075]) {
    const chevron = box(
      torso,
      0.11,
      0.022,
      0.009,
      x,
      0.055,
      -0.331,
      armor,
      0.003,
    );
    chevron.rotation.z = x < 0 ? -0.45 : 0.45;
  }
  // Embroidered-style identity patches on front/back, readable without a HUD tag.
  const patch = new THREE.MeshStandardMaterial({
    map: callsignTexture(callsign, team),
    roughness: 0.94,
  });
  patch.name = "woven-callsign-patch";
  parts.callsignMaterial = patch;
  for (const [z, y, angle] of [
    [-0.343, 0.055, Math.PI],
    [0.341, 0.015, 0],
  ]) {
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.11), patch);
    label.position.set(0, y, z);
    label.rotation.y = angle;
    torso.add(label);
  }
  const cable = new THREE.Mesh(
    operatorShapes.copy(
      "radio-cable",
      () =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.24, 0.22, 0.26),
            new THREE.Vector3(0.29, 0.34, 0.17),
            new THREE.Vector3(0.27, 0.36, -0.08),
            new THREE.Vector3(0.24, 0.21, -0.25),
          ]),
          12,
          0.009,
          5,
          false,
        ),
    ),
    trim,
  );
  cable.castShadow = true;
  torso.add(cable);
  // Within the existing carrier silhouette: seam-binding, radio fascia, buckles.
  box(torso, 0.115, 0.16, 0.022, 0.16, 0.01, 0.33, metal, 0.007);
  for (let i = 0; i < 4; i++)
    box(
      torso,
      0.065,
      0.006,
      0.009,
      0.16,
      0.045 - i * 0.022,
      0.346,
      trim,
      0.002,
    );
  for (const side of [-1, 1]) {
    box(torso, 0.066, 0.055, 0.015, side * 0.235, 0.235, -0.282, metal, 0.004);
    box(torso, 0.035, 0.028, 0.018, side * 0.235, 0.235, -0.292, trim, 0.003);
  }
  for (const x of [-0.22, 0.22])
    for (const y of [-0.092, 0.192])
      cylinder(torso, 0.012, 0.012, x, y, -0.315, metal, "z");
  box(torso, 0.54, 0.36, 0.075, 0, 0.035, 0.215, armor, 0.028);
  box(torso, 0.43, 0.11, 0.025, 0, 0.16, 0.263, teamMat);
  box(torso, 0.3, 0.28, 0.09, 0, 0.02, 0.276, trim, 0.022);
  box(torso, 0.255, 0.024, 0.012, 0, 0.09, 0.329, teamMat);
  for (const x of [-0.32, 0.32])
    box(torso, 0.04, 0.38, 0.34, x, -0.02, 0, trim);
  box(torso, 0.39, 0.09, 0.36, 0, 0.344, 0, trim, 0.02);
  cylinder(upper, 0.105, 0.1, 0, 0.433, 0, skin);
  const belt = joint("belt", group, 0, 0.73, 0);
  box(belt, 0.69, 0.115, 0.39, 0, 0, 0, trim);
  box(belt, 0.11, 0.075, 0.022, 0, 0, -0.213, metal, 0.006);
  for (const side of [-1, 1]) {
    const pouch = joint(
      side < 0 ? "pouchLeft" : "pouchRight",
      upper,
      side * 0.24,
      -0.17,
      -0.23,
    );
    box(pouch, 0.16, 0.19, 0.1, 0, 0, 0, cloth);
    box(pouch, 0.17, 0.055, 0.025, 0, 0.065, -0.061, armor);
    box(pouch, 0.023, 0.065, 0.012, 0, 0.025, -0.08, trim, 0.004);
  }
  const head = joint("head", upper, 0, 0.6, 0);
  box(head, 0.455, 0.445, 0.42, 0, 0, 0, skin, 0.055);
  // Human face is readable from several metres: brow, cheek/nose, eyes and jaw.
  for (const side of [-1, 1]) {
    box(head, 0.092, 0.044, 0.022, side * 0.102, 0.022, -0.219, eye, 0.008);
    box(head, 0.033, 0.039, 0.013, side * 0.097, 0.02, -0.237, iris, 0.005);
    const lid = joint(
      side < 0 ? "leftLid" : "rightLid",
      head,
      side * 0.102,
      0.022,
      -0.249,
    );
    box(lid, 0.1, 0.05, 0.008, 0, 0, 0, skin, 0.005);
    lid.scale.y = 0.001;
    const brow = box(
      head,
      0.105,
      0.022,
      0.025,
      side * 0.102,
      0.073,
      -0.225,
      hair,
      0.004,
    );
    brow.rotation.z = side * 0.08;
    box(head, 0.038, 0.096, 0.06, side * 0.232, -0.015, 0, skin, 0.016);
  }
  box(head, 0.056, 0.076, 0.048, 0, -0.027, -0.231, skin, 0.016);
  box(head, 0.095, 0.012, 0.012, 0, -0.121, -0.217, iris, 0.003);
  // High-set ballistic eyewear leaves the face visible instead of a blank robot strip.
  const visor = joint("visor", head, 0, 0.117, -0.209);
  for (const side of [-1, 1]) {
    box(visor, 0.166, 0.068, 0.027, side * 0.099, 0, 0, trim, 0.012);
    box(visor, 0.142, 0.046, 0.012, side * 0.099, 0, -0.02, lens, 0.01);
  }
  box(visor, 0.055, 0.015, 0.027, 0, 0, -0.008, metal, 0.003);
  const helmet = joint("helmet", head, 0, 0.2, 0);
  box(helmet, 0.47, 0.135, 0.43, 0, 0, 0.014, hair, 0.038);
  for (let i = 0; i < 4; i++) {
    const tuft = box(
      helmet,
      0.103,
      0.075,
      0.29,
      -0.155 + i * 0.098,
      0.07,
      -0.015,
      hair,
      0.018,
    );
    tuft.rotation.z = -0.16;
    tuft.rotation.x = -0.12;
  }
  box(helmet, 0.39, 0.036, 0.02, 0, 0.017, -0.219, hair, 0.009);
  for (const side of [-1, 1]) {
    cylinder(head, 0.079, 0.052, side * 0.254, 0.055, 0.025, trim, "x");
    cylinder(head, 0.054, 0.058, side * 0.26, 0.055, 0.025, armor, "x");
    box(head, 0.016, 0.16, 0.031, side * 0.244, 0.157, 0.025, trim, 0.004);
  }
  const mic = box(
    head,
    0.027,
    0.022,
    0.19,
    0.267,
    -0.005,
    -0.105,
    metal,
    0.007,
  );
  mic.rotation.x = 0.18;
  box(head, 0.047, 0.035, 0.043, 0.267, -0.023, -0.205, trim, 0.008);
  // Preserve the existing shoulder, elbow, wrist, hip and knee coordinates for IK.
  for (const [side, sign] of [
    ["left", -1],
    ["right", 1],
  ]) {
    const arm = joint(side + "Arm", upper, sign * 0.47, 0.37, -0.13);
    box(arm, 0.235, 0.34, 0.245, 0, -0.17, 0, cloth, 0.027);
    box(arm, 0.28, 0.19, 0.285, 0, -0.075, 0, armor, 0.027);
    box(arm, 0.017, 0.085, 0.2, sign * 0.15, -0.065, 0, teamMat, 0.006);
    for (const z of [-0.08, 0.08])
      cylinder(arm, 0.011, 0.012, sign * 0.163, -0.06, z, metal, "x");
    const elbow = joint(side + "Elbow", arm, 0, -0.34, 0);
    cylinder(elbow, 0.106, 0.235, 0, 0, 0, trim, "x");
    box(elbow, 0.216, 0.365, 0.228, 0, -0.19, 0, cloth, 0.024);
    box(elbow, 0.19, 0.24, 0.044, 0, -0.19, -0.127, armor);
    box(elbow, 0.225, 0.057, 0.245, 0, -0.315, 0, teamMat, 0.008);
    const hand = joint(side + "Hand", elbow, 0, -0.4, 0);
    box(hand, 0.212, 0.135, 0.225, 0, 0, 0, trim, 0.025);
    box(hand, 0.17, 0.044, 0.105, 0, 0.058, -0.033, armor, 0.009);
    for (let i = 0; i < 3; i++)
      box(
        hand,
        0.041,
        0.038,
        0.075,
        -0.054 + i * 0.054,
        0.056,
        -0.083,
        trim,
        0.008,
      );
    const hip = joint(side + "Leg", group, sign * 0.23, 0.73, 0);
    box(hip, 0.28, 0.34, 0.3, 0, -0.17, 0, cloth, 0.024);
    box(hip, 0.031, 0.24, 0.22, sign * 0.15, -0.17, 0.013, teamMat, 0.006);
    const knee = joint(side + "Knee", hip, 0, -0.34, 0);
    box(knee, 0.266, 0.315, 0.28, 0, -0.16, 0, cloth, 0.024);
    box(knee, 0.245, 0.19, 0.07, 0, -0.035, -0.166, trim, 0.024);
    box(knee, 0.195, 0.12, 0.025, 0, -0.024, -0.211, armor, 0.015);
    box(knee, 0.19, 0.11, 0.035, 0, -0.203, -0.158, teamMat, 0.012);
    const foot = joint(side + "Foot", knee, 0, -0.325, -0.045);
    box(foot, 0.295, 0.125, 0.4, 0, 0, 0, trim, 0.021);
    box(foot, 0.295, 0.034, 0.4, 0, -0.049, 0, armor, 0.008);
    box(foot, 0.255, 0.075, 0.16, 0, 0.015, -0.131, trim, 0.02);
    for (let i = 0; i < 3; i++)
      box(knee, 0.13, 0.009, 0.018, 0, -0.27 - i * 0.022, -0.15, metal, 0.002);
  }
  const weapon = joint("weaponRig", upper, 0.18, 0.23, -0.25);
  parts.gun = box(
    weapon,
    0.15,
    0.19,
    0.7,
    0,
    -0.01,
    -0.28,
    mat("world-rifle", 0x66735c, 0.55, 0.35),
  );
  parts.barrel = box(weapon, 0.06, 0.06, 0.3, 0, 0, -0.7, trim);
  const flash = muzzleFlash(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 2.1, 0.45),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0, 0, -0.88);
  weapon.add(flash);
  parts.muzzleFlash = flash;
  const socket = new THREE.Group();
  weapon.add(socket);
  parts.onlineSocket = socket;
  parts.baseMuzzleFlash = flash;
  flash.visible = false;
  parts.gun.visible = parts.barrel.visible = false;
  // Glove rounds replace the held item immediately: do not build, texture and
  // then dispose a detailed rifle during every spawn / first third-person frame.
  if (!unarmed) {
    const rifle = detailedWeapon("rifle", WEAPONS.rifle, { hands: false });
    rifle.scale.setScalar(0.85);
    rifle.position.set(-0.24 * 0.85, 0.24 * 0.85, 0.62 * 0.85);
    socket.add(rifle);
    socket.userData.id = "rifle";
    socket.userData.weapon = rifle;
    parts.muzzleFlash = rifle.userData.muzzleFlash;
  }
  // Batch each rigid bone separately. Never merge moving joints or retained rig handles.
  const retained = new Set([parts.gun, parts.barrel]);
  const isHeldWeapon = (o) => {
    for (let p = o; p; p = p.parent) if (p === socket) return true;
    return false;
  };
  const bones = [];
  group.traverse((o) => {
    if (o.isGroup && o !== weapon && !isHeldWeapon(o)) bones.push(o);
  });
  for (const o of bones) {
    const fixed = o.children.filter((c) => c.isMesh && !retained.has(c));
    if (fixed.length < 2) continue;
    const temp = new THREE.Group();
    temp.name = "rigid-bone-detail";
    o.add(temp);
    for (const c of fixed) temp.add(c);
    batchFixedMeshes(temp);
  }
  group.userData.characterStyle = "striker-v2";
  group.userData.team = team;
  group.userData.kitStyle = kit.name;
  group.userData.callsign = callsign;
  group.userData.finishRevision = "striker-v3";
  group.userData.rigRevision = 3;
  return { group, parts };
}
