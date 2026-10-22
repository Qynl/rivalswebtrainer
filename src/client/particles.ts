/**
 * GPU-friendly particles, tracer beams and shockwaves.
 *
 * All sparks live in one Points buffer with one draw call, updated on the CPU
 * (a few hundred particles is nothing). Beams and rings come from small pools
 * so a firefight never allocates.
 */

import * as THREE from 'three';
import type { Vec3 } from '../shared/mathx.ts';

interface Particle {
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
}

export interface BurstOptions {
  speed?: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** Bias every particle toward this direction (normalised inside). */
  dir?: Vec3;
  /** How tightly the burst hugs `dir` (0 = sphere, 1 = cone). */
  focus?: number;
}

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float falloff = pow(1.0 - r * 2.0, 2.2);
  gl_FragColor = vec4(vColor * (1.0 + falloff), vAlpha * falloff);
}
`;

export class Particles {
  readonly points: THREE.Points;
  private capacity: number;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private data: Particle[] = [];
  private cursor = 0;

  constructor(capacity = 1200) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.data.push({ vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, gravity: 0, drag: 0 });
      this.pos[i * 3 + 1] = -9999;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  burst(at: Vec3, color: number, count: number, opts: BurstOptions = {}): void {
    const c = new THREE.Color(color);
    const speed = opts.speed ?? 9;
    const spread = opts.spread ?? 1;
    const size = opts.size ?? 0.42;
    const life = opts.life ?? 0.5;
    const dir = opts.dir ? new THREE.Vector3(opts.dir.x, opts.dir.y, opts.dir.z).normalize() : null;
    const focus = opts.focus ?? 0;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const d = this.data[i];
      // Random point on a sphere, then optionally bent toward `dir`.
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      let vx = Math.cos(theta) * r;
      let vy = z;
      let vz = Math.sin(theta) * r;
      if (dir) {
        vx = vx * (1 - focus) + dir.x * focus;
        vy = vy * (1 - focus) + dir.y * focus;
        vz = vz * (1 - focus) + dir.z * focus;
      }
      const sp = speed * (0.35 + Math.random() * 0.9) * spread;
      d.vx = vx * sp;
      d.vy = vy * sp;
      d.vz = vz * sp;
      d.maxLife = life * (0.6 + Math.random() * 0.8);
      d.life = d.maxLife;
      d.gravity = opts.gravity ?? 12;
      d.drag = opts.drag ?? 2.2;
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      const tint = 0.75 + Math.random() * 0.5;
      this.col[i * 3] = c.r * tint;
      this.col[i * 3 + 1] = c.g * tint;
      this.col[i * 3 + 2] = c.b * tint;
      this.size[i] = size * (0.5 + Math.random() * 1.1);
      this.alpha[i] = 1;
    }
  }

  /** A single ember, used for trails behind fast movers. */
  ember(at: Vec3, color: number, size = 0.3, life = 0.4): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const d = this.data[i];
    d.vx = (Math.random() - 0.5) * 1.4;
    d.vy = (Math.random() - 0.5) * 1.4;
    d.vz = (Math.random() - 0.5) * 1.4;
    d.maxLife = life;
    d.life = life;
    d.gravity = -1.4;
    d.drag = 1.2;
    const c = new THREE.Color(color);
    this.pos[i * 3] = at.x;
    this.pos[i * 3 + 1] = at.y;
    this.pos[i * 3 + 2] = at.z;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.alpha[i] = 0.85;
  }

  update(dt: number): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < this.capacity; i++) {
      const d = this.data[i];
      if (d.life <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          alpha.needsUpdate = true;
        }
        continue;
      }
      d.life -= dt;
      const decay = Math.exp(-d.drag * dt);
      d.vx *= decay;
      d.vz *= decay;
      d.vy = d.vy * decay - d.gravity * dt;
      this.pos[i * 3] += d.vx * dt;
      this.pos[i * 3 + 1] += d.vy * dt;
      this.pos[i * 3 + 2] += d.vz * dt;
      this.alpha[i] = Math.max(0, d.life / d.maxLife);
      if (d.life <= 0) this.alpha[i] = 0;
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ── Tracer beams ───────────────────────────────────────────────────────────

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  across = pow(clamp(across, 0.0, 1.0), 2.0);
  float along = smoothstep(0.0, 0.65, vUv.y) * (0.25 + 0.75 * smoothstep(0.0, 0.08, 1.0 - vUv.y));
  float head = pow(vUv.y, 6.0) * 1.6;
  float a = (across * along + head) * uOpacity;
  gl_FragColor = vec4(uColor * (1.0 + head), a);
}
`;

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  life: number;
}

export class Beams {
  readonly group = new THREE.Group();
  private pool: Beam[] = [];
  private up = new THREE.Vector3(0, 1, 0);
  private q = new THREE.Quaternion();
  private dir = new THREE.Vector3();

  constructor(count = 12) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.pool.push({ mesh, mat, life: 0 });
    }
  }

  fire(from: Vec3, to: Vec3, color: number, width = 0.42, life = 0.32): void {
    let slot = this.pool.find((b) => b.life <= 0);
    if (!slot) slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    this.dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = this.dir.length();
    if (len < 0.01) return;
    this.dir.multiplyScalar(1 / len);
    const b = slot;
    b.mesh.position.set(from.x, from.y, from.z);
    this.q.setFromUnitVectors(this.up, this.dir);
    b.mesh.quaternion.copy(this.q);
    b.mesh.scale.set(width, len, 1);
    b.mesh.visible = true;
    b.mat.uniforms.uColor.value.setHex(color);
    b.mat.uniforms.uOpacity.value = 1;
    b.life = life;
    b.mesh.userData.life = life;
  }

  update(dt: number): void {
    for (const b of this.pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / (b.mesh.userData.life as number));
      b.mat.uniforms.uOpacity.value = k;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }
}

// ── Shockwave rings ────────────────────────────────────────────────────────

interface Wave {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  scale: number;
}

export class Shockwaves {
  readonly group = new THREE.Group();
  private pool: Wave[] = [];

  constructor(count = 8) {
    const geo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.pool.push({ mesh, life: 0, max: 1, scale: 1 });
    }
  }

  spawn(at: Vec3, color: number, scale = 6, life = 0.5, tilt = 0): void {
    let slot = this.pool.find((w) => w.life <= 0);
    if (!slot) slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    slot.mesh.position.set(at.x, at.y, at.z);
    slot.mesh.rotation.set(Math.PI / 2 + tilt, 0, 0);
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    slot.mesh.visible = true;
    slot.life = life;
    slot.max = life;
    slot.scale = scale;
  }

  update(dt: number): void {
    for (const w of this.pool) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const t = 1 - Math.max(0, w.life / w.max);
      const s = w.scale * (0.25 + t * 1.6);
      w.mesh.scale.set(s, s, s);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      if (w.life <= 0) w.mesh.visible = false;
    }
  }
}
