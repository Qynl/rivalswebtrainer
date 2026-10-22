import { MASKS_MAX } from './config';
import { createCamera, shake, updateCamera, type Camera } from './camera';
import { rectsOverlap, inflate, type Vec2 } from './geometry';
import { buildTestChamber, type Level } from './level';
import {
  applyHurt,
  attackHitbox,
  clampToWorld,
  createPlayerState,
  respawn,
  stepPlayer,
  type InputFrame,
  type PlayerState,
} from './movement';
import { createPlayerVisual, updatePlayerVisual, type PlayerVisual } from '../render/player';
import { ParticleSystem } from './particles';

export interface HudState {
  masks: number;
  masksMax: number;
  dashReady: boolean;
  dashCooldown: number;
  message: string;
  messageTimer: number;
}

export class Game {
  level: Level = buildTestChamber();
  player: PlayerState;
  visual: PlayerVisual = createPlayerVisual();
  camera: Camera = createCamera();
  particles = new ParticleSystem();
  masks = MASKS_MAX;
  checkpoint: Vec2;
  sporeTimer = 0;
  hud: HudState;
  time = 0;

  constructor() {
    this.player = createPlayerState(this.level.spawn);
    this.checkpoint = { ...this.level.spawn };
    this.hud = { masks: this.masks, masksMax: MASKS_MAX, dashReady: true, dashCooldown: 0, message: '', messageTimer: 0 };
    this.setMessage('THE MOSSBOUND HOLLOW', 2.8);
  }

  private setMessage(text: string, time = 2.2): void {
    this.hud.message = text;
    this.hud.messageTimer = time;
  }

  private hurt(fromX: number): void {
    if (this.player.invulnTimer > 0) return;
    this.masks = Math.max(0, this.masks - 1);
    applyHurt(this.player, fromX);
    this.particles.burst(this.player.pos.x + this.player.width / 2, this.player.pos.y + this.player.height / 2, 10, 'shard', {
      color: '#ff6b6b',
      size: 3,
      life: 0.4,
      maxLife: 0.4,
      gravity: 500,
    });
    shake(this.camera, 5, 0.18);
    if (this.masks <= 0) {
      this.die();
    }
  }

  private die(): void {
    this.setMessage('BOUND BY THREAD...', 1.6);
    this.masks = MASKS_MAX;
    respawn(this.player, this.checkpoint);
    shake(this.camera, 8, 0.25);
  }

  private spawnDust(x: number, y: number, amount: number): void {
    this.particles.burst(x, y, amount, 'dust', {
      color: 'rgba(210,225,210,0.55)',
      size: 4,
      life: 0.35,
      maxLife: 0.35,
      gravity: -40,
      drag: 0.86,
    });
  }

  private spawnSparks(x: number, y: number, amount: number, color: string): void {
    this.particles.burst(x, y, amount, 'spark', { color, size: 7, life: 0.25, maxLife: 0.25, gravity: 200, drag: 0.8 });
  }

