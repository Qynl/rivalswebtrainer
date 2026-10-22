/**
 * Three.js view.
 *
 * Art direction: overcast-bright daylight over a concrete ruin in the sky.
 * Surfaces are textured and matte, lighting is a single sun with shadows, and
 * saturated colour is reserved for information — the enemy, the glint, the
 * hazard wall, the rope. No emissive architecture.
 *
 * Everything is procedural: textures are painted into canvases at boot, the
 * arena is merged boxes, and the only "effects" are particles, beams and a
 * three-pass post stack.
 *
 * The camera is driven directly by the simulated yaw/pitch so the crosshair is
 * always exactly the bullet ray. FOV, roll, shake and sway are cosmetic only.
 */

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Arena } from '../shared/arena.ts';
import { SKINS, WEAPON } from '../shared/constants.ts';
import { clamp, lerp, smoothstep, type Vec3 } from '../shared/mathx.ts';
import type { PlayerState } from '../shared/sim.ts';
import { Beams, Particles, Shockwaves } from './particles.ts';
import { PostFX } from './postfx.ts';
import { buildSky } from './sky.ts';
import {
  flareTexture,
  floorTexture,
  glowTexture,
  metalTexture,
  panelTexture,
  signTexture,
} from './textures.ts';

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
  /** Ground height under each player, for contact shadows (null = the void). */
  groundLocal?: number | null;
  groundRemote?: number | null;
  /** 0..1 damage flash. */
  hurt?: number;
}

const COL = {
  deck: 0xffffff,
  wall: 0xffffff,
  strut: 0xffffff,
  beacon: 0xffffff,
  ring: 0xff8a3d,
};

interface PlayerVisual {
  group: THREE.Group;
  torso: THREE.Mesh;
  legs: THREE.Mesh[];
  visor: THREE.Mesh;
  outline: THREE.Mesh;
  jetL: THREE.Sprite;
  jetR: THREE.Sprite;
  shadow: THREE.Mesh;
  glintCore: THREE.Sprite;
  glintFlare: THREE.Sprite;
  color: THREE.Color;
}

/**
 * Box geometry with texel-density-correct UVs.
 *
 * A merged 24 m deck and a 2 m crate must not share a 0..1 UV square, or one of
 * them turns into a smear. Each face is scaled by its real size instead.
 */
