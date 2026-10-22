import type { Game } from '../game/game';
import { renderBackground } from './background';
import { renderWorld } from './world';
import { drawPlayer } from './player';
import { renderParticles } from './fx';

export const VIEW_W = 1024;
export const VIEW_H = 576;

export function render(ctx: CanvasRenderingContext2D, game: Game, dt: number): void {
  const cam = game.camera;

  renderBackground(ctx, cam, VIEW_W, VIEW_H, dt);

  ctx.save();
  ctx.translate(Math.round(-cam.x + cam.offsetX), Math.round(-cam.y + cam.offsetY));

  renderWorld(ctx, game.level, dt);
  drawPlayer(ctx, game.player, game.visual);
  renderParticles(ctx, game.particles);

  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.25,
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.85,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (game.player.invulnTimer > 0 && game.player.hurtTimer > 0) {
    ctx.fillStyle = 'rgba(200,40,50,0.12)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}
