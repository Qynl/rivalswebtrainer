/**
 * Procedural textures for a clean, readable, Valorant-ish look: flat matte
 * geometry with crisp painted stone, not emissive neon. Everything here is
 * drawn into a canvas at boot — no image files.
 */

import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

/** Soft dot: glints, sparks, muzzle flash, halos. */
export function glowTexture(): THREE.Texture {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four-point optic flare for the scope glint. */
export function flareTexture(): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const mid = size / 2;
  ctx.translate(mid, mid);
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, mid);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.12, 'rgba(255,250,235,0.85)');
  core.addColorStop(0.35, 'rgba(255,235,200,0.2)');
  core.addColorStop(1, 'rgba(255,220,180,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-mid, -mid, size, size);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    const spike = ctx.createLinearGradient(0, 0, 0, -mid);
    spike.addColorStop(0, 'rgba(255,255,255,0.95)');
    spike.addColorStop(0.4, 'rgba(255,248,225,0.28)');
    spike.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = spike;
    ctx.beginPath();
    ctx.moveTo(-3.4, 0);
    ctx.lineTo(0, -mid);
    ctx.lineTo(3.4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const v = Math.random();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha * Math.random()})` : `rgba(0,0,0,${alpha * Math.random()})`;
    const s = 1 + Math.random() * 2.4;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

/**
 * Painted concrete panels. Tileable: the border seam sits exactly on the edge,
 * so a 2x2 repeat keeps the grid continuous.
 */
export function panelTexture(light = '#c9c5ba', grout = '#8e8b81'): THREE.Texture {
  const w = 512;
  const h = 512;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, h);

  // Large blotches: uneven paint / weathering.
  for (let i = 0; i < 130; i++) {
    const r = 14 + Math.random() * 90;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(90,86,78,0.06)' : 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Panel grid: 2 x 2 panels per tile, inset grooves.
  const cell = w / 2;
  ctx.strokeStyle = grout;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 5;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, h);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(w, i * cell);
    ctx.stroke();
  }
  // Groove highlight on one side, so seams read in 3D even without shadows.
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell + 3, 0);
    ctx.lineTo(i * cell + 3, h);
    ctx.moveTo(0, i * cell + 3);
    ctx.lineTo(w, i * cell + 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Bolt heads and small cross marks at panel corners.
  for (let gx = 0; gx < 2; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      const x = gx * cell;
      const y = gy * cell;
      for (const [ox, oy] of [[16, 16], [cell - 16, 16], [16, cell - 16], [cell - 16, cell - 16]]) {
        ctx.fillStyle = 'rgba(70,68,62,0.5)';
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(80,78,72,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + cell / 2 - 8, y + cell / 2);
      ctx.lineTo(x + cell / 2 + 8, y + cell / 2);
      ctx.moveTo(x + cell / 2, y + cell / 2 - 8);
      ctx.lineTo(x + cell / 2, y + cell / 2 + 8);
      ctx.stroke();
    }
  }

  // Chipped edges: short dark dashes hugging the grooves.
  for (let i = 0; i < 40; i++) {
    const onVertical = Math.random() > 0.5;
    const t = Math.random() * w;
    const g0 = (Math.random() > 0.5 ? 1 : 0) * cell;
    ctx.fillStyle = 'rgba(96,92,84,0.35)';
    if (onVertical) ctx.fillRect(g0 + 6, t, 3 + Math.random() * 7, 2);
    else ctx.fillRect(t, g0 + 6, 2, 3 + Math.random() * 7);
  }
  speckle(ctx, w, h, 2600, 0.09);
  return finish(c);
}

/** Darker, colder variant for interior walls and struts. */
export function metalTexture(base = '#4b4e55', line = '#2f3238'): THREE.Texture {
  const w = 512;
  const h = 512;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Horizontal brushed streaks.
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * h;
    const x = Math.random() * w;
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + Math.random() * 90, y);
    ctx.stroke();
  }
  // Plate seams and rivet rows.
  ctx.strokeStyle = line;
  ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i * h) / 4);
    ctx.lineTo(w, (i * h) / 4);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 4; i++) {
    for (let x = 18; x < w; x += 42) {
      ctx.beginPath();
      ctx.arc(x, (i * h) / 4 + 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  speckle(ctx, w, h, 1500, 0.07);
  return finish(c);
}

/** Anti-slip deck floor with painted hazard chevrons. */
export function floorTexture(): THREE.Texture {
  const w = 512;
  const h = 512;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#8d8f8c';
  ctx.fillRect(0, 0, w, h);
  // Anti-slip dimples.
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w; x += 16) {
      const o = (y / 16) % 2 === 0 ? 8 : 0;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(60,60,58,0.18)';
      ctx.beginPath();
      ctx.arc(x + o, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Tile joints.
  ctx.strokeStyle = 'rgba(70,72,72,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, w, h);
  // Wear: scuffs and paint loss.
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(${70 + Math.random() * 30},${70 + Math.random() * 30},${70 + Math.random() * 30},${Math.random() * 0.18})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 22, 2 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, w, h, 2200, 0.08);
  return finish(c);
}

/** Sandbag / fabric weave for cover cubes. */
export function fabricTexture(): THREE.Texture {
  const w = 256;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#8a8270';
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, y, w, 2);
  }
  for (let x = 0; x < w; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(x, 0, 2, h);
  }
  speckle(ctx, w, h, 1600, 0.1);
  return finish(c);
}

/** Ground in the courtyard: gravel and cracked paving. */
export function gravelTexture(): THREE.Texture {
  const w = 512;
  const h = 512;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#7c7d76';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) {
    const v = 60 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v + 2},${v - 4},${0.25 + Math.random() * 0.4})`;
    const s = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(50,50,48,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let x = Math.random() * w;
    let y = Math.random() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return finish(c);
}

