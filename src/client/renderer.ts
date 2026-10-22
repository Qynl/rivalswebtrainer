/**
 * Three.js view.
 *
 * Everything is procedural: boxes, lines, sprites built from a gradient drawn
 * into a canvas at runtime. No textures, no models, no post-processing stack —
 * glow is faked with additive materials and emissive edges, which is what keeps
 * this comfortably 60 fps on an integrated GPU.
 *
 * The camera is driven directly by the simulated yaw/pitch so the crosshair is
 * always exactly the bullet ray. FOV, roll and shake are cosmetic only.
 */

import * as THREE from 'three';
import type { Arena } from '../shared/arena.ts';
import { PLAYER, SKINS, WEAPON } from '../shared/constants.ts';
import { clamp, lerp, smoothstep, type Vec3 } from '../shared/mathx.ts';
import type { PlayerState } from '../shared/sim.ts';

export interface RemoteView {
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  sliding: boolean;
  scoped: boolean;
  glint: number;
  speed: number;
  grapple: { active: boolean; mode: 'none' | 'swing' | 'zip'; anchor: Vec3; length: number; target: 0 | 1 };
}

export interface RopeView {
  active: boolean;
  anchor: Vec3;
  length: number;
  mode: 'none' | 'swing' | 'zip';
}

export interface FrameView {
  local: PlayerState;
  /** Interpolated camera eye (the sim is 60 Hz; the display may not be). */
  eye?: Vec3;
  localRope: RopeView;
  remote: RemoteView;
  remoteRope: RopeView;
  ringRadius: number;
  ringActive: boolean;
  scoped: number;
  glintVisible: boolean;
  glintIntensity: number;
  killcam: { t: number; killerPos: Vec3; victimPos: Vec3 } | null;
  reducedFx: boolean;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Spark {
  sprite: THREE.Sprite;
  life: number;
  vel: THREE.Vector3;
}

const COL = {
  deck: 0x101a2e,
  wall: 0x161226,
  strut: 0x0b1020,
  beacon: 0x0a2233,
  edgeCyan: 0x3ff6ff,
  edgeMagenta: 0xff3f86,
  ring: 0xff2d6a,
  white: 0xffffff,
};

function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.28, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private arena: Arena;
  private glow: THREE.Texture;

  private players: THREE.Group[] = [];
  private glints: THREE.Sprite[] = [];
  private ropes: { line: THREE.Line; geo: THREE.BufferGeometry; color: number }[] = [];
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private anchorPulse: THREE.InstancedMesh | null = null;
  private ringGroup = new THREE.Group();
  private ringWall: THREE.Mesh = new THREE.Mesh();
  private ringLines: THREE.Line[] = [];
  private viewmodel: THREE.Group;
  private viewmodelSkin = -1;
  private muzzle: THREE.Sprite;
  private weaponRecoil = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private shakeAmt = 0;
  private roll = 0;
  private fov: number = WEAPON.baseFov;
  private time = 0;
  private ambientPulse = 0;

  constructor(canvas: HTMLCanvasElement, arena: Arena) {
    this.arena = arena;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 1.6,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x04060c, 1);

    this.scene.fog = new THREE.FogExp2(0x05070f, 0.0028);
    this.camera = new THREE.PerspectiveCamera(WEAPON.baseFov, 16 / 9, 0.06, 900);
    this.glow = glowTexture();

