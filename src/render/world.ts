import type { Level } from '../game/level';
import type { Rect } from '../game/geometry';

let time = 0;

function roundedPlatform(ctx: CanvasRenderingContext2D, r: Rect): void {
  const radius = Math.min(10, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y);
  ctx.lineTo(r.x + r.w - radius, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + radius, radius);
  ctx.lineTo(r.x + r.w, r.y + r.h);
  ctx.lineTo(r.x, r.y + r.h);
  ctx.lineTo(r.x, r.y + radius);
  ctx.arcTo(r.x, r.y, r.x + radius, r.y, radius);
  ctx.closePath();
}

function drawPlatform(ctx: CanvasRenderingContext2D, r: Rect, seed: number): void {
  roundedPlatform(ctx, r);
  const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  grad.addColorStop(0, '#2a4740');
  grad.addColorStop(0.18, '#1c322c');
  grad.addColorStop(1, '#0e1b18');
  ctx.fillStyle = grad;
  ctx.fill();

  // rim light along the top edge
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + 1);
  ctx.lineTo(r.x + r.w, r.y + 1);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(184, 230, 200, 0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + 4);
  ctx.lineTo(r.x + r.w, r.y + 4);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(120, 190, 160, 0.18)';
  ctx.stroke();

  // sparse moss speckle texture, deterministic per-platform
  let n = seed;
  const rnd = () => {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    return (n % 1000) / 1000;
  };
  const count = Math.max(2, Math.floor((r.w * r.h) / 900));
  for (let i = 0; i < count; i++) {
    const px = r.x + rnd() * r.w;
    const py = r.y + rnd() * r.h;
    const s = 1 + rnd() * 2.4;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(130,180,150,0.10)' : 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(px, py, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // tufts of grass along the top edge
  let g = seed * 7 + 3;
  const grnd = () => {
    g = (g * 1103515245 + 12345) & 0x7fffffff;
    return (g % 1000) / 1000;
  };
  ctx.strokeStyle = 'rgba(140, 210, 170, 0.5)';
  ctx.lineWidth = 1.4;
  for (let x = 6; x < r.w - 4; x += 10) {
    if (grnd() < 0.55) continue;
    const bx = r.x + x;
    const sway = Math.sin(time * 1.6 + bx * 0.06) * 2.2;
    ctx.beginPath();
    ctx.moveTo(bx, r.y + 1);
    ctx.quadraticCurveTo(bx + sway, r.y - 5, bx + sway * 1.6, r.y - 9);
    ctx.stroke();
  }
}

