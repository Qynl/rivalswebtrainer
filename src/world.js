import { addElevations } from "./elevation-layout.js";
import { EXTRA_COURTS, dressCourt } from "./map-layouts.js";
import { createArenaDressing } from "./arena-dressing.js";
import { batchFixedMeshes } from "./batching.js";
import { muzzleFlash } from "./animation.js";
import { ArenaAtmosphere } from "./atmosphere.js";
import { ARENA, HALF_COVER, HALF_WINDOWS } from "./arena-layout.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ArenaGraphics, artColor } from "./graphics.js";
import { detailedWeapon } from "./weapon-models.js";
import { NavGrid } from "./physics.js";
export function textTexture(
  text,
  bg = "#3b354e",
  fg = "#ece5fa",
  width = 512,
  height = 128,
) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  g.fillStyle = /^#[0-9a-f]{6}$/i.test(bg)
    ? "#" + new THREE.Color(artColor(parseInt(bg.slice(1), 16))).getHexString()
    : bg;
  g.fillRect(0, 0, width, height);
  g.fillStyle = fg;
  g.font = `900 ${height * 0.53}px Arial`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, width / 2, height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export class ArenaWorld {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.boxes = [];
    this.solidMeshes = [];
    this.materials = new Map();
    this.graphics = new ArenaGraphics();
    this.atmosphere = new ArenaAtmosphere();
    scene.add(this.atmosphere.mesh);
    this.size = 48;
    this.mapId = "compound";
  }
  material(color) {
    if (!this.materials.has(color))
      this.materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color: artColor(color),
          roughness: 0.82,
          map: this.graphics.texture("concrete"),
          normalMap: this.graphics.texture("normal"),
          normalScale: new THREE.Vector2(0.12, 0.12),
        }),
      );
    return this.materials.get(color);
  }
  box(x, y, z, w, h, d, color, solid = true) {
    const m = new THREE.Mesh(
      w >= 0.7 && h >= 0.7 && d >= 0.7
        ? new RoundedBoxGeometry(w, h, d, 1, 0.045)
        : new THREE.BoxGeometry(w, h, d),
      this.material(color),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    if (solid) {
      this.boxes.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: y - h / 2,
        maxY: y + h / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
      this.solidMeshes.push(m);
    }
    return m;
  }
  // Flat markings never cast shadows or compete with the floor depth buffer.
  floorMark(x, z, width, depth, color, layer = 1) {
    const key = `mark-${color}-${layer}`;
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new THREE.MeshStandardMaterial({
          color: artColor(color),
          transparent: layer < 3,
          opacity: layer < 3 ? 0.38 : 1,
          roughness: 0.9,
          polygonOffset: true,
          polygonOffsetFactor: -layer,
          polygonOffsetUnits: -layer,
          depthWrite: false,
        }),
      );
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      this.materials.get(key),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.006 + layer * 0.003, z);
    mesh.receiveShadow = true;
    mesh.renderOrder = layer;
    this.group.add(mesh);
    return mesh;
  }
  cylinder(x, y, z, r, h, color, sides = 12) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, sides),
      this.material(color),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
  label(text, x, y, z, w, h, rot = 0, bg = "#49435e", fg = "#ddd4f3") {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: textTexture(text, bg, fg),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rot;
    this.group.add(m);
    return m;
  }
  crate(x, z, s = 2, color = 0xc68d75, y = 0) {
    this.box(x, y + s / 2, z, s, s, s, color);
    for (const dz of [-s / 2 - 0.014, s / 2 + 0.014]) {
      this.box(x, y + s * 0.14, z + dz, s + 0.03, 0.1, 0.03, 0x75596c, false);
      this.box(x, y + s * 0.86, z + dz, s + 0.03, 0.1, 0.03, 0x75596c, false);
      this.box(x - s * 0.36, y + s / 2, z + dz, 0.1, s, 0.035, 0x75596c, false);
      this.box(x + s * 0.36, y + s / 2, z + dz, 0.1, s, 0.035, 0x75596c, false);
    }
    this.box(x, y + s + 0.01, z, s, 0.025, s, 0xd4a08c, false);
  }
  container(x, z, w = 5, d = 3, color = 0x867b9c) {
    this.box(x, 1.7, z, w, 3.4, d, color);
    this.box(x, 3.45, z, w + 0.1, 0.12, d + 0.1, 0xa79cbc);
    for (let i = -w / 2 + 0.35; i < w / 2; i += 0.45) {
      this.box(x + i, 1.7, z + d / 2 + 0.025, 0.05, 3.1, 0.04, 0x655e7b, false);
      this.box(x + i, 1.7, z - d / 2 - 0.025, 0.05, 3.1, 0.04, 0x655e7b, false);
    }
    this.label("09", x, 1.9, z + d / 2 + 0.055, 1.4, 0.7);
  }
  tree(x, z, scale = 1) {
    this.box(
      x,
      1.2 * scale,
      z,
      0.38 * scale,
      2.4 * scale,
      0.38 * scale,
      0x6e5774,
      false,
    );
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry((1.5 - i * 0.2) * scale, 0),
        this.material(i % 2 ? 0xb898ba : 0xd0acbe),
      );
      m.position.set(x + (i - 1) * 0.4 * scale, (3 + i * 0.6) * scale, z);
      m.castShadow = true;
      this.group.add(m);
    }
  }
  stairs(x, z, direction = 1, count = 6, rise = 0.36) {
    for (let i = 0; i < count; i++)
      this.box(
        x,
        (rise / 2) * (i + 1),
        z + i * 0.6 * direction,
        3,
        rise * (i + 1),
        0.6,
        0xaaa0b9,
      );
  }
  build(id = "blockout") {
    // Dispose transient signage, not shared procedural textures/materials.
    const sharedMaterials = new Set(this.materials.values());
    const disposed = new Set();
    while (this.group.children.length) {
      const child = this.group.children[0];
      this.group.remove(child);
      child.traverse((o) => {
        if (o.geometry && !disposed.has(o.geometry)) {
          o.geometry.dispose();
          disposed.add(o.geometry);
        }
        if (
          o.material?.map &&
          !sharedMaterials.has(o.material) &&
          !disposed.has(o.material)
        ) {
          o.material.map.dispose();
          o.material.dispose();
          disposed.add(o.material);
        }
      });
    }
    this.boxes = [];
    this.solidMeshes = [];
    this.mapId = id;
    this.layout = null;
    this.staticStats = null;
    this.size = 48;
    this.bounds = { minX: -23.1, maxX: 23.1, minZ: -23.1, maxZ: 23.1 };
    if (id === "blockout" || EXTRA_COURTS[id]) {
      const layout = EXTRA_COURTS[id] || ARENA;
      this.layout = layout;
      this.buildBlockout(
        layout,
        layout.cover || HALF_COVER,
        layout.windows || HALF_WINDOWS,
      );
      return;
    }
    const roof = id === "rooftops",
      hangar = id === "hangar";
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(roof ? 0xb4cbd8 : 0xbcccd3, 62, 145);
    // Only the paving slab has a top at y=0. The foundation ends below it.
    this.box(0, -1.2, 0, 49, 2, 49, 0x6c6484, false);
    const floor = this.box(
      0,
      -0.1,
      0,
      48,
      0.2,
      48,
      roof ? 0xb4a9bf : 0xbeb4c9,
      false,
    );
    this.solidMeshes.push(floor);
    this.box(0, -2.1, 0, 51, 0.5, 51, 0x49435f, false);
    // Expansion joints break up the flat ground without changing collision.
    for (let i = -20; i <= 20; i += 8) {
      this.floorMark(i, 0, 0.035, 47, 0x9c92af);
      this.floorMark(0, i, 47, 0.035, 0x9c92af, 2);
    }
    for (const x of [-24, 24]) {
      this.box(x, 1.9, 0, 1, 3.8, 49, 0x827794);
      this.box(x, 3.9, 0, 1.2, 0.25, 49, 0xb4a8c1, false);
    }
    for (const z of [-24, 24]) {
      this.box(0, 1.9, z, 49, 3.8, 1, 0x827794);
      this.box(0, 3.9, z, 49, 0.25, 1.2, 0xb4a8c1, false);
    }
    // Raised orange stripes guide movement toward the arena lanes.
    for (const z of [-18, 18]) {
      this.floorMark(0, z, 6, 0.18, 0xe59a7b, 4);
      this.floorMark(-3, z, 0.16, 3, 0xe59a7b, 4);
      this.floorMark(3, z, 0.16, 3, 0xe59a7b, 4);
    }
    this.spawns = {
      0: [
        { x: 0, z: 19 },
        { x: -5, z: 19 },
        { x: 5, z: 19 },
      ],
      1: [
        { x: 0, z: -19 },
        { x: 5, z: -19 },
        { x: -5, z: -19 },
      ],
    };
    if (id === "range") {
      this.label("THE RANGE", 0, 3, -23.45, 10, 1.3, 0, "#827794");
      for (let i = 0; i < 5; i++) {
        const x = -14 + i * 7;
        this.floorMark(x, -2, 4.8, 30, i % 2 ? 0xb2a8c0 : 0xb8aec6, 3);
        this.floorMark(x - 2.6, -2, 0.06, 31, 0x887d9a, 4);
        this.floorMark(x + 2.6, -2, 0.06, 31, 0x887d9a, 4);
        this.label(
          "0" + (i + 1),
          x,
          1.7,
          -23.4,
          1.6,
          1.3,
          0,
          "#827794",
          "#ffcfb5",
        );
        this.floorMark(x, 14, 3, 0.16, 0xe59a7b, 4);
        this.box(x, 0.6, -20, 4, 1.2, 1, 0xaaa0b9);
      }
      this.crate(-20, 6, 2);
      this.crate(20, 6, 2);
      this.box(-21, 0.4, 17, 2, 0.8, 2, 0x83798f);
      this.tree(-21, 17, 0.8);
      this.box(21, 0.4, 17, 2, 0.8, 2, 0x83798f);
      this.tree(21, 17, 0.8);
    } else if (id === "compound") {
      this.box(-8, 2.3, -5, 7, 4.6, 10, 0x9689a7);
      this.box(-8, 4.7, -5, 7.4, 0.3, 10.4, 0xb5a9c3);
      this.box(-8, 2.4, 0.07, 5.7, 2.7, 0.08, 0x6b6280, false);
      this.label("SECTOR 01", -8, 3, 0.12, 4.7, 0.7, 0, "#6b6280");
      this.box(9, 2.3, 6, 7, 4.6, 10, 0x8f829f);
      this.box(9, 4.7, 6, 7.4, 0.3, 10.4, 0xb5a9c3);
      this.label("SECTOR 02", 9, 3, 0.94, 4.7, 0.7, Math.PI);
      this.container(8, -10, 8, 3, 0xc58d7e);
      this.container(-9, 12, 8, 3, 0x7f8993);
      this.box(0, 1.2, 0, 4.5, 2.4, 4.5, 0xbbb0c5);
      this.box(0, 2.47, 0, 4.8, 0.14, 4.8, 0xe3d4df, false);
      this.label("R", 0, 1.35, 2.27, 1.3, 1.3, 0, "#bbb0c5", "#84758f");
      this.crate(-16, -13, 2.4);
      this.crate(16, 13, 2.4);
      this.crate(15, -1, 2);
      this.crate(-15, 1, 2);
      this.crate(-3, 10, 1.7);
      this.crate(3, -10, 1.7);
      this.stairs(-8, 7.4, -1, 13);
      this.stairs(9, -6.4, 1, 13);
      for (const [x, z] of [
        [-17, 16],
        [17, -16],
        [-17, -19],
        [18, 19],
      ]) {
        this.box(x, 0.4, z, 3, 0.8, 3, 0x83798f);
        this.tree(x, z, 0.8);
      }
      this.label("THE COMPOUND", 0, 2.6, -23.47, 12, 1.1, 0, "#827794");
    } else if (roof) {
      this.box(0, 1.7, 0, 7, 3.4, 8, 0xaaa0b9);
      this.box(0, 3.48, 0, 7.4, 0.16, 8.4, 0xd1c5db);
      this.stairs(0, 9.7, -1, 10, 0.34);
      this.stairs(0, -9.7, 1, 10, 0.34);
      for (const [x, z] of [
        [-11, -8],
        [11, 8],
        [-13, 12],
        [13, -12],
      ]) {
        this.box(x, 1.15, z, 5, 2.3, 4, 0x9291a8);
        this.box(x, 2.33, z, 5.2, 0.1, 4.2, 0xc7bbcf);
        for (let i = -1.5; i <= 1.5; i += 0.5)
          this.box(x + i, 1.3, z + 2.02, 0.11, 1.4, 0.04, 0x68697e, false);
        this.cylinder(x, 2.45, z, 1.2, 0.15, 0x4d4d69);
      }
      this.crate(-7, 3, 1.8, 0xbb8c84);
      this.crate(7, -3, 1.8, 0xbb8c84);
      this.box(-18, 1.5, 0, 2, 3, 9, 0x8a7f9c);
      this.box(18, 1.5, 0, 2, 3, 9, 0x8a7f9c);
      for (const x of [-18, 18]) {
        this.cylinder(x, 3, -18, 0.12, 6, 0x68617d);
        this.box(x, 6, -18, 3, 0.12, 1.4, 0xe0bf97, false);
      }
      this.label("SKYLINE", 0, 2.7, -23.45, 9, 1.2);
    } else {
      for (const x of [-18, 18])
        for (const z of [-15, 0, 15]) {
          this.box(x, 5, z, 1, 10, 1, 0x625d78);
          this.box(x, 5, z, 1.12, 0.4, 1.12, 0xc79b84, false);
        }
      for (const z of [-15, 0, 15])
        this.box(0, 10, z, 37, 0.8, 1, 0x6b6583, false);
      this.container(-9, -7, 10, 4, 0xb98576);
      this.container(9, 7, 10, 4, 0x7b8b99);
      this.container(10, -12, 5, 3, 0x90819c);
      this.container(-10, 12, 5, 3, 0x90819c);
      this.crate(-2, 0, 2.5);
      this.crate(2, 0, 2.5);
      this.crate(0, 3, 1.5);
      this.crate(-15, 5, 2);
      this.crate(15, -5, 2);
      this.label("HANGAR 09", 0, 3, -23.45, 12, 1.8, 0, "#827794");
      this.floorMark(0, 0, 0.22, 45, 0xd5aa89, 4);
    }
    this.decorate(id);
    // Surrounding skyline makes this a real place, not a floating grey box.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 48 + (i % 3) * 7;
      const height = 7 + ((i * 13) % 21);
      const building = this.box(
        Math.cos(a) * r,
        height / 2 - 7,
        Math.sin(a) * r,
        6 + (i % 3) * 3,
        height,
        7,
        i % 2 ? 0x8b83a5 : 0x9b92b1,
        false,
      );
      const key = "city-" + (i % 2);
      if (!this.materials.has(key))
        this.materials.set(
          key,
          new THREE.MeshStandardMaterial({
            color: i % 2 ? 0xa6bed0 : 0xc1cdd5,
            map: this.graphics.texture("windows"),
            roughness: 0.48,
            metalness: 0.35,
          }),
        );
      building.material = this.materials.get(key);
    }
    this.nav = new NavGrid(this.boxes, 48, 1.5);
    // Combat/LOS can run before the first render, including right after a round reset.
    this.group.updateMatrixWorld(true);
  }
  concrete(x, z, w, h, d, angle = 0) {
    const mesh = this.box(x, h / 2, z, w, h, d, 0xd8dbdd);
    mesh.material = this.blockMaterial;
    if (angle) {
      mesh.rotation.y = angle;
      const box = this.boxes[this.boxes.length - 1];
      Object.assign(box, { angle, cx: x, cz: z, halfX: w / 2, halfZ: d / 2 });
      const extentX =
        (Math.abs(Math.cos(angle)) * w) / 2 +
        (Math.abs(Math.sin(angle)) * d) / 2;
      const extentZ =
        (Math.abs(Math.sin(angle)) * w) / 2 +
        (Math.abs(Math.cos(angle)) * d) / 2;
      Object.assign(box, {
        minX: x - extentX,
        maxX: x + extentX,
        minZ: z - extentZ,
        maxZ: z + extentZ,
      });
    }
    return mesh;
  }
  windowCover(x, z, width, height = 4.4, depth = 1.3, axis = "x") {
    const opening = 2.15,
      sill = 0.85,
      lintel = 3.0;
    const piece = (offset, y, w, h) => {
      const mesh =
        axis === "z"
          ? this.box(x, y, z + offset, depth, h, w, 0x9aa4ac)
          : this.box(x + offset, y, z, w, h, depth, 0x9aa4ac);
      mesh.material = this.blockMaterial;
    };
    const side = (width - opening) / 2;
    piece(-(width + opening) / 4, height / 2, side, height);
    piece((width + opening) / 4, height / 2, side, height);
    piece(0, sill / 2, opening, sill);
    piece(0, (height + lintel) / 2, opening, height - lintel);
  }
  ramp(x, z, width, length, rise, direction = 1) {
    const low = -length / 2,
      high = length / 2;
    const h0 = direction > 0 ? 0 : rise,
      h1 = direction > 0 ? rise : 0;
    const vertices = [
      [-width / 2, 0, low],
      [width / 2, 0, low],
      [-width / 2, 0, high],
      [width / 2, 0, high],
      [-width / 2, h0, low],
      [width / 2, h0, low],
      [-width / 2, h1, high],
      [width / 2, h1, high],
    ];
    const indices = [
      4, 6, 5, 5, 6, 7, 0, 1, 2, 1, 3, 2, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0,
      2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices.flat(), 3),
    );
    geometry.setIndex(indices);
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    flat.computeVertexNormals();
    flat.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        new Float32Array(flat.attributes.position.count * 2),
        2,
      ),
    );
    const mesh = new THREE.Mesh(flat, this.blockMaterial);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.solidMeshes.push(mesh);
    this.boxes.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - length / 2,
      maxZ: z + length / 2,
      minY: 0,
      maxY: rise,
      ramp: { axis: "z", direction, rise },
    });
    return mesh;
  }
  contactShadow(x, z, w, d, angle = 0) {
    if (!this.materials.has("contact-shadow")) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d");
      const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
      grad.addColorStop(0, "rgba(13,23,32,.3)");
      grad.addColorStop(0.6, "rgba(13,23,32,.13)");
      grad.addColorStop(1, "rgba(13,23,32,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      this.materials.set(
        "contact-shadow",
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(c),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 1.3, d + 1.3),
      this.materials.get("contact-shadow"),
    );
    mesh.position.set(x, 0.012, z);
    mesh.rotation.set(-Math.PI / 2, 0, -angle);
    this.group.add(mesh);
  }
  buildBlockout(layout = ARENA, covers = HALF_COVER, windows = HALF_WINDOWS) {
    const { width, depth, wallHeight, wallThickness } = layout;
    this.bounds = {
      minX: -width / 2 + 0.44,
      maxX: width / 2 - 0.44,
      minZ: -depth / 2 + 0.44,
      maxZ: depth / 2 - 0.44,
    };
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0xa7b4be, 65, 125);
    this.blockMaterial = this.materials.get("reference-concrete");
    if (!this.blockMaterial) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xa4a6a5,
        roughness: 0.92,
        bumpMap: this.graphics.texture("height"),
        bumpScale: 0.012,
        map: this.graphics.texture("block-concrete"),
      });
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vPanelPosition; varying vec3 vPanelNormal;",
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvPanelPosition=(modelMatrix*vec4(position,1.0)).xyz;vPanelNormal=normalize(mat3(modelMatrix)*normal);",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vPanelPosition; varying vec3 vPanelNormal;",
          )
          .replace(
            "#include <map_fragment>",
            "vec3 panelNormal=abs(normalize(vPanelNormal));vec2 panelUv=panelNormal.y>max(panelNormal.x,panelNormal.z)?vPanelPosition.xz:panelNormal.x>panelNormal.z?vPanelPosition.zy:vPanelPosition.xy;diffuseColor*=texture2D(map,panelUv/2.4);vec2 slab=floor(panelUv/2.4);diffuseColor.rgb*=.94+.09*fract(sin(dot(slab,vec2(12.9898,78.233)))*43758.5453);diffuseColor.rgb*=1.-.055*(1.-panelNormal.y)*exp(-max(vPanelPosition.y,0.)*2.);",
          );
      };
      const panelCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader) => {
        panelCompile(shader);
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          "float concreteHeight=texture2D(bumpMap,panelUv/.55).r;normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(concreteHeight),dFdy(concreteHeight))*bumpScale,faceDirection);",
        );
      };
      material.customProgramCacheKey = () => "concrete-reference-v2";
      this.blockMaterial = material;
      this.materials.set("reference-concrete", material);
    }
    if (layout.theme) {
      const key = this.mapId + "-concrete";
      if (!this.materials.has(key)) {
        const base = this.blockMaterial,
          mat = base.clone();
        mat.color.setHex(layout.theme.wall);
        mat.onBeforeCompile = base.onBeforeCompile;
        mat.customProgramCacheKey = base.customProgramCacheKey;
        this.materials.set(key, mat);
      }
      this.blockMaterial = this.materials.get(key);
    }
    this.box(0, -0.7, 0, width + 2, 1, depth + 2, 0x63717a, false);
    const floor = this.box(0, -0.1, 0, width, 0.2, depth, 0x858e95, false);
    if (!this.materials.has("arena-floor"))
      this.materials.set(
        "arena-floor",
        new THREE.MeshStandardMaterial({
          color: 0x868b8c,
          roughness: 0.9,
          map: this.graphics.texture("floor"),
          roughnessMap: this.graphics.texture("floor-roughness"),
          bumpMap: this.graphics.texture("height"),
          bumpScale: 0.006,
        }),
      );
    floor.material = this.materials.get("arena-floor");
    if (layout.theme) {
      const key = this.mapId + "-floor";
      if (!this.materials.has(key)) {
        const mat = floor.material.clone();
        mat.color.setHex(layout.theme.floor);
        this.materials.set(key, mat);
      }
      floor.material = this.materials.get(key);
    }
    this.solidMeshes.push(floor);
    for (const x of [-1, 1])
      this.concrete(
        (x * (width + wallThickness)) / 2,
        0,
        wallThickness,
        wallHeight,
        depth + wallThickness * 2,
      );
    for (const z of [-1, 1])
      this.concrete(
        0,
        (z * (depth + wallThickness)) / 2,
        width + wallThickness * 2,
        wallHeight,
        wallThickness,
      );
    // Mirrored half-layout: compact sightlines, opposing ramp banks and window cover.
    for (const side of [-1, 1]) {
      for (const b of covers) {
        this.concrete(b.x * side, b.z * side, b.w, b.h, b.d, b.angle);
        this.contactShadow(b.x * side, b.z * side, b.w, b.d, b.angle);
      }
      for (const b of windows)
        this.windowCover(b.x * side, b.z * side, b.w, b.h, b.d, b.axis);
      this.ramp(
        -layout.rampX * side,
        -layout.rampZ * side,
        layout.rampWidth,
        layout.rampLength,
        layout.rampRise,
        -side,
      );
      this.concrete(
        -layout.rampX * side,
        -layout.platformZ * side,
        layout.rampWidth,
        layout.rampRise,
        layout.platformLength,
      );
      // Explicit walkable summit: bots may reach it only through the ramp.
      this.boxes[this.boxes.length - 1].walkable = true;
      this.contactShadow(
        -layout.rampX * side,
        -layout.rampZ * side,
        layout.rampWidth,
        layout.rampLength + layout.platformLength,
      );
      this.floorMark(
        0,
        side * (depth / 2 - 1.1),
        width - 4,
        0.025,
        0x596971,
        1,
      );
    }
    addElevations(this, layout);
    for (let x = -width / 2 + 2.4; x < width / 2; x += 4.8)
      this.floorMark(x, 0, 0.014, depth - 0.1, 0x5c6971, 1);
    for (let z = -depth / 2 + 2.4; z < depth / 2; z += 4.8)
      this.floorMark(0, z, width - 0.1, 0.014, 0x5c6971, 1);
    this.spawns = {
      0: [
        { x: 0, z: layout.spawnZ },
        { x: -layout.spawnSpread, z: layout.spawnZ },
        { x: layout.spawnSpread, z: layout.spawnZ },
      ],
      1: [
        { x: 0, z: -layout.spawnZ },
        { x: layout.spawnSpread, z: -layout.spawnZ },
        { x: -layout.spawnSpread, z: -layout.spawnZ },
      ],
    };
    this.size = width;
    this.nav = new NavGrid(this.boxes, width, 0.8, depth);
    if (layout.theme) dressCourt(this, layout);
    this.staticStats = batchFixedMeshes(this.group, {
      rayMeshes: this.solidMeshes,
    });
    this.group.add(
      createArenaDressing(this.graphics, this.materials, layout, covers),
    );
    this.group.updateMatrixWorld(true);
  }
  glow(x, y, z, w, h, d, color = 0x88e1eb) {
    const key = `glow-${color}`;
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.3,
          roughness: 0.35,
        }),
      );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      this.materials.get(key),
    );
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }
  decorate(id) {
    // Slim infrastructure and surface details retain the arena's existing collision layout.
    for (const z of [-23.44, 23.44]) {
      this.glow(0, 3.55, z, 43, 0.065, 0.025, 0xffc58e);
      for (let x = -20; x <= 20; x += 8) {
        this.box(x, 1.85, z, 0.18, 3.4, 0.1, 0x33495c, false);
        this.box(
          x,
          2.3,
          z + (z < 0 ? 0.02 : -0.02),
          2.5,
          0.7,
          0.08,
          0x33495c,
          false,
        );
      }
    }
    if (id === "compound") {
      for (const [x, z] of [
        [-8, -5],
        [9, 6],
      ]) {
        this.glow(x, 4.88, z + 5.16, 6.5, 0.055, 0.04);
        this.glow(x, 4.88, z - 5.16, 6.5, 0.055, 0.04);
        for (const side of [-1, 1]) {
          this.box(x + side * 3.55, 2.7, z, 0.06, 1.35, 6.5, 0x33495c, false);
          this.glow(x + side * 3.59, 2.75, z, 0.025, 0.95, 6.1, 0x538a9b);
          for (let dz = -2.7; dz <= 2.7; dz += 1.8)
            this.box(
              x + side * 3.61,
              2.75,
              z + dz,
              0.03,
              1.36,
              0.08,
              0xc1d0d7,
              false,
            );
        }
        for (let dx = -2.4; dx < 2.5; dx += 0.8)
          this.box(x + dx, 1.25, z + 5.035, 0.035, 0.8, 0.045, 0x33495c, false);
        this.box(x, 1.3, z + 5.04, 5.8, 0.035, 0.05, 0xc1d0d7, false);
        this.box(x, 1.65, z + 5.05, 5.8, 0.035, 0.05, 0xc1d0d7, false);
        this.box(x, 5.12, z, 2, 0.55, 2.1, 0x60778b);
        this.cylinder(x, 5.45, z, 0.6, 0.12, 0x263442);
      }
    } else if (id === "rooftops") {
      for (const x of [-18, 18])
        for (let z = -16; z <= 16; z += 8) {
          this.glow(x, 3.6, z, 0.035, 0.05, 3);
          this.cylinder(x, 1.9, z, 0.055, 3.8, 0x33495c);
        }
      this.glow(0, 3.58, 4.21, 6.7, 0.04, 0.03, 0xffc58e);
      for (let z = -3; z < 3; z += 1.3)
        this.box(0, 3.65, z, 4, 0.12, 0.6, 0x60778b, false);
    } else if (id === "hangar") {
      for (const z of [-15, 0, 15])
        for (const x of [-12, 0, 12]) {
          this.box(x, 9.46, z, 4, 0.14, 0.65, 0x263442, false);
          this.glow(x, 9.35, z, 3.6, 0.06, 0.45, 0xe1f5fa);
        }
      for (const x of [-22.5, 22.5]) {
        this.cylinder(x, 1.5, 0, 0.2, 3, 0xd08c54);
        this.box(x, 2.8, 0, 0.55, 0.12, 0.55, 0x33495c, false);
        this.glow(x, 3.8, 0, 0.05, 0.055, 39);
      }
    } else if (id === "range") {
      for (let i = 0; i < 5; i++) {
        const x = -14 + i * 7;
        this.glow(x, 3.15, -23.35, 3.9, 0.04, 0.03);
        this.box(x, 1.3, -20.6, 4.4, 2.6, 0.16, 0x33495c);
        this.label(
          "AIM / " + (i + 1),
          x,
          2.1,
          -20.5,
          2.8,
          0.45,
          0,
          "#33495c",
          "#b6eaf3",
        );
      }
    }
  }
  dispose() {
    this.group.traverse((o) => o.geometry?.dispose());
    for (const m of this.materials.values()) m.dispose();
    this.graphics.dispose();
    this.atmosphere.dispose();
  }
}
export function createCharacter(team, name = "BOT") {
  const group = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({
    color: team === 0 ? 0x77b9ac : 0xe5907b,
    roughness: 0.8,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x293946,
    roughness: 0.8,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: 0xd4b3a1,
    roughness: 0.9,
  });
  const parts = {};
  const box = (name, w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    parts[name] = m;
    return m;
  };
  box("torso", 0.75, 0.7, 0.4, armor, 0, 1.08, 0);
  box("belt", 0.78, 0.13, 0.43, dark, 0, 0.73, 0);
  box("head", 0.5, 0.5, 0.48, skin, 0, 1.69, 0);
  box("helmet", 0.55, 0.18, 0.53, dark, 0, 1.92, 0);
  box("visor", 0.51, 0.14, 0.025, dark, 0, 1.72, -0.253);
  box("leftArm", 0.24, 0.64, 0.26, armor, -0.51, 1.1, -0.13);
  box("rightArm", 0.24, 0.64, 0.26, armor, 0.51, 1.1, -0.13);
  box("leftLeg", 0.28, 0.7, 0.3, dark, -0.23, 0.37, 0);
  box("rightLeg", 0.28, 0.7, 0.3, dark, 0.23, 0.37, 0);
  box("gun", 0.15, 0.19, 0.7, dark, 0.18, 1.22, -0.53);
  box("barrel", 0.06, 0.06, 0.3, dark, 0.18, 1.23, -0.95);
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: team === 0 ? 0x235966 : 0x644936,
    emissive: team === 0 ? 0x59aab7 : 0xbb7543,
    emissiveIntensity: 0.22,
    metalness: 0.4,
    roughness: 0.22,
  });
  parts.visor.material = visorMaterial;
  box("chestPlate", 0.6, 0.4, 0.08, dark, 0, 1.13, -0.24);
  box("chestStripe", 0.38, 0.04, 0.012, armor, 0, 1.26, -0.29);
  box("pouchLeft", 0.15, 0.17, 0.12, dark, -0.25, 0.79, -0.26);
  box("pouchRight", 0.15, 0.17, 0.12, dark, 0.25, 0.79, -0.26);
  for (const side of ["leftLeg", "rightLeg"]) {
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(0.27, 0.21, 0.09, 1, 0.02),
      armor,
    );
    pad.position.set(0, -0.02, -0.18);
    parts[side].add(pad);
  }
  // Hip/shoulder pivots, not mesh-centre rotations: feet no longer paddle in place.
  for (const [name, y] of [
    ["leftLeg", 0.73],
    ["rightLeg", 0.73],
    ["leftArm", 1.37],
    ["rightArm", 1.37],
  ]) {
    const mesh = parts[name],
      joint = new THREE.Group();
    joint.position.set(mesh.position.x, y, mesh.position.z);
    mesh.position.sub(joint.position);
    group.remove(mesh);
    joint.add(mesh);
    group.add(joint);
    parts[name] = joint;
    if (name.endsWith("Leg")) {
      const boot = new THREE.Mesh(
        new RoundedBoxGeometry(0.3, 0.13, 0.4, 1, 0.016),
        dark,
      );
      boot.position.set(0, -0.665, -0.045);
      boot.castShadow = true;
      joint.add(boot);
    } else {
      const palm = new THREE.Mesh(
        new RoundedBoxGeometry(0.22, 0.15, 0.22, 1, 0.018),
        skin,
      );
      palm.position.set(0, -0.59, 0);
      palm.castShadow = true;
      joint.add(palm);
    }
  }
  // Articulated arms replace the old backward-facing single-piece rotations.
  for (const side of ["left", "right"]) {
    const shoulder = parts[side + "Arm"];
    for (const child of [...shoulder.children]) {
      shoulder.remove(child);
      child.traverse((o) => o.geometry?.dispose());
    }
    const upperArm = new THREE.Mesh(
      new RoundedBoxGeometry(0.24, 0.34, 0.26, 1, 0.012),
      armor,
    );
    upperArm.position.y = -0.17;
    upperArm.castShadow = true;
    shoulder.add(upperArm);
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(0.28, 0.15, 0.29, 1, 0.018),
      dark,
    );
    pad.position.y = -0.05;
    pad.castShadow = true;
    shoulder.add(pad);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    shoulder.add(elbow);
    parts[side + "Elbow"] = elbow;
    const forearm = new THREE.Mesh(
      new RoundedBoxGeometry(0.22, 0.4, 0.24, 1, 0.012),
      dark,
    );
    forearm.position.y = -0.2;
    forearm.castShadow = true;
    elbow.add(forearm);
    const hand = new THREE.Group();
    hand.position.y = -0.4;
    elbow.add(hand);
    parts[side + "Hand"] = hand;
    const glove = new THREE.Mesh(
      new RoundedBoxGeometry(0.23, 0.14, 0.25, 1, 0.015),
      dark,
    );
    glove.castShadow = true;
    hand.add(glove);
    batchFixedMeshes(shoulder);
  }
  // Two-bone legs: knees fold independently instead of scaling the whole actor.
  for (const side of ["left", "right"]) {
    const hip = parts[side + "Leg"],
      old = hip.children[0];
    hip.remove(old);
    old.traverse((o) => o.geometry?.dispose());
    const thigh = new THREE.Mesh(
      new RoundedBoxGeometry(0.28, 0.34, 0.3, 1, 0.012),
      dark,
    );
    thigh.position.y = -0.17;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.34;
    hip.add(knee);
    parts[side + "Knee"] = knee;
    const shin = new THREE.Mesh(
      new RoundedBoxGeometry(0.27, 0.32, 0.285, 1, 0.012),
      dark,
    );
    shin.position.y = -0.16;
    knee.add(shin);
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(0.28, 0.18, 0.075, 1, 0.014),
      armor,
    );
    pad.position.set(0, -0.035, -0.16);
    knee.add(pad);
    const boot = hip.children.find((o) => o.isMesh && o !== thigh);
    if (boot) {
      hip.remove(boot);
      boot.position.set(0, -0.325, -0.045);
      knee.add(boot);
    }
    thigh.castShadow = shin.castShadow = pad.castShadow = true;
  }
  const headRig = new THREE.Group();
  headRig.position.copy(parts.head.position);
  group.add(headRig);
  for (const name of ["head", "helmet", "visor"]) {
    const mesh = parts[name];
    mesh.position.sub(headRig.position);
    headRig.add(mesh);
  }
  parts.head = headRig;
  const weaponRig = new THREE.Group();
  weaponRig.position.set(0.18, 1.23, -0.25);
  group.add(weaponRig);
  parts.weaponRig = weaponRig;
  parts.gun.material = new THREE.MeshStandardMaterial({
    color: 0x8b927a,
    metalness: 0.35,
    roughness: 0.6,
  });
  for (const name of ["gun", "barrel"]) {
    const mesh = parts[name];
    mesh.position.sub(weaponRig.position);
    weaponRig.add(mesh);
  }
  const botFlash = muzzleFlash(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 2.1, 0.45),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  botFlash.position.set(0, 0, -0.88);
  weaponRig.add(botFlash);
  parts.muzzleFlash = botFlash;
  const upper = new THREE.Group();
  upper.position.y = 1;
  group.add(upper);
  parts.upperBody = upper;
  for (const name of [
    "torso",
    "chestPlate",
    "chestStripe",
    "pouchLeft",
    "pouchRight",
    "head",
    "leftArm",
    "rightArm",
    "weaponRig",
  ]) {
    const object = parts[name];
    object.position.sub(upper.position);
    upper.add(object);
  }
  for (const fixed of [upper, parts.leftKnee, parts.rightKnee])
    batchFixedMeshes(fixed);
  // Nametag: only shown for allies, so rivals can't be tracked through walls.
  if (team === 0) {
    const tag = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textTexture(name, "#222333", "#b7f9dc", 256, 64),
        depthTest: true,
      }),
    );
    tag.position.set(0, 2.4, 0);
    tag.scale.set(1.4, 0.35, 1);
    group.add(tag);
  }
  return { group, parts };
}
export function createViewModel(id, data, options) {
  const model = detailedWeapon(id, data, options);
  if (!model) throw new Error("Unknown weapon model: " + id);
  return model;
}
