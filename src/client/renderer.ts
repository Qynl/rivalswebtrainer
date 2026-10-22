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
import { GRAPPLE, SKINS, WEAPON } from '../shared/constants.ts';
import { DEFAULT_LOADOUT, gunSkin, grappleSkin, killEffect, type Loadout } from '../shared/cosmetics.ts';
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
  aimRingTexture,
  cloudTexture,
  streakTexture,
  deckStencilTexture,
  patternTexture,
} from './textures.ts';

export interface RemoteView {
  /** Cosmetic kit of the opponent, validated server-side. */
  look?: Loadout;
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  sliding: boolean;
  scoped: boolean;
  glint: number;
  speed: number;
  grapple: { active: boolean; mode: 'none' | 'swing' | 'zip'; anchor: Vec3; length: number; target: 0 | 1 };
  /** Equipped item, so their hands match yours. */
  slot: 0 | 1;
  /** Claw in flight. */
  hook: { active: boolean; pos: Vec3 };
}

export interface RopeView {
  active: boolean;
  anchor: Vec3;
  length: number;
  mode: 'none' | 'swing' | 'zip';
  /** Claw still travelling: a straight cable paying out of the hand. */
  inFlight?: boolean;
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
  rifle: THREE.Group;
  launcher: THREE.Group;
  /** Rifle furniture materials, recoloured by the owner's gun skin. */
  kitBody: THREE.MeshStandardMaterial;
  kitPanel: THREE.MeshStandardMaterial;
  kitTrim: THREE.MeshStandardMaterial;
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


/**
 * The claw. A tapered shaft, a shackle ring and three hinged flukes that snap
 * shut the instant the hook bites — the shape is what sells the throw.
 */
function buildGrapnel(metalHex: number): THREE.Group {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.38, metalness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: metalHex, roughness: 0.34, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.7, metalness: 0.4 });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.028, 0.3, 10), steel);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.1;
  root.add(shaft);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 5, 12), brass);
  collar.position.z = -0.02;
  root.add(collar);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 12), brass);
  ring.position.z = 0.09;
  root.add(ring);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 8), dark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.3;
  root.add(nose);

  // Three flukes on a common hinge line: they fold back in flight and bite
  // outward on contact.
  for (let i = 0; i < 3; i++) {
    const hinge = new THREE.Group();
    hinge.name = `hinge${i}`;
    hinge.rotation.z = (i / 3) * Math.PI * 2;
    const fluke = new THREE.Group();
    fluke.position.z = -0.16;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.15), steel);
    arm.position.z = -0.075;
    fluke.add(arm);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.09, 6), brass);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.175;
    fluke.add(tip);
    hinge.add(fluke);
    root.add(hinge);
  }
  return root;
}

/**
 * Bakes a cheap ambient-occlusion read into the merged block geometry: tops
 * catch the sun, sides fall off, undersides go dark, and everything picks up a
 * little more light the higher it sits. One extra attribute, no extra pass.
 */
function shadeBlocks(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  // The sun sits in the -x/-z quadrant and above, so a face's dot product with
  // it is a free, per-vertex bounce-light term: sunlit concrete goes warm and
  // slightly hot, shaded faces pick up the cool sky and sit lower. This is
  // baked into vertex colours, so it costs nothing at runtime and it is what
  // stops the whole map reading as one flat grey material.
  const sun = new THREE.Vector3(-0.46, 0.62, -0.62).normalize();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const y = pos.getY(i);
    const facing = nrm.getX(i) * sun.x + ny * sun.y + nrm.getZ(i) * sun.z;
    let v = ny > 0.5 ? 1 : ny < -0.5 ? 0.5 : 0.78;
    v *= 0.87 + clamp((y + 12) / 130, 0, 1) * 0.15;
    v *= 1 + clamp(facing, -1, 1) * 0.07;
    const cool = clamp(-facing, 0, 1) * 0.05;
    colors[i * 3] = clamp(v * 1.02 - cool * 0.4, 0, 1);
    colors[i * 3 + 1] = clamp(v - cool * 0.1, 0, 1);
    colors[i * 3 + 2] = clamp(v * 0.96 + cool * 0.9, 0, 1);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}


/**
 * Collapses a group of static meshes into one mesh per material. The first
 * person models are ~90 little parts; merged they cost a dozen draw calls,
 * which is the difference between a crisp viewmodel and a stutter.
 */