function drawHazard(ctx: CanvasRenderingContext2D, r: Rect): void {
  const spikeW = 12;
  const count = Math.max(1, Math.round(r.w / spikeW));
  const w = r.w / count;
  const pulse = 0.5 + Math.sin(time * 3) * 0.15;
  ctx.fillStyle = `rgba(230, 60, 70, ${0.08 + pulse * 0.05})`;
  ctx.fillRect(r.x - 4, r.y - 6, r.w + 8, r.h + 10);
  for (let i = 0; i < count; i++) {
    const x0 = r.x + i * w;
    ctx.beginPath();
    ctx.moveTo(x0, r.y + r.h);
    ctx.lineTo(x0 + w / 2, r.y);
    ctx.lineTo(x0 + w, r.y + r.h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, '#f3efe3');
    g.addColorStop(1, '#8f8f86');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,15,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBouncePad(ctx: CanvasRenderingContext2D, r: Rect): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const bob = Math.sin(time * 2.4 + cx) * 2;
  const pulse = 0.6 + Math.sin(time * 4 + cx) * 0.4;

  // thread holding it up
  ctx.strokeStyle = 'rgba(230,230,220,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 40);
  ctx.lineTo(cx, cy - r.h / 2 + bob);
  ctx.stroke();

  const glow = ctx.createRadialGradient(cx, cy + bob, 0, cx, cy + bob, 26);
  glow.addColorStop(0, `rgba(255,255,255,${0.35 + pulse * 0.25})`);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 30, cy + bob - 30, 60, 60);

  ctx.beginPath();
  ctx.ellipse(cx, cy + bob, r.w / 2, r.h / 2 + 2, 0, 0, Math.PI * 2);
  const grad = ctx.createLinearGradient(0, cy - r.h, 0, cy + r.h);
  grad.addColorStop(0, '#fdf8ee');
  grad.addColorStop(1, '#cdd9c8');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawBench(ctx: CanvasRenderingContext2D, r: Rect): void {
  const glow = ctx.createRadialGradient(r.x + r.w / 2, r.y, 0, r.x + r.w / 2, r.y, 50);
  glow.addColorStop(0, 'rgba(130, 200, 255, 0.18)');
  glow.addColorStop(1, 'rgba(130, 200, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(r.x - 40, r.y - 50, r.w + 80, 80);

  ctx.fillStyle = '#2c3a3a';
  ctx.fillRect(r.x - 4, r.y, r.w + 8, 6);
  ctx.fillRect(r.x, r.y + 6, 6, 14);
  ctx.fillRect(r.x + r.w - 6, r.y + 6, 6, 14);
  ctx.strokeStyle = 'rgba(170,220,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x - 4, r.y, r.w + 8, 6);
}

function drawBreakable(ctx: CanvasRenderingContext2D, b: Level['breakables'][number]): void {
  if (b.broken) return;
  const { rect: r } = b;
  const sway = Math.sin(time * 1.8 + r.x) * 3;
  if (b.kind === 'grass') {
    ctx.strokeStyle = '#86c99a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const bx = r.x + (i / 2) * r.w;
      ctx.beginPath();
      ctx.moveTo(bx, r.y + r.h);
      ctx.quadraticCurveTo(bx + sway, r.y + r.h / 2, bx + sway * 1.6, r.y);
      ctx.stroke();
    }
  } else if (b.kind === 'pot') {
    ctx.fillStyle = '#5c4632';
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.lineTo(r.x + r.w - 3, r.y + 4);
    ctx.lineTo(r.x + 3, r.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7a5c40';
    ctx.fillRect(r.x - 1, r.y, r.w + 2, 5);
  } else {
    ctx.fillStyle = 'rgba(240,240,230,0.85)';
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderWorld(ctx: CanvasRenderingContext2D, level: Level, dt: number): void {
  time += dt;
  for (const v of level.vines) {
    ctx.strokeStyle = 'rgba(30,50,42,0.9)';
    ctx.lineWidth = 2;
    const sway = Math.sin(time * 0.6 + v.x * 0.02) * 10;
    ctx.beginPath();
    ctx.moveTo(v.x, v.y);
    ctx.quadraticCurveTo(v.x + sway, v.y + v.len * 0.6, v.x + sway * 1.5, v.y + v.len);
    ctx.stroke();
  }

  level.solids.forEach((r, i) => drawPlatform(ctx, r, i * 97 + 13));
  level.hazards.forEach((r) => drawHazard(ctx, r));
  level.bouncePads.forEach((r) => drawBouncePad(ctx, r));
  level.benches.forEach((r) => drawBench(ctx, r));
  level.breakables.forEach((b) => drawBreakable(ctx, b));

  for (const f of level.fireflies) {
    const tw = 0.5 + Math.sin(time * 2 + f.phase) * 0.5;
    const fy = f.y + Math.sin(time * 0.8 + f.phase) * 8;
    const fx = f.x + Math.cos(time * 0.5 + f.phase) * 6;
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, f.r * 6);
    glow.addColorStop(0, `rgba(210,255,190,${0.5 * tw})`);
    glow.addColorStop(1, 'rgba(210,255,190,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fx - f.r * 6, fy - f.r * 6, f.r * 12, f.r * 12);
    ctx.fillStyle = `rgba(230,255,210,${0.7 * tw + 0.2})`;
    ctx.beginPath();
    ctx.arc(fx, fy, f.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
