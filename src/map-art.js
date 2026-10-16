import * as THREE from "three";
import { batchFixedMeshes } from "./batching.js";

// Daylight, not a colour filter: neutral combat silhouettes remain readable.
// These profiles never change weapon-scene lights or gameplay geometry.
export const MAP_ART = Object.freeze(
  Object.fromEntries(
    Object.entries({
      blockout: {
        name: "CONCRETE WORKS",
        code: "01 / TRAINING",
        trim: 0x4f626a,
        accent: 0xa36e52,
        stone: 0x949d9e,
        sun: [-22, 38, 18],
        light: 0xffefd9,
        power: 2.45,
        sky: 0x427da6,
        horizon: 0xc3d1d6,
        fog: 0xb1c2ca,
        ground: 0x596572,
      },
      foundry: {
        name: "FOUNDRY",
        code: "07 / CASTING BAY",
        trim: 0x4b565b,
        accent: 0xb17d43,
        stone: 0x8c9190,
        sun: [-28, 32, 16],
        light: 0xffe7ce,
        power: 2.5,
        sky: 0x5b829b,
        horizon: 0xd7d0bf,
        fog: 0xc0bdb3,
        ground: 0x635e58,
      },
      courtyard: {
        name: "THE COURTYARD",
        code: "03 / BOTANICAL",
        trim: 0x596b5e,
        accent: 0xa48757,
        stone: 0xa1a395,
        sun: [-16, 40, -22],
        light: 0xfff1da,
        power: 2.35,
        sky: 0x4e88a5,
        horizon: 0xd0dcd0,
        fog: 0xc1cdc1,
        ground: 0x64705c,
      },
      compound: {
        name: "THE COMPOUND",
        code: "02 / OPERATIONS",
        trim: 0x526269,
        accent: 0xa7785c,
        stone: 0x969f9f,
        sun: [-24, 38, 14],
        light: 0xffeedc,
        power: 2.4,
        sky: 0x497da0,
        horizon: 0xc8d4d7,
        fog: 0xb9c9ce,
        ground: 0x596874,
      },
      rooftops: {
        name: "SKYLINE",
        code: "04 / ROOF ACCESS",
        trim: 0x475e6c,
        accent: 0x927e5e,
        stone: 0x939fa7,
        sun: [22, 34, -20],
        light: 0xffe9cf,
        power: 2.5,
        sky: 0x3a709e,
        horizon: 0xc8d8df,
        fog: 0xb7cbd6,
        ground: 0x55687b,
      },
      hangar: {
        name: "HANGAR 09",
        code: "09 / FREIGHT",
        trim: 0x48565c,
        accent: 0xb58a51,
        stone: 0x909a9c,
        sun: [-30, 35, -10],
        light: 0xffeed8,
        power: 2.45,
        sky: 0x537b9a,
        horizon: 0xcbd4d5,
        fog: 0xb7c6ce,
        ground: 0x58656e,
      },
      range: {
        name: "THE RANGE",
        code: "00 / QUALIFICATION",
        trim: 0x52646b,
        accent: 0xa57e58,
        stone: 0x98a2a2,
        sun: [-20, 38, 15],
        light: 0xfff0df,
        power: 2.4,
        sky: 0x467ea6,
        horizon: 0xc9d9df,
        fog: 0xb8cad3,
        ground: 0x596875,
      },
    }).map(([id, profile]) => [
      id,
      Object.freeze({ ...profile, sun: Object.freeze(profile.sun) }),
    ]),
  ),
);

