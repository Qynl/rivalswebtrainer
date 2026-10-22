/**
 * GPU-friendly particles, tracer beams and shockwaves.
 *
 * All sparks live in one Points buffer with one draw call, updated on the CPU
 * (a few hundred particles is nothing). Beams and rings come from small pools
 * so a firefight never allocates.
 */

import { clamp } from '../shared/mathx.ts';

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
uniform vec3 uStart;
uniform vec3 uEnd;
uniform float uWidth;
uniform float uProgress;
uniform float uTail;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  // A world-space billboard: the ribbon is rebuilt as a strip along the shot
  // and widened toward the camera, so it is never edge-on and never pops when
  // you strafe across it. This is the single biggest difference between a
  // tracer that reads as a beam of light and one that reads as a cardboard cut.
  vec3 dir = normalize(uEnd - uStart);
  vec3 axis = normalize(cross(dir, normalize(cameraPosition - uStart)));
  float head = uProgress;
  float tail = max(0.0, uProgress - uTail);
  float t = mix(tail, head, uv.y);
  vec3 p = mix(uStart, uEnd, t);
  // Fat at the head, hairline at the tail: a bullet is a point, not a bar.
  float taper = smoothstep(0.0, 0.75, uv.y) * (0.35 + 0.65 * uv.y);
  p += axis * (uv.x - 0.5) * uWidth * taper;
  // Nudge toward the camera a hair so a shot that skims a wall does not
  // z-fight the concrete.
  p += normalize(cameraPosition - p) * 0.05;
  vFade = 1.0 - smoothstep(0.82, 1.0, uv.y) * 0.55;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFade;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float core = pow(clamp(across, 0.0, 1.0), 3.0);
  float glow = pow(clamp(across, 0.0, 1.0), 0.9) * 0.45;
  // Heat along the length: white-hot at the head, ember at the tail.
  float heat = smoothstep(0.35, 1.0, vUv.y);
  // A little shimmer so a long shot does not look like a decal that was placed.
  float flicker = 0.92 + 0.08 * sin(uTime * 90.0 + vUv.y * 24.0);
  float a = (core * (0.35 + heat * 1.35) + glow) * uOpacity * vFade * flicker;
  vec3 col = mix(uColor, vec3(1.0), core * heat * 0.85);
  gl_FragColor = vec4(col * (1.0 + heat * 1.2), clamp(a, 0.0, 1.0));
}
`;

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  life: number;
  maxLife: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds the bolt takes to cross the whole shot. */
  travel: number;
  /** Fraction of the shot that is lit at once (the tail). */
  tail: number;
}

export class Beams {
  readonly group = new THREE.Group();
  private pool: Beam[] = [];
  private time = 0;

  constructor(count = 14) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uStart: { value: new THREE.Vector3() },
          uEnd: { value: new THREE.Vector3() },
          uWidth: { value: 0.3 },
          uProgress: { value: 0 },
          uTail: { value: 0.2 },
          uColor: { value: new THREE.Color(0xffffff) },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.pool.push({
        mesh,
        mat,
        life: 0,
        maxLife: 1,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        travel: 0.06,
        tail: 0.35,
      });
    }
  }

  /**
   * Fires a bolt along a segment. It is deliberately slower than a bullet: at
   * 900 m/s a 60 m tracer is on screen for one frame. Stretching it over ~70 ms
   * with a 20 m tail is the difference between "a flash" and "a shot you can
   * read, flinch at, and use to find the shooter".
   */
  fire(from: Vec3, to: Vec3, color: number, width = 0.42, life = 0.3): void {
    let slot = this.pool.find((b) => b.life <= 0);
    if (!slot) slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (len < 0.3) return;
    const b = slot;
    b.from.set(from.x, from.y, from.z);
    b.to.set(to.x, to.y, to.z);
    b.travel = clamp(len / 900, 0.025, 0.085);
    b.tail = clamp(22 / Math.max(1, len), 0.06, 0.85);
    b.maxLife = b.travel + life;
    b.life = b.maxLife;
    const u = b.mat.uniforms;
    (u.uStart.value as THREE.Vector3).copy(b.from);
    (u.uEnd.value as THREE.Vector3).copy(b.to);
    u.uWidth.value = width;
    u.uTail.value = b.tail;
    u.uProgress.value = 0;
    u.uOpacity.value = 1;
    (u.uColor.value as THREE.Color).setHex(color);
    b.mesh.visible = true;
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const elapsed = b.maxLife - b.life;
      const u = b.mat.uniforms;
      // The bolt crosses in `travel`, then the ribbon fades where it stopped.
      u.uProgress.value = clamp(elapsed / b.travel, 0, 1);
      const after = elapsed - b.travel;
      u.uOpacity.value = after <= 0 ? 1 : clamp(1 - after / Math.max(0.02, b.maxLife - b.travel), 0, 1);
      u.uTime.value = this.time;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }
}

// ── Shockwave rings ────────────────────────────────────────────────────────

const WAVE_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WAVE_FRAG = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSeed;
uniform float uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  // Turbulence running around the ring: a shock front is air, not a hoop, and
  // the noise is what stops these reading as decals laid on the screen.
  float n = noise(vec2(ang * 2.6 + uSeed, r * 5.0 - uTime * 2.4)) * 0.6
          + noise(vec2(ang * 7.0 - uSeed, r * 11.0 + uTime * 1.3)) * 0.4;
  float band = smoothstep(0.55, 0.98, r + n * 0.16);
  // Hot leading edge, cool wake.
  float edge = smoothstep(0.9, 1.0, r + n * 0.05);
  float a = (band * (0.35 + n * 0.9) + edge * 0.8) * uOpacity;
  vec3 col = mix(uColor, vec3(1.0), edge * 0.55);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  life: number;
  max: number;
  scale: number;
}

export class Shockwaves {
  readonly group = new THREE.Group();
  private pool: Wave[] = [];
  private time = 0;

  constructor(count = 8) {
    const geo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xffffff) },
          uOpacity: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uTime: { value: 0 },
        },
        vertexShader: WAVE_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.pool.push({ mesh, mat, life: 0, max: 1, scale: 1 });
    }
  }

  spawn(at: Vec3, color: number, scale = 6, life = 0.5, tilt = 0): void {
    let slot = this.pool.find((w) => w.life <= 0);
    if (!slot) slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    slot.mesh.position.set(at.x, at.y, at.z);
    slot.mesh.rotation.set(Math.PI / 2 + tilt, 0, 0);
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.mat.uniforms.uSeed.value = Math.random() * 10;
    slot.mesh.visible = true;
    slot.life = life;
    slot.max = life;
    slot.scale = scale;
  }

  /** Orient a ring along an arbitrary axis (used for shot-aligned plates). */
  spawnAligned(at: Vec3, color: number, scale: number, life: number, normal: Vec3): void {
    let slot = this.pool.find((w) => w.life <= 0);
    if (!slot) slot = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    slot.mesh.position.set(at.x, at.y, at.z);
    slot.mesh.lookAt(at.x + normal.x, at.y + normal.y, at.z + normal.z);
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.mat.uniforms.uSeed.value = Math.random() * 10;
    slot.mesh.visible = true;
    slot.life = life;
    slot.max = life;
    slot.scale = scale;
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.pool) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const t = 1 - Math.max(0, w.life / w.max);
      const s = w.scale * (0.25 + t * 1.6);
      w.mesh.scale.set(s, s, s);
      w.mat.uniforms.uOpacity.value = (1 - t) * 0.85;
      w.mat.uniforms.uTime.value = this.time;
      if (w.life <= 0) w.mesh.visible = false;
    }
  }
}
