/**
 * Procedural effect pools: debris, lightning, impact scorch and ejected brass.
 *
 * Everything the game throws on screen comes from here or from particles.ts,
 * and everything is pooled. A kill happens up to six times a match, but a shot
 * happens constantly, so allocating a mesh per event would hand the garbage
 * collector the frame budget. Each pool owns its geometry once and only ever
 * rewrites instance matrices and opacities.
 *
 * No randomness is synced: these are cosmetic and never feed the simulation.
 */

import * as THREE from 'three';
import type { KillShape } from '../shared/cosmetics.ts';
import { clamp } from '../shared/mathx.ts';
import type { Vec3 } from '../shared/mathx.ts';

const TAU = Math.PI * 2;

/* ────────────────────────────────────────────────────────────────────────────
 * Debris: shards that tumble, petals that flutter
 * ──────────────────────────────────────────────────────────────────────────── */

interface Shard {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  gravity: number;
  alive: boolean;
}

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private shards: Shard[] = [];
  private tint: THREE.Color[] = [];
  private capacity: number;
  private cursor = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, hide);
      this.mesh.setColorAt(i, white);
      this.tint.push(white.clone());
      this.shards.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        axis: new THREE.Vector3(0, 1, 0),
        spin: 0,
        angle: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        drag: 1,
        gravity: 20,
        alive: false,
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  burst(
    at: Vec3,
    color: number,
    count: number,
    opts: { speed: number; size: number; life: number; gravity: number; drag: number; flatten?: number },
  ): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const s = this.shards[idx];
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      dir.normalize();
      const speed = opts.speed * (0.35 + Math.random() * 0.9);
      s.pos.set(at.x, at.y, at.z);
      s.vel.copy(dir).multiplyScalar(speed);
      if (opts.flatten !== undefined) s.vel.y *= opts.flatten;
      s.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      s.spin = (Math.random() * 2 - 1) * 14;
      s.angle = Math.random() * TAU;
      s.maxLife = opts.life * (0.6 + Math.random() * 0.7);
      s.life = s.maxLife;
      s.size = opts.size * (0.55 + Math.random() * 0.9);
      s.drag = opts.drag;
      s.gravity = opts.gravity;
      s.alive = true;
      this.tint[idx].copy(c).multiplyScalar(0.82 + Math.random() * 0.4);
      this.mesh.setColorAt(idx, this.tint[idx]);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.shards[i];
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        dirty = true;
        continue;
      }
      s.vel.y -= s.gravity * dt;
      s.vel.multiplyScalar(Math.exp(-s.drag * dt));
      s.pos.addScaledVector(s.vel, dt);
      s.angle += s.spin * dt;
      // Debris shrinks as it burns out, which reads as heat rather than as a
      // piece of geometry politely fading.
      const k = clamp(s.life / s.maxLife, 0, 1);
      const size = s.size * (0.35 + 0.65 * Math.pow(k, 0.4));
      this.quat.setFromAxisAngle(s.axis, s.angle);
      this.scale.set(size, size, size);
      this.matrix.compose(s.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Arcs: forked lightning around a kill
 * ──────────────────────────────────────────────────────────────────────────── */

interface Arc {
  points: Float32Array;
  life: number;
  maxLife: number;
  seed: THREE.Vector3;
  radius: number;
  flicker: number;
}

export class Arcs {
  readonly group = new THREE.Group();
  private lines: THREE.Line[] = [];
  private arcs: Arc[] = [];

  constructor(scene: THREE.Scene, count = 9, segments = 10) {
    for (let i = 0; i < count; i++) {
      const pts = new Float32Array(segments * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.lines.push(line);
      this.arcs.push({ points: pts, life: 0, maxLife: 1, seed: new THREE.Vector3(), radius: 1, flicker: 0 });
    }
    scene.add(this.group);
  }

  burst(at: Vec3, color: number, count = 7, radius = 1.4, life = 0.42): void {
    for (let i = 0; i < count; i++) {
      const arc = this.arcs[i];
      const line = this.lines[i];
      arc.seed.set(at.x, at.y, at.z);
      arc.radius = radius * (0.5 + Math.random() * 0.9);
      arc.maxLife = life * (0.6 + Math.random() * 0.7);
      arc.life = arc.maxLife;
      arc.flicker = 0;
      (line.material as THREE.LineBasicMaterial).color.setHex(color);
      line.visible = true;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      const line = this.lines[i];
      if (arc.life <= 0) {
        if (line.visible) line.visible = false;
        continue;
      }
      arc.life -= dt;
      if (arc.life <= 0) {
        line.visible = false;
        continue;
      }
      const k = clamp(arc.life / arc.maxLife, 0, 1);
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = k * (0.55 + Math.random() * 0.45);
      // A fresh jagged path every other frame: lightning that holds still is a
      // wire. The endpoints orbit the victim so the bolts look like they are
      // jumping between the body and the air around it.
      arc.flicker += dt;
      if (arc.flicker > 0.035) {
        arc.flicker = 0;
        const segs = arc.points.length / 3;
        const a0 = Math.random() * TAU;
        const a1 = a0 + Math.PI * (0.5 + Math.random());
        for (let s = 0; s < segs; s++) {
          const t = s / (segs - 1);
          const a = a0 + (a1 - a0) * t;
          const r = arc.radius * (1 - t * 0.7);
          const jitter = arc.radius * 0.35 * (1 - Math.abs(t - 0.5) * 2);
          arc.points[s * 3] = arc.seed.x + Math.cos(a) * r + (Math.random() - 0.5) * jitter;
          arc.points[s * 3 + 1] = arc.seed.y + (t - 0.5) * arc.radius * 2.2 + (Math.random() - 0.5) * jitter;
          arc.points[s * 3 + 2] = arc.seed.z + Math.sin(a) * r + (Math.random() - 0.5) * jitter;
        }
        (line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Decals: where a bullet actually landed
 * ──────────────────────────────────────────────────────────────────────────── */

interface Decal {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export class Decals {
  private pool: Decal[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, map: THREE.Texture, count = 28) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const base = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      opacity: 1,
    });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, base.clone());
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 1 });
    }
  }

  /** Puts a scorch on a surface. `normal` orients it; omit for air bursts. */
  add(at: Vec3, normal: Vec3 | null, size = 0.5, life = 9): void {
    const d = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    const mesh = d.mesh;
    mesh.position.set(at.x, at.y, at.z);
    if (normal) {
      const n = new THREE.Vector3(normal.x, normal.y, normal.z);
      if (n.lengthSq() < 1e-5) n.set(0, 1, 0);
      mesh.lookAt(at.x + n.x, at.y + n.y, at.z + n.z);
      // Pull the plane a hair off the wall so it never z-fights the concrete.
      mesh.position.addScaledVector(n.normalize(), 0.02);
    } else {
      mesh.rotation.set(-Math.PI / 2, 0, Math.random() * TAU);
    }
    mesh.scale.setScalar(size * (0.75 + Math.random() * 0.5));
    mesh.rotation.z += Math.random() * TAU;
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.92;
    const tint = 0.7 + Math.random() * 0.3;
    (mesh.material as THREE.MeshBasicMaterial).color.setRGB(tint, tint * 0.95, tint * 0.88);
    d.maxLife = life;
    d.life = life;
    mesh.visible = true;
  }

  update(dt: number): void {
    for (const d of this.pool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      const k = clamp(d.life / d.maxLife, 0, 1);
      mat.opacity = 0.92 * clamp(k * 2.2, 0, 1);
      if (d.life <= 0) d.mesh.visible = false;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shells: brass leaving the ejection port
 * ──────────────────────────────────────────────────────────────────────────── */

interface Shell {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Casings live in viewmodel space (parented to the camera) so they never
 *  clip into a wall two metres from the eye. */
export class Shells {
  readonly group = new THREE.Group();
  private pool: Shell[] = [];
  private cursor = 0;

  constructor(camera: THREE.Camera, count = 6) {
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 0.042, 7);
    geo.rotateZ(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a052, roughness: 0.32, metalness: 0.95 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, brass);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    camera.add(this.group);
  }

  eject(origin: THREE.Vector3): void {
    const s = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    s.mesh.position.copy(origin);
    s.mesh.rotation.set(0, 0, 0);
    s.vel.set(1.5 + Math.random() * 0.8, 1.2 + Math.random() * 0.7, 0.5 + Math.random() * 0.4);
    s.spin.set(Math.random() * 18, Math.random() * 12, Math.random() * 18);
    s.life = 0.62;
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const s of this.pool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 7.5 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      // A casing that tumbles out of frame is gone, not falling for ever.
      if (s.mesh.position.y < -0.55) {
        s.mesh.visible = false;
        s.life = 0;
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rings: flat shock rings, used by the star effects
 * ──────────────────────────────────────────────────────────────────────────── */

export class Rings {
  private pool: { mesh: THREE.Mesh; life: number; maxLife: number; from: number; to: number }[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, count = 10) {
    const geo = new THREE.RingGeometry(0.82, 1, 64);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 1, from: 1, to: 8 });
    }
  }

  spawn(at: Vec3, color: number, from: number, to: number, life: number, normal?: Vec3): void {
    const r = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    r.mesh.position.set(at.x, at.y, at.z);
    if (normal) {
      const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
      r.mesh.lookAt(at.x + n.x, at.y + n.y, at.z + n.z);
    } else {
      r.mesh.rotation.set(-Math.PI / 2, 0, 0);
      r.mesh.position.y += 0.05;
    }
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.from = from;
    r.to = to;
    r.maxLife = life;
    r.life = life;
    r.mesh.visible = true;
  }

  update(dt: number): void {
    for (const r of this.pool) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }
  }
}

export interface KillFxApi {
  kill(at: Vec3, shape: KillShape, colors: { burst: number; ring: number; motes: number }, scale: number): void;
  impact(at: Vec3, normal: Vec3 | null, color: number): void;
  update(dt: number): void;
}

/** One door for every pooled effect, so the renderer never touches pools. */
export class Fx implements KillFxApi {
  constructor(
    readonly shards: Debris,
    readonly petals: Debris,
    readonly arcs: Arcs,
    readonly decals: Decals,
    readonly shells: Shells,
    readonly rings: Rings,
  ) {}

  kill(
    at: Vec3,
    shape: KillShape,
    colors: { burst: number; ring: number; motes: number },
    scale: number,
  ): void {
    const k = clamp(scale, 0.2, 2);
    switch (shape) {
      case 'shard':
        this.shards.burst(at, colors.burst, Math.round(34 * k), {
          speed: 15,
          size: 0.24,
          life: 1.15,
          gravity: 16,
          drag: 1.1,
        });
        this.shards.burst(at, colors.motes, Math.round(14 * k), {
          speed: 7,
          size: 0.16,
          life: 1.5,
          gravity: 4,
          drag: 1.8,
        });
        this.rings.spawn(at, colors.ring, 0.5, 9 * k, 0.42);
        break;
      case 'petal':
        this.petals.burst(at, colors.burst, Math.round(26 * k), {
          speed: 9,
          size: 0.5,
          life: 1.35,
          gravity: 3.2,
          drag: 1.5,
          flatten: 0.35,
        });
        this.petals.burst(at, colors.motes, Math.round(12 * k), {
          speed: 4,
          size: 0.34,
          life: 1.7,
          gravity: 1.4,
          drag: 2,
          flatten: 0.2,
        });
        this.rings.spawn(at, colors.ring, 0.4, 7 * k, 0.7);
        break;
      case 'arc':
        this.arcs.burst(at, colors.burst, 9, 1.5 * k, 0.5);
        this.arcs.burst(at, colors.motes, 5, 2.4 * k, 0.28);
        this.rings.spawn(at, colors.ring, 0.6, 5 * k, 0.32);
        break;
      case 'star':
        this.rings.spawn(at, 0xffffff, 0.3, 4 * k, 0.22);
        this.rings.spawn(at, colors.ring, 0.6, 16 * k, 1.05);
        this.rings.spawn(at, colors.ring, 0.3, 9 * k, 0.8);
        this.shards.burst(at, colors.motes, Math.round(22 * k), {
          speed: 12,
          size: 0.2,
          life: 1.1,
          gravity: 5,
          drag: 1.2,
        });
        break;
      default:
        this.shards.burst(at, colors.burst, Math.round(24 * k), {
          speed: 12,
          size: 0.18,
          life: 0.8,
          gravity: 14,
          drag: 1.6,
        });
        break;
    }
    // Every kill scorches the air around the victim a little: a hot flash that
    // ties the effect to the body instead of leaving it floating.
    this.rings.spawn(at, colors.burst, 0.4, 3.2 * k, 0.2);
  }

  /** A bullet hit: scorch on the surface, sparks fanning off the normal. */
  impact(at: Vec3, normal: Vec3 | null, color: number): void {
    if (normal) {
      this.decals.add(at, normal, 0.55, 10);
      this.rings.spawn(at, color, 0.1, 1.4, 0.18, normal);
      this.shards.burst(at, 0x9aa4ae, 5, { speed: 5, size: 0.1, life: 0.5, gravity: 16, drag: 2 });
      // Concrete explodes in two fractions: a fast chip cone and a slow dust
      // plume that lifts off the wall and hangs. The plume is what makes a miss
      // legible from 60 m, where individual chips are sub-pixel.
      this.petals.burst(at, 0xd6cfc0, 7, {
        speed: 1.6,
        size: 0.42,
        life: 1.15,
        gravity: -1.1,
        drag: 2.6,
        flatten: 0.5,
      });
    }
    this.shards.burst(at, color, 4, { speed: 7, size: 0.1, life: 0.32, gravity: 18, drag: 2 });
  }

  update(dt: number): void {
    this.shards.update(dt);
    this.petals.update(dt);
    this.arcs.update(dt);
    this.decals.update(dt);
    this.shells.update(dt);
    this.rings.update(dt);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ornaments: the moving part of a skin
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A small group that hangs off the weapon and never stops moving. This is the
 * difference between a painted rifle and an owned one: the eye catches motion
 * long before it reads a pattern, and a still frame of the viewmodel is most of
 * what the player ever looks at.
 */
export class Ornament {
  readonly group = new THREE.Group();
  private parts: { object: THREE.Object3D; kind: string; base: THREE.Vector3; rate: number; phase: number }[] = [];
  private materials: THREE.Material[] = [];

  constructor(kind: 'none' | 'ring' | 'motes' | 'vent' | 'coil' | 'shards', color: number, scale = 1) {
    const glow = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(glow);
    const solid = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.25,
      metalness: 0.9,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.6,
    });
    this.materials.push(solid);

    if (kind === 'ring') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05 * scale, 0.0035 * scale, 6, 28), solid);
      ring.position.set(0, 0.128, -0.46);
      ring.rotation.y = Math.PI / 2;
      this.group.add(ring);
      this.parts.push({ object: ring, kind: 'spin', base: ring.position.clone(), rate: 1.4, phase: 0 });
      // A second, finer ring on the opposite phase: a gyroscope, not a hoop.
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.058 * scale, 0.0018 * scale, 5, 32), glow);
      halo.position.set(0, 0.128, -0.36);
      this.group.add(halo);
      this.parts.push({ object: halo, kind: 'tilt', base: halo.position.clone(), rate: 0.9, phase: 1.7 });
    } else if (kind === 'motes') {
      for (let i = 0; i < 7; i++) {
        // A tiny lit sphere, not a sprite: at 4 mm a sprite's square corners
        // show, and a sphere is one draw call for all seven motes anyway.
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004 * scale, 5, 4), glow);
        dot.position.set((Math.random() - 0.5) * 0.07, 0.06 + Math.random() * 0.04, -0.2 - Math.random() * 0.5);
        this.group.add(dot);
        this.parts.push({ object: dot, kind: 'rise', base: dot.position.clone(), rate: 0.35 + Math.random() * 0.35, phase: Math.random() * TAU });
      }
    } else if (kind === 'vent') {
      for (let i = 0; i < 4; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.004 * scale, 0.014 * scale, 0.03 * scale), glow);
        slot.position.set(0.041, 0.026, -0.5 - i * 0.05);
        this.group.add(slot);
        this.parts.push({ object: slot, kind: 'breathe', base: slot.position.clone(), rate: 2.2, phase: i * 0.7 });
      }
    } else if (kind === 'coil') {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.062 * scale, 0.004 * scale, 6, 26), solid);
      coil.position.set(0, -0.035, -0.2);
      coil.rotation.y = Math.PI / 2;
      this.group.add(coil);
      this.parts.push({ object: coil, kind: 'spin', base: coil.position.clone(), rate: 2.2, phase: 0 });
    } else if (kind === 'shards') {
      for (let i = 0; i < 5; i++) {
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.012 * scale), glow);
        this.group.add(shard);
        this.parts.push({ object: shard, kind: 'orbit', base: new THREE.Vector3(0, 0.02, -0.5), rate: 1.1, phase: (i / 5) * TAU });
      }
    }
  }

  update(t: number): void {
    for (const p of this.parts) {
      if (p.kind === 'spin') {
        p.object.rotation.z = t * p.rate;
        p.object.rotation.x = Math.sin(t * p.rate * 0.7) * 0.2;
      } else if (p.kind === 'tilt') {
        p.object.rotation.y = Math.PI / 2 + Math.sin(t * p.rate + p.phase) * 0.5;
        p.object.rotation.x = t * p.rate * 0.6;
      } else if (p.kind === 'rise') {
        const loop = (t * p.rate + p.phase) % 1;
        p.object.position.set(p.base.x, p.base.y + loop * 0.06, p.base.z);
        (p.object as THREE.Mesh).scale.setScalar(1 - loop * 0.7);
      } else if (p.kind === 'breathe') {
        const k = 0.55 + 0.45 * Math.sin(t * p.rate + p.phase);
        ((p.object as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.25 + k * 0.75;
      } else if (p.kind === 'orbit') {
        const a = t * p.rate + p.phase;
        p.object.position.set(Math.cos(a) * 0.045, p.base.y + Math.sin(a * 2) * 0.02, p.base.z + Math.sin(a) * 0.045);
        p.object.rotation.set(a * 2, a * 1.7, 0);
      }
    }
  }
}