/** Roughness map: white = matte, black = wet/polished. */
export function roughnessTexture(): THREE.Texture {
  const w = 256;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    const r = 4 + Math.random() * 40;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(90,90,90,0.35)');
    g.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Painted stencil / signage: used on walls as decals. */
export function signTexture(label: string, accent = '#c8b273'): THREE.Texture {
  const w = 256;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.04);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20);
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px ui-monospace, monospace';
  ctx.fillText(label, 0, 2);
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.globalAlpha = 0.6;
  ctx.fillText('SECTOR 07 · GLINTSPIRE', 0, 28);
  ctx.restore();
  // Paint loss over the stencil.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0 && Math.random() < 0.22) img.data[i + 3] *= 0.25;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A sea of cloud far below the arena. Without it the void reads as an empty
 * fog bank; with it the map reads as being high up, which is the whole pitch.
 */
export function cloudTexture(): THREE.Texture {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);
  // Soft banks of vapour, densest in the middle of each tile.
  for (let i = 0; i < 190; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 26 + Math.random() * 96;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const bright = 232 + Math.random() * 22;
    g.addColorStop(0, `rgba(${bright},${bright + 3},${bright + 8},${0.1 + Math.random() * 0.22})`);
    g.addColorStop(0.55, `rgba(${bright - 26},${bright - 22},${bright - 14},0.08)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Wrap the edges so the tile blends into its neighbours.
  const img = ctx.getImageData(0, 0, size, size);
  const w = size;
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = Math.min(1, Math.min(x, w - 1 - x) / 48);
      const fy = Math.min(1, Math.min(y, size - 1 - y) / 48);
      const k = Math.max(fx, fy);
      const i = (y * size + x) * 4 + 3;
      data[i] = data[i] * k;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 4;
  return tex;
}

/**
 * White-on-white surface pattern for weapon skins. The material colour does
 * the tinting, so one texture serves every skin: carbon weave, camo blotches,
 * marble veins, paint flake and simple plate seams.
 */
export function patternTexture(pattern: string): THREE.Texture | null {
  if (pattern === 'solid') return null;
  const size = 256;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  if (pattern === 'carbon') {
    // 2x2 twill: alternating light and dark cells on a 45° weave.
    for (let y = 0; y < size; y += 8) {
      for (let x = 0; x < size; x += 8) {
        const on = ((x / 8) + (y / 8)) % 4 < 2;
        ctx.fillStyle = on ? 'rgba(255,255,255,0.0)' : 'rgba(120,126,136,0.5)';
        ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.strokeStyle = 'rgba(90,96,106,0.35)';
    ctx.lineWidth = 1;
    for (let i = -size; i < size * 2; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
    }
  } else if (pattern === 'camo') {
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 18 + Math.random() * 34;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(120,116,96,0.45)' : 'rgba(215,210,190,0.5)';
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.65 + Math.random() * 0.5);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (pattern === 'marble') {
    ctx.strokeStyle = 'rgba(120,110,88,0.42)';
    for (let i = 0; i < 22; i++) {
      ctx.lineWidth = 0.7 + Math.random() * 2.2;
      ctx.beginPath();
      let x = Math.random() * size;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < size) {
        x += (Math.random() - 0.5) * 26;
        y += 10 + Math.random() * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (pattern === 'flake') {
    for (let i = 0; i < 1400; i++) {
      const a = 0.08 + Math.random() * 0.22;
      ctx.fillStyle = Math.random() > 0.4 ? `rgba(255,255,255,${a})` : `rgba(120,120,130,${a})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
  } else {
    // plate: recessed panel lines with a hairline highlight.
    ctx.strokeStyle = 'rgba(110,110,120,0.32)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * size) / 4, 0);
      ctx.lineTo((i * size) / 4, size);
      ctx.moveTo(0, (i * size) / 4);
      ctx.lineTo(size, (i * size) / 4);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  return tex;
}
