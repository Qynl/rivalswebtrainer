import * as THREE from "three";
// Original, deterministic textures: no downloads, photo assets or runtime requests.
const PALETTE = new Map([
  [0x6c6484, 0x344554],
  [0x49435f, 0x263442],
  [0xbeb4c9, 0x9ba9b2],
  [0xb4a9bf, 0x91a2ad],
  [0x9c92af, 0x667b8b],
  [0x827794, 0x60778b],
  [0xb4a8c1, 0xa5b9c5],
  [0x9689a7, 0x6d8496],
  [0x8f829f, 0x637b8e],
  [0xb5a9c3, 0xc1d0d7],
  [0x6b6280, 0x33495c],
  [0xc58d7e, 0xd08c54],
  [0x7f8993, 0x427d8c],
  [0xbbb0c5, 0x8da2af],
  [0xe3d4df, 0xc4d1d8],
  [0xc68d75, 0xbb8556],
  [0xd4a08c, 0xd5ac76],
  [0x75596c, 0x55504b],
  [0x83798f, 0x526b7b],
  [0xaaa0b9, 0x94a9b6],
  [0x8a7f9c, 0x65798f],
  [0xc7bbcf, 0xb5c8d3],
  [0xd1c5db, 0xc2d0d6],
  [0x9291a8, 0x768b98],
  [0xb2a8c0, 0x8196a4],
  [0xb8aec6, 0x8ca0ac],
  [0x887d9a, 0x5b7c90],
  [0xd0acbe, 0x8faf8a],
  [0xb898ba, 0xaac29a],
  [0x6e5774, 0x695d4d],
  [0x8b83a5, 0x758d9f],
  [0x9b92b1, 0x829cab],
]);
export function artColor(color) {
  return PALETTE.get(color) ?? color;
}
export class ArenaGraphics {
  constructor() {
    this.textures = new Map();
    this.seed = 731;
  }
  random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  texture(kind = "concrete") {
    if (this.textures.has(kind)) return this.textures.get(kind);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const image = g.createImageData(256, 256);
    for (let i = 0; i < image.data.length; i += 4) {
      const grain = this.random();
      const n =
        kind === "normal"
          ? 122 + Math.floor(grain * 12)
          : kind === "concrete"
            ? 244 + Math.floor(grain * 6)
            : 235 + Math.floor(grain * 15);
      image.data[i] = n;
      image.data[i + 1] = n;
      image.data[i + 2] = kind === "normal" ? 255 : n;
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    if (kind === "floor" || kind === "floor-roughness") {
      // Broad, soft trowel patches under fine aggregate, not loud repeated grunge.
      for (let i = 0; i < 28; i++) {
        const x = this.random() * 256,
          y = this.random() * 256,
          r = 15 + this.random() * 65;
        const patch = g.createRadialGradient(x, y, 0, x, y, r);
        patch.addColorStop(
          0,
          kind === "floor" ? "rgba(110,115,117,.05)" : "rgba(30,30,30,.12)",
        );
        patch.addColorStop(1, "rgba(90,90,90,0)");
        g.fillStyle = patch;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 40; i++) {
        const x = this.random() * 256,
          y = this.random() * 256;
        g.strokeStyle =
          kind === "floor" ? "rgba(135,140,143,.12)" : "rgba(85,85,85,.18)";
        g.lineWidth = 0.3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + this.random() * 22, y + this.random() * 4);
        g.stroke();
      }
    }
    if (kind === "metal") {
      g.strokeStyle = "#bcc7ce";
      g.lineWidth = 0.5;
      for (let i = 0; i < 55; i++) {
        const x = this.random() * 256,
          y = this.random() * 256;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 5 + this.random() * 22, y + 0.3);
        g.stroke();
      }
    }
    if (kind === "block-concrete") {
      g.strokeStyle = "rgba(70,80,88,.42)";
      g.lineWidth = 1.2;
      g.strokeRect(0.6, 0.6, 254.8, 254.8);
      g.fillStyle = "rgba(60,70,77,.65)";
      for (const x of [7, 249])
        for (const y of [7, 249]) {
          g.beginPath();
          g.arc(x, y, 1.3, 0, Math.PI * 2);
          g.fill();
        }
    }
    if (kind === "windows") {
      g.fillStyle = "#677d8c";
      g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 16; row++)
        for (let col = 0; col < 8; col++) {
          g.fillStyle =
            this.random() > 0.8
              ? "#dfceb0"
              : this.random() > 0.5
                ? "#a3c0d0"
                : "#7f9dac";
          g.fillRect(col * 32 + 3, row * 16 + 2, 25, 10);
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(kind === "windows" ? 1 : 3, kind === "windows" ? 1 : 3);
    t.anisotropy = 4;
    if (!["normal", "height", "floor-roughness"].includes(kind))
      t.colorSpace = THREE.SRGBColorSpace;
    if (kind === "floor" || kind === "floor-roughness") t.repeat.set(8, 10);
    this.textures.set(kind, t);
    return t;
  }
  sky(id) {
    const key = `sky-${id}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 1024;
    const g = c.getContext("2d");
    const gradient = g.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, id === "blockout" ? "#527a9c" : "#3b78a9");
    gradient.addColorStop(0.35, id === "blockout" ? "#adc6d6" : "#9cc5df");
    gradient.addColorStop(0.52, id === "blockout" ? "#d9e1e4" : "#dfddce");
    gradient.addColorStop(0.7, "#a9bdc7");
    gradient.addColorStop(1, "#718c9f");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 2048, 1024);
    const sun = g.createRadialGradient(1450, 350, 8, 1450, 350, 135);
    sun.addColorStop(0, "#fffce0");
    sun.addColorStop(0.13, "#fff4d7");
    sun.addColorStop(0.35, "#fff3de66");
    sun.addColorStop(1, "#fff3de00");
    g.fillStyle = sun;
    g.fillRect(1300, 200, 300, 300);
    // Soft wisps rather than repeated hard-edged ellipse stamps.
    for (let i = 0; i < 36; i++) {
      const x = this.random() * 2048,
        y = 220 + this.random() * 170,
        r = 90 + this.random() * 180;
      const cloud = g.createRadialGradient(x, y, 1, x, y, r);
      cloud.addColorStop(0, "rgba(255,255,255,.07)");
      cloud.addColorStop(1, "rgba(255,255,255,0)");
      g.save();
      g.translate(0, y);
      g.scale(1, 0.22);
      g.translate(0, -y);
      g.fillStyle = cloud;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, t);
    return t;
  }
  dispose() {
    for (const t of this.textures.values()) t.dispose();
  }
}