export function applyMapLighting(scene, atmosphere, id) {
  const art = MAP_ART[id] || MAP_ART.blockout;
  const sun = scene.getObjectByName("arena-sun");
  if (sun) {
    sun.position.fromArray(art.sun);
    sun.color.setHex(art.light);
    sun.intensity = art.power;
    sun.updateMatrixWorld();
    sun.shadow.needsUpdate = true;
  }
  const fill = scene.getObjectByName("arena-fill");
  if (fill) {
    fill.color.setHex(art.horizon);
    fill.groundColor.setHex(art.ground);
    fill.intensity = 0.9;
  }
  if (scene.fog) {
    scene.fog.color.setHex(art.fog);
    scene.fog.near = 60;
    scene.fog.far = 145;
  }
  const u = atmosphere.material.uniforms;
  u.sunDirection.value.fromArray(art.sun).normalize();
  u.horizon.value.setHex(art.horizon);
  u.zenith.value.setHex(art.sky);
  return art;
}

function material(world, key, options) {
  const name = `map-art-${key}`;
  if (!world.materials.has(name))
    world.materials.set(name, new THREE.MeshStandardMaterial(options));
  return world.materials.get(name);
}

function lettering(world, id, art) {
  const key = `map-art-lettering-${id}`;
  let texture = world.graphics.textures.get(key);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c8d0cc";
    ctx.font = "700 42px sans-serif";
    ctx.fillText(art.name, 12, 55, 488);
    ctx.fillStyle = "#b69a70";
    ctx.fillRect(12, 72, 46, 5);
    ctx.fillStyle = "#a1b0af";
    ctx.font = "600 20px sans-serif";
    ctx.fillText(art.code + "   /   FIELD FACILITY", 75, 88, 420);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    world.graphics.textures.set(key, texture);
  }
  return material(world, `lettering-${id}`, {
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function serviceAtlas(world) {
  const key = "map-art-service-atlas";
  let texture = world.graphics.textures.get(key);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext("2d");
    c.fillStyle = "#576369";
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = "#293940";
    c.beginPath();
    c.arc(128, 128, 116, 0, Math.PI * 2);
    c.fill();
    // Static fan blades and concentric guards read at a distance without animation.
    c.save();
    c.translate(128, 128);
    for (let i = 0; i < 7; i++) {
      c.rotate((Math.PI * 2) / 7);
      c.fillStyle = "#69777d";
      c.beginPath();
      c.moveTo(10, 4);
      c.quadraticCurveTo(70, -52, 103, -10);
      c.lineTo(53, 27);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = "#9ba5a5";
    c.lineWidth = 2;
    for (let r = 28; r < 117; r += 14) {
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
    }
    for (let i = 0; i < 8; i++) {
      c.rotate(Math.PI / 4);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(116, 0);
      c.stroke();
    }
    c.fillStyle = "#aab0ac";
    c.beginPath();
    c.arc(0, 0, 12, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = "#8c999b";
    c.fillRect(264, 8, 240, 240);
    c.fillStyle = "#3d5058";
    for (let y = 24; y < 181; y += 12) {
      c.fillRect(279, y, 210, 5);
    }
    c.fillStyle = "#bdc5bf";
    for (const x of [272, 496])
      for (const y of [16, 240]) c.fillRect(x - 2, y - 2, 4, 4);
    c.fillStyle = "#334850";
    c.fillRect(281, 202, 128, 26);
    c.fillStyle = "#c4ceca";
    c.font = "bold 13px sans-serif";
    c.fillText("AIR / SERVICE", 287, 220);
    c.fillStyle = "#b3945b";
    c.fillRect(433, 202, 52, 26);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    world.graphics.textures.set(key, texture);
  }
  return material(world, "service-atlas", {
    map: texture,
    roughness: 0.65,
    metalness: 0.25,
  });
}

// Every in-bounds detail is paint/flush cladding on an existing solid surface.
// All substantial silhouettes live OUTSIDE the court. No fake, non-colliding cover.
export function createMapArchitecture(world, layout, covers = []) {
  const id = world.mapId,
    art = MAP_ART[id] || MAP_ART.blockout;
  const width = layout?.width || 47,
    depth = layout?.depth || 47,
    height = layout?.wallHeight || 3.8;
  const group = new THREE.Group();
  group.name = "map-architecture";
  const surfaces = material(world, "surfaces", {
    vertexColors: true,
    roughness: 0.88,
  });
  const metal = material(world, "metal", {
    vertexColors: true,
    roughness: 0.53,
    metalness: 0.42,
  });
  const lamps = material(world, "lamps", {
    color: 0xffeccd,
    emissive: 0xffd9a3,
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });
  const paint = material(world, "paint", {
    vertexColors: true,
    roughness: 0.94,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const color = new THREE.Color();
  let sourceMeshes = 0,
    exteriorMeshes = 0;
  function mesh(
    geometry,
    x,
    y,
    z,
    hex,
    mat = surfaces,
    rotation = 0,
    exterior = false,
  ) {
    if (mat.vertexColors) {
      color.setHex(hex);
      const values = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
      geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    }
    const obj = new THREE.Mesh(geometry, mat);
    obj.position.set(x, y, z);
    obj.rotation.y = rotation;
    obj.receiveShadow = true;
    // Flush paint must never introduce shadow acne. Exterior forms can cast.
    obj.castShadow = exterior;
    group.add(obj);
    sourceMeshes++;
    if (exterior) exteriorMeshes++;
    return obj;
  }
  const box = (x, y, z, w, h, d, hex, mat = surfaces, exterior = false) =>
    mesh(new THREE.BoxGeometry(w, h, d), x, y, z, hex, mat, 0, exterior);
  const plane = (x, y, z, w, h, hex, rotation = 0, mat = paint) =>
    mesh(new THREE.PlaneGeometry(w, h), x, y, z, hex, mat, rotation);

  // Side-wall architecture: broad tonal bands and fine joints, not more obstacles.
  // Stop short of the corners so existing wall signage/windows stay untouched.
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.006),
      facing = (-side * Math.PI) / 2;
    plane(x, height - 0.32, 0, depth - 0.3, 0.23, art.trim, facing);
    plane(x, 0.34, 0, depth - 0.3, 0.48, art.trim, facing);
    const count = Math.floor((depth - 4) / 4.8);
    for (let i = 0; i <= count; i++) {
      const z = (i - count / 2) * 4.8;
      // Slim vertical pour joints bring scale to the tall blank perimeter.
      plane(
        x - side * 0.002,
        height / 2,
        z,
        0.026,
        height - 1.1,
        art.trim,
        facing,
      );
      if (height > 6) {
        plane(x - side * 0.004, height - 2.5, z, 3.8, 0.055, art.trim, facing);
        plane(
          x - side * 0.004,
          height - 3.1,
          z,
          0.38,
          0.13,
          art.accent,
          facing,
        );
      }
    }
    // Two large, quiet facility identities on the high wall, not in combat space.
    plane(
      x - side * 0.008,
      height > 6 ? height - 1.65 : 2.65,
      0,
      height > 6 ? 7 : 5.5,
      height > 6 ? 1.75 : 1.375,
      0xffffff,
      facing,
      lettering(world, id, art),
    );
  }
  // Fine recessed-looking cover seams; rotate exactly like the mirrored solids.
  for (const side of [-1, 1])
    for (const slab of covers) {
      const angle = (slab.angle || 0) + (side < 0 ? Math.PI : 0);
      for (const face of [-1, 1]) {
        const offset = face * (slab.d / 2 + 0.004);
        const x = side * slab.x + Math.sin(angle) * offset;
        const z = side * slab.z + Math.cos(angle) * offset;
        for (const y of [slab.h * 0.48, slab.h - 0.24])
          plane(
            x,
            y,
            z,
            Math.max(0.1, slab.w - 0.14),
            0.018,
            0x737e80,
            angle + (face < 0 ? Math.PI : 0),
          );
      }
    }
  // Flush loading thresholds with broken edges instead of floating raised bars.
  for (const side of [-1, 1])
    for (let i = -3; i <= 3; i++) {
      const p = plane(
        i * 0.45,
        0.018,
        side * (depth / 2 - 1.3),
        0.24,
        0.42,
        art.accent,
      );
      p.rotation.set(-Math.PI / 2, 0, 0.35);
    }

  function service(x, y, z, w, h, fan = false, rotation = 0) {
    const geometry = fan
      ? new THREE.CircleGeometry(w / 2, 32)
      : new THREE.PlaneGeometry(w, h);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setX(i, uv.getX(i) * 0.5 + (fan ? 0 : 0.5));
    const obj = mesh(
      geometry,
      x,
      y,
      z,
      0xffffff,
      serviceAtlas(world),
      rotation,
    );
    if (fan) obj.rotation.x = -Math.PI / 2;
    return obj;
  }
  if (id === "rooftops") {
    for (const [x, z] of [
      [-11, -8],
      [11, 8],
      [-13, 12],
      [13, -12],
    ]) {
      service(x, 2.531, z, 2.2, 2.2, true);
      for (const side of [-1, 1])
        service(
          x + side * 2.506,
          1.3,
          z,
          2.9,
          1.5,
          false,
          (side * Math.PI) / 2,
        );
      plane(x, 0.3, z - 2.006, 4.5, 0.12, art.trim, Math.PI);
    }
  }
  if (id === "compound")
    for (const [x, z] of [
      [-8, -5],
      [9, 6],
    ]) {
      service(x, 5.517, z, 1.08, 1.08, true);
      service(x - 1.6, 2.1, z - 5.006, 1.6, 1.4, false, Math.PI);
      for (const dx of [-3.3, 3.3])
        plane(x + dx, 2.1, z - 5.008, 0.08, 3.8, art.trim, Math.PI);
      plane(x, 0.4, z - 5.008, 6.6, 0.25, art.trim, Math.PI);
    }
  // End-door detailing follows the actual shipping-container footprint.
  const containers =
    id === "hangar"
      ? [
          [-9, -7, 10, 4],
          [9, 7, 10, 4],
          [10, -12, 5, 3],
          [-10, 12, 5, 3],
        ]
      : id === "compound"
        ? [
            [8, -10, 8, 3],
            [-9, 12, 8, 3],
          ]
        : [];
  for (const [x, z, w, d] of containers)
    for (const side of [-1, 1]) {
      const face = x + side * (w / 2 + 0.006),
        rotation = (side * Math.PI) / 2;
      for (const offset of [-d * 0.38, 0, d * 0.38])
        plane(face, 1.7, z + offset, 0.035, 3, art.trim, rotation);
      for (const y of [0.25, 3.15])
        plane(face, y, z, d - 0.14, 0.08, art.trim, rotation);
      service(
        face + side * 0.002,
        1.8,
        z,
        Math.min(1.2, d * 0.35),
        0.9,
        false,
        rotation,
      );
    }

  if (id === "courtyard") {
    // Botanical garden beyond the real walls; trunks never occupy playable lanes.
    for (const side of [-1, 1])
      for (const z of [-depth * 0.38, 0, depth * 0.38]) {
        const x = side * (width / 2 + 5.5),
          h = 10 + Math.cos(z) * 1.3;
        box(x, 1, z, 5.8, 2, 5.8, art.stone, surfaces, true);
        mesh(
          new THREE.CylinderGeometry(0.24, 0.4, h, 7),
          x,
          h / 2 + 1,
          z,
          0x736a52,
          surfaces,
          0,
          true,
        );
        for (let i = 0; i < 3; i++)
          mesh(
            new THREE.IcosahedronGeometry(2.8 - i * 0.32, 1),
            x + Math.sin(i * 4 + z) * 1.2,
            h + i * 1.05,
            z + Math.cos(i * 3) * 0.9,
            [0x647b50, 0x72865b, 0x829266][i],
            surfaces,
            0,
            true,
          );
      }
    for (const side of [-1, 1]) {
      const z = side * (depth / 2 + 6);
      for (const x of [-width * 0.33, width * 0.33])
        box(
          x,
          height / 2,
          z,
          0.55,
          height + 2,
          0.55,
          art.stone,
          surfaces,
          true,
        );
      box(0, height + 1, z, width * 0.7, 0.45, 0.7, art.trim, surfaces, true);
      for (let x = -width * 0.33; x < width * 0.34; x += 1.6)
        box(x, height + 1.4, z, 0.16, 0.15, 3.8, art.trim, surfaces, true);
    }
  } else if (id === "foundry" || id === "hangar") {
    // Twin industrial landmarks: unmistakable map identity from either spawn.
    for (const side of [-1, 1]) {
      const x = side * (width / 2 + 8),
        z = -side * depth * 0.28,
        h = height + 7;
      mesh(
        new THREE.CylinderGeometry(2.5, 2.5, h, 12),
        x,
        h / 2,
        z,
        art.stone,
        metal,
        0,
        true,
      );
      for (const y of [h * 0.34, h * 0.7, h - 0.6])
        mesh(
          new THREE.CylinderGeometry(2.58, 2.58, 0.22, 12),
          x,
          y,
          z,
          art.trim,
          metal,
          0,
          true,
        );
      mesh(
        new THREE.CylinderGeometry(1.3, 2.5, 1.2, 12),
        x,
        h + 0.6,
        z,
        art.trim,
        metal,
        0,
        true,
      );
      box(
        x + side * 4,
        (h + 6) / 2,
        z + 4,
        1.3,
        h + 6,
        1.3,
        art.trim,
        surfaces,
        true,
      );
      for (let y = h; y < h + 6; y += 1)
        box(
          x + side * 4,
          y,
          z + 4,
          1.32,
          0.25,
          1.32,
          art.accent,
          surfaces,
          true,
        );
      box(x, height + 3.5, z + 5, 12, 0.6, 0.8, art.trim, metal, true);
      box(x, height + 3.1, z + 5, 4, 0.12, 0.4, 0xffffff, lamps, true);
    }
  } else if (id === "blockout") {
    // An architectural campus, with stepped rooflines rather than window noise.
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1,
        x = side * (width / 2 + 8 + (i % 3) * 3);
      const z = (Math.floor(i / 2) - 2) * 13,
        h = 15 + ((i * 7) % 11);
      box(x, h / 2, z, 7, h, 8, i % 3 ? art.stone : 0x7d8d94, surfaces, true);
      box(x, h + 0.2, z, 7.4, 0.4, 8.4, art.trim, surfaces, true);
      box(x, h + 1.2, z, 3.6, 2, 4.4, art.trim, surfaces, true);
      for (let y = height + 0.7; y < h; y += 2.5) {
        box(x - side * 3.51, y, z, 0.025, 0.8, 5.8, 0x516873, metal, true);
        box(x, y, z + 4.01, 5.8, 0.8, 0.025, 0x516873, metal, true);
      }
    }
  }
  // Per-map batched maintenance fixtures safely behind the boundary, including
  // the legacy maps whose existing skyline is intentionally kept intact.
  if (["compound", "rooftops", "range"].includes(id))
    for (const side of [-1, 1]) {
      const x = side * (width / 2 + 3),
        z = -side * depth * 0.3;
      box(x, 4, z, 2, 8, 2, art.trim, metal, true);
      box(x, 8.3, z, 3.8, 0.5, 2.5, art.stone, metal, true);
      box(x - side * 1.92, 8.3, z, 0.035, 0.2, 1.7, 0xffffff, lamps, true);
      if (id === "rooftops") {
        mesh(
          new THREE.CylinderGeometry(0.065, 0.1, 6, 6),
          x,
          11.5,
          z,
          art.trim,
          metal,
          0,
          true,
        );
        box(x, 13, z, 2.5, 0.08, 0.08, art.trim, metal, true);
        box(x, 11.7, z, 1.6, 0.08, 0.08, art.trim, metal, true);
      }
    }
  group.userData = {
    style: id,
    sourceMeshes,
    exteriorMeshes,
    collisionFree: true,
    batching: batchFixedMeshes(group),
  };
  return group;
}
