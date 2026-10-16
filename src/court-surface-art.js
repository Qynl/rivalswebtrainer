import * as THREE from "three";

function atlas(world) {
  const key = "court-floor-stencils";
  if (world.graphics.textures.has(key)) return world.graphics.textures.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const c = canvas.getContext("2d");
  c.strokeStyle = c.fillStyle = "#ffffff";
  c.lineWidth = 4;
  for (let side = 0; side < 2; side++) {
    c.save();
    c.translate(side * 256, 0);
    // Open corner brackets leave most of the floor exposed, not a bright carpet.
    for (const x of [16, 240])
      for (const y of [22, 234]) {
        c.beginPath();
        c.moveTo(x + (x < 100 ? 26 : -26), y);
        c.lineTo(x, y);
        c.lineTo(x, y + (y < 100 ? 24 : -24));
        c.stroke();
      }
    c.font = "700 77px sans-serif";
    c.textAlign = "center";
    c.fillText(side ? "B" : "A", 128, 126);
    c.font = "600 17px sans-serif";
    c.fillText("READY / STAGING", 128, 164);
    c.fillRect(72, 183, 112, 3);
    c.restore();
  }
  c.save();
  c.beginPath();
  c.rect(512, 0, 256, 256);
  c.clip();
  c.lineWidth = 24;
  for (let x = 385; x < 900; x += 58) {
    c.beginPath();
    c.moveTo(x, 256);
    c.lineTo(x + 170, 0);
    c.stroke();
  }
  c.restore();
  c.save();
  c.translate(768, 0);
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(83, 80);
  c.lineTo(128, 35);
  c.lineTo(173, 80);
  c.stroke();
  c.beginPath();
  c.moveTo(128, 40);
  c.lineTo(128, 128);
  c.stroke();
  c.font = "700 25px sans-serif";
  c.textAlign = "center";
  c.fillText("UPPER", 128, 181);
  c.font = "500 16px sans-serif";
  c.fillText("RAMP ACCESS", 128, 211);
  c.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  world.graphics.textures.set(key, texture);
  return texture;
}

// All marks lie on the existing y=0 slab, never raised platforms or ramp slopes.
// No collision, no text/UI overlays and no emissive paint at enemy silhouette height.
export function addCourtSurfaceGraphics(world, group, layout) {
  const key = "court-floor-stencils";
  if (!world.materials.has(key))
    world.materials.set(
      key,
      new THREE.MeshStandardMaterial({
        map: atlas(world),
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        alphaTest: 0.035,
        roughness: 0.96,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
  const material = world.materials.get(key);
  let count = 0;
  const color = new THREE.Color();
  function mark(tile, x, z, w, d, hex, rotation = 0) {
    const geometry = new THREE.PlaneGeometry(w, d),
      uv = geometry.attributes.uv;
    // Half-texel inset keeps adjacent atlas tiles out of mip/filter edges.
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (tile * 256 + 2 + uv.getX(i) * 252) / 1024,
        (2 + uv.getY(i) * 252) / 256,
      );
    color.setHex(hex);
    const rgb = new Float32Array(12);
    for (let i = 0; i < 12; i += 3) color.toArray(rgb, i);
    geometry.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, rotation);
    mesh.position.set(x, 0.025, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    count++;
  }
  const depth = layout?.depth || 48,
    width = layout?.width || 48;
  for (const side of [-1, 1]) {
    mark(
      side > 0 ? 0 : 1,
      0,
      side * (layout?.spawnZ || 19),
      5.2,
      2.2,
      side > 0 ? 0x7d9ea4 : 0xb39177,
      side > 0 ? 0 : Math.PI,
    );
    if (layout) {
      const x = -layout.rampX * side,
        bottom = -layout.rampZ * side + (side * layout.rampLength) / 2;
      mark(
        3,
        x,
        bottom + side * 1.05,
        1.25,
        1.8,
        0x9ba8a2,
        side > 0 ? 0 : Math.PI,
      );
    }
    for (const x of [-width * 0.25, width * 0.25])
      mark(2, x, side * (depth / 2 - 0.55), 2, 0.18, 0xaf9667);
  }
  return count;
}
