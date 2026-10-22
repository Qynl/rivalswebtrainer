import type { Camera } from '../game/camera';

export interface BgLayer {
  points: number[]; // alternating x,y silhouette polygon (one screen-width tile, repeated)
  color: string;
  rim: string;
  scroll: number; // parallax factor, 0 = fixed, 1 = moves with world
  baseY: number; // anchor Y in world space
  tileW: number;
}

let time = 0;

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jaggedSilhouette(seed: number, tileW: number, baseAmp: number, teeth: number): number[] {
  const rnd = mulberry32(seed);
  const pts: number[] = [];
  const step = tileW / teeth;
  let firstY = 0;
  for (let i = 0; i <= teeth; i++) {
    const x = i * step;
    // Force the last point to match the first so the silhouette tiles seamlessly.
    const y = i === teeth ? firstY : (rnd() - 0.5) * baseAmp;
    if (i === 0) firstY = y;
    pts.push(x, y);
  }
  return pts;
}

const layerDefs = [
  { seed: 1, tileW: 1400, amp: 90, teeth: 10, scroll: 0.06, color: '#0a1414', rim: 'rgba(130,180,160,0.05)', baseY: 0.42 },
  { seed: 2, tileW: 1100, amp: 140, teeth: 9, scroll: 0.14, color: '#0e1d1b', rim: 'rgba(150,200,175,0.08)', baseY: 0.5 },
  { seed: 3, tileW: 820, amp: 110, teeth: 8, scroll: 0.3, color: '#122924', rim: 'rgba(180,220,190,0.1)', baseY: 0.62 },
  { seed: 4, tileW: 640, amp: 150, teeth: 7, scroll: 0.52, color: '#173b32', rim: 'rgba(255,210,150,0.14)', baseY: 0.78 },
];

const layers = layerDefs.map((d) => ({
  ...d,
  points: jaggedSilhouette(d.seed, d.tileW, d.amp, d.teeth),
}));

function drawSilhouetteLayer(
  ctx: CanvasRenderingContext2D,
  layer: (typeof layers)[number],
  cam: Camera,
  viewW: number,
  viewH: number,
): void {
  const parallaxX = cam.x * layer.scroll;
  const baseY = layer.baseY * viewH + Math.sin(time * 0.05 + layer.seed) * 6 - cam.y * layer.scroll * 0.1;
  const tileW = layer.tileW;
  const startTile = Math.floor(parallaxX / tileW) - 1;
  const endTile = Math.floor((parallaxX + viewW) / tileW) + 1;

  for (let t = startTile; t <= endTile; t++) {
    const offsetX = t * tileW - parallaxX;
    ctx.beginPath();
    ctx.moveTo(offsetX, viewH + 20);
    ctx.lineTo(offsetX + layer.points[0], baseY + layer.points[1]);
    for (let i = 0; i < layer.points.length; i += 2) {
      ctx.lineTo(offsetX + layer.points[i], baseY + layer.points[i + 1]);
    }
    ctx.lineTo(offsetX + tileW, viewH + 20);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();

    // thin rim-light along the silhouette's top edge
    ctx.beginPath();
    ctx.moveTo(offsetX + layer.points[0], baseY + layer.points[1]);
    for (let i = 0; i < layer.points.length; i += 2) {
      ctx.lineTo(offsetX + layer.points[i], baseY + layer.points[i + 1]);
    }
    ctx.strokeStyle = layer.rim;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawLightShafts(ctx: CanvasRenderingContext2D, cam: Camera, viewW: number, viewH: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const count = 4;
  for (let i = 0; i < count; i++) {
    const baseX = ((i * 420 - cam.x * 0.4) % (viewW + 600)) - 300;
    const sway = Math.sin(time * 0.15 + i * 2) * 20;
    const grad = ctx.createLinearGradient(baseX + sway, 0, baseX + sway + 260, viewH);
    grad.addColorStop(0, 'rgba(255,205,140,0.10)');
    grad.addColorStop(0.6, 'rgba(255,190,120,0.035)');
    grad.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX + sway, -40);
    ctx.lineTo(baseX + sway + 140, -40);
    ctx.lineTo(baseX + sway + 260, viewH + 40);
    ctx.lineTo(baseX + sway + 40, viewH + 40);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function renderBackground(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewW: number,
  viewH: number,
  dt: number,
): void {
  time += dt;

  const sky = ctx.createLinearGradient(0, 0, 0, viewH);
  sky.addColorStop(0, '#050b0c');
  sky.addColorStop(0.55, '#0a1716');
  sky.addColorStop(1, '#12221f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewW, viewH);

  // distant glow orbs (lanterns far away)
  for (let i = 0; i < 3; i++) {
    const gx = ((i * 500 - cam.x * 0.08) % (viewW + 400)) - 200;
    const gy = viewH * 0.3 + Math.sin(time * 0.1 + i) * 10;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 140);
    glow.addColorStop(0, 'rgba(255,200,130,0.10)');
    glow.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(gx - 150, gy - 150, 300, 300);
  }

  for (const layer of layers) drawSilhouetteLayer(ctx, layer, cam, viewW, viewH);
  drawLightShafts(ctx, cam, viewW, viewH);

  // soft fog near the bottom for depth
  const fog = ctx.createLinearGradient(0, viewH * 0.6, 0, viewH);
  fog.addColorStop(0, 'rgba(8,18,18,0)');
  fog.addColorStop(1, 'rgba(8,18,18,0.55)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, viewW, viewH);
}