function mergeChildren(group: THREE.Group, preserve: Set<THREE.Object3D> = new Set()): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...group.children]) {
    if (preserve.has(child) || !(child as THREE.Mesh).isMesh) continue;
    const mesh = child as THREE.Mesh;
    mesh.updateMatrix();
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const list = byMat.get(mesh.material as THREE.Material) ?? [];
    list.push(geo);
    byMat.set(mesh.material as THREE.Material, list);
    group.remove(mesh);
  }
  for (const [mat, geos] of byMat) {
    if (!geos.length) continue;
    group.add(new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos), mat));
  }
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
  private ropes: {
    line: Line2;
    geo: LineGeometry;
    mat: LineMaterial;
    sheath: Line2;
    sheathGeo: LineGeometry;
    sheathMat: LineMaterial;
  }[] = [];
  private ringGroup = new THREE.Group();
  private ringWall: THREE.Mesh = new THREE.Mesh();
  private ringLines: THREE.Line[] = [];
  private ringSpokes: THREE.LineSegments = new THREE.LineSegments();
  private anchorInst: THREE.InstancedMesh | null = null;
  private anchorHalos: THREE.Points | null = null;
  private anchorSpin = 0;
  private viewmodel: THREE.Group;
  private rifleModel: THREE.Group = new THREE.Group();
  private grapnelModel: THREE.Group = new THREE.Group();
  private boltGroup: THREE.Group = new THREE.Group();
  private spool: THREE.Object3D = new THREE.Object3D();
  /** The loaded claw in the launcher's throat; hidden while one is in flight. */
  private readyClaw: THREE.Object3D = new THREE.Object3D();
  private slotBlend = 0;
  private hookKick = 0;
  private hookHeads: THREE.Group[] = [];
  /** A bead that runs down the cable while the reels are turning. */
  private ropePulses: THREE.Sprite[] = [];
  /** Halo where the claw bit: proves the bite point to both players. */
  private biteHalos: THREE.Sprite[] = [];
  /** World-space marker for the pinion the claw would bite right now. */
  private aimMark: THREE.Sprite | null = null;
  private aimTarget: { point: Vec3; onPlayer: boolean } | null = null;
  private moteAcc = 0;
  private readonly tint = new THREE.Color();
  private readonly warm = new THREE.Color(0xffcf8a);
  /** A short FOV punch: the lens equivalent of a flinch, used on hook catches. */
  private fovPunch = 0;
  /** Claws whipping back to the hand after a miss, so nothing blinks out. */
  private hookRetract: { t: number; from: Vec3 }[] = [
    { t: 1, from: { x: 0, y: 0, z: 0 } },
    { t: 1, from: { x: 0, y: 0, z: 0 } },
  ];
  private hookClaw: number[] = [0, 0];
  private viewmodelSkin = -1;
  /** Cosmetic kit for the local player and the opponent. Purely visual. */
  private look: Loadout = { ...DEFAULT_LOADOUT };
  private remoteLook: Loadout = { ...DEFAULT_LOADOUT };
  /** Which array slot in `players` belongs to the player holding this camera. */
  private localIndex = 0;
  private gunPattern: THREE.Texture | null = null;
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
    // Slightly hot exposure: daylight should clip on the concrete, not sit in
    // the middle of the histogram where every surface reads the same grey.
    this.renderer.toneMappingExposure = 1.04;
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
    this.viewmodel.traverse((o) => o.layers.enable(1));
    this.camera.add(this.viewmodel);
    // A dedicated rig for the hands and the gun. A viewmodel lit only by the
    // world sun goes black the moment you face away from it, which is exactly
    // when you are looking at it most. Short-range point lights keep the effect
    // on the weapon instead of washing out the map.
    const key = new THREE.PointLight(0xfff3e0, 9, 2.8, 2);
    key.position.set(-0.5, 0.7, 0.45);
    this.camera.add(key);
    const rim = new THREE.PointLight(0xc3dbf6, 5, 2.6, 2);
    rim.position.set(0.7, -0.15, -1.1);
    this.camera.add(rim);
    const fill = new THREE.PointLight(0xffffff, 2.4, 2.2, 2);
    fill.position.set(0.1, -0.6, 0.2);
    this.camera.add(fill);

    this.muzzle = this.makeSprite(0xfff0c0, 1.1);
    this.muzzle.visible = false;
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.008, -1.42);
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 14, 2);
    this.muzzleLight.position.set(0, 0.06, -1.55);
    this.camera.add(this.muzzleLight);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.resize();
  }

  private buildLights(): void {
    // Overcast-bright: strong sky dome, warm sun, cool bounce from below.
    const hemi = new THREE.HemisphereLight(0xcfe3f6, 0x8a8172, 0.72);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(0xa8c8ec, 0.42);
    fill.position.set(80, 40, 120);
    this.scene.add(fill);
    const ambient = new THREE.AmbientLight(0xffffff, 0.1);
    this.scene.add(ambient);
  }

  private setupSunShadow(): void {
    const sun = this.sunLight;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -104;
    cam.right = 104;
    cam.top = 118;
    cam.bottom = -58;
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
      deck: new THREE.MeshStandardMaterial({ map: floor, bumpMap: floor, bumpScale: 0.12, color: COL.deck, roughness: 0.88, metalness: 0.06, vertexColors: true }),
      wall: new THREE.MeshStandardMaterial({ map: stone, bumpMap: stone, bumpScale: 0.18, color: COL.wall, roughness: 0.92, metalness: 0.02, vertexColors: true }),
      strut: new THREE.MeshStandardMaterial({ map: steel, bumpMap: steel, bumpScale: 0.22, color: COL.strut, roughness: 0.72, metalness: 0.35, vertexColors: true }),
      beacon: new THREE.MeshStandardMaterial({ map: darkStone, bumpMap: darkStone, bumpScale: 0.14, color: COL.beacon, roughness: 0.85, metalness: 0.05, vertexColors: true }),
    };
    const seen = new Set<number>();
    for (const list of Object.values(groups)) for (const g of list) seen.add(g.id);
    void rust;
    void seen;

    for (const kind of Object.keys(groups)) {
      if (!groups[kind].length) continue;
      const merged = mergeGeometries(groups[kind]);
      shadeBlocks(merged);
      const mesh = new THREE.Mesh(merged, mats[kind]);
      mesh.name = `arena-${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    this.buildStructure();

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
      const tint = new THREE.Color();
      hazard.forEach((m, i) => {
        inst.setMatrixAt(i, m);
        // Paint wears unevenly: a per-strip brightness wobble (deterministic,
        // so the map looks the same on both machines) beats a flat yellow line.
        const k = 0.82 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3;
        tint.setHex(0xd8b23c).multiplyScalar(k);
        inst.setColorAt(i, tint);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
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
            // Hung just below the underside, so they read from the void rather
            // than being buried inside the slab.
            new THREE.Vector3(b.x + Math.cos(a) * b.hx * 0.6, b.y - b.hy - 0.09, b.z + Math.sin(a) * b.hz * 0.6),
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

    // Signage on the walls: crisp stencilled plates, merged per label so the
    // whole map's signage costs two draw calls instead of two per wall.
    const sign = signTexture('SECTOR 07', '#c9b275');
    const sign2 = signTexture('NO ANCHOR', '#b9c3cc');
    const plates: Record<string, THREE.BufferGeometry[]> = { a: [], b: [] };
    this.arena.blocks.forEach((b, i) => {
      if (b.kind !== 'wall' || b.hx < 2) return;
      const w = Math.min(7, b.hx * 1.9);
      const h = Math.min(3.4, b.hy * 1.5);
      const key = i % 4 === 0 ? 'b' : 'a';
      for (const side of [1, -1]) {
        const g = new THREE.PlaneGeometry(w, h);
        const m = new THREE.Matrix4()
          .makeRotationY(side === 1 ? 0 : Math.PI)
          .setPosition(b.x, b.y + b.hy * 0.2, b.z + side * (b.hz + 0.03));
        g.applyMatrix4(m);
        plates[key].push(g);
      }
    });
    const plateMat = (map: THREE.Texture): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        roughness: 0.9,
        metalness: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
    if (plates.a.length) this.scene.add(new THREE.Mesh(mergeGeometries(plates.a), plateMat(sign)));
    if (plates.b.length) this.scene.add(new THREE.Mesh(mergeGeometries(plates.b), plateMat(sign2)));

    // Anchor pinions: warm brass markers, small and physical, not glowing orbs.
    const anchorGeo = new THREE.CylinderGeometry(0.34, 0.42, 0.5, 8);
    const anchorMat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.42, metalness: 0.85, emissive: 0x1a1206, emissiveIntensity: 1 });
    this.anchorInst = new THREE.InstancedMesh(anchorGeo, anchorMat, this.arena.anchors.length);
    this.arena.anchors.forEach((a, i) => {
      this.anchorInst!.setMatrixAt(i, new THREE.Matrix4().makeTranslation(a.x, a.y, a.z));
    });
    this.anchorInst.instanceMatrix.needsUpdate = true;
    const brass = new THREE.Color(0xc9a86a);
    this.arena.anchors.forEach((_, i) => this.anchorInst!.setColorAt(i, brass));
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

    // Deck stencils: a numeral per big platform, flat on the concrete. They
    // double as landmarks — "he is on 02" is a callout the map can support.
    const decks = this.arena.blocks.filter((b) => b.kind === 'deck' && b.hx >= 5 && b.hz >= 5).slice(0, 6);
    decks.forEach((b, i) => {
      const label = String(i + 1).padStart(2, '0');
      const mat = new THREE.MeshStandardMaterial({
        map: deckStencilTexture(label),
        transparent: true,
        roughness: 0.9,
        metalness: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      });
      const size = Math.min(b.hx, b.hz) * 1.35;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(b.x, b.y + b.hy + 0.03, b.z);
      plane.renderOrder = 1;
      this.scene.add(plane);
    });

    // The void gets a floor. A sea of cloud far below the kill line turns
    // looking down from a high deck into a view instead of an empty fog bank.
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshBasicMaterial({
        map: cloudTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: true,
      }),
    );
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = -66;
    clouds.renderOrder = 2;
    clouds.name = 'cloudsea';
    this.scene.add(clouds);

    // Broken slabs drifting well outside the play space: parallax, scale and a
    // reminder that this ruin is a fragment of something much bigger.
    const debris: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + i * 0.37;
      const r = 118 + (i % 6) * 20;
      const y = -20 + ((i * 41) % 84);
      const sc = 3 + (i % 4) * 2.6;
      const g = new THREE.BoxGeometry(sc * 2, sc * 0.62, sc * 1.5);
      g.rotateY(i * 0.71);
      g.rotateX(0.18 + (i % 3) * 0.1);
      g.rotateZ(0.09 + (i % 5) * 0.05);
      g.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      debris.push(g);
    }
    const rocks = new THREE.Mesh(
      mergeGeometries(debris),
      new THREE.MeshStandardMaterial({ map: stone, color: 0xcfcabd, roughness: 0.96, metalness: 0.02 }),
    );
    rocks.name = 'debris';
    rocks.castShadow = false;
    rocks.receiveShadow = false;
    this.scene.add(rocks);
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
      const tan = new THREE.MeshStandardMaterial({ color: 0xa48b58, roughness: 0.74, metalness: 0.14 });
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

      // What the opponent is carrying has to be readable at rifle range: a
      // long rifle silhouette, or the stubby launcher with its drum of cable.
      const rifle = new THREE.Group();
      const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        rifle.add(mesh);
      };
      part(new THREE.BoxGeometry(0.09, 0.11, 0.86), tan, 0, 0, 0);
      part(new THREE.BoxGeometry(0.075, 0.06, 0.5), plate, 0, -0.075, 0.02);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.72, 8), plate);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.72;
      rifle.add(barrel);
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.14, 8), accent);
      brake.rotation.x = Math.PI / 2;
      brake.position.z = -1.1;
      rifle.add(brake);
      // Optic.
      const optic = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.34, 8), plate);
      optic.rotation.x = Math.PI / 2;
      optic.position.set(0, 0.1, -0.16);
      rifle.add(optic);
      // Stock, magazine, grip.
      part(new THREE.BoxGeometry(0.06, 0.1, 0.34), tan, 0, -0.03, 0.52);
      part(new THREE.BoxGeometry(0.05, 0.16, 0.1), plate, 0, -0.16, -0.04);
      part(new THREE.BoxGeometry(0.05, 0.14, 0.08), plate, 0, -0.12, 0.16);
      part(new THREE.BoxGeometry(0.1, 0.02, 0.3), accent, 0, 0.065, -0.3);
      rifle.position.set(0.2, 0.24, -0.36);
      group.add(rifle);

      // Grapnel launcher in the same hands.
      const launcher = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 12), plate);
      drum.rotation.z = Math.PI / 2;
      launcher.add(drum);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.42), tan);
      body.position.z = -0.16;
      launcher.add(body);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), accent);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.z = -0.42;
      launcher.add(muzzle);
      launcher.position.set(0.2, 0.24, -0.3);
      launcher.visible = false;
      group.add(launcher);

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
      this.players.push({
        group,
        torso,
        legs,
        visor,
        outline: chest,
        jetL,
        jetR,
        shadow,
        glintCore,
        glintFlare,
        rifle,
        launcher,
        kitBody: tan,
        kitPanel: plate,
        kitTrim: accent,
        color,
      });
    }

    // Cable: a thick dark sheath with a bright core, plus a real grapnel head
    // that can be seen leaving your hand.
    for (let i = 0; i < 2; i++) {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 0, 1, 0]);
      const mat = new LineMaterial({
        color: SKINS[i].color,
        linewidth: 1.5,
        worldUnits: false,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);

      const sheathGeo = new LineGeometry();
      sheathGeo.setPositions([0, 0, 0, 0, 1, 0]);
      const sheathMat = new LineMaterial({
        color: 0x23262b,
        linewidth: 3.6,
        worldUnits: false,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const sheath = new Line2(sheathGeo, sheathMat);
      sheath.frustumCulled = false;
      sheath.visible = false;
      this.scene.add(sheath);

      this.ropes.push({ line, geo, mat, sheath, sheathGeo, sheathMat });

      // A travelling bead makes the cable read as a live mechanism: it runs
      // from the hand to the claw while the spool is paying out or reeling in.
      const pulse = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glow, color: SKINS[i].color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      pulse.scale.setScalar(1.5);
      pulse.visible = false;
      this.scene.add(pulse);
      this.ropePulses.push(pulse);

      // Where the claw bit: a soft halo so a rope in the sky has a near end
      // and a far end, not just a line into fog.
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glow, color: SKINS[i].color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      halo.scale.setScalar(4.2);
      halo.visible = false;
      this.scene.add(halo);
      this.biteHalos.push(halo);
      const head = buildGrapnel(i === 0 ? grappleSkin(DEFAULT_LOADOUT.grapple).claw : 0xc9a86a);
      // A hot little halo rides with the claw while it is in the air, so a
      // throw stays visible against the sky at any range.
      const spark = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glow, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      spark.scale.setScalar(0.9);
      spark.name = 'hookspark';
      head.add(spark);
      head.visible = false;
      this.scene.add(head);
      this.hookHeads.push(head);
    }
    this.buildAimMark();
  }

  /**
   * Everything that makes the blocks read as built rather than dropped:
   * underdeck joists, corner caps, pipe runs and a hazy skyline on the horizon.
   * All of it is decoration — none of it has a collider or a gameplay effect.
   */
  private buildStructure(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x53565c, roughness: 0.6, metalness: 0.55 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.66, metalness: 0.5 });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const mat4 = new THREE.Matrix4();
    const push = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): void => {
      list.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
          new THREE.Vector3(sx, sy, sz),
        ),
      );
    };

    const joists: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const pipes: THREE.Matrix4[] = [];
    const lampsOn: THREE.Matrix4[] = [];

    for (const b of this.arena.blocks) {
      if (b.kind === 'deck') {
        // Joists under the slab, running the short axis, so looking up from
        // the void shows structure instead of a floating pancake.
        const span = Math.min(b.hx, b.hz) * 2;
        const long = Math.max(b.hx, b.hz);
        const alongX = b.hx >= b.hz;
        const count = Math.max(2, Math.round(long / 6));
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          const off = (t - 0.5) * long * 1.7;
          const x = alongX ? b.x + off : b.x;
          const z = alongX ? b.z : b.z + off;
          push(joists, x, b.y - b.hy - 0.22, z, alongX ? 0.34 : span, 0.42, alongX ? span : 0.34);
        }
        // Corner caps: a machined edge catches the light and frames the deck.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const cx = b.x + sx * (b.hx - 0.32);
            const cz = b.z + sz * (b.hz - 0.32);
            push(caps, cx, b.y + b.hy + 0.12, cz, 0.62, 0.26, 0.62);
            push(caps, cx, b.y - b.hy - 0.12, cz, 0.62, 0.26, 0.62);
          }
        }
        // A few service lamps on the underside, aimed at the void.
        if (b.hx > 5 && b.hz > 5) {
          push(lampsOn, b.x, b.y - b.hy - 0.3, b.z, 1.1, 0.14, 1.1);
        }
      } else if (b.kind === 'wall') {
        // Pipe runs down the inner faces of the tall walls.
        const face = b.hx > b.hz ? 'x' : 'z';
        for (const side of [-1, 1]) {
          if (face === 'x') {
            push(pipes, b.x, b.y + b.hy * 0.2, b.z + side * (b.hz + 0.28), 0.26, b.hy * 1.5, 0.26);
          } else {
            push(pipes, b.x + side * (b.hx + 0.28), b.y + b.hy * 0.2, b.z, 0.26, b.hy * 1.5, 0.26);
          }
        }
      }
    }

    // ── Masonry ───────────────────────────────────────────────────────────
    // The central spire is the map's landmark, so it gets the only real
    // architectural treatment on the map: fluted faces, a cornice band every
    // few metres, and a stepped crown. Plain boxes read as placeholders; a
    // little articulated stone reads as a building.
    const flutes: THREE.Matrix4[] = [];
    const bands: THREE.Matrix4[] = [];
    const brackets: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind === 'strut' && b.hx >= 4 && b.hz >= 4) {
        // Flutes: shallow vertical ribs, pulled 0.1 m proud of the face.
        const n = Math.max(3, Math.round(b.hx));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          for (const side of [-1, 1]) {
            push(flutes, b.x + (t - 0.5) * b.hx * 1.9, b.y, b.z + side * (b.hz + 0.1), 0.34, b.hy * 1.96, 0.2);
            push(flutes, b.x + side * (b.hx + 0.1), b.y, b.z + (t - 0.5) * b.hz * 1.9, 0.2, b.hy * 1.96, 0.34);
          }
        }
        // Cornice + string courses: horizontal shadow lines break the height.
        const courses = Math.max(2, Math.round(b.hy / 9));
        for (let i = 0; i <= courses; i++) {
          const y = b.y - b.hy + (i / courses) * b.hy * 2;
          const grow = i === courses ? 0.55 : 0.3;
          push(bands, b.x, y, b.z, b.hx * 2 + grow * 2, i === courses ? 0.9 : 0.4, b.hz * 2 + grow * 2);
        }
      } else if (b.kind === 'deck' && b.hx > 5) {
        // Brackets under the rim: the slab looks carried, not floating.
        const span = Math.min(b.hx, b.hz);
        const n = Math.max(2, Math.round(b.hx * 0.5));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const x = b.x + (t - 0.5) * b.hx * 1.8;
          for (const side of [-1, 1]) {
            push(brackets, x, b.y - b.hy - 0.55, b.z + side * (b.hz - 0.5), 0.34, 1.0, span * 0.35);
            push(brackets, b.x + side * (b.hx - 0.5), b.y - b.hy - 0.55, b.z + (t - 0.5) * b.hz * 1.8, span * 0.35, 1.0, 0.34);
          }
        }
      }
    }

    // ── Panel joints and fascia ───────────────────────────────────────────
    // Concrete that has been cast in place is never one pour: every wall shows
    // horizontal lift lines and vertical shutter joints, and every slab has a
    // fascia band where the formwork was clamped. Two instanced draw calls buy
    // the whole map a scale and a history it did not have.
    const joints: THREE.Matrix4[] = [];
    const fascia: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind === 'wall' || (b.kind === 'strut' && b.hx >= 3 && b.hz >= 3)) {
        const lifts = Math.max(2, Math.round((b.hy * 2) / 3.4));
        for (let i = 1; i < lifts; i++) {
          const y = b.y - b.hy + (i / lifts) * b.hy * 2;
          push(joints, b.x, y, b.z, b.hx * 2 + 0.03, 0.05, b.hz * 2 + 0.03);
        }
        const bays = Math.max(2, Math.round(Math.max(b.hx, b.hz) / 2.6));
        for (let i = 1; i < bays; i++) {
          const t = (i / bays - 0.5) * 2;
          push(joints, b.x + t * b.hx * 0.98, b.y, b.z, 0.05, b.hy * 2, b.hz * 2 + 0.03);
          push(joints, b.x, b.y, b.z + t * b.hz * 0.98, b.hx * 2 + 0.03, b.hy * 2, 0.05);
        }
      } else if (b.kind === 'deck') {
        // Shadow gap under the top edge, and a fascia band below it.
        push(fascia, b.x, b.y + b.hy - 0.12, b.z, b.hx * 2 - 0.06, 0.09, b.hz * 2 - 0.06);
        push(fascia, b.x, b.y - b.hy + 0.1, b.z, b.hx * 2 + 0.02, 0.12, b.hz * 2 + 0.02);
      }
    }

    // ── Weathering ────────────────────────────────────────────────────────
    // Rain and rust trails on the vertical faces. One instanced draw call, and
    // the difference between "concrete texture" and "a building that has been
    // standing in weather" is almost entirely these streaks.
    const streakQuads: THREE.Matrix4[] = [];
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (const b of this.arena.blocks) {
      if (b.kind !== 'wall') continue;
      const faces: { axis: 'x' | 'z'; side: number; width: number }[] = [
        { axis: 'z', side: 1, width: b.hx * 2 },
        { axis: 'z', side: -1, width: b.hx * 2 },
        { axis: 'x', side: 1, width: b.hz * 2 },
        { axis: 'x', side: -1, width: b.hz * 2 },
      ];
      for (const face of faces) {
        const n = 3 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const along = (rnd() - 0.5) * face.width * 0.9;
          const wdt = 0.7 + rnd() * 2.2;
          const hgt = 4 + rnd() * Math.min(16, b.hy * 1.4);
          const y = b.y + b.hy - hgt * 0.5 - rnd() * 2;
          const off = (face.side > 0 ? 1 : -1) * 0.02;
          if (face.axis === 'z') {
            push(
              streakQuads,
              b.x + along,
              y,
              b.z + face.side * (b.hz + Math.abs(off)),
              wdt,
              hgt,
              1,
              face.side > 0 ? 0 : Math.PI,
            );
          } else {
            push(
              streakQuads,
              b.x + face.side * (b.hx + Math.abs(off)),
              y,
              b.z + along,
              wdt,
              hgt,
              1,
              face.side > 0 ? Math.PI / 2 : -Math.PI / 2,
            );
          }
        }
      }
    }
    if (streakQuads.length) {
      // The quads are built flat; rotate each into its wall plane by using a
      // plane whose local +z is the face normal.
      const quadGeo = new THREE.PlaneGeometry(1, 1);
      const grime = new THREE.MeshStandardMaterial({
        map: streakTexture(),
        transparent: true,
        opacity: 0.85,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const mesh = new THREE.InstancedMesh(quadGeo, grime, streakQuads.length);
      streakQuads.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = 'weathering';
      this.scene.add(mesh);
    }

    const instanced = (list: THREE.Matrix4[], geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): void => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    instanced(joists, unit, darkSteel);
    instanced(caps, unit, steel);
    instanced(brackets, unit, darkSteel);
    instanced(flutes, unit, steel);
    instanced(bands, unit, steel);
    const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 8);
    instanced(pipes, pipeGeo, steel);
    instanced(joints, unit, new THREE.MeshStandardMaterial({ color: 0x8e8a80, roughness: 1, metalness: 0 }), false);
    instanced(fascia, unit, new THREE.MeshStandardMaterial({ color: 0xb3aea2, roughness: 0.95, metalness: 0 }), false);
    void mat4;

    // Skyline: hazy towers and a crane out past the arena. They never enter
    // the play space; they exist so the horizon is a place, not a void.
    const skyline: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + (i % 3) * 0.06;
      const r = 300 + (i % 6) * 46;
      const h = 34 + ((i * 47) % 120);
      const w = 12 + ((i * 29) % 26);
      const g = new THREE.BoxGeometry(w, h, w * (0.6 + ((i * 7) % 10) / 10));
      g.translate(Math.cos(a) * r, h / 2 - 46, Math.sin(a) * r);
      skyline.push(g);
    }
    // Two cranes: a mast, a jib and a counter-jib.
    for (const [cx, cz, rot] of [[210, -150, 0.4], [-230, 120, 2.2]] as [number, number, number][]) {
      const mast = new THREE.BoxGeometry(3, 96, 3);
      mast.translate(cx, 2, cz);
      skyline.push(mast);
      const jib = new THREE.BoxGeometry(70, 2.4, 2.4);
      jib.translate(cx + Math.cos(rot) * 26, 48, cz + Math.sin(rot) * 26);
      jib.rotateY(rot);
      skyline.push(jib);
    }
    const cityGeo = mergeGeometries(skyline);
    const city = new THREE.Mesh(
      cityGeo,
      new THREE.MeshStandardMaterial({ color: 0x9aa9b8, roughness: 1, metalness: 0 }),
    );
    city.name = 'skyline';
    this.scene.add(city);

    // Lit windows on the nearest towers, so the skyline is not a flat cut-out.
    const winGeo = new THREE.PlaneGeometry(2.4, 1.4);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xf2e3c3, transparent: true, opacity: 0.5 });
    const wins: THREE.Matrix4[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 + 0.15;
      const r = 300 + (i % 6) * 46;
      const h = 34 + ((i * 47) % 120);
      const y = -40 + ((i * 13) % Math.max(10, h - 24)) + 12;
      wins.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * (r - 9), y, Math.sin(a) * (r - 9)),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
    instanced(wins, winGeo, winMat, false);
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

  /**
   * Both hands' worth of kit, built once. The marksman rifle is the long,
   * scoped, bolt-action silhouette; the grapnel is a chunky launcher with a
   * live spool. Only one is visible at a time — swapping is a physical motion,
   * not a texture change.
   */
  private buildViewmodel(skinIndex: number): THREE.Group {
    const skin = SKINS[skinIndex];
    const container = new THREE.Group();

    // The skin is a material set, not a decal: receiver, furniture, steel and
    // trim each take a colour from the catalogue plus one shared pattern map.
    const gs = gunSkin(this.look.gun);
    const gr = grappleSkin(this.look.grapple);
    const pattern = patternTexture(gs.pattern);
    if (this.gunPattern && this.gunPattern !== pattern) this.gunPattern.dispose();
    this.gunPattern = pattern;
    const mapped = pattern ? { map: pattern } : {};
    const shadeOf = (hex: number, k: number): number => new THREE.Color(hex).multiplyScalar(k).getHex();
    const gunmetal = new THREE.MeshStandardMaterial({ color: gs.metal, roughness: 0.42, metalness: 0.8, ...mapped });
    const blued = new THREE.MeshStandardMaterial({ color: shadeOf(gs.metal, 0.55), roughness: 0.3, metalness: 0.85, ...mapped });
    const polymer = new THREE.MeshStandardMaterial({ color: gs.panel, roughness: 0.82, metalness: 0.14, ...mapped });
    const sand = new THREE.MeshStandardMaterial({ color: gs.body, roughness: 0.62, metalness: 0.22, ...mapped });
    const accent = new THREE.MeshStandardMaterial({
      color: skin.color,
      roughness: 0.45,
      metalness: 0.3,
      emissive: new THREE.Color(skin.color),
      emissiveIntensity: 0.1,
    });
    const glove = new THREE.MeshStandardMaterial({ color: 0xb99455, roughness: 0.93, metalness: 0.02 });
    const gloveDark = new THREE.MeshStandardMaterial({ color: 0x8a6d40, roughness: 0.95, metalness: 0.02 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4b4e44, roughness: 0.96, metalness: 0.02 });
    const brass = new THREE.MeshStandardMaterial({ color: gs.trim, roughness: 0.3, metalness: 0.92 });
    const glass = new THREE.MeshStandardMaterial({
      color: gs.glow,
      emissive: new THREE.Color(gs.glow),
      emissiveIntensity: 0.4,
      roughness: 0.08,
      metalness: 0.95,
    });
    // Launcher furniture follows the grapnel skin, so 1 and 2 wear the same set.
    const gBody = new THREE.MeshStandardMaterial({ color: gr.body, roughness: 0.55, metalness: 0.45 });
    const gSpool = new THREE.MeshStandardMaterial({ color: gr.spool, roughness: 0.62, metalness: 0.5 });

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const cyl = (r1: number, r2: number, len: number, m: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'z' = 'z'): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), m);
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      else mesh.rotation.z = Math.PI / 2;
      mesh.position.set(x, y, z);
      return mesh;
    };

    // ── Marksman rifle ────────────────────────────────────────────────────
    const rifle = new THREE.Group();

    const receiver = box(0.086, 0.1, 0.44, sand, 0, 0.005, -0.36);
    rifle.add(receiver);
    rifle.add(box(0.072, 0.055, 0.48, gunmetal, 0, -0.055, -0.37));
    rifle.add(box(0.05, 0.016, 0.44, blued, 0, 0.062, -0.4));
    // Chamfered shoulders give the receiver a machined read instead of a slab.
    for (const side of [-1, 1]) {
      const chamfer = box(0.02, 0.03, 0.42, polymer, side * 0.041, 0.048, -0.38);
      chamfer.rotation.z = side * 0.5;
      rifle.add(chamfer);
    }

    // Barrel, flutes, brake.
    rifle.add(cyl(0.0145, 0.0155, 0.62, blued, 0, 0.008, -1.0));
    for (let i = 0; i < 3; i++) {
      const flute = cyl(0.0045, 0.0045, 0.5, gunmetal, 0, 0.008, -0.98);
      const a = (i / 3) * Math.PI * 2;
      flute.position.x = Math.cos(a) * 0.016;
      flute.position.y = 0.008 + Math.sin(a) * 0.016;
      rifle.add(flute);
    }
    const brake = cyl(0.03, 0.032, 0.12, gunmetal, 0, 0.008, -1.36);
    rifle.add(brake);
    rifle.add(cyl(0.033, 0.033, 0.014, brass, 0, 0.008, -1.31));
    rifle.add(cyl(0.033, 0.033, 0.014, brass, 0, 0.008, -1.41));
    for (const side of [-1, 1]) rifle.add(box(0.014, 0.03, 0.05, blued, side * 0.03, 0.008, -1.36));

    // Handguard with cooling slots.
    rifle.add(box(0.07, 0.072, 0.34, sand, 0, 0.004, -0.76));
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        rifle.add(box(0.004, 0.032, 0.03, polymer, side * 0.036, 0.004, -0.63 - i * 0.075));
      }
    }
    rifle.add(box(0.06, 0.014, 0.3, polymer, 0, -0.034, -0.76));

    // Optic: tube, objective bell, ocular, sunshade, turrets, mounts.
    const scopeY = 0.128;
    rifle.add(cyl(0.031, 0.031, 0.3, gunmetal, 0, scopeY, -0.3));
    rifle.add(cyl(0.043, 0.036, 0.1, gunmetal, 0, scopeY, -0.48));
    rifle.add(cyl(0.039, 0.034, 0.08, gunmetal, 0, scopeY, -0.13));
    rifle.add(cyl(0.046, 0.046, 0.03, blued, 0, scopeY, -0.535));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), glass);
    lens.position.set(0, scopeY, -0.545);
    lens.rotation.y = Math.PI;
    rifle.add(lens);
    const eyeLens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), glass);
    eyeLens.position.set(0, scopeY, -0.088);
    rifle.add(eyeLens);
    rifle.add(cyl(0.047, 0.049, 0.05, blued, 0, scopeY, -0.575));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.004, 5, 16), brass);
    rim.position.set(0, scopeY, -0.552);
    rifle.add(rim);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12), blued);
    turret.position.set(0, scopeY + 0.045, -0.34);
    rifle.add(turret);
    rifle.add(cyl(0.014, 0.014, 0.028, blued, 0.038, scopeY, -0.34, 'x'));
    for (const z of [-0.42, -0.2]) rifle.add(box(0.04, 0.05, 0.03, blued, 0, scopeY - 0.045, z));

    // Bolt handle: this group is animated through the cycle.
    this.boltGroup = new THREE.Group();
    this.boltGroup.position.set(0.045, 0.016, -0.14);
    const stem = cyl(0.011, 0.011, 0.075, gunmetal, 0.035, 0, 0, 'x');
    this.boltGroup.add(stem);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), blued);
    knob.position.x = 0.075;
    this.boltGroup.add(knob);
    rifle.add(this.boltGroup);

    // Magazine, grip, trigger, stock.
    const mag = box(0.052, 0.18, 0.11, polymer, 0, -0.13, -0.26);
    mag.rotation.x = 0.16;
    rifle.add(mag);
    rifle.add(box(0.056, 0.02, 0.12, gunmetal, 0, -0.22, -0.245));
    const grip = box(0.048, 0.15, 0.075, polymer, 0, -0.11, -0.03);
    grip.rotation.x = -0.34;
    rifle.add(grip);
    const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 5, 10), gunmetal);
    triggerGuard.rotation.x = Math.PI / 2;
    triggerGuard.position.set(0, -0.085, -0.135);
    rifle.add(triggerGuard);
    rifle.add(box(0.05, 0.085, 0.28, sand, 0, -0.01, 0.08));
    rifle.add(box(0.045, 0.032, 0.14, polymer, 0, 0.05, 0.04));
    rifle.add(box(0.06, 0.11, 0.028, polymer, 0, -0.012, 0.23));
    rifle.add(box(0.03, 0.02, 0.05, gunmetal, 0, 0.075, -0.02));

    // Cheek riser and recoil pad: the two parts that make a rifle look
    // shouldered rather than moulded from one lump.
    rifle.add(box(0.052, 0.03, 0.16, polymer, 0, 0.088, 0.06));
    rifle.add(box(0.055, 0.07, 0.03, blued, 0, -0.012, 0.25));
    // Rail slots along the receiver top.
    for (let i = 0; i < 3; i++) rifle.add(box(0.03, 0.008, 0.022, blued, 0, 0.072, -0.2 - i * 0.06));

    // Folding bipod: two legs and a hinge block. It is the detail that most
    // sells "this rifle was designed to be shot off a ledge".
    rifle.add(box(0.05, 0.026, 0.07, gunmetal, 0, -0.042, -0.86));
    for (const side of [-1, 1]) {
      const leg = cyl(0.007, 0.007, 0.3, blued, side * 0.024, -0.16, -0.9);
      leg.rotation.z = side * 0.22;
      leg.rotation.x = 0.28;
      rifle.add(leg);
      rifle.add(box(0.024, 0.014, 0.04, polymer, side * 0.055, -0.3, -0.94));
    }
    // Sling swivels and a strap loop under the stock.
    for (const z of [-0.62, 0.2]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.005, 5, 10), brass);
      loop.rotation.y = Math.PI / 2;
      loop.position.set(-0.045, -0.05, z);
      rifle.add(loop);
    }
    // Magnification ring with a throw lever, plus a parallax knob.
    const magRing = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 6, 18), polymer);
    magRing.position.set(0, scopeY, -0.2);
    magRing.rotation.y = Math.PI / 2;
    rifle.add(magRing);
    rifle.add(box(0.012, 0.02, 0.038, polymer, 0.03, scopeY + 0.026, -0.2));
    rifle.add(cyl(0.012, 0.012, 0.026, blued, -0.04, scopeY - 0.006, -0.2, 'x'));
    // Cheek-riser thumb screws and a bolt-body cover with a witness port.
    for (const z of [0.02, 0.1]) rifle.add(cyl(0.009, 0.009, 0.012, brass, 0.03, 0.076, z, 'x'));
    rifle.add(box(0.028, 0.014, 0.05, blued, 0.05, 0.016, -0.17));
    // Sling: two straps and a brass swivel.
    const slingA = box(0.014, 0.006, 0.5, sleeve, 0.055, -0.075, 0.03);
    slingA.rotation.x = 0.18;
    rifle.add(slingA);
    rifle.add(box(0.014, 0.006, 0.34, sleeve, 0.055, -0.055, -0.5));
    rifle.add(cyl(0.012, 0.012, 0.02, brass, 0.055, -0.088, 0.2, 'x'));
    // Ejection port + a chip of bare metal where the finish has worn.
    rifle.add(box(0.006, 0.026, 0.07, blued, -0.044, 0.028, -0.3));
    rifle.add(box(0.004, 0.014, 0.03, gunmetal, 0.045, -0.03, -0.72));

    // Folded bipod under the handguard.
    for (const side of [-1, 1]) {
      const leg = box(0.012, 0.012, 0.22, gunmetal, side * 0.028, -0.06, -0.62);
      leg.rotation.x = 0.22;
      rifle.add(leg);
    }

    // Team paint + stencil plate.
    rifle.add(box(0.004, 0.055, 0.2, accent, 0.045, -0.005, -0.42));
    rifle.add(box(0.004, 0.03, 0.05, accent, -0.045, 0.02, -0.2));

    // Hands: right on the grip, left under the handguard.
    const handR = box(0.075, 0.1, 0.13, glove, 0.004, -0.135, -0.03);
    handR.rotation.x = -0.3;
    rifle.add(handR);
    const handL = box(0.082, 0.088, 0.12, glove, -0.006, -0.075, -0.72);
    rifle.add(handL);
    for (let i = 0; i < 3; i++) {
      rifle.add(box(0.078, 0.018, 0.032, gloveDark, -0.004, -0.052 + i * 0.03, -0.74 - i * 0.001));
    }
    const sleeveR = cyl(0.055, 0.07, 0.3, sleeve, 0.07, -0.23, 0.02);
    sleeveR.rotation.set(1.25, 0, 0.16);
    rifle.add(sleeveR);
    const sleeveL = cyl(0.05, 0.066, 0.34, sleeve, -0.1, -0.19, -0.56);
    sleeveL.rotation.set(1.3, 0, -0.34);
    rifle.add(sleeveL);

    // ── Grapnel launcher ──────────────────────────────────────────────────
    const grapnel = new THREE.Group();
    grapnel.add(box(0.11, 0.12, 0.26, gBody, 0, -0.01, -0.17));
    grapnel.add(box(0.088, 0.075, 0.11, sand, 0, 0.032, -0.31));
    grapnel.add(cyl(0.05, 0.055, 0.18, gBody, 0, 0.02, -0.44));
    // Muzzle crown: a toothed brass ring, the launcher's one loud detail.
    grapnel.add(cyl(0.058, 0.058, 0.026, brass, 0, 0.02, -0.52));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      grapnel.add(box(0.014, 0.014, 0.03, brass, Math.cos(a) * 0.055, 0.02 + Math.sin(a) * 0.055, -0.535));
    }
    grapnel.add(cyl(0.058, 0.058, 0.022, brass, 0, 0.02, -0.35));
    grapnel.add(box(0.03, 0.022, 0.08, blued, 0, 0.09, -0.44));
    // Carrying handle over the receiver.
    grapnel.add(box(0.02, 0.016, 0.16, gunmetal, 0, 0.078, -0.19));

    // Spool: visible cable, spins while the claw is out.
    this.spool = new THREE.Group();
    this.spool.position.set(0, -0.035, -0.2);
    const spoolCore = gSpool;
    const cableMat = new THREE.MeshStandardMaterial({ color: gr.rope, roughness: 0.85, metalness: 0.2 });
    this.spool.add(cyl(0.052, 0.052, 0.05, spoolCore, 0, 0, 0, 'x'));
    const wound = cyl(0.056, 0.056, 0.042, cableMat, 0, 0, 0, 'x');
    this.spool.add(wound);
    for (const side of [-1, 1]) {
      this.spool.add(cyl(0.062, 0.062, 0.012, gunmetal, side * 0.032, 0, 0, 'x'));
    }
    grapnel.add(this.spool);
    grapnel.add(box(0.02, 0.05, 0.05, brass, 0.06, -0.035, -0.2));
    // Fairlead: the cable is guided out through a ringed eye, so the spool and
    // the muzzle read as one machine instead of two boxes.
    for (const z of [-0.34, -0.47]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 5, 12), gunmetal);
      eye.position.set(0, 0.045, z);
      eye.rotation.x = Math.PI / 2;
      grapnel.add(eye);
    }
    // Pressure gauge on the side, with a needle at the charged end.
    grapnel.add(cyl(0.026, 0.026, 0.012, brass, -0.07, -0.005, -0.22, 'x'));
    grapnel.add(box(0.004, 0.016, 0.003, blued, -0.077, 0.002, -0.222));
    // Side braces and a spare claw clipped under the barrel.
    for (const side of [-1, 1]) {
      const brace = box(0.012, 0.012, 0.22, gunmetal, side * 0.058, 0.0, -0.33);
      brace.rotation.z = side * 0.0;
      grapnel.add(brace);
    }
    grapnel.add(box(0.05, 0.018, 0.07, brass, 0, -0.062, -0.4));
    // Forearm brace: a wide yoke the off hand presses into.
    grapnel.add(box(0.09, 0.02, 0.05, polymer, 0, -0.075, -0.13));

    // The resting claw, cradled and ready.
    const ready = buildGrapnel(gr.claw);
    ready.scale.setScalar(0.55);
    ready.position.set(0, 0.035, -0.52);
    grapnel.add(ready);
    this.readyClaw = ready;

    const gGrip = box(0.048, 0.15, 0.075, polymer, 0, -0.11, -0.03);
    gGrip.rotation.x = -0.34;
    grapnel.add(gGrip);
    const gGuard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 5, 10), gunmetal);
    gGuard.rotation.x = Math.PI / 2;
    gGuard.position.set(0, -0.08, -0.12);
    grapnel.add(gGuard);
    grapnel.add(box(0.004, 0.05, 0.16, accent, 0.05, 0.0, -0.18));
    const gHandR = box(0.075, 0.1, 0.13, glove, 0.004, -0.135, -0.03);
    gHandR.rotation.x = -0.3;
    grapnel.add(gHandR);
    grapnel.add(box(0.08, 0.085, 0.12, glove, -0.005, -0.07, -0.24));
    const gSleeveR = cyl(0.055, 0.07, 0.3, sleeve, 0.07, -0.23, 0.02);
    gSleeveR.rotation.set(1.25, 0, 0.16);
    grapnel.add(gSleeveR);
    const gSleeveL = cyl(0.05, 0.066, 0.3, sleeve, -0.11, -0.2, -0.14);
    gSleeveL.rotation.set(1.3, 0, -0.4);
    grapnel.add(gSleeveL);

    // Cull the static parts down to one mesh per material (the bolt, spool and
    // the cradle claw stay separate because they animate).
    mergeChildren(ready, new Set());
    mergeChildren(rifle, new Set<THREE.Object3D>([this.boltGroup]));
    mergeChildren(grapnel, new Set<THREE.Object3D>([this.spool, ready]));

    rifle.position.set(0, 0, 0);
    grapnel.position.set(0, 0, 0);
    container.add(rifle, grapnel);
    this.rifleModel = rifle;
    this.grapnelModel = grapnel;
    this.slotBlend = skinIndex === -1 ? 0 : this.slotBlend;

    container.position.set(0.2, -0.19, -0.1);
    container.scale.setScalar(1.06);
    container.rotation.y = -0.06;
    container.visible = false;
    this.viewmodelSkin = skinIndex;
    return container;
  }

  /** Cosmetic kick for the launcher; the sim already knows the hook is away. */
  hookFire(): void {
    this.hookKick = 1;
    this.punch(-0.03, 0.01);
  }

  /** Sparks at the bite point. */
  /** Widens the lens for a beat. Positive reads as a jolt of speed. */
  fovPulse(deg: number): void {
    this.fovPunch = Math.min(14, this.fovPunch + deg);
  }

  /** A missed claw flies back to the hand instead of vanishing at range. */
  retractHook(index: number, from: Vec3): void {
    this.hookRetract[index] = { t: 0, from: { ...from } };
  }

  hookHit(pos: Vec3): void {
    const trail = grappleSkin(this.look.grapple).trail;
    this.particles.burst(pos, trail, 16, { speed: 6, size: 0.12, life: 0.35, gravity: 8 });
    this.waves.spawn(pos, trail, 2.4, 0.3);
  }

  /**
   * Applies the equipped kit. Called on equip and on join; the viewmodel is
   * rebuilt only when the rifle or launcher material set actually changes.
   */
  applyLoadout(look: Loadout): void {
    const changed = look.gun !== this.look.gun || look.grapple !== this.look.grapple;
    this.look = { ...look };
    if (changed) this.rebuildViewmodel();
  }

  /** The reticle that shows which pinion the claw would bite. */
  private buildAimMark(): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: aimRingTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: true,
      }),
    );
    sprite.visible = false;
    sprite.renderOrder = 4;
    this.aimMark = sprite;
    this.scene.add(sprite);
  }

  /**
   * Where the claw would bite if the trigger were pulled now. Null hides the
   * marker (wrong slot, no target, or the throw is out of range).
   */
  setGrappleAim(point: Vec3 | null, onPlayer = false): void {
    this.aimTarget = point ? { point: { ...point }, onPlayer } : null;
  }

  /** The opponent's kit: rifle furniture, claw metal and cable colour. */
  applyRemoteLook(look: Loadout): void {
    this.remoteLook = { ...look };
    const gs = gunSkin(look.gun);
    const gr = grappleSkin(look.grapple);
    const visual = this.players[1 - this.localIndex];
    if (visual) {
      visual.kitBody.color.setHex(gs.body);
      visual.kitPanel.color.setHex(gs.panel);
      visual.kitTrim.color.setHex(gs.trim);
    }
    const head = this.hookHeads[1 - this.localIndex];
    if (head) {
      head.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.metalness !== undefined && mat.metalness > 0.5) mat.color.setHex(gr.claw);
      });
    }
  }

  /** Their kill, dressed in their effect. */
  killBurst(at: Vec3, effectId: string, scale = 1): void {
    const fx = killEffect(effectId);
    this.particles.burst(at, fx.burst, Math.round(26 * scale), { speed: 9 * scale, size: 0.16, life: 0.5, gravity: 10 });
    this.particles.burst(at, fx.motes, Math.round(18 * scale), { speed: 3.5 * scale, size: 0.22, life: 0.85, gravity: -1.2 });
    this.waves.spawn(at, fx.ring, 3.2 * scale, 0.45);
    this.waves.spawn(at, fx.burst, 1.6 * scale, 0.28);
  }

  private rebuildViewmodel(): void {
    const index = this.viewmodelSkin < 0 ? 0 : this.viewmodelSkin;
    this.camera.remove(this.viewmodel);
    this.viewmodel = this.buildViewmodel(index);
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.008, -1.42);
    this.camera.add(this.viewmodel);
  }

  setSkin(index: 0 | 1): void {
    if (this.viewmodelSkin === index) return;
    this.camera.remove(this.viewmodel);
    this.viewmodel = this.buildViewmodel(index);
    this.camera.add(this.viewmodel);
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.008, -1.42);
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
    this.fovPunch *= Math.exp(-dt * 7);
    const hipFov = WEAPON.baseFov + speedT * WEAPON.maxFovKick + this.fovPunch;
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
      // Their hands show the same kit they have equipped.
      const slot = isLocal ? local.slot : remote.slot;
      visual.rifle.visible = slot === 0;
      visual.launcher.visible = slot === 1;
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

    this.localIndex = local.id;

    // ── Ropes ──────────────────────────────────────────────────────────────
    const localRopeColor = grappleSkin(this.look.grapple).rope;
    const remoteRopeColor = grappleSkin(this.remoteLook.grapple).rope;
    const rope = local.hook.active ? view.localRope : local.grapple.active && local.grapple.mode !== 'none' ? view.localRope : null;
    this.drawRope(0, local.eye, rope, localRopeColor, dt);
    this.drawRope(
      1,
      { x: remote.pos.x, y: remote.pos.y + 0.35, z: remote.pos.z },
      remote.grapple.active || remote.hook.active ? view.remoteRope : null,
      remoteRopeColor,
      dt,
    );

    // ── Grapnel aim marker ─────────────────────────────────────────────────
    // A ring that lives on the pinion the claw would bite. It is not a HUD
    // element: it is sized in metres at the anchor, so it shrinks with range
    // exactly like a real sight picture does.
    if (this.aimMark) {
      const show = !!this.aimTarget && local.alive && local.slot === 1 && !view.killcam && local.scopeT < 0.5;
      this.aimMark.visible = show;
      if (show && this.aimTarget) {
        const at = this.aimTarget.point;
        const d = Math.hypot(at.x - local.eye.x, at.y - local.eye.y, at.z - local.eye.z);
        this.aimMark.position.set(at.x, at.y, at.z);
        const onPlayer = this.aimTarget.onPlayer;
        const breathe = 1 + Math.sin(this.time * (onPlayer ? 9 : 4.5)) * 0.05;
        this.aimMark.scale.setScalar(clamp(d * 0.048, 0.6, 3) * breathe);
        const mat = this.aimMark.material;
        mat.color.setHex(onPlayer ? 0xff6a52 : grappleSkin(this.look.grapple).trail);
        mat.rotation = this.time * (onPlayer ? 1.8 : 0.45);
        mat.opacity = 0.62 + Math.sin(this.time * 6) * 0.12;
      }
    }

    // Air off the cable: while a swing is carrying you, the fast air peels
    // past in short motes tinted to the kit. Purely cosmetic, frame-rate safe.
    this.moteAcc = 0;
    if (local.grapple.active && local.grapple.mode === 'swing' && local.speed > 24) {
      const k = clamp((local.speed - 24) / 36, 0, 1);
      this.moteAcc += dt * (10 + 34 * k);
      const trail = grappleSkin(this.look.grapple).trail;
      const n = Math.min(8, Math.floor(this.moteAcc));
      for (let i = 0; i < n; i++) {
        this.particles.ember(
          {
            x: local.eye.x + (Math.random() - 0.5) * 1.6,
            y: local.eye.y + (Math.random() - 0.5) * 1.6,
            z: local.eye.z + (Math.random() - 0.5) * 1.6,
          },
          trail,
          0.22,
          0.3,
        );
      }
      this.moteAcc -= n;
    }

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
      // Pinions inside the claw's reach read warm; the rest sit back in brass
      // shadow. It is the same information the reticle gives, available at a
      // glance, and it costs nothing: 44 instance colours, no draw calls.
      const holding = local.slot === 1;
      this.arena.anchors.forEach((a, i) => {
        m.compose(new THREE.Vector3(a.x, a.y + Math.sin(this.time * 1.2 + i) * 0.08, a.z), q, new THREE.Vector3(1, 1, 1));
        this.anchorInst!.setMatrixAt(i, m);
        const d = Math.hypot(a.x - local.eye.x, a.y - local.eye.y, a.z - local.eye.z);
        const inReach = holding && d <= GRAPPLE.range;
        const heat = inReach ? clamp(1 - d / GRAPPLE.range, 0, 1) : 0;
        this.tint.setHex(0x6d604a).lerp(this.warm, 0.25 + heat * 0.75);
        this.anchorInst!.setColorAt(i, this.tint);
      });
      this.anchorInst.instanceMatrix.needsUpdate = true;
      if (this.anchorInst.instanceColor) this.anchorInst.instanceColor.needsUpdate = true;
    }
    if (this.anchorHalos) {
      (this.anchorHalos.material as THREE.PointsMaterial).opacity = 0.3 + Math.sin(this.time * 2) * 0.1;
    }
    if (this.floaters) this.floaters.rotation.y = this.time * 0.008;

    // ── Viewmodel ──────────────────────────────────────────────────────────
    // Swapping is a physical motion: the outgoing item drops out of frame and
    // the new one rises into it, so 1 / 2 reads instantly even in a fight.
    this.slotBlend = lerp(this.slotBlend, local.slot, 1 - Math.exp(-dt * 13));
    const blend = this.slotBlend;
    this.rifleModel.visible = blend < 0.985;
    this.grapnelModel.visible = blend > 0.015;
    this.rifleModel.position.y = -blend * 0.42;
    this.rifleModel.rotation.x = blend * 0.9;
    this.grapnelModel.position.y = -(1 - blend) * 0.42;
    this.grapnelModel.rotation.x = (1 - blend) * 0.9;

    // Bolt cycle: handle lifts and draws back while the next round feeds.
    const cycle = local.fireCooldown > 0 ? clamp(local.fireCooldown / 0.5, 0, 1) : 0;
    const lifted = Math.sin(Math.min(1, (1 - cycle) * 2) * Math.PI);
    this.boltGroup.rotation.x = -lifted * 1.15;
    this.boltGroup.position.z = -0.14 + lifted * 0.06;
    // Spool pays out while the claw is away.
    this.hookKick = Math.max(0, this.hookKick - dt * 6);
    this.spool.rotation.x += dt * (local.hook.active ? 26 : 0) + this.hookKick * dt * 40;
    // One claw, one place: while it is out the launcher's cradle is empty.
    const clawAway = local.hook.active || local.grapple.active;
    this.readyClaw.visible = !clawAway;
    this.grapnelModel.position.z = this.hookKick * 0.07;

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
    const head = this.hookHeads[index];
    const pulse = this.ropePulses[index];
    const halo = this.biteHalos[index];
    if (!rope) {
      entry.line.visible = false;
      entry.sheath.visible = false;
      pulse.visible = false;
      halo.visible = false;
      const back = this.hookRetract[index];
      if (back.t < 1) {
        back.t = Math.min(1, back.t + dt * 9);
        const e = 1 - Math.pow(1 - back.t, 2.4);
        head.visible = true;
        head.position.set(
          lerp(back.from.x, from.x, e),
          lerp(back.from.y, from.y, e),
          lerp(back.from.z, from.z, e),
        );
        head.lookAt(from.x, from.y, from.z);
        head.rotateZ(dt * 14);
        head.scale.setScalar(1 - 0.25 * e);
        const mat = (head.getObjectByName('hookspark') as THREE.Sprite | undefined)?.material as
          | THREE.SpriteMaterial
          | undefined;
        if (mat) {
          mat.opacity = 0.4 * (1 - e);
          (head.getObjectByName('hookspark') as THREE.Sprite).visible = mat.opacity > 0.02;
        }
        this.hookClaw[index] = lerp(this.hookClaw[index], 0.8, 1 - Math.exp(-dt * 12));
      } else {
        head.visible = false;
        this.hookClaw[index] = lerp(this.hookClaw[index], 0, 1 - Math.exp(-dt * 20));
      }
      return;
    }
    this.hookRetract[index].t = 1;

    const dist = Math.hypot(rope.anchor.x - from.x, rope.anchor.y - from.y, rope.anchor.z - from.z);
    const slack = Math.max(0, rope.length - dist);
    // A taut cable is a straight line; slack hangs. In flight the cable is
    // being pulled out of the spool, so it stays dead straight and thin.
    const flight = !!rope.inFlight;
    const sag = flight ? 0 : Math.min(3.2, slack * 0.5);
    const taut = !flight && slack < 0.6;
    const whip = taut ? Math.sin(this.time * 26 + index) * 0.02 : 0;
    const SEG = 20;
    const pts: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const s = Math.sin(Math.PI * t) * sag;
      // A small lateral wobble so a taut line reads as loaded, not painted on.
      const ox = Math.sin(Math.PI * t) * whip;
      pts.push(
        from.x + (rope.anchor.x - from.x) * t + ox,
        from.y + (rope.anchor.y - from.y) * t - s,
        from.z + (rope.anchor.z - from.z) * t + ox * 0.5,
      );
    }
    entry.geo.setPositions(pts);
    entry.sheathGeo.setPositions(pts);
    entry.line.visible = true;
    entry.sheath.visible = true;
    const clawSkin = grappleSkin(index === 0 ? this.look.grapple : this.remoteLook.grapple);
    entry.mat.color.setHex(flight ? clawSkin.trail : color);
    entry.mat.linewidth = flight ? 1.1 : rope.mode === 'zip' ? 1.9 : 1.5;
    entry.mat.opacity = 0.9;
    entry.sheathMat.linewidth = flight ? 2.6 : rope.mode === 'zip' ? 5 : 4.2;
    // The sheath takes the kit's colour too, darkened: a cable is part of the
    // skin, not a black line drawn on top of it.
    const sheathCol = new THREE.Color(clawSkin.rope).multiplyScalar(0.42);
    entry.sheathMat.color.copy(sheathCol);
    // Taut cable hums: the core widens and brightens as the reel loads up.
    const tension = clamp(1 - slack / 3.2, 0, 1);
    entry.mat.linewidth = (flight ? 1.1 : rope.mode === 'zip' ? 1.9 : 1.5) * (1 + tension * 0.35);

    // Bead on the cable: pays out fast in flight, crawls while reeling in.
    if (!flight) {
      const speed = rope.mode === 'zip' ? 2.4 : 0.55;
      const t = (this.time * speed + index * 0.37) % 1;
      pulse.position.set(
        from.x + (rope.anchor.x - from.x) * t,
        from.y + (rope.anchor.y - from.y) * t - Math.sin(Math.PI * t) * sag,
        from.z + (rope.anchor.z - from.z) * t,
      );
      pulse.material.color.setHex(clawSkin.trail);
      pulse.material.opacity = 0.5 + 0.35 * tension;
      pulse.scale.setScalar(1.1 + 0.6 * tension);
      pulse.visible = true;
    } else {
      pulse.visible = false;
    }

    // The bite point glows, and breathes harder the more the rope is loaded.
    halo.position.set(rope.anchor.x, rope.anchor.y, rope.anchor.z);
    halo.material.color.setHex(clawSkin.trail);
    halo.material.opacity = (flight ? 0.55 : 0.3 + tension * 0.35) * (0.85 + Math.sin(this.time * 9 + index) * 0.15);
    halo.scale.setScalar((flight ? 2.6 : 3.4) + tension * 1.2);
    halo.visible = true;

    // Claw: spins open in flight, snaps shut on the bite.
    head.visible = true;
    head.position.set(rope.anchor.x, rope.anchor.y, rope.anchor.z);
    const dx = rope.anchor.x - from.x;
    const dy = rope.anchor.y - from.y;
    const dz = rope.anchor.z - from.z;
    head.lookAt(rope.anchor.x + dx, rope.anchor.y + dy, rope.anchor.z + dz);
    const target = flight ? 1 : 0;
    this.hookClaw[index] = lerp(this.hookClaw[index], target, 1 - Math.exp(-dt * (flight ? 14 : 26)));
    const open = this.hookClaw[index];
    head.children.forEach((child) => {
      if (child.name.startsWith('hinge')) {
        const i = Number(child.name.slice(5));
        child.rotation.z = ((i / 3) * Math.PI * 2);
        const fluke = child.children[0];
        if (fluke) fluke.rotation.x = -0.15 - open * 0.85;
      }
    });
    head.rotateZ(flight ? dt * 9 : 0);
    head.scale.setScalar(flight ? 1.15 : 1);
    const spark = head.getObjectByName('hookspark') as THREE.Sprite | undefined;
    if (spark) {
      const mat = spark.material as THREE.SpriteMaterial;
      mat.color.setHex(clawSkin.trail);
      mat.opacity = lerp(mat.opacity, flight ? 0.55 : 0, 1 - Math.exp(-dt * 12));
      spark.visible = mat.opacity > 0.02;
    }
    head.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.metalness !== undefined && mat.metalness > 0.5) mat.color.setHex(clawSkin.claw);
    });
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
