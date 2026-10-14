import * as THREE from 'three';
import { PLAYER, WEAPONS, SCYTHE, type WeaponId } from '../game/config';
import type { Game, Actor, GameEvent } from '../game/game';
import type { ArenaBox } from '../game/map';

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

function makeFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2c3138';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#3a4048';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  // subtle noise for grit
  for (let i = 0; i < 600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Vertical sky gradient: deep blue zenith fading to a warm horizon glow. */
function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0f1c33');
  grad.addColorStop(0.5, '#2d4a6e');
  grad.addColorStop(0.82, '#c98f6a');
  grad.addColorStop(1, '#3a3430');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mat(color: number, rough = 0.7, metal = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly weapons: Record<WeaponId | 'scythe', THREE.Group>;
  private readonly botRoot = new THREE.Group();
  private readonly botLimbs: { arm: THREE.Object3D; gun: THREE.Object3D };
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private eyeY = PLAYER.eyeStand;
  private recoil = 0;
  private swingT = -1;
  private dashPose = 0;
  private walkT = 0;
  private hitFlash = 0;
  private bobT = 0;
  private primary: WeaponId = 'ak';
  private secondary: WeaponId = 'pistol';
  private muzzleT = 0;
  private readonly muzzle: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x1a2230);
    this.scene.fog = new THREE.Fog(0x1a2230, 40, 120);

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 300);
    this.scene.add(this.camera);

    this.setupLights();
    this.weapons = {
      pistol: this.buildPistol(),
      smg: this.buildSmg(),
      rifle: this.buildRifle(),
      ak: this.buildAk(),
      puma: this.buildPanther(),
      scythe: this.buildScythe(),
    };
    for (const k of Object.keys(this.weapons) as (WeaponId | 'scythe')[]) {
      this.weapons[k].visible = false;
      this.camera.add(this.weapons[k]);
    }
    this.muzzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.22, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.muzzle.rotation.x = -Math.PI / 2;
    this.muzzle.visible = false;
    this.camera.add(this.muzzle);
    this.botLimbs = this.buildBot();
    this.scene.add(this.botRoot);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0x9fb4d6, 0x2a2420, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.1);
    sun.position.set(-18, 34, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  buildArena(boxes: readonly ArenaBox[]): void {
    const floorTex = makeFloorTexture();
    for (const b of boxes) {
      const w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      const d = b.max.z - b.min.z;
      const geo = new THREE.BoxGeometry(w, h, d);
      let m: THREE.Material;
      if (b.kind === 'floor') {
        m = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0 });
      } else {
        m = mat(b.color, b.kind === 'wall' ? 0.85 : 0.6, b.kind === 'pillar' ? 0.3 : 0.1);
      }
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      mesh.castShadow = b.kind !== 'floor';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (b.kind !== 'floor' && b.max.y > 0.6) {
        // Edge trim for readability.
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x0b0e12, transparent: true, opacity: 0.35 }),
        );
        edge.position.copy(mesh.position);
        this.scene.add(edge);
      }
    }
    // Sky dome gradient
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(200, 32, 16),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
    );
    this.scene.add(sky);
  }

  private buildBot(): { arm: THREE.Object3D; gun: THREE.Object3D } {
    const body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), mat(0x9b3b3b, 0.6));
    torso.position.y = 1.1;
    torso.castShadow = true;
    body.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat(0xd8b79a, 0.7));
    head.position.y = 1.7;
    head.castShadow = true;
    body.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), mat(0x1c2a3a, 0.2, 0.4));
    visor.position.set(0, 1.72, -0.18);
    body.add(visor);
    for (const sx of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.24), mat(0x2d2f38, 0.8));
      leg.position.set(sx, 0.35, 0);
      leg.castShadow = true;
      body.add(leg);
    }
    const arm = new THREE.Group();
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), mat(0x9b3b3b, 0.6));
    armMesh.position.y = -0.3;
    arm.add(armMesh);
    arm.position.set(0.4, 1.4, -0.1);
    arm.rotation.x = -Math.PI / 2;
    body.add(arm);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.7), mat(0x222222, 0.4, 0.6));
    gun.position.set(0, -0.1, -0.4);
    arm.add(gun);
    body.traverse(o => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.botRoot.add(body);
    return { arm, gun };
  }

  private gunMat(): THREE.MeshStandardMaterial {
    return mat(0x1e2228, 0.35, 0.7);
  }

  private accentMat(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x3dd5ff, emissive: 0x1a8fbf, emissiveIntensity: 0.6, roughness: 0.3 });
  }

  private buildPistol(): THREE.Group {
    const g = new THREE.Group();
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), this.gunMat());
    slide.position.set(0, 0, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.07), this.gunMat());
    grip.position.set(0, -0.1, 0.08);
    grip.rotation.x = 0.2;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.02), this.accentMat());
    sight.position.set(0, 0.045, -0.13);
    g.add(slide, grip, sight);
    g.position.set(0.28, -0.24, -0.45);
    return g;
  }

  private buildSmg(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.46), this.gunMat());
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.06), this.gunMat());
    mag.position.set(0, -0.14, 0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.18), this.gunMat());
    stock.position.set(0, 0.0, 0.3);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.4), this.accentMat());
    rail.position.set(0, 0.07, -0.02);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), this.gunMat());
    barrel.position.set(0, 0, -0.33);
    g.add(body, mag, stock, rail, barrel);
    g.position.set(0.3, -0.27, -0.5);
    return g;
  }

  private buildRifle(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.62), this.gunMat());
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.36), this.gunMat());
    barrel.position.set(0, 0.01, -0.46);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.22), this.accentMat());
    scope.position.set(0, 0.1, -0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.24), this.gunMat());
    stock.position.set(0, -0.02, 0.4);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), this.gunMat());
    mag.position.set(0, -0.14, -0.05);
    g.add(body, barrel, scope, stock, mag);
    g.position.set(0.3, -0.27, -0.6);
    return g;
  }

  /** Curved scythe blade built from an extruded arc, with a long handle. */
  private buildScythe(): THREE.Group {
    const g = new THREE.Group();
    const handleMat = mat(0x3b2a1e, 0.7);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.25, 8), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0, -0.35);
    const shape = new THREE.Shape();
    const R = 0.55;
    const steps = 24;
    shape.moveTo(0, 0);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2.4);
      shape.lineTo(Math.sin(a) * R, Math.cos(a) * R - R);
    }
    for (let i = steps; i >= 0; i--) {
      const a = (i / steps) * (Math.PI / 2.4);
      shape.lineTo(Math.sin(a) * (R - 0.05), Math.cos(a) * (R - 0.05) - R);
    }
    shape.closePath();
    const blade = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.25, metalness: 0.85 }),
    );
    blade.position.set(0, 0, -0.95);
    blade.rotation.set(0, 0, 0);
    g.add(handle, blade);
    g.position.set(0.3, -0.3, -0.45);
    g.rotation.set(0.1, -0.15, 0.25);
    return g;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sets which weapon models are shown in the primary and secondary slots. */
  setLoadout(primary: WeaponId, secondary: WeaponId): void {
    this.primary = primary;
    this.secondary = secondary;
  }

  /** BRUTE-47 viewmodel: wooden furniture, curved mag, gold accent. */
  private buildAk(): THREE.Group {
    const g = new THREE.Group();
    const wood = mat(0x6b4a2b, 0.75);
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.9, roughness: 0.3 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.5), this.gunMat());
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8), this.gunMat());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.46);
    const furniture = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.22), wood);
    furniture.position.set(0, -0.01, -0.36);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.3), wood);
    stock.position.set(0, -0.02, 0.36);
    stock.rotation.x = -0.06;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.1), this.gunMat());
    mag.position.set(0, -0.17, -0.08);
    mag.rotation.x = 0.22;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), gold);
    sight.position.set(0, 0.085, -0.6);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), this.gunMat());
    rear.position.set(0, 0.09, 0.12);
    g.add(receiver, barrel, furniture, stock, mag, sight, rear);
    g.position.set(0.3, -0.27, -0.6);
    return g;
  }

  /** PANTHER viewmodel: compact run-and-gun body, cyan glow strips, long mag. */
  private buildPanther(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.34), this.gunMat());
    const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.3), this.accentMat());
    glowL.position.set(-0.045, 0.02, 0);
    const glowR = glowL.clone();
    glowR.position.x = 0.045;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.07), this.gunMat());
    mag.position.set(0, -0.17, 0.02);
    mag.rotation.x = -0.12;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), this.gunMat());
    barrel.position.set(0, 0.01, -0.25);
    const comp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), this.accentMat());
    comp.position.set(0, 0.01, -0.34);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.06), this.gunMat());
    grip.position.set(0, -0.11, 0.1);
    grip.rotation.x = 0.25;
    g.add(body, glowL, glowR, mag, barrel, comp, grip);
    g.position.set(0.28, -0.25, -0.46);
    return g;
  }

  /** Shows a short muzzle flash at the barrel. */
  private flashMuzzle(): void {
    this.muzzleT = 0.05;
    this.muzzle.visible = true;
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.muzzle.position.set(0.28, -0.22, -0.9);
  }

  triggerSwingVisual(): void {
    this.swingT = 0;
  }

  triggerDashVisual(): void {
    this.dashPose = SCYTHE.dashTime;
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
  }

  private addSparks(at: THREE.Vector3, color: number): void {
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 4), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(at);
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
      this.scene.add(m);
      this.sparks.push({ mesh: m, vel: v, life: 0.35 });
    }
  }

  /** Consumes events for visuals (tracers, sparks, animations). */
  handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'shot') {
        this.addTracer(new THREE.Vector3(e.from.x, e.from.y - 0.15, e.from.z), new THREE.Vector3(e.to.x, e.to.y, e.to.z), e.by === 'player' ? 0xffd27a : 0xff6a6a);
        if (e.hit) this.addSparks(new THREE.Vector3(e.to.x, e.to.y, e.to.z), e.head ? 0xffffff : 0xff4d4d);
        if (e.by === 'player') {
          this.recoil = Math.min(this.recoil + 1, 1);
          this.flashMuzzle();
        }
      } else if (e.type === 'swing') {
        this.triggerSwingVisual();
      } else if (e.type === 'dash') {
        this.triggerDashVisual();
      } else if (e.type === 'hit' && e.target === 'player') {
        this.hitFlash = 0.25;
      } else if (e.type === 'hit' && e.target === 'bot') {
        this.addSparks(new THREE.Vector3(e.at.x, e.at.y, e.at.z), 0xff4d4d);
      }
    }
  }

  /** Updates scene meshes and camera from the game state. */
  render(game: Game, dt: number): void {
    const p = game.player;
    const b = game.bot;
    this.updateCamera(p, dt);
    this.updateBot(b, dt);
    this.updateViewmodel(p, dt);
    this.updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(p: Actor, dt: number): void {
    const target = p.move.height === PLAYER.slideHeight ? PLAYER.eyeSlide : PLAYER.eyeStand;
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * 12);
    const bob = Math.sin(this.bobT) * 0.035 * Math.min(1, Math.hypot(p.move.vel.x, p.move.vel.z) / 7);
    this.bobT += dt * Math.hypot(p.move.vel.x, p.move.vel.z) * 1.2;
    const flash = this.hitFlash;
    this.hitFlash = Math.max(0, flash - dt);
    this.camera.position.set(p.move.pos.x, p.move.pos.y + this.eyeY + bob, p.move.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(p.pitch + this.recoil * 0.02, p.yaw, 0);
    this.camera.fov = 78 + (p.scythe.dashTimer > 0 ? 6 : 0);
    this.camera.updateProjectionMatrix();
    this.recoil = Math.max(0, this.recoil - dt * 6);
  }

  private updateBot(b: Actor, dt: number): void {
    this.botRoot.visible = b.alive;
    this.botRoot.position.set(b.move.pos.x, b.move.pos.y, b.move.pos.z);
    this.botRoot.rotation.y = b.yaw;
    const speed = Math.hypot(b.move.vel.x, b.move.vel.z);
    this.walkT += dt * speed * 1.6;
    const sway = Math.sin(this.walkT) * 0.25 * Math.min(1, speed / 6);
    // Slide pose: squash the figure.
    const squash = b.move.height === PLAYER.slideHeight ? 0.55 : 1;
    this.botRoot.scale.set(1, squash, 1);
    this.botLimbs.arm.rotation.x = -Math.PI / 2 + sway * 0.2;
    this.botLimbs.gun.visible = b.slot !== 3;
  }

  private updateViewmodel(p: Actor, dt: number): void {
    const showSlot = p.slot;
    const wepKey: WeaponId | 'scythe' = showSlot === 3 ? 'scythe' : showSlot === 1 ? this.secondary : this.primary;
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.visible = false;
    }
    for (const k of Object.keys(this.weapons) as (WeaponId | 'scythe')[]) {
      this.weapons[k].visible = k === wepKey && p.alive;
    }
    const sway = Math.sin(this.bobT * 0.5) * 0.008;
    const base = wepKey === 'scythe' ? new THREE.Vector3(0.3, -0.3, -0.45) : new THREE.Vector3(0.28, -0.25, -0.5);
    const g = this.weapons[wepKey];
    const kick = this.recoil * (wepKey === 'rifle' ? 0.05 : 0.03);
    g.position.set(base.x + sway, base.y - kick * 0.6, base.z + kick);
    if (wepKey === 'scythe') {
      if (this.swingT >= 0) {
        this.swingT += dt;
        const t = Math.min(1, this.swingT / SCYTHE.swingTime);
        g.rotation.set(0.1 - t * 0.9, -0.15 + Math.sin(t * Math.PI) * 1.2 - t * 0.6, 0.25 - Math.sin(t * Math.PI) * 0.5);
        if (t >= 1) this.swingT = -1;
      } else {
        g.rotation.set(0.1, -0.15, 0.25);
      }
      if (this.dashPose > 0) {
        this.dashPose -= dt;
        g.position.z -= 0.12;
        g.rotation.x -= 0.25;
      }
    } else {
      g.rotation.set(0, 0, 0);
    }
  }

  private updateEffects(dt: number): void {
    this.tracers = this.tracers.filter(t => {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.08) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        return false;
      }
      return true;
    });
    this.sparks = this.sparks.filter(s => {
      s.life -= dt;
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  /** Display name of a weapon, for HUD use. */
  static weaponLabel(id: WeaponId): string {
    return WEAPONS[id].name;
  }

  get hitFlashAmount(): number {
    return this.hitFlash;
  }
}