  update(input: InputFrame, dt: number): void {
    this.time += dt;
    this.hud.messageTimer = Math.max(0, this.hud.messageTimer - dt);

    const prevVelY = this.player.vel.y;
    const feetBefore = { x: this.player.pos.x + this.player.width / 2, y: this.player.pos.y + this.player.height };

    const ev = stepPlayer(this.player, input, this.level, dt);
    updatePlayerVisual(this.visual, this.player, ev, dt);

    const feet = { x: this.player.pos.x + this.player.width / 2, y: this.player.pos.y + this.player.height };

    if (ev.jumped) this.spawnDust(feet.x, feet.y, 4);
    if (ev.wallJumped) this.spawnSparks(feetBefore.x, feetBefore.y - this.player.height * 0.4, 6, '#d9f0ff');
    if (ev.landed) {
      const impact = Math.min(1, prevVelY / 700);
      this.spawnDust(feet.x, feet.y, 4 + Math.round(impact * 8));
      if (impact > 0.55) shake(this.camera, 3 + impact * 3, 0.12);
    }
    if (ev.dashed) {
      this.particles.burst(feet.x, feet.y - this.player.height * 0.5, 10, 'silk', {
        color: 'rgba(240,240,255,0.8)',
        size: 6,
        life: 0.22,
        maxLife: 0.22,
        drag: 0.75,
      });
      shake(this.camera, 2, 0.08);
    }
    if (ev.pogoed) {
      this.spawnSparks(feet.x, feet.y, 10, '#eafff0');
      shake(this.camera, 3, 0.12);
    }
    if (ev.fellOut) {
      this.hurt(feet.x);
    }

    // --- hazards ---
    const box = { x: this.player.pos.x, y: this.player.pos.y, w: this.player.width, h: this.player.height };
    for (const hz of this.level.hazards) {
      if (rectsOverlap(box, hz)) {
        this.hurt(hz.x + hz.w / 2);
        break;
      }
    }

    // --- breakables ---
    const atkBox = attackHitbox(this.player);
    if (atkBox) {
      for (const b of this.level.breakables) {
        if (b.broken) continue;
        if (rectsOverlap(atkBox, b.rect)) {
          b.broken = true;
          b.respawnTimer = 5 + Math.random() * 3;
          const cx = b.rect.x + b.rect.w / 2;
          const cy = b.rect.y + b.rect.h / 2;
          const color = b.kind === 'grass' ? '#8fd6a0' : b.kind === 'pot' ? '#9c7a55' : '#f2f2e8';
          this.particles.burst(cx, cy, 8, 'leaf', { color, size: 3, life: 0.5, maxLife: 0.5, gravity: 420, drag: 0.92 });
        }
      }
    }
    for (const b of this.level.breakables) {
      if (b.broken) {
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0) b.broken = false;
      }
    }

    // --- benches ---
    for (const bench of this.level.benches) {
      if (rectsOverlap(box, inflate(bench, 10, 24))) {
        const restPoint = { x: bench.x + bench.w / 2 - this.player.width / 2, y: bench.y - this.player.height };
        const isNew = Math.hypot(restPoint.x - this.checkpoint.x, restPoint.y - this.checkpoint.y) > 4;
        this.checkpoint = restPoint;
        if (this.masks < MASKS_MAX || isNew) this.setMessage('RESTED AT THE BENCH', 1.6);
        this.masks = MASKS_MAX;
      }
    }

    // --- ambient spores drifting through the chamber ---
    this.sporeTimer -= dt;
    if (this.sporeTimer <= 0) {
      this.sporeTimer = 0.35;
      const x = this.camera.x + Math.random() * 1024;
      const y = this.camera.y + Math.random() * 576;
      this.particles.spawn({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: -6 - Math.random() * 10,
        kind: Math.random() > 0.5 ? 'spore' : 'petal',
        color: Math.random() > 0.5 ? 'rgba(220,235,210,0.35)' : 'rgba(255,255,255,0.3)',
        size: 1.2 + Math.random() * 1.8,
        life: 6 + Math.random() * 4,
        maxLife: 10,
        gravity: 0,
        drag: 0.995,
      });
    }

    clampToWorld(this.player, this.level.width);
    this.particles.update(dt);
    updateCamera(
      this.camera,
      { x: this.player.pos.x + this.player.width / 2, y: this.player.pos.y + this.player.height / 2, vx: this.player.vel.x },
      1024,
      576,
      this.level.width,
      this.level.height,
      dt,
    );

    this.hud.masks = this.masks;
    this.hud.dashReady = this.player.dashReady && this.player.dashCooldown <= 0;
    this.hud.dashCooldown = this.player.dashCooldown;
  }

  reset(): void {
    this.level = buildTestChamber();
    this.player = createPlayerState(this.level.spawn);
    this.visual = createPlayerVisual();
    this.camera = createCamera();
    this.particles = new ParticleSystem();
    this.masks = MASKS_MAX;
    this.checkpoint = { ...this.level.spawn };
    this.setMessage('THE MOSSBOUND HOLLOW', 2.4);
  }
}