    this.buildLights();
    this.buildArena();
    this.buildPlayers();
    this.buildRing();
    this.viewmodel = this.buildViewmodel(0);
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this.muzzle = this.makeSprite(0xfff2b0, 1.1);
    this.muzzle.visible = false;
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, -1.35);

    this.resize();
  }

  // ── Static scene ─────────────────────────────────────────────────────────
  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x2a3b66, 1.1));
    const hemi = new THREE.HemisphereLight(0x6fe8ff, 0x2a0a1f, 0.9);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xbfe9ff, 1.15);
    key.position.set(30, 120, 20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3f86, 0.6);
    rim.position.set(-60, 40, -80);
    this.scene.add(rim);
  }

  private buildArena(): void {
    const groups: Record<string, THREE.BufferGeometry[]> = { deck: [], wall: [], strut: [], beacon: [] };
    for (const b of this.arena.blocks) {
      const g = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
      g.translate(b.x, b.y, b.z);
      groups[b.kind].push(g);
    }
    const mats: Record<string, THREE.MeshStandardMaterial> = {
      deck: new THREE.MeshStandardMaterial({ color: COL.deck, roughness: 0.72, metalness: 0.35, emissive: 0x0a1730, emissiveIntensity: 0.8 }),
      wall: new THREE.MeshStandardMaterial({ color: COL.wall, roughness: 0.65, metalness: 0.4, emissive: 0x1a0a22, emissiveIntensity: 0.9 }),
      strut: new THREE.MeshStandardMaterial({ color: COL.strut, roughness: 0.85, metalness: 0.5, emissive: 0x061120, emissiveIntensity: 0.7 }),
      beacon: new THREE.MeshStandardMaterial({ color: COL.beacon, roughness: 0.3, metalness: 0.2, emissive: 0x1f7f9a, emissiveIntensity: 1.5 }),
    };
    for (const kind of Object.keys(groups)) {
      if (!groups[kind].length) continue;
      const merged = mergeGeometries(groups[kind]);
      this.scene.add(new THREE.Mesh(merged, mats[kind]));
    }

    // One edge buffer for the entire arena: the low-poly neon look.
    const edgePositions: number[] = [];
    const edgeColors: number[] = [];
    const c = new THREE.Color();
    for (const b of this.arena.blocks) {
      const x0 = b.x - b.hx, x1 = b.x + b.hx;
      const y0 = b.y - b.hy, y1 = b.y + b.hy;
      const z0 = b.z - b.hz, z1 = b.z + b.hz;
      const corners = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      c.setHex(b.kind === 'wall' ? 0xff3f86 : b.kind === 'beacon' ? 0x9dfaff : 0x3ff6ff);
      for (const [i, j] of edges) {
        edgePositions.push(...corners[i], ...corners[j]);
        edgeColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    eg.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
    const edges = new THREE.LineSegments(
      eg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.scene.add(edges);

    // Neon trim along every deck rim: reads as architecture, costs one draw call.
    const trims: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind === 'strut') continue;
      const y = b.y + b.hy + 0.06;
      const specs: [number, number, number, number, number, number][] = [
        [b.x, y, b.z - b.hz, b.hx * 2, 0.1, 0.1],
        [b.x, y, b.z + b.hz, b.hx * 2, 0.1, 0.1],
        [b.x - b.hx, y, b.z, 0.1, 0.1, b.hz * 2],
        [b.x + b.hx, y, b.z, 0.1, 0.1, b.hz * 2],
      ];
      for (const s of specs) {
        const m = new THREE.Matrix4();
        m.compose(new THREE.Vector3(s[0], s[1], s[2]), new THREE.Quaternion(), new THREE.Vector3(s[3], s[4], s[5]));
        trims.push(m);
      }
    }
    if (trims.length) {
      const trimMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x54f7ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
        trims.length,
      );
      trims.forEach((m, i) => trimMesh.setMatrixAt(i, m));
      trimMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(trimMesh);
    }

    // Anchor pinions.
    const anchorGeo = new THREE.OctahedronGeometry(0.55, 0);
    const anchorMat = new THREE.MeshBasicMaterial({ color: 0x9df9ff, transparent: true, opacity: 0.9 });
    this.anchorPulse = new THREE.InstancedMesh(anchorGeo, anchorMat, this.arena.anchors.length);
    const haloMat = new THREE.SpriteMaterial({ map: this.glow, color: 0x39f6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.arena.anchors.forEach((a, i) => {
      const m = new THREE.Matrix4().makeTranslation(a.x, a.y, a.z);
      this.anchorPulse!.setMatrixAt(i, m);
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(a.x, a.y, a.z);
      halo.scale.setScalar(3.2);
      this.scene.add(halo);
    });
    this.anchorPulse.instanceMatrix.needsUpdate = true;
    this.scene.add(this.anchorPulse);

    // Void dust: a cheap depth cue for the drop.
    const dustGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const r = 60 + Math.random() * 240;
      const a = Math.random() * Math.PI * 2;
      positions.push(Math.cos(a) * r, -60 + Math.random() * 190, Math.sin(a) * r);
    }
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x4fa8d8, size: 0.6, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false }),
    );
    this.scene.add(dust);

    // A soft glow under the spire to anchor the composition.
    const base = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0x1c6cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    base.position.set(0, -6, 0);
    base.scale.setScalar(120);
    this.scene.add(base);
  }

  private buildPlayers(): void {
    for (let i = 0; i < 2; i++) {
      const skin = SKINS[i];
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color: skin.color,
        emissive: new THREE.Color(skin.color),
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.6,
      });
      const dark = new THREE.MeshStandardMaterial({ color: 0x0c1222, roughness: 0.6, metalness: 0.7 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.halfHeight * 2, 4, 10), bodyMat);
      body.position.y = 0;
      g.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), dark);
      head.position.set(0, 0.66, 0);
      g.add(head);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: skin.color }));
      visor.position.set(0, 0.7, -0.17);
      g.add(visor);
      const rifle = new THREE.Group();
      rifle.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.95), dark));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.55), new THREE.MeshBasicMaterial({ color: skin.color }));
      barrel.position.z = -0.7;
      rifle.add(barrel);
      rifle.position.set(0.26, 0.16, -0.35);
      g.add(rifle);
      const feet = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: skin.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      feet.position.y = -0.85;
      feet.scale.setScalar(1.4);
      g.add(feet);
      const glint = this.makeSprite(0xfff8d0, 1.8);
      glint.position.set(0, 0.7, -0.3);
      glint.visible = false;
      g.add(glint);
      this.glints.push(glint);
      this.players.push(g);
      this.scene.add(g);
    }
  }

  private buildRing(): void {
    const wallGeo = new THREE.CylinderGeometry(1, 1, 190, 96, 1, true);
    wallGeo.translate(0, 40, 0);
    this.ringWall = new THREE.Mesh(
      wallGeo,
      new THREE.MeshBasicMaterial({ color: COL.ring, transparent: true, opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ringGroup.add(this.ringWall);
    for (const y of [-24, 40, 104]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), y, Math.sin(a)));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COL.ring, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.ringLines.push(line);
      this.ringGroup.add(line);
    }
    this.ringGroup.visible = false;
    this.scene.add(this.ringGroup);

    for (let i = 0; i < 20; i++) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0x9df9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    const sparkTex = this.glow;
    for (let i = 0; i < 22; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.visible = false;
      this.scene.add(sprite);
      this.sparks.push({ sprite, life: 0, vel: new THREE.Vector3() });
    }
  }

  private makeSprite(color: number, scale: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.scale.setScalar(scale);
    return s;
  }

  private buildViewmodel(skinIndex: number): THREE.Group {
    const skin = SKINS[skinIndex];
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b111f, roughness: 0.45, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: skin.color, emissive: new THREE.Color(skin.color), emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.5 });
    if (skin.weapon === 'lance') {
      // Long angular anti-materiel silhouette.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 1.0), dark);
      body.position.z = -0.55;
      g.add(body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), accent);
      barrel.position.set(0, 0.01, -1.3);
      g.add(barrel);
      const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14), dark);
      muzzleBrake.position.set(0, 0.01, -1.72);
      g.add(muzzleBrake);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.13, -0.5);
      g.add(scope);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.34), dark);
      stock.position.set(0, -0.02, 0.12);
      g.add(stock);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.5), accent);
      trim.position.set(0, 0.08, -0.6);
      g.add(trim);
    } else {
      // Needle: thin, long, ringed.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.8), dark);
      body.position.z = -0.5;
      g.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.1, 6), accent);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -1.25);
      g.add(barrel);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12), accent);
      ring.position.set(0, 0.02, -0.95);
      g.add(ring);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 8), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.11, -0.42);
      g.add(scope);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.32), dark);
      stock.position.set(0, -0.01, 0.1);
      g.add(stock);
    }
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), dark);
    hand.position.set(0, -0.1, -0.32);
    g.add(hand);
    g.position.set(0.24, -0.22, -0.12);
    g.rotation.y = -0.045;
    g.visible = false;
    this.viewmodelSkin = skinIndex;
    return g;
  }

  setSkin(index: 0 | 1): void {
    if (this.viewmodelSkin === index) return;
    this.camera.remove(this.viewmodel);
    this.viewmodel = this.buildViewmodel(index);
    this.camera.add(this.viewmodel);
    this.muzzle = this.makeSprite(0xfff2b0, 1.1);
    this.muzzle.position.set(0, 0.02, -1.85);
    this.viewmodel.add(this.muzzle);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Feedback hooks ───────────────────────────────────────────────────────
  shake(amount: number): void {
    this.shakeAmt = Math.min(0.06, this.shakeAmt + amount);
  }

  punch(pitch: number, yaw = 0): void {
    this.punchPitch += pitch;
    this.punchYaw += yaw;
  }

  recoil(): void {
    this.weaponRecoil = 1;
    this.muzzle.visible = true;
    this.muzzle.scale.setScalar(1.6);
  }

  tracer(from: Vec3, to: Vec3, color: number): void {
    let slot = this.tracers.find((t) => t.life <= 0);
    if (!slot) slot = this.tracers.reduce((a, b) => (a.life < b.life ? a : b));
    const attr = slot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    slot.line.geometry.computeBoundingSphere();
    (slot.line.material as THREE.LineBasicMaterial).color.setHex(color);
    (slot.line.material as THREE.LineBasicMaterial).opacity = 1;
    slot.life = 0.55;
  }

  spark(pos: Vec3, color: number, count = 5): void {
    let spawned = 0;
    for (const s of this.sparks) {
      if (s.life > 0) continue;
      s.sprite.position.set(pos.x, pos.y, pos.z);
      s.sprite.visible = true;
      s.sprite.scale.setScalar(0.5 + Math.random() * 0.5);
      s.vel.set((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8);
      s.life = 0.35 + Math.random() * 0.25;
      (s.sprite.material as THREE.SpriteMaterial).color.setHex(color);
      if (++spawned >= count) break;
    }
  }

  muzzleFlash(): void {
    this.muzzle.scale.setScalar(1.8);
    this.muzzle.material.opacity = 1;
    this.muzzle.visible = true;
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  update(dt: number, view: FrameView): void {
    this.time += dt;
    const local = view.local;
    const remote = view.remote;

    // Camera: yaw/pitch straight from the sim, then cosmetic offsets.
    this.punchPitch *= Math.exp(-dt * 7);
    this.punchYaw *= Math.exp(-dt * 7);
    const yaw = local.yaw + this.punchYaw;
    const pitch = clamp(local.pitch + this.punchPitch, -1.5, 1.5);
    const eye = view.eye ?? local.eye;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch);

    const lateral = local.vel.x * Math.cos(local.yaw) - local.vel.z * Math.sin(local.yaw);
    const swingRoll = local.grapple.active && local.grapple.mode === 'swing' ? -lateral * 0.0016 : 0;
    const strafeRoll = -lateral * 0.0012;
    const targetRoll = clamp(swingRoll + strafeRoll, -0.12, 0.12) * (1 - local.scopeT);
    this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-dt * 8));
    this.camera.rotateZ(this.roll);

    this.shakeAmt *= Math.exp(-dt * 9);
    if (this.shakeAmt > 0.0004) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.rotateZ((Math.random() - 0.5) * this.shakeAmt * 0.6);
    }

    // FOV: speed is the single strongest "feels fast" cue.
    const speedT = clamp(local.speed / 46, 0, 1);
    const hipFov = WEAPON.baseFov + speedT * WEAPON.maxFovKick;
    const targetFov = lerp(hipFov, WEAPON.scopedFov, smoothstep(0.25, 1, local.scopeT));
    this.fov = lerp(this.fov, targetFov, 1 - Math.exp(-dt * 9));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Local player body is visible only when the camera is not in their head.
    for (let i = 0; i < 2; i++) {
      const isLocal = i === local.id;
      const state = isLocal ? local : remote;
      const group = this.players[i];
      // First person hides your own body; the kill cam reveals it.
      group.visible = isLocal ? !!view.killcam : true;
      const pos = isLocal ? local.pos : remote.pos;
      group.position.set(pos.x, pos.y, pos.z);
      group.rotation.y = (isLocal ? local.yaw : remote.yaw) + Math.PI;
      const g = isLocal ? view.localRope : view.remoteRope;
      group.rotation.z = state.sliding ? 0.55 : 0;
      // Lean into swings for physicality.
      if (g.active) group.rotation.x = clamp((isLocal ? local.vel.y : remote.speed) * 0.006, -0.25, 0.25);
      else group.rotation.x = 0;
      group.visible = group.visible && (isLocal ? local.alive || !!view.killcam : remote.alive);

      const glint = this.glints[i];
      const isRemote = !isLocal;
      const intensity = isRemote ? remote.glint * (view.glintVisible ? 1 : 0) : local.glint;
      glint.visible = intensity > 0.02 && (isRemote ? remote.alive : local.alive);
      if (glint.visible) {
        glint.material.opacity = Math.min(1, intensity) * 0.95;
        const s = 0.9 + intensity * 1.6 + Math.sin(this.time * 9) * 0.06;
        glint.scale.setScalar(s);
        glint.position.set(0, 0.72, -0.34);
      }
    }

    this.drawRope(0, local.eye, local.grapple.active && local.grapple.mode !== 'none' ? view.localRope : null, SKINS[local.id].color);
    this.drawRope(1, { x: remote.pos.x, y: remote.pos.y + 0.35, z: remote.pos.z }, remote.grapple.active ? view.remoteRope : null, SKINS[1 - local.id].color);

    this.updateRing(view.ringRadius, view.ringActive);

    // Tracers and sparks.
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const mat = t.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, t.life / 0.55);
      if (t.life <= 0) mat.opacity = 0;
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.sprite.position.addScaledVector(s.vel, dt);
      s.vel.y -= 14 * dt;
      const mat = s.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, s.life * 2.4);
      if (s.life <= 0) s.sprite.visible = false;
    }

    // First-person weapon.
    const scopedNow = local.scopeT > 0.72;
    this.viewmodel.visible = !scopedNow && !view.killcam && local.alive;
    this.weaponRecoil *= Math.exp(-dt * 10);
    const bobSpeed = local.grounded ? local.speed : 0;
    const bob = Math.sin(this.time * 9) * 0.006 * Math.min(1, bobSpeed / 8);
    this.viewmodel.position.set(0.24 + Math.sin(this.time * 4.2) * 0.004, -0.22 + bob - this.weaponRecoil * 0.02, -0.12 + this.weaponRecoil * 0.16);
    this.viewmodel.rotation.set(this.weaponRecoil * 0.22, -0.045 + Math.cos(this.time * 4.2) * 0.003, this.weaponRecoil * 0.05);
    if (this.muzzle.visible) {
      this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - dt * 7);
      if (this.muzzle.material.opacity <= 0.01) this.muzzle.visible = false;
    }

    // Kill cam: frame the killer from the victim's death point.
    if (view.killcam) {
      const k = view.killcam;
      const victim = k.victimPos;
      const killer = k.killerPos;
      const dir = new THREE.Vector3(killer.x - victim.x, killer.y - victim.y, killer.z - victim.z);
      const dist = Math.max(6, dir.length());
      dir.normalize();
      const t = Math.min(1, k.t / 0.9);
      const e = 1 - Math.pow(1 - t, 3);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const camPos = new THREE.Vector3(
        victim.x - dir.x * dist * 0.55 + side.x * dist * 0.28,
        victim.y + 2.4 + (1 - e) * 4,
        victim.z - dir.z * dist * 0.55 + side.z * dist * 0.28,
      );
      this.camera.position.copy(camPos);
      this.camera.lookAt(killer.x, killer.y, killer.z);
      this.camera.fov = lerp(this.camera.fov, 62, 1 - Math.exp(-dt * 6));
      this.camera.updateProjectionMatrix();
    }

    // Anchor pulse is cheap and makes the pinions read as interactive.
    this.ambientPulse += dt;
    if (this.anchorPulse) {
      const mat = this.anchorPulse.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.65 + Math.sin(this.ambientPulse * 2.2) * 0.2;
    }
  }

  private drawRope(index: number, from: Vec3, rope: RopeView | null, color: number): void {
    const entry = this.ropes[index] ?? (() => {
      const geo = new THREE.BufferGeometry();
      const pts = new Float32Array(16 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false;
      this.scene.add(line);
      const made = { line, geo, color };
      this.ropes[index] = made;
      return made;
    })();
    if (!rope || !rope.active) {
      entry.line.visible = false;
      return;
    }
    entry.line.visible = true;
    (entry.line.material as THREE.LineBasicMaterial).color.setHex(color);
    const attr = entry.geo.getAttribute('position') as THREE.BufferAttribute;
    const ax = rope.anchor.x, ay = rope.anchor.y, az = rope.anchor.z;
    const dist = Math.hypot(ax - from.x, ay - from.y, az - from.z);
    const slack = clamp((rope.length - dist) / 8, 0, 1.4);
    const segs = 15;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const sag = Math.sin(Math.PI * t) * slack * 1.6;
      attr.setXYZ(
        i,
        from.x + (ax - from.x) * t,
        from.y + (ay - from.y) * t - sag,
        from.z + (az - from.z) * t,
      );
    }
    attr.needsUpdate = true;
    entry.geo.computeBoundingSphere();
  }

  private updateRing(radius: number, active: boolean): void {
    this.ringGroup.visible = active;
    if (!active) return;
    this.ringGroup.position.set(0, 0, 0);
    this.ringWall.scale.set(radius, 1, radius);
    for (const l of this.ringLines) l.scale.set(radius, 1, radius);
    const mat = this.ringWall.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.05 + Math.sin(this.time * 2) * 0.012;
  }

  /** Slow establishing shot used behind the menu and the results screen. */
  orbit(dt: number): void {
    this.time += dt;
    const a = this.time * 0.06;
    const r = 132;
    this.camera.position.set(Math.cos(a) * r, 58 + Math.sin(this.time * 0.13) * 8, Math.sin(a) * r);
    this.camera.fov = lerp(this.camera.fov, 58, 1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 42, 0);
    this.ringGroup.visible = false;
    this.viewmodel.visible = false;
    for (const g of this.players) g.visible = false;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  setRingColor(inside: boolean): void {
    const c = inside ? COL.ring : 0xff9a2d;
    for (const l of this.ringLines) (l.material as THREE.LineBasicMaterial).color.setHex(c);
    (this.ringWall.material as THREE.MeshBasicMaterial).color.setHex(c);
  }
}

/** Minimal geometry merge: three's BufferGeometryUtils is an extra import we don't need. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  let vertexCount = 0;
  for (const g of geos) vertexCount += g.getAttribute('position').count;
  for (const name of attrs) {
    const itemSize = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(vertexCount * itemSize);
    let off = 0;
    for (const g of geos) {
      const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      arr.set(a.array as Float32Array, off);
      off += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  const indices: number[] = [];
  let base = 0;
  for (const g of geos) {
    const idx = g.getIndex();
    const count = g.getAttribute('position').count;
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    } else {
      for (let i = 0; i < count; i++) indices.push(i + base);
    }
    base += count;
  }
  out.setIndex(indices);
  out.computeBoundingSphere();
  return out;
}
