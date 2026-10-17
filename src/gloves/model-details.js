import * as THREE from "three";
// Original, bounded procedural geometry. No Roblox meshes, textures or audio.
export function addGloveDetails(glove, { palm, wrist, box, main, dark, trim }) {
  const mesh = (geometry, material, x, y, z) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    palm.add(m);
    m.castShadow = true;
    return m;
  };
  const ring = (radius, x, y, z, arc = Math.PI * 2) =>
    mesh(new THREE.TorusGeometry(radius, 0.019, 6, 24, arc), trim, x, y, z);
  const pip = (x, y, z = 0.16, material = dark, r = 0.023) =>
    mesh(new THREE.SphereGeometry(r, 8, 6), material, x, y, z);
  switch (glove.key) {
    case "dual":
      box(palm, 0.22, 0.06, 0.04, 0, 0.12, 0.14, trim);
      break;
    case "brick":
      box(palm, 0.32, 0.25, 0.08, 0, 0.13, 0.14, trim);
      for (let i = 0; i < 4; i++)
        pip(
          ((i % 2) - 0.5) * 0.15,
          0.07 + Math.floor(i / 2) * 0.13,
          0.21,
          main,
          0.04,
        );
      break;
    case "acrobat":
      for (let i = 0; i < 3; i++)
        box(wrist, 0.27, 0.035, 0.25, 0, -0.22 - i * 0.08, 0, trim);
      for (let i = 0; i < 2; i++) {
        const b = box(
          palm,
          0.07,
          0.23,
          0.04,
          (i - 0.5) * 0.13,
          0.15,
          0.15,
          dark,
        );
        b.rotation.z = -0.35;
      }
      break;
    case "dice":
      box(palm, 0.29, 0.29, 0.11, 0, 0.15, 0.16, trim);
      for (const [x, y] of [
        [-0.08, 0.07],
        [-0.08, 0.15],
        [-0.08, 0.23],
        [0.08, 0.07],
        [0.08, 0.15],
        [0.08, 0.23],
      ])
        pip(x, y, 0.225);
      break;
    case "ghost":
      main.transparent = true;
      main.opacity = 0.68;
      trim.emissiveIntensity = 0.45;
      for (const x of [-0.08, 0.08]) {
        const eye = pip(x, 0.18, 0.16, dark, 0.045);
        eye.scale.y = 1.3;
      }
      box(palm, 0.09, 0.025, 0.02, 0, 0.07, 0.14, dark);
      break;
    case "thanos":
      main.metalness = 0.75;
      for (let i = 0; i < 5; i++) {
        const mat = new THREE.MeshStandardMaterial({
          color: ["#f66b69", "#70df8b", "#85bfff", "#db8ce8", "#ffe085"][i],
          emissive: ["#f66b69", "#70df8b", "#85bfff", "#db8ce8", "#ffe085"][i],
          emissiveIntensity: 0.3,
          metalness: 0.4,
          roughness: 0.22,
        });
        const crystal = mesh(
          new THREE.OctahedronGeometry(i === 4 ? 0.08 : 0.042),
          mat,
          i === 4 ? 0 : (i - 1.5) * 0.095,
          i === 4 ? 0.13 : 0.29,
          0.15,
        );
        crystal.scale.z = 0.6;
      }
      break;
    case "stun":
      for (const x of [-0.13, 0.13]) {
        box(palm, 0.065, 0.28, 0.07, x, 0.15, 0.14, dark);
        for (let i = 0; i < 4; i++)
          box(palm, 0.08, 0.025, 0.09, x, 0.03 + i * 0.075, 0.15, trim);
      }
      box(palm, 0.07, 0.16, 0.04, 0, 0.16, 0.15, trim).rotation.z = -0.4;
      break;
    case "za_hando":
      for (let i = 0; i < 4; i++)
        box(palm, 0.36, 0.018, 0.02, 0, 0.025 + i * 0.075, 0.11, dark);
      ring(0.09, 0, 0.14, 0.16);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.04, 0.12, 4),
          trim,
        );
        spike.position.set((i - 2) * 0.064, -0.16, 0.12);
        spike.rotation.x = Math.PI;
        wrist.add(spike);
      }
      break;
    case "magnet":
      ring(0.11, 0, 0.18, 0.16, Math.PI);
      for (const x of [-0.11, 0.11]) {
        box(palm, 0.045, 0.14, 0.04, x, 0.11, 0.16, trim);
        box(palm, 0.055, 0.055, 0.05, x, 0.04, 0.16, dark);
      }
      break;
    case "anchor":
      ring(0.045, 0, 0.29, 0.15);
      box(palm, 0.025, 0.28, 0.03, 0, 0.13, 0.15, trim);
      box(palm, 0.24, 0.025, 0.03, 0, 0.17, 0.15, trim);
      for (const x of [-0.09, 0.09])
        box(palm, 0.13, 0.025, 0.03, x, 0.035, 0.15, trim).rotation.z =
          x > 0 ? -0.5 : 0.5;
      break;
    case "space":
      main.color.set("#30364f");
      main.metalness = 0.55;
      ring(0.14, 0, 0.15, 0.14).rotation.y = 0.5;
      ring(0.1, 0, 0.15, 0.17).rotation.x = 0.7;
      pip(0, 0.15, 0.17, trim, 0.065);
      for (let i = 0; i < 6; i++)
        pip(Math.cos(i) * 0.17, 0.15 + Math.sin(i) * 0.17, 0.14, trim, 0.013);
      break;
    case "boomerang":
      for (const x of [-0.07, 0.07])
        box(palm, 0.19, 0.055, 0.04, x, 0.16, 0.15, trim).rotation.z =
          x > 0 ? -0.65 : 0.65;
      break;
    case "speedrun":
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++) {
          const coil = ring(0.05, (i - 1.5) * 0.103, 0.34 + j * 0.07, 0.01);
          coil.rotation.x = Math.PI / 2;
        }
      box(palm, 0.055, 0.23, 0.03, 0, 0.14, 0.14, trim).rotation.z = -0.45;
      break;
    case "golden":
      main.metalness = 0.88;
      main.roughness = 0.22;
      trim.emissiveIntensity = 0.45;
      for (let i = 0; i < 3; i++) {
        const peak = mesh(
          new THREE.ConeGeometry(0.055, 0.13, 4),
          trim,
          (i - 1) * 0.105,
          0.16,
          0.14,
        );
        peak.rotation.z = Math.PI;
      }
      box(palm, 0.32, 0.045, 0.04, 0, 0.07, 0.15, trim);
      break;
    case "reverse":
      for (const [y, direction] of [
        [0.08, 1],
        [0.23, -1],
      ]) {
        box(palm, 0.23, 0.035, 0.04, 0, y, 0.15, trim);
        for (const sign of [-1, 1])
          box(
            palm,
            0.09,
            0.03,
            0.04,
            0.115 * direction,
            y + sign * 0.025,
            0.15,
            trim,
          ).rotation.z = sign * direction * 0.7;
      }
      break;
  }
}