function boxGeometry(w: number, h: number, d: number, texelsPerMetre = 0.32): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const scale = texelsPerMetre;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSize: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceSize[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su * scale, uv.getY(i) * sv * scale);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geos) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.index!.count;
  }
  const pos = new Float32Array(vertexCount * 3);
  const norm = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const t = g.getAttribute('uv') as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, vo * 3);
    norm.set(n.array as Float32Array, vo * 3);
    uv.set(t.array as Float32Array, vo * 2);
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo;
    io += idx.count;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private post: PostFX;
  private arena: Arena;
  private glow: THREE.Texture;
  private flare: THREE.Texture;
  private sky: ReturnType<typeof buildSky>;
  private particles = new Particles(1400);
  private beams = new Beams(12);
  private waves = new Shockwaves(8);

  private players: PlayerVisual[] = [];
  private ropes: { line: Line2; geo: LineGeometry; mat: LineMaterial }[] = [];
  private ropeHook: THREE.Mesh[] = [];
  private ringGroup = new THREE.Group();
  private ringWall: THREE.Mesh = new THREE.Mesh();
  private ringLines: THREE.Line[] = [];
  private ringSpokes: THREE.LineSegments = new THREE.LineSegments();
  private anchorInst: THREE.InstancedMesh | null = null;
  private anchorHalos: THREE.Points | null = null;
  private anchorSpin = 0;
  private viewmodel: THREE.Group;
  private viewmodelSkin = -1;
  private muzzle: THREE.Sprite;
  private muzzleLight: THREE.PointLight;
  private weaponRecoil = 0;
  private weaponKick = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private shakeAmt = 0;
  private roll = 0;
  private fov: number = WEAPON.baseFov;
  private time = 0;
  private lastYaw = 0;
  private swayX = 0;
  private swayY = 0;
  private breath = 0;
  private hurtFlash = 0;
  private floaters: THREE.Points | null = null;
  private sunLight: THREE.DirectionalLight;
  /** DPR the display asked for; the quality guard scales on top of this. */
  private baseDpr = Math.min(window.devicePixelRatio || 1, 1.75);
  private qualityScale = 1;

  constructor(canvas: HTMLCanvasElement, arena: Arena) {
    this.arena = arena;
    this.glow = glowTexture();
    this.flare = flareTexture();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(this.baseDpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0xb9d2e6, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Light aerial perspective: everything past ~250 m fades into sky haze.
    this.scene.fog = new THREE.FogExp2(0xc8d8e6, 0.0016);
    this.camera = new THREE.PerspectiveCamera(WEAPON.baseFov, 16 / 9, 0.08, 2000);

    this.buildLights();
    this.sky = buildSky();
    this.sunLight = this.sky.sun;
    this.setupSunShadow();
    this.scene.add(this.sky.group);
    this.buildArena();
    this.buildPlayers();
    this.buildRing();
    this.scene.add(this.particles.points, this.beams.group, this.waves.group);

    this.viewmodel = this.buildViewmodel(0);
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this.muzzle = this.makeSprite(0xfff0c0, 1.1);
    this.muzzle.visible = false;
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, -1.35);
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 14, 2);
    this.muzzleLight.position.set(0, 0.1, -1.6);
    this.camera.add(this.muzzleLight);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.resize();
  }

  private buildLights(): void {
    // Overcast-bright: strong sky dome, warm sun, cool bounce from below.
    const hemi = new THREE.HemisphereLight(0xcfe3f6, 0x8a8172, 0.85);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(0xa8c8ec, 0.55);
    fill.position.set(80, 40, 120);
    this.scene.add(fill);
    const ambient = new THREE.AmbientLight(0xffffff, 0.16);
    this.scene.add(ambient);
  }

  private setupSunShadow(): void {
    const sun = this.sunLight;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -120;
    cam.right = 120;
    cam.top = 140;
    cam.bottom = -60;
    cam.near = 20;
    cam.far = 460;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.06;
    sun.target.position.set(0, 40, 0);
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  private buildArena(): void {
    // One merged mesh per surface class: four draw calls for the whole ruin.
    const groups: Record<string, THREE.BufferGeometry[]> = { deck: [], wall: [], strut: [], beacon: [] };
    for (const b of this.arena.blocks) {
      const g = boxGeometry(b.hx * 2, b.hy * 2, b.hz * 2, b.kind === 'deck' ? 0.34 : 0.28);
      g.translate(b.x, b.y, b.z);
      groups[b.kind].push(g);
    }

    const floor = floorTexture();
    const stone = panelTexture('#cbc7bc', '#8d897f');
    const darkStone = panelTexture('#9a978e', '#6a6760');
    const steel = metalTexture('#5c6068', '#33363c');
    const rust = metalTexture('#6d5f52', '#3d352d');

    const mats: Record<string, THREE.Material> = {
      deck: new THREE.MeshStandardMaterial({ map: floor, bumpMap: floor, bumpScale: 0.12, color: COL.deck, roughness: 0.88, metalness: 0.06 }),
      wall: new THREE.MeshStandardMaterial({ map: stone, bumpMap: stone, bumpScale: 0.18, color: COL.wall, roughness: 0.92, metalness: 0.02 }),
      strut: new THREE.MeshStandardMaterial({ map: steel, bumpMap: steel, bumpScale: 0.22, color: COL.strut, roughness: 0.72, metalness: 0.35 }),
      beacon: new THREE.MeshStandardMaterial({ map: darkStone, bumpMap: darkStone, bumpScale: 0.14, color: COL.beacon, roughness: 0.85, metalness: 0.05 }),
    };
    void rust;

    for (const kind of Object.keys(groups)) {
      if (!groups[kind].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(groups[kind]), mats[kind]);
      mesh.name = `arena-${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Painted safety yellow along every deck rim. It is the clearest "this is
    // an edge" cue in the scene, and it costs one instanced draw call.
    const hazard: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind !== 'deck') continue;
      const y = b.y + b.hy + 0.02;
      const specs: [number, number, number, number, number, number][] = [
        [b.x, y, b.z - b.hz + 0.16, b.hx * 2 - 0.3, 0.02, 0.26],
        [b.x, y, b.z + b.hz - 0.16, b.hx * 2 - 0.3, 0.02, 0.26],
        [b.x - b.hx + 0.16, y, b.z, 0.26, 0.02, b.hz * 2 - 0.3],
        [b.x + b.hx - 0.16, y, b.z, 0.26, 0.02, b.hz * 2 - 0.3],
      ];
      for (const sp of specs) {
        hazard.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(sp[0], sp[1], sp[2]),
            new THREE.Quaternion(),
            new THREE.Vector3(sp[3], sp[4], sp[5]),
          ),
        );
      }
    }
    if (hazard.length) {
      const paint = new THREE.MeshStandardMaterial({ color: 0xd8b23c, roughness: 0.78, metalness: 0.05 });
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), paint, hazard.length);
      hazard.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      this.scene.add(inst);
    }

    // Cables strung between neighbouring pinions: these are the lines you will
    // be chaining along, so they also read as a route map.
    const cablePts: THREE.Vector3[] = [];
    for (let i = 0; i < this.arena.anchors.length; i++) {
      const a = this.arena.anchors[i];
      let nearest: (typeof this.arena.anchors)[number] | null = null;
      let best = 34;
      for (let j = 0; j < this.arena.anchors.length; j++) {
        if (i === j) continue;
        const b = this.arena.anchors[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (d > 7 && d < best) {
          best = d;
          nearest = b;
        }
      }
      if (!nearest) continue;
      const mid = new THREE.Vector3((a.x + nearest.x) / 2, (a.y + nearest.y) / 2 - best * 0.18, (a.z + nearest.z) / 2);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, a.y, a.z),
        mid,
        new THREE.Vector3(nearest.x, nearest.y, nearest.z),
      );
      const pts = curve.getPoints(9);
      for (let k = 0; k < pts.length - 1; k++) cablePts.push(pts[k], pts[k + 1]);
    }
    if (cablePts.length) {
      this.scene.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(cablePts),
          new THREE.LineBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0.55, depthWrite: false }),
        ),
      );
    }

    // Service lamps: small warm fixtures under the big decks. They add a second
    // colour temperature to the scene without turning it into a light show.
    const lampGeo = new THREE.BoxGeometry(0.9, 0.12, 0.34);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x201a12, emissive: 0xffc27a, emissiveIntensity: 1.6, roughness: 0.6 });
    const lamps: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind !== 'deck' || b.hx < 6) continue;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        lamps.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(b.x + Math.cos(a) * b.hx * 0.6, b.y + b.hy - 0.1, b.z + Math.sin(a) * b.hz * 0.6),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    if (lamps.length) {
      const inst = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
      lamps.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }

    // Signage on the walls: crisp stencilled plates.
    const sign = signTexture('SECTOR 07', '#c9b275');
    const sign2 = signTexture('NO ANCHOR', '#b9c3cc');
    for (const [i, b] of this.arena.blocks.entries()) {
      if (b.kind !== 'wall' || b.hx < 2) continue;
      const mat = new THREE.MeshStandardMaterial({
        map: i % 4 === 0 ? sign2 : sign,
        transparent: true,
        roughness: 0.9,
        metalness: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const w = Math.min(7, b.hx * 1.9);
      const h = Math.min(3.4, b.hy * 1.5);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      plane.position.set(b.x, b.y + b.hy * 0.2, b.z + b.hz + 0.03);
      this.scene.add(plane);
      const back = plane.clone();
      back.position.z = b.z - b.hz - 0.03;
      back.rotation.y = Math.PI;
      this.scene.add(back);
    }

    // Anchor pinions: warm brass markers, small and physical, not glowing orbs.
    const anchorGeo = new THREE.CylinderGeometry(0.34, 0.42, 0.5, 8);
    const anchorMat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.42, metalness: 0.85, emissive: 0x1a1206, emissiveIntensity: 1 });
    this.anchorInst = new THREE.InstancedMesh(anchorGeo, anchorMat, this.arena.anchors.length);
    this.arena.anchors.forEach((a, i) => {
      this.anchorInst!.setMatrixAt(i, new THREE.Matrix4().makeTranslation(a.x, a.y, a.z));
    });
    this.anchorInst.instanceMatrix.needsUpdate = true;
    this.anchorInst.castShadow = true;
    this.scene.add(this.anchorInst);
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(this.arena.anchors.flatMap((a) => [a.x, a.y, a.z]), 3));
    this.anchorHalos = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({
        map: this.glow,
        color: 0xffe3ac,
        size: 2.2,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.anchorHalos);

    // Ground dust motes: sparse, sunlit.
    const motes = new THREE.BufferGeometry();
    const mp: number[] = [];
    for (let i = 0; i < 700; i++) {
      mp.push((Math.random() - 0.5) * 190, 4 + Math.random() * 96, (Math.random() - 0.5) * 190);
    }
    motes.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
    this.floaters = new THREE.Points(
      motes,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.scene.add(this.floaters);
  }

  private buildPlayers(): void {
    for (let i = 0; i < 2; i++) {
      const skin = SKINS[i];
      const color = new THREE.Color(skin.color);
      const group = new THREE.Group();

      // Armour: dark matte plates with the team colour on the trim only, so a
      // distant silhouette still reads as a person rather than a dye blob.
      const shell = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.62, metalness: 0.25 });
      const plate = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.55, metalness: 0.4 });
      const accent = new THREE.MeshStandardMaterial({ color: skin.color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.2 });
      const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b0f14, emissive: color, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.6 });

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.34, 4, 12), shell);
      torso.position.y = 0.16;
      torso.castShadow = true;
      group.add(torso);

      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.32), plate);
      chest.position.set(0, 0.36, 0);
      chest.castShadow = true;
      group.add(chest);
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.34), accent);
      sash.position.set(0, 0.42, 0);
      group.add(sash);

      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), plate);
        shoulder.position.set(side * 0.3, 0.4, 0);
        shoulder.castShadow = true;
        group.add(shoulder);
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.4, 3, 8), shell);
        arm.position.set(side * 0.33, 0.13, -0.02);
        arm.rotation.z = side * 0.16;
        arm.castShadow = true;
        group.add(arm);
      }

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), plate);
      head.position.set(0, 0.66, 0);
      head.castShadow = true;
      group.add(head);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.12), visorMat);
      visor.position.set(0, 0.66, -0.12);
      group.add(visor);

      const legs: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.48, 3, 8), shell);
        leg.position.set(side * 0.12, -0.47, 0);
        leg.castShadow = true;
        legs.push(leg);
        group.add(leg);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.28), plate);
        boot.position.set(side * 0.12, -0.79, -0.04);
        group.add(boot);
      }

      const rifle = new THREE.Group();
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.9), plate);
      rifle.add(receiver);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 6), plate);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.72;
      rifle.add(barrel);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.34), accent);
      trim.position.set(0, 0.07, -0.2);
      rifle.add(trim);
      rifle.position.set(0.2, 0.24, -0.36);
      group.add(rifle);

      // Team-colour shoulder beacon: the readable "that is an enemy" cue.
      const beacon = new THREE.Sprite(this.makeGlowSpriteMaterial(skin.color, 0.55));
      beacon.position.set(0, 0.36, 0.26);
      beacon.scale.setScalar(1.1);
      group.add(beacon);

      const jetL = this.makeSprite(skin.color, 0.8);
      jetL.position.set(-0.16, -0.88, 0.16);
      group.add(jetL);
      const jetR = this.makeSprite(skin.color, 0.8);
      jetR.position.set(0.16, -0.88, 0.16);
      group.add(jetR);

      const glintCore = this.makeSprite(0xfff4d6, 0.9);
      glintCore.position.set(0, 0.66, -0.16);
      glintCore.visible = false;
      group.add(glintCore);
      const glintFlare = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.flare, color: 0xffe6b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glintFlare.position.set(0, 0.66, -0.16);
      glintFlare.visible = false;
      group.add(glintFlare);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.6),
        new THREE.MeshBasicMaterial({ map: this.glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.visible = false;
      this.scene.add(shadow);

      this.scene.add(group);
      this.players.push({ group, torso, legs, visor, outline: chest, jetL, jetR, shadow, glintCore, glintFlare, color });
    }

    // Rope: physical sag, a hook head and no glow soup.
    for (let i = 0; i < 2; i++) {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 0, 1, 0]);
      const mat = new LineMaterial({
        color: SKINS[i].color,
        linewidth: 2.2,
        worldUnits: false,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.ropes.push({ line, geo, mat });

      const hook = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.1, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.4, metalness: 0.9 }),
      );
      hook.visible = false;
      this.scene.add(hook);
      this.ropeHook.push(hook);
    }
  }

  private buildRing(): void {
    const wallGeo = new THREE.CylinderGeometry(1, 1, 300, 128, 1, true);
    wallGeo.translate(0, 30, 0);
    const wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(COL.ring) }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          float h = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float edge = pow(clamp(h, 0.0, 1.0), 0.55);
          float n = noise(vec2(vUv.x * 120.0, vWorld.y * 0.16 - uTime * 1.4)) * 0.5
                  + noise(vec2(vUv.x * 40.0, vWorld.y * 0.05 + uTime * 0.6)) * 0.5;
          float bands = smoothstep(0.45, 0.95, n);
          float glow = edge * (0.32 + bands * 0.55);
          // A soft scan line rising up the wall.
          float scan = smoothstep(0.03, 0.0, abs(fract(vWorld.y * 0.012 - uTime * 0.06) - 0.5)) * 0.35;
          gl_FragColor = vec4(uColor * (1.0 + bands * 0.4), (glow + scan) * uOpacity * 0.62);
        }
      `,
    });
    this.ringWall = new THREE.Mesh(wallGeo, wallMat);
    this.ringGroup.add(this.ringWall);
    for (const y of [-24, 46, 108]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), y, Math.sin(a)));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COL.ring, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      this.ringLines.push(line);
      this.ringGroup.add(line);
    }
    const spokePts: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      spokePts.push(Math.cos(a), -24, Math.sin(a), Math.cos(a), 108, Math.sin(a));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(spokePts, 3));
    this.ringSpokes = new THREE.LineSegments(
      sg,
      new THREE.LineBasicMaterial({ color: COL.ring, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.ringGroup.add(this.ringSpokes);
    this.ringGroup.visible = false;
    this.scene.add(this.ringGroup);
  }

  private makeGlowSpriteMaterial(color: number, opacity: number): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  private makeSprite(color: number, scale: number): THREE.Sprite {
    const s = new THREE.Sprite(this.makeGlowSpriteMaterial(color, 0));
    s.scale.setScalar(scale);
    return s;
  }

  private buildViewmodel(skinIndex: number): THREE.Group {
    const skin = SKINS[skinIndex];
    const g = new THREE.Group();
    // Gunmetal plus a painted accent panel: reads as a real service rifle.
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.46, metalness: 0.75 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.82, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: skin.color, roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(skin.color), emissiveIntensity: 0.12 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.95, metalness: 0.02 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a4d43, roughness: 0.96, metalness: 0.02 });
    const lance = skin.weapon === 'lance';

    // Receiver.
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.72), gunmetal);
    receiver.position.z = -0.4;
    g.add(receiver);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.6), polymer);
    rail.position.set(0, 0.08, -0.42);
    g.add(rail);
    // Painted panel on the side, the cosmetic difference.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.08, 0.34), accent);
    panel.position.set(0.052, -0.01, -0.44);
    g.add(panel);

    // Handguard + barrel.
    const guardLen = lance ? 0.62 : 0.5;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, guardLen), polymer);
    guard.position.set(0, 0.01, -0.82 - guardLen * 0.3);
    g.add(guard);
    const barrelLen = lance ? 0.66 : 0.52;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(lance ? 0.019 : 0.015, lance ? 0.021 : 0.017, barrelLen, 10), gunmetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.9 - guardLen * 0.55 - barrelLen * 0.4);
    g.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.1, 8), gunmetal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.02, -0.9 - guardLen * 0.55 - barrelLen * 0.78);
    g.add(muzzle);

    // Optic.
    const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.3, 12), gunmetal);
    scopeBody.rotation.x = Math.PI / 2;
    scopeBody.position.set(0, 0.15, -0.34);
    g.add(scopeBody);
    const scopeRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 14), polymer);
    scopeRing.position.set(0, 0.15, -0.2);
    g.add(scopeRing);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 14), new THREE.MeshStandardMaterial({ color: 0x2a4a5c, roughness: 0.1, metalness: 0.9 }));
    lens.position.set(0, 0.15, -0.19);
    g.add(lens);

    // Magazine, grip, stock.
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.13), polymer);
    mag.position.set(0, -0.16, -0.32);
    mag.rotation.x = 0.22;
    g.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.09), polymer);
    grip.position.set(0, -0.12, -0.06);
    grip.rotation.x = -0.32;
    g.add(grip);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.26), polymer);
    stock.position.set(0, -0.01, 0.06);
    g.add(stock);

    // Hands: a glove on the grip and one on the handguard, with sleeves.
    const glove1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.16), glove);
    glove1.position.set(0.005, -0.14, -0.08);
    glove1.rotation.x = -0.2;
    g.add(glove1);
    const glove2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.15), glove);
    glove2.position.set(-0.01, -0.06, -0.78);
    g.add(glove2);
    const sleeve1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.34, 8), sleeve);
    sleeve1.rotation.x = Math.PI / 2.3;
    sleeve1.rotation.z = 0.12;
    sleeve1.position.set(0.09, -0.24, -0.02);
    g.add(sleeve1);
    const sleeve2 = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.068, 0.4, 8), sleeve);
    sleeve2.rotation.x = Math.PI / 2.1;
    sleeve2.rotation.z = -0.3;
    sleeve2.position.set(-0.14, -0.2, -0.62);
    g.add(sleeve2);

    g.position.set(0.22, -0.2, -0.1);
    g.rotation.y = -0.04;
    g.visible = false;
    this.viewmodelSkin = skinIndex;
    return g;
  }

  setSkin(index: 0 | 1): void {
    if (this.viewmodelSkin === index) return;
    this.camera.remove(this.viewmodel);
    this.viewmodel = this.buildViewmodel(index);
    this.camera.add(this.viewmodel);
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, -1.85);
    this.viewmodel.visible = true;
  }

  /**
   * Adaptive resolution. Post-processing plus a shadow map is a lot for an
   * integrated GPU, so the frame-time guard in main.ts nudges this down before
   * the player ever notices a stutter, and back up when there is headroom.
   */
  setQuality(scale: number): void {
    const next = clamp(scale, 0.55, 1);
    if (Math.abs(next - this.qualityScale) < 0.02) return;
    this.qualityScale = next;
    this.renderer.setPixelRatio(this.baseDpr * next);
    this.post.composer.setPixelRatio(this.baseDpr * next);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const r of this.ropes) r.mat.resolution.set(w, h);
    this.post.setSize(w, h);
  }

  // ── Feedback hooks ───────────────────────────────────────────────────────
  shake(amount: number): void {
    this.shakeAmt = Math.min(0.06, this.shakeAmt + amount);
  }

  punch(pitch: number, yaw = 0): void {
    this.punchPitch += pitch;
    this.punchYaw += yaw;
  }

  hurt(amount = 0.6): void {
    this.hurtFlash = Math.min(1, this.hurtFlash + amount);
  }

  recoil(): void {
    this.weaponRecoil = 1;
    this.weaponKick = 1;
    this.muzzle.visible = true;
    this.muzzle.material.opacity = 1;
    this.muzzle.scale.setScalar(1.5);
    this.muzzleLight.intensity = 22;
  }

  muzzleFlash(): void {
    this.recoil();
  }

  tracer(from: Vec3, to: Vec3, color: number): void {
    this.beams.fire(from, to, color, 0.34, 0.26);
    this.beams.fire(from, to, 0xffffff, 0.1, 0.16);
  }

  spark(pos: Vec3, color: number, count = 5): void {
    this.particles.burst(pos, color, count, { speed: 9, size: 0.3, life: 0.4, gravity: 18 });
    this.particles.burst(pos, 0xffe2b0, Math.round(count * 0.5), { speed: 6, size: 0.2, life: 0.28, gravity: 22 });
  }

  /** Big hit burst: a kill is the loudest visual event in the game. */
  shatter(pos: Vec3, color: number): void {
    this.particles.burst(pos, color, 70, { speed: 17, size: 0.34, life: 0.95, gravity: 15, drag: 1.4 });
    this.particles.burst(pos, 0x9aa4ae, 26, { speed: 8, size: 0.5, life: 1.3, gravity: 5, drag: 2 });
    this.waves.spawn(pos, color, 7, 0.55);
    this.shake(0.04);
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  update(dt: number, view: FrameView): void {
    this.time += dt;
    const local = view.local;
    const remote = view.remote;

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
    const swingRoll = local.grapple.active && local.grapple.mode === 'swing' ? -lateral * 0.0019 : 0;
    const strafeRoll = -lateral * 0.0013;
    const targetRoll = clamp(swingRoll + strafeRoll, -0.14, 0.14) * (1 - local.scopeT);
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

    // ── Players ────────────────────────────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      const isLocal = i === local.id;
      const visual = this.players[i];
      const state = isLocal ? local : remote;
      const pos = isLocal ? local.pos : remote.pos;
      const alive = isLocal ? local.alive || !!view.killcam : remote.alive;
      visual.group.visible = alive && (isLocal ? !!view.killcam : true);
      visual.group.position.set(pos.x, pos.y, pos.z);
      visual.group.rotation.y = (isLocal ? local.yaw : remote.yaw) + Math.PI;
      const sliding = state.sliding;
      visual.group.rotation.z = sliding ? 0.6 : 0;
      visual.group.rotation.x = 0;

      const airborne = isLocal ? !local.grounded : !remote.alive ? false : true;
      const pump = Math.sin(this.time * 11) * clamp((isLocal ? local.speed : remote.speed) / 16, 0, 1) * 0.5;
      visual.legs[0].rotation.x = sliding ? -1.1 : airborne ? -0.4 : pump;
      visual.legs[1].rotation.x = sliding ? -1.1 : airborne ? 0.2 : -pump;

      const jetOn = isLocal ? !local.grounded && local.speed > 8 : remote.alive && (remote.speed > 20 || remote.grapple.active);
      for (const jet of [visual.jetL, visual.jetR]) {
        jet.visible = jetOn;
        jet.material.opacity = jetOn ? 0.35 + Math.sin(this.time * 40) * 0.1 : 0;
      }

      const groundY = isLocal ? view.groundLocal : view.groundRemote;
      if (typeof groundY === 'number' && alive) {
        visual.shadow.visible = true;
        visual.shadow.position.set(pos.x, groundY + 0.02, pos.z);
        const h = Math.max(0, pos.y - groundY);
        const k = clamp(1 - h / 26, 0.12, 1);
        visual.shadow.scale.setScalar(0.55 + k * 1.4);
        (visual.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * k;
      } else {
        visual.shadow.visible = false;
      }

      const isRemote = !isLocal;
      const intensity = isRemote ? remote.glint * (view.glintVisible ? 1 : 0) : 0;
      const glintOn = intensity > 0.02;
      visual.glintCore.visible = glintOn;
      visual.glintFlare.visible = glintOn;
      if (glintOn) {
        const pulse = 0.92 + Math.sin(this.time * 7.5) * 0.08;
        visual.glintCore.material.opacity = Math.min(1, intensity) * 0.95;
        visual.glintCore.scale.setScalar((0.7 + intensity * 1.2) * pulse);
        visual.glintFlare.material.opacity = Math.min(1, intensity) * 0.7;
        visual.glintFlare.scale.setScalar(1.6 + intensity * 2.6);
        visual.glintFlare.material.rotation = this.time * 0.2;
      }

      if (isRemote && remote.alive && remote.speed > 26) {
        this.particles.ember({ x: pos.x, y: pos.y, z: pos.z }, 0xd8d2c4, 0.2, 0.35);
      }
    }

    // ── Ropes ──────────────────────────────────────────────────────────────
    this.drawRope(0, local.eye, local.grapple.active && local.grapple.mode !== 'none' ? view.localRope : null, SKINS[local.id].color, dt);
    this.drawRope(
      1,
      { x: remote.pos.x, y: remote.pos.y + 0.35, z: remote.pos.z },
      remote.grapple.active ? view.remoteRope : null,
      SKINS[1 - local.id].color,
      dt,
    );

    // ── World effects ──────────────────────────────────────────────────────
    this.updateRing(view.ringRadius, view.ringActive, dt);
    this.sky.update(dt, this.camera);
    this.particles.update(dt);
    this.beams.update(dt);
    this.waves.update(dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);

    if (this.anchorInst) {
      this.anchorSpin += dt * 0.5;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.anchorSpin, 0));
      this.arena.anchors.forEach((a, i) => {
        m.compose(new THREE.Vector3(a.x, a.y + Math.sin(this.time * 1.2 + i) * 0.08, a.z), q, new THREE.Vector3(1, 1, 1));
        this.anchorInst!.setMatrixAt(i, m);
      });
      this.anchorInst.instanceMatrix.needsUpdate = true;
    }
    if (this.anchorHalos) {
      (this.anchorHalos.material as THREE.PointsMaterial).opacity = 0.3 + Math.sin(this.time * 2) * 0.1;
    }
    if (this.floaters) this.floaters.rotation.y = this.time * 0.008;

    // ── Viewmodel ──────────────────────────────────────────────────────────
    const scopedNow = local.scopeT > 0.72;
    this.viewmodel.visible = !scopedNow && !view.killcam && local.alive;
    this.weaponRecoil *= Math.exp(-dt * 11);
    this.weaponKick *= Math.exp(-dt * 7);
    const yawDelta = this.normalizeAngle(local.yaw - this.lastYaw);
    this.lastYaw = local.yaw;
    this.swayX = lerp(this.swayX, clamp(yawDelta * 2.2, -0.05, 0.05), 1 - Math.exp(-dt * 7));
    this.swayY = lerp(this.swayY, clamp(local.vel.y * 0.0014, -0.035, 0.035), 1 - Math.exp(-dt * 6));
    this.breath += dt;
    const bobSpeed = local.grounded ? local.speed : 0;
    const bob = Math.sin(this.time * 9) * 0.005 * Math.min(1, bobSpeed / 8);
    const breathe = Math.sin(this.breath * 1.7) * 0.0022;
    const raise = smoothstep(0.55, 1, local.scopeT);
    this.viewmodel.position.set(
      0.22 + Math.sin(this.time * 4.2) * 0.003 + this.swayX - raise * 0.18,
      -0.2 + bob + breathe + this.swayY - this.weaponKick * 0.025 - raise * 0.05,
      -0.1 + this.weaponRecoil * 0.14,
    );
    this.viewmodel.rotation.set(
      this.weaponRecoil * 0.18 + this.weaponKick * 0.06 - this.swayY * 0.6,
      -0.04 + Math.cos(this.time * 4.2) * 0.002 + this.swayX * 0.5,
      this.weaponRecoil * 0.05,
    );
    if (this.muzzle.visible) {
      this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - dt * 8);
      if (this.muzzle.material.opacity <= 0.01) this.muzzle.visible = false;
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 220);

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
      this.camera.position.set(
        victim.x - dir.x * dist * 0.5 + side.x * dist * 0.3,
        victim.y + 2.2 + (1 - e) * 4,
        victim.z - dir.z * dist * 0.5 + side.z * dist * 0.3,
      );
      this.camera.lookAt(killer.x, killer.y, killer.z);
      this.camera.fov = lerp(this.camera.fov, 58, 1 - Math.exp(-dt * 6));
      this.camera.updateProjectionMatrix();
    }

    const hurt = this.hurtFlash + (view.hurt ?? 0);
    this.post.setState(
      this.time,
      clamp(speedT * 0.85 + (local.grapple.active ? 0.3 : 0), 0, 1),
      local.scopeT > 0.7 ? 1 : 0,
      clamp(hurt, 0, 1),
    );
  }

  private normalizeAngle(a: number): number {
    let x = a;
    while (x > Math.PI) x -= Math.PI * 2;
    while (x < -Math.PI) x += Math.PI * 2;
    return x;
  }

  private drawRope(index: number, from: Vec3, rope: RopeView | null, color: number, dt: number): void {
    const entry = this.ropes[index];
    const hook = this.ropeHook[index];
    if (!rope) {
      entry.line.visible = false;
      hook.visible = false;
      return;
    }
    const dist = Math.hypot(rope.anchor.x - from.x, rope.anchor.y - from.y, rope.anchor.z - from.z);
    const slack = Math.max(0, rope.length - dist);
    const sag = Math.min(3.2, slack * 0.5);
    const SEG = 18;
    const pts: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const s = Math.sin(Math.PI * t) * sag;
      pts.push(
        from.x + (rope.anchor.x - from.x) * t,
        from.y + (rope.anchor.y - from.y) * t - s,
        from.z + (rope.anchor.z - from.z) * t,
      );
    }
    entry.geo.setPositions(pts);
    entry.line.visible = true;
    entry.mat.color.setHex(color);
    entry.mat.linewidth = rope.mode === 'zip' ? 3 : 2.2;
    entry.mat.opacity = 0.95;

    hook.visible = true;
    hook.position.set(rope.anchor.x, rope.anchor.y, rope.anchor.z);
    hook.rotation.y += dt * 4;
  }

  private updateRing(radius: number, active: boolean, dt: number): void {
    this.ringGroup.visible = active;
    if (!active) return;
    this.ringWall.scale.set(radius, 1, radius);
    for (const l of this.ringLines) l.scale.set(radius, 1, radius);
    this.ringSpokes.scale.set(radius, 1, radius);
    this.ringSpokes.rotation.y += dt * 0.04;
    (this.ringWall.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
  }

  /** Slow establishing shot used behind the menu and the results screen. */
  orbit(dt: number): void {
    this.time += dt;
    const a = this.time * 0.05;
    const r = 150 + Math.sin(this.time * 0.07) * 14;
    this.camera.position.set(Math.cos(a) * r, 46 + Math.sin(this.time * 0.11) * 10, Math.sin(a) * r);
    this.camera.fov = lerp(this.camera.fov, 46, 1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 36, 0);
    this.ringGroup.visible = false;
    this.viewmodel.visible = false;
    for (const p of this.players) {
      p.group.visible = false;
      p.shadow.visible = false;
    }
    this.particles.update(dt);
    this.beams.update(dt);
    this.waves.update(dt);
    this.sky.update(dt, this.camera);
    this.post.setState(this.time, 0, 0, 0);
  }

  render(): void {
    this.post.render();
  }

  setRingColor(inside: boolean): void {
    const c = inside ? COL.ring : 0xff3b30;
    for (const l of this.ringLines) (l.material as THREE.LineBasicMaterial).color.setHex(c);
    (this.ringWall.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(c);
    (this.ringSpokes.material as THREE.LineBasicMaterial).color.setHex(c);
  }
}
