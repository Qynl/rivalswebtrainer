import * as THREE from "three";
import { batchFixedMeshes } from "./batching.js";
import { ARENA, HALF_COVER } from "./arena-layout.js";

// Painted, offline wayfinding. Deliberately no new collision or extra cover.
function stencilAtlas(graphics) {
  if (graphics.textures.has("arena-stencils"))
    return graphics.textures.get("arena-stencils");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const labels = [
    ["01", "NORTH / COURT", "#ad6556"],
    ["02", "SOUTH / COURT", "#497789"],
    ["A", "RAMP ACCESS", "#344a54"],
    ["B", "CROSSING", "#344a54"],
  ];
  labels.forEach(([number, label, color], i) => {
    const x = (i % 2) * 256,
      y = Math.floor(i / 2) * 256;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(22, 32, 5, 168);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 142px Arial";
    ctx.fillText(number, 143, 121);
    ctx.font = "bold 13px Arial";
    ctx.fillText(label, 142, 211);
    ctx.fillRect(55, 232, 175, 2);
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  graphics.textures.set("arena-stencils", texture);
  return texture;
}
export function createArenaDressing(
  graphics,
  materials,
  layout = ARENA,
  covers = HALF_COVER,
) {
  const group = new THREE.Group();
  group.name = "arena-wayfinding";
  if (!materials.has("arena-stencils"))
    materials.set(
      "arena-stencils",
      new THREE.MeshStandardMaterial({
        map: stencilAtlas(graphics),
        transparent: true,
        alphaTest: 0.04,
        depthWrite: false,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
  if (!materials.has("arena-trim"))
    materials.set(
      "arena-trim",
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    );
  const sign = (index, x, y, z, size, yaw = 0) => {
    const geometry = new THREE.PlaneGeometry(size, size),
      uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (uv.getX(i) + (index % 2)) / 2,
        (uv.getY(i) + (index < 2 ? 1 : 0)) / 2,
      );
    const mesh = new THREE.Mesh(geometry, materials.get("arena-stencils"));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.renderOrder = 4;
    group.add(mesh);
  };
  const solid = (geometry, x, y, z, color, yaw = 0) => {
    const c = new THREE.Color(color),
      colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, materials.get("arena-trim"));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const hw = layout.width / 2,
    hd = layout.depth / 2;
  if (!layout.theme) {
    sign(0, 0, Math.min(7.6, layout.wallHeight - 2.4), -hd + 0.012, 4.2);
    sign(
      1,
      0,
      Math.min(7.6, layout.wallHeight - 2.4),
      hd - 0.012,
      4.2,
      Math.PI,
    );
    sign(2, -hw + 0.012, 3.3, -8, 2.3, Math.PI / 2);
    sign(3, hw - 0.012, 3.3, 8, 2.3, -Math.PI / 2);
  }
  // Sparse architectural courses make the actual 24m height legible, without
  // filling the court with props or adding collision/draw calls per detail.
  for (const side of [-1, 1]) {
    for (const y of [4.8, 9.6, 14.4, 19.2, layout.wallHeight - 0.12].filter(
      (y) => y < layout.wallHeight,
    )) {
      solid(
        new THREE.BoxGeometry(layout.width, 0.045, 0.035),
        0,
        y,
        side * (hd - 0.018),
        0x758086,
      );
      solid(
        new THREE.BoxGeometry(0.035, 0.045, layout.depth),
        side * (hw - 0.018),
        y,
        0,
        0x758086,
      );
    }
    solid(
      new THREE.BoxGeometry(layout.width, 0.14, 0.18),
      0,
      layout.wallHeight - 0.07,
      side * (hd - 0.07),
      0xa3adaf,
    );
    solid(
      new THREE.BoxGeometry(0.18, 0.14, layout.depth),
      side * (hw - 0.07),
      layout.wallHeight - 0.07,
      0,
      0xa3adaf,
    );
  }
  for (const side of [1, -1]) {
    const b = covers[1],
      angle = (b.angle || 0) + (side < 0 ? Math.PI : 0);
    sign(
      side > 0 ? 0 : 1,
      side * (b.x + Math.sin(b.angle || 0) * (b.d / 2 + 0.014)),
      1.9,
      side * (b.z + Math.cos(b.angle || 0) * (b.d / 2 + 0.014)),
      2.3,
      angle,
    );
    for (const slab of covers)
      solid(
        new THREE.BoxGeometry(slab.w + 0.018, 0.13, slab.d + 0.018),
        slab.x * side,
        0.07,
        slab.z * side,
        0x657176,
        (slab.angle || 0) + (side < 0 ? Math.PI : 0),
      );
    for (const slab of covers)
      solid(
        new THREE.BoxGeometry(slab.w + 0.025, 0.08, slab.d + 0.025),
        slab.x * side,
        slab.h - 0.04,
        slab.z * side,
        0xa7b0b2,
        (slab.angle || 0) + (side < 0 ? Math.PI : 0),
      );
    const color = side > 0 ? 0xa96a59 : 0x547e89;
    for (const x of [-5.1, 5.1]) {
      for (let i = 0; i < 3; i++) {
        const stripe = solid(
          new THREE.PlaneGeometry(0.13, 1.4),
          x * side,
          0.012,
          (layout.spawnZ - 1 - i * 1.6) * side,
          color,
        );
        stripe.rotation.x = -Math.PI / 2;
      }
      for (const angle of [-0.65, 0.65]) {
        const arrow = solid(
          new THREE.PlaneGeometry(0.11, 0.75),
          (x + (angle > 0 ? 0.2 : -0.2)) * side,
          0.014,
          8.5 * side,
          color,
        );
        arrow.rotation.set(-Math.PI / 2, 0, angle + (side < 0 ? Math.PI : 0));
      }
    }
  }
  group.userData.batching = batchFixedMeshes(group);
  return group;
}
