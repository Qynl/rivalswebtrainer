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
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      c.geometry?.dispose();
      if (c.material?.map && !sharedMaterials.has(c.material)) {
        c.material.map.dispose();
        c.material.dispose();
      }
    }
    this.boxes = [];
    this.solidMeshes = [];
    this.mapId = id;
    this.bounds = { minX: -23.1, maxX: 23.1, minZ: -23.1, maxZ: 23.1 };
    if (id === "blockout") {
      this.buildBlockout();
      return;
    }
    const roof = id === "rooftops",
      hangar = id === "hangar";
    this.scene.background = this.graphics.sky(id);
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
  buildBlockout() {
    this.bounds = { minX: -23.55, maxX: 23.55, minZ: -31.55, maxZ: 31.55 };
    this.scene.background = this.graphics.sky("blockout");
    this.scene.fog = new THREE.Fog(0xc5ccd1, 75, 160);
    if (!this.blockMaterial) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x9aa4ac,
        roughness: 0.96,
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
            "vec3 panelNormal=abs(normalize(vPanelNormal));vec2 panelUv=panelNormal.y>max(panelNormal.x,panelNormal.z)?vPanelPosition.xz:panelNormal.x>panelNormal.z?vPanelPosition.zy:vPanelPosition.xy;diffuseColor*=texture2D(map,panelUv/3.0);",
          );
      };
      material.customProgramCacheKey = () => "concrete-reference-v1";
      this.blockMaterial = material;
      this.materials.set("reference-concrete", material);
    }
    this.box(0, -1.1, 0, 50, 1.8, 66, 0x90999f, false);
    const floor = this.box(0, -0.1, 0, 48, 0.2, 64, 0x858e95, false);
    if (!this.materials.has("arena-floor"))
      this.materials.set(
        "arena-floor",
        new THREE.MeshStandardMaterial({
          color: 0x858e95,
          roughness: 1,
          map: this.graphics.texture("concrete"),
        }),
      );
    floor.material = this.materials.get("arena-floor");
    this.solidMeshes.push(floor);
    for (const x of [-24.8, 24.8]) this.concrete(x, 0, 1.6, 16.8, 65.6);
    for (const z of [-32.8, 32.8]) this.concrete(0, z, 51.2, 16.8, 1.6);
    // A narrow low ledge and inset cap frame the reference's tall concrete box.
    for (const x of [-22.6, 22.6]) this.concrete(x, 0, 2.8, 0.6, 62);
    for (const z of [-30.6, 30.6]) this.concrete(0, z, 42.4, 0.6, 2.8);
    for (const [x, z, w, h, d, a] of [
      [-17, -22, 5.5, 3.8, 5.5, 0],
      [-1, -22, 11, 3.4, 4.5, 0],
      [15.5, -22, 8, 2.2, 2.7, 0],
      [-7.8, -13, 11, 2.8, 2.4, -0.48],
      [7.5, -12, 9.5, 3.4, 4, 0.55],
      [-15.5, -2, 6, 3, 4, 0],
      [15, -1, 7.5, 3.6, 4.7, 0],
      [-6.5, 10, 11, 3.2, 4, 0.58],
      [6.8, 12, 14, 2.5, 2.2, -0.5],
      [-16, 19, 6.2, 3.4, 4, 0],
      [-1.5, 24, 13, 2.1, 3, 0],
      [15, 22, 7, 3.4, 3.3, 0],
    ])
      this.concrete(x, z, w, h, d, a);
    // The central structure has a real passage and a walkable roof, not a solid cube.
    this.concrete(-0.7, 0, 2.2, 4, 7.2);
    this.concrete(5.7, 0, 2.2, 4, 7.2);
    const header = this.box(2.5, 3.5, 0, 8.6, 1, 7.2, 0xd8dbdd);
    header.material = this.blockMaterial;
    this.concrete(2.5, -2.7, 4.2, 3, 1.8);
    for (let i = 0; i < 8; i++)
      this.concrete(2.5, 8.8 - i * 0.6, 3, 0.35 * (i + 1), 0.6);
    // Explicit routes up the side ledges and a couple of hop-on blocks.
    this.concrete(-18.3, -18, 2, 0.8, 2);
    this.concrete(17.5, 16.5, 2, 0.8, 2);
    this.spawns = {
      0: [
        { x: 0, z: 28.5 },
        { x: -9, z: 28.5 },
        { x: 9, z: 28.5 },
      ],
      1: [
        { x: 0, z: -28.5 },
        { x: 9, z: -28.5 },
        { x: -9, z: -28.5 },
      ],
    };
    this.nav = new NavGrid(this.boxes, 48, 1.5, 64);
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
  }
}
export function createCharacter(team, name = "BOT") {
  const group = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({
    color: team === 0 ? 0x77b9ac : 0xe5907b,
    roughness: 0.8,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x414359,
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
  box("gun", 0.15, 0.19, 0.7, dark, 0.37, 1.22, -0.53);
  box("barrel", 0.06, 0.06, 0.3, dark, 0.37, 1.23, -0.95);
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: team === 0 ? 0x7fe8ec : 0xffbb85,
    emissive: team === 0 ? 0x59aab7 : 0xbb7543,
    emissiveIntensity: 0.45,
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
  const detailed = detailedWeapon(id, data, options);
  if (detailed) return detailed;
  const g = new THREE.Group(),
    metal = new THREE.MeshStandardMaterial({
      color: data.color,
      roughness: 0.33,
      metalness: 0.65,
    }),
    dark = new THREE.MeshStandardMaterial({ color: 0x2d2e40, roughness: 0.72 }),
    accent = new THREE.MeshStandardMaterial({
      color: 0xe9a083,
      roughness: 0.5,
    }),
    skin = new THREE.MeshStandardMaterial({ color: 0xc6a38e, roughness: 0.85 }),
    sleeve = new THREE.MeshStandardMaterial({
      color: 0x57536f,
      roughness: 0.9,
    });
  const box = (x, y, z, w, h, d, m) => {
    const o = new THREE.Mesh(
      w > 0.08 && h > 0.05 && d > 0.05
        ? new RoundedBoxGeometry(w, h, d, 1, 0.012)
        : new THREE.BoxGeometry(w, h, d),
      m,
    );
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const cylinder = (x, y, z, r, l, m) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 16), m);
    o.rotation.x = Math.PI / 2;
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const hand = (x, y, z, rot = 0) => {
    const h = box(x, y, z, 0.12, 0.13, 0.2, skin);
    h.rotation.z = rot;
    h.userData.hand = true;
    box(x, y - 0.15, z + 0.15, 0.14, 0.3, 0.25, sleeve).userData.hand = true;
  };
  if (data.type === "melee") {
    hand(0.29, -0.3, -0.5, -0.3);
    hand(-0.27, -0.32, -0.48, 0.3);
    if (id === "knife") {
      box(0.29, -0.16, -0.65, 0.04, 0.28, 0.12, metal);
      box(0.29, -0.29, -0.65, 0.18, 0.04, 0.15, dark);
    }
    if (id === "scythe") {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.032, 0.92, 16),
        dark,
      );
      pole.position.set(0.26, -0.01, -0.69);
      pole.rotation.z = -0.22;
      g.add(pole);
      for (let y = -0.34; y < 0.1; y += 0.07)
        box(0.26 + y * 0.22, y, -0.69, 0.07, 0.027, 0.07, accent);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(-0.18, 0.28, -0.63, 0.18);
      shape.quadraticCurveTo(-0.44, 0.16, -0.22, 0.04);
      shape.lineTo(-0.03, -0.04);
      shape.closePath();
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, {
          depth: 0.025,
          bevelEnabled: true,
          bevelThickness: 0.005,
          bevelSize: 0.005,
          bevelSegments: 1,
          steps: 1,
          curveSegments: 14,
        }),
        metal,
      );
      blade.position.set(0.15, 0.37, -0.72);
      g.add(blade);
      box(0.13, 0.35, -0.7, 0.09, 0.1, 0.08, accent);
    }
    if (id === "katana") {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.045, 0);
      shape.quadraticCurveTo(0.025, 0.53, -0.07, 0.76);
      shape.lineTo(-0.115, 0.79);
      shape.quadraticCurveTo(-0.015, 0.42, 0, 0);
      shape.closePath();
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, {
          depth: 0.018,
          bevelEnabled: true,
          bevelThickness: 0.003,
          bevelSize: 0.003,
          bevelSegments: 1,
          steps: 1,
          curveSegments: 16,
        }),
        metal,
      );
      blade.position.set(0.27, -0.14, -0.65);
      g.add(blade);
      box(0.29, -0.16, -0.65, 0.22, 0.032, 0.1, accent);
      box(0.29, -0.3, -0.65, 0.05, 0.25, 0.06, dark);
      for (let i = 0; i < 5; i++) {
        const wrap = box(
          0.29,
          -0.21 - i * 0.04,
          -0.612,
          0.055,
          0.016,
          0.016,
          accent,
        );
        wrap.rotation.z = 0.3;
      }
    }
  } else if (data.slot === 3) {
    hand(0.3, -0.3, -0.6);
    cylinder(0.3, -0.24, -0.7, 0.095, 0.23, metal);
    box(0.3, -0.12, -0.7, 0.1, 0.1, 0.1, dark);
  } else if (data.type === "rocket") {
    hand(0.28, -0.34, -0.6);
    cylinder(0.3, -0.12, -0.7, 0.14, 0.95, metal);
    cylinder(0.3, -0.12, -1.24, 0.17, 0.15, dark);
    box(0.3, -0.36, -0.65, 0.1, 0.24, 0.15, dark);
    box(0.3, 0.04, -0.85, 0.04, 0.14, 0.05, accent);
  } else {
    const pistol = data.slot === 1;
    hand(0.23, -0.35, -0.45);
    if (!pistol) hand(-0.06, -0.35, -0.85, 0.25);
    const z = pistol ? -0.64 : -0.88;
    box(0.24, -0.19, z, pistol ? 0.17 : 0.19, 0.2, pistol ? 0.36 : 0.64, metal);
    box(0.24, -0.33, z + 0.13, 0.12, 0.24, 0.14, dark);
    box(0.24, -0.37, z - 0.04, 0.11, pistol ? 0.12 : 0.28, 0.14, metal);
    cylinder(
      0.24,
      -0.16,
      z - (pistol ? 0.26 : 0.5),
      0.027,
      pistol ? 0.17 : 0.4,
      dark,
    );
    box(0.24, -0.065, z - 0.16, 0.04, 0.06, 0.05, accent);
    box(0.24, -0.085, z + 0.15, 0.1, 0.06, 0.09, dark);
    if (!pistol) {
      box(0.24, -0.2, -0.44, 0.15, 0.17, 0.25, dark);
      for (let i = 0; i < 4; i++)
        box(0.24, -0.18, z - 0.24 - i * 0.035, 0.198, 0.018, 0.018, dark);
    }
    // Receiver rails, silver fasteners and a readable rear/front sight.
    for (let i = 0; i < 3; i++)
      box(0.345, -0.18, z - 0.12 + i * 0.09, 0.013, 0.035, 0.018, accent);
    box(0.24, -0.054, z + 0.12, 0.13, 0.035, 0.05, dark);
    box(0.24, -0.062, z - 0.18, 0.065, 0.075, 0.055, metal);
    if (!pistol) {
      box(0.24, -0.135, z - 0.28, 0.205, 0.07, 0.25, dark);
      for (let i = 0; i < 4; i++)
        box(0.345, -0.18, z - 0.29 - i * 0.045, 0.012, 0.075, 0.022, accent);
      box(0.24, -0.18, -0.33, 0.18, 0.23, 0.07, metal);
    }
    if (id === "sniper") {
      box(0.24, -0.02, z - 0.1, 0.04, 0.1, 0.045, dark);
      box(0.24, -0.02, z + 0.1, 0.04, 0.1, 0.045, dark);
      cylinder(0.24, 0.04, z, 0.056, 0.34, dark);
      cylinder(0.24, 0.04, z - 0.19, 0.058, 0.03, accent);
    }
    if (id === "shotgun") box(0.24, -0.2, -1.09, 0.22, 0.16, 0.26, accent);
  }
  g.position.set(0, -0.03, 0);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
    }
  });
  return g;
}
