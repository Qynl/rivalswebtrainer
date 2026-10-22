import type { Particle, ParticleSystem } from '../game/particles';

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const t = 1 - p.life / p.maxLife;
  const alpha = p.life / p.maxLife;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = Math.max(0, alpha);

  switch (p.kind) {
    case 'dust': {
      ctx.fillStyle = p.color;
      const s = p.size * (1 + t * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'silk': {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * 0.6;
      ctx.beginPath();
      ctx.moveTo(-p.size, 0);
      ctx.lineTo(p.size, 0);
      ctx.stroke();
      break;
    }
    case 'spark': {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-p.size, 0);
      ctx.lineTo(p.size, 0);
      ctx.stroke();
      break;
    }
    case 'leaf': {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shard': {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.7, p.size * 0.6);
      ctx.lineTo(-p.size * 0.7, p.size * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'glow': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      g.addColorStop(0, p.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
      break;
    }
    case 'petal':
    case 'spore':
    default: {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

export function renderParticles(ctx: CanvasRenderingContext2D, ps: ParticleSystem): void {
  for (const p of ps.particles) drawParticle(ctx, p);
}
