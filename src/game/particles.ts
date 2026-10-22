export type ParticleKind = 'dust' | 'spark' | 'silk' | 'spore' | 'petal' | 'leaf' | 'shard' | 'glow';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  kind: ParticleKind;
  color: string;
  spin: number;
  rot: number;
  drag: number;
  gravity: number;
}

export class ParticleSystem {
  particles: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number; kind: ParticleKind }): void {
    this.particles.push({
      vx: 0,
      vy: 0,
      life: 0.6,
      maxLife: 0.6,
      size: 3,
      color: '#eaf6ef',
      spin: 0,
      rot: 0,
      drag: 0.9,
      gravity: 0,
      ...p,
    });
  }

  burst(x: number, y: number, count: number, kind: ParticleKind, opts: Partial<Particle> = {}): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        kind,
        ...opts,
      });
    }
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
