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
import { Arcs, Debris, Decals, Fx, Ornament, Rings, Shells } from './fx.ts';
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
  chevronTexture,
  lensDirtTexture,
  namePlateTexture,
  scorchTexture,
  streakTexture,
  sweepTexture,
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
  /** Vertical velocity and contact: the pose needs both to read as a jump. */
  vel: Vec3;
  grounded: boolean;
  scopeT: number;
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

/** The subset of player state the skeleton reads; local and remote both fit. */
type PoseState = {
  speed: number;
  vel: Vec3;
  grounded: boolean;
  sliding: boolean;
  yaw: number;
  pitch: number;
  slot: 0 | 1;
  scopeT: number;
  grapple: { active: boolean; mode: 'none' | 'swing' | 'zip' };
  alive: boolean;
};

/** Initial facing for a seat, so the first frame does not read as a spin. */
const skinIndexYaw = (i: number): number => (i === 0 ? 0 : Math.PI);

/** Per-character animation memory: phase, eased poses, gesture timers. */
interface PlayerAnim {
  phase: number;
  run: number;
  air: number;
  slide: number;
  swing: number;
  zip: number;
  squash: number;
  spawn: number;
  alive: boolean;
  kick: number;
  swap: number;
  slot: number;
  wasGrounded: boolean;
  lastVy: number;
}

interface PlayerVisual {
  group: THREE.Group;
  /** Pelvis pivot: everything above the hips leans, ducks and breathes here. */
  body: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group[];
  hips: THREE.Group[];
  knees: THREE.Group[];
  /** Both weapons hang off this, so kick, draw and swap share one transform. */
  weapon: THREE.Group;
  torso: THREE.Mesh;
  visor: THREE.Mesh;
  anim: PlayerAnim;
  /** Smoothed yaw rate, -1..1: cape sway and lean read the turn, not the aim. */
  turn: number;
  lastYaw: number;
  jetL: THREE.Sprite;
  jetR: THREE.Sprite;
  /** Thruster cones under the pack: solid geometry, not just a glow sprite. */
  thrust: THREE.Mesh[];
  /** A scored cape in four hinged panels, so speed is visible on the body. */
  cape: THREE.Mesh[];
  /** The visor's lamp: a thin line of team light you can find at 90 m. */
  lamp: THREE.Sprite;
  /** Anamorphic streak: a horizontal bar, the classic scope-shine tell. */
  glintStreak: THREE.Sprite;
  /** A wide, soft halo that lifts the glint off a bright sky. */
  glintHalo: THREE.Sprite;
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
function buildGrapnel(metalHex: number, shape: 'tri' | 'quad' | 'twin' | 'ring' = 'tri', glow = 0xffe0a8): THREE.Group {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.38, metalness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: metalHex, roughness: 0.34, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.7, metalness: 0.4 });
  const lit = new THREE.MeshStandardMaterial({
    color: glow,
    roughness: 0.2,
    metalness: 0.6,
    emissive: new THREE.Color(glow),
    emissiveIntensity: 1.4,
  });

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

  // A hot core in the throat of the head. It is the one part of the claw that
  // reads at any distance, and it is tinted by the kit's trail colour.
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), lit);
  core.position.z = -0.12;
  core.name = 'hookcore';
  root.add(core);

  // The silhouette is the skin: three slim flukes, four needle flukes, two
  // heavy barbed hooks, or the three-fluke head caged in a gold ring.
  const count = shape === 'quad' ? 4 : shape === 'twin' ? 2 : 3;
  const heavy = shape === 'twin';
  for (let i = 0; i < count; i++) {
    const hinge = new THREE.Group();
    hinge.name = `hinge${i}`;
    const base = (i / count) * Math.PI * 2;
    hinge.userData.baseAngle = base;
    hinge.rotation.z = base;
    const fluke = new THREE.Group();
    fluke.position.z = -0.16;
    const armLen = heavy ? 0.15 : shape === 'quad' ? 0.18 : 0.15;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(heavy ? 0.036 : 0.026, heavy ? 0.034 : 0.026, armLen), steel);
    arm.position.z = -armLen / 2;
    fluke.add(arm);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(heavy ? 0.028 : 0.021, heavy ? 0.12 : 0.09, 6), brass);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -armLen - (heavy ? 0.05 : 0.03);
    fluke.add(tip);
    if (heavy) {
      // A barb behind the point, so the heavy head looks like it holds.
      const barb = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 5), dark);
      barb.rotation.set(-Math.PI / 2, 0, 0);
      barb.position.set(0, 0.022, -armLen - 0.005);
      fluke.add(barb);
    }
    if (shape === 'quad') {
      // A stabiliser vane between the needles: it spins in flight.
      const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.06), steel);
      vane.position.set(0, 0.02, -0.05);
      vane.rotation.x = -Math.PI / 2;
      fluke.add(vane);
    }
    hinge.add(fluke);
    root.add(hinge);
  }

  if (shape === 'ring') {
    // The cage: two brass hoops straddling the flukes, purely ornamental.
    for (const z of [-0.19, -0.3]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.007, 5, 20), brass);
      hoop.position.z = z;
      root.add(hoop);
    }
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 18), lit);
    cage.position.z = -0.24;
    cage.rotation.x = Math.PI / 2;
    root.add(cage);
  }

  if (heavy) root.scale.setScalar(1.12);
  return root;
}

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
  /** The working hand: it rides the bolt handle through the cycle. */
  private handRig: THREE.Group = new THREE.Group();
  private spool: THREE.Object3D = new THREE.Object3D();
  /** The loaded claw in the launcher's throat; hidden while one is in flight. */
  private readyClaw: THREE.Object3D = new THREE.Object3D();
  private slotBlend = 0;
  private hookKick = 0;
  /** Landing spring on the viewmodel: a dip and a rebound, not a wobble. */
  private landSpring = 0;
  private hookHeads: THREE.Group[] = [];
  /** A bead that runs down the cable while the reels are turning. */
  private ropePulses: THREE.Sprite[] = [];
  /** Halo where the claw bit: proves the bite point to both players. */
  private biteHalos: THREE.Sprite[] = [];
  /** World-space marker for the pinion the claw would bite right now. */
  private aimMark: THREE.Sprite | null = null;
  private aimTarget: { point: Vec3; onPlayer: boolean } | null = null;
  private moteAcc = 0;
  /** Pooled debris, lightning, scorch, brass and shock rings. */
  private fx!: Fx;
  /** Debris pool, exposed for hit confirms that do not need the whole Fx door. */
  private get shards() {
    return this.fx.shards;
  }
  /** The moving parts of the equipped kit. */
  private gunOrnament: Ornament | null = null;
  private ropeOrnament: Ornament | null = null;
  private sweepBand: THREE.Mesh | null = null;
  private sweepMat: THREE.MeshBasicMaterial | null = null;
  private accentMats: THREE.MeshStandardMaterial[] = [];
  private gunAnim = { sweep: 0, pulse: 0, glow: 0 };
  private glassMats: THREE.MeshStandardMaterial[] = [];
  private lastRemote: Vec3 | null = null;
  /** The spire's rotating warning beacon: the map's one moving landmark. */
  private beaconSweep: THREE.Group | null = null;
  private beaconLamp: THREE.Sprite | null = null;
  /** Slow fog banks drifting through the void below the decks. */
  private fogBanks: {
    mesh: THREE.InstancedMesh;
    speed: number;
    phase: number;
    baseY: number;
    size: number;
    radius: number;
    tint: number;
  }[] = [];
  private fogBank: THREE.InstancedMesh | null = null;
  private fogBankCount = 0;
  private fogMatrix = new THREE.Matrix4();
  private fogQuat = new THREE.Quaternion();
  private fogScale = new THREE.Vector3();
  private fogPos = new THREE.Vector3();
  private fogLook = new THREE.Matrix4();
  private fogAim = new THREE.Vector3();
  private ropeMoteAcc = [0, 0];
  private readonly sunDir = new THREE.Vector3(-0.46, 0.62, -0.62).normalize();
  private readonly sunScreen = new THREE.Vector2(0.5, 0.5);
  private readonly sunProbe = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly camForwardWorld = new THREE.Vector3(0, 0, -1);
  /** 1 → 0 while the weapon is being turned over after a skin change. */
  private inspect = 0;
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
  /**
   * The three short-range lights on the viewmodel rig. They live with the
   * weapon and are switched off with it: a point light is charged to every
   * fragment of every material in the scene, so a stowed rifle must not keep
   * paying for the light it is not standing in.
   */
  private vmLights: THREE.PointLight[] = [];
  /** A brief flare at the muzzle: a star, not a ball. */
  private muzzleFlare: THREE.Sprite;
  /** One light that lives at the most recent impact. */
  private impactLight: THREE.PointLight;
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
    this.buildEnvironment();
    this.scene.add(this.sky.group);
    this.buildArena();
    this.buildPlayers();
    this.buildRing();
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.35,
      flatShading: true,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      vertexColors: false,
    });
    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
      emissive: 0xffffff,
      emissiveIntensity: 0.25,
    });
    this.fx = new Fx(
      new Debris(this.scene, new THREE.TetrahedronGeometry(0.16), shardMat, 220),
      new Debris(this.scene, new THREE.PlaneGeometry(0.34, 0.14), petalMat, 120),
      new Arcs(this.scene),
      new Decals(this.scene, scorchTexture(), 26),
      new Shells(this.camera, 6),
      new Rings(this.scene, 14),
    );
    this.scene.add(this.particles.points, this.beams.group, this.waves.group);

    // The camera must be IN the scene graph: three.js only draws what it can
    // reach from the scene, and the entire first-person weapon (plus its three
    // lights) hangs off the camera. Without this line the rifle and the
    // grapnel are built, animated, and never drawn.
    this.scene.add(this.camera);
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
    this.vmLights = [key, rim, fill];

    this.muzzle = this.makeSprite(0xfff0c0, 1.1);
    this.muzzle.visible = false;
    this.viewmodel.add(this.muzzle);
    this.muzzle.position.set(0, 0.008, -1.42);
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 14, 2);
    this.muzzleLight.position.set(0, 0.06, -1.55);
    this.camera.add(this.muzzleLight);
    this.muzzleFlare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.flare,
        color: 0xffe0a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.muzzleFlare.visible = false;
    this.viewmodel.add(this.muzzleFlare);
    this.muzzleFlare.position.set(0, 0.008, -1.44);
    this.impactLight = new THREE.PointLight(0xffdca8, 0, 26, 2);
    this.scene.add(this.impactLight);

    this.post = new PostFX(this.renderer, this.scene, this.camera, lensDirtTexture());
    this.resize();
  }

  /**
   * Image-based lighting.
   *
   * Metal with no environment is black plastic: every chrome, brass and blued
   * surface in this game was being lit only by a hemisphere light, which is
   * why the rifle read as painted. Rendering the sky into a prefiltered
   * environment map once costs a few milliseconds at boot and gives every
   * metal on the map the actual sky, in the actual colours, in every highlight.
   */
  private buildEnvironment(): void {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      // Only the sky dome and its clouds: the arena would bake its own shadow.
      envScene.add(this.sky.group.clone(true));
      const env = pmrem.fromScene(envScene, 0, 1, 900);
      this.scene.environment = env.texture;
      // Dialled back so daylight stays directional: the sun still owns the
      // shadows, this only fills the metal.
      this.scene.environmentIntensity = 0.5;
      pmrem.dispose();
    } catch {
      // A context that cannot render to a cube still gets the directional rig.
    }
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

    // ── Sunlit trim + ledge chevrons ──────────────────────────────────────
    // A thin, bright top edge on every deck catches the low sun and draws the
    // silhouette of each platform. Chelseas at the rim point back to safety,
    // which is the map teaching the same lesson the ring does.
    const trim: THREE.Matrix4[] = [];
    for (const b of this.arena.blocks) {
      if (b.kind !== 'deck') continue;
      trim.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(b.x, b.y + b.hy + 0.008, b.z),
          new THREE.Quaternion(),
          new THREE.Vector3(b.hx * 2 + 0.05, 0.016, b.hz * 2 + 0.05),
        ),
      );
    }
    if (trim.length) {
      const trimMat = new THREE.MeshStandardMaterial({
        color: 0xefe8d6,
        roughness: 0.55,
        metalness: 0.12,
        emissive: 0x2a2418,
        emissiveIntensity: 0.4,
      });
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), trimMat, trim.length);
      trim.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      this.scene.add(inst);
    }

    const chevrons: THREE.Matrix4[] = [];
    const chevMat = new THREE.MeshBasicMaterial({
      map: chevronTexture(),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    for (const b of this.arena.blocks) {
      if (b.kind !== 'deck' || b.hx < 3 || b.hz < 3) continue;
      const y = b.y + b.hy + 0.02;
      const w = Math.min(2.6, Math.min(b.hx, b.hz) * 0.5);
      const edge: [number, number, number][] = [
        [b.x, b.z - b.hz + w * 0.9, 0],
        [b.x, b.z + b.hz - w * 0.9, Math.PI],
        [b.x - b.hx + w * 0.9, b.z, Math.PI / 2],
        [b.x + b.hx - w * 0.9, b.z, -Math.PI / 2],
      ];
      for (const [x, z, rot] of edge) {
        chevrons.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rot)),
            new THREE.Vector3(w, w, 1),
          ),
        );
      }
    }
    if (chevrons.length) {
      const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), chevMat, chevrons.length);
      chevrons.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.renderOrder = 1;
      this.scene.add(inst);
    }

    // ── The landmark ──────────────────────────────────────────────────────
    // The spire crown gets a rotating warning beacon and a mast with guy wires.
    // Everything on this map is static, so one moving light in the sky gives the
    // whole arena a heartbeat and a direction you can orient by.
    const crown = this.arena.blocks.find((b) => b.kind === 'beacon');
    if (crown) {
      const top = crown.y + crown.hy;
      const sweep = new THREE.Group();
      sweep.position.set(crown.x, top + 0.35, crown.z);
      // A shallow cone of light, additive, no depth write, so it reads as haze
      // rather than a solid object you could hook onto.
      const coneGeo = new THREE.CylinderGeometry(0.12, 5.2, 9, 24, 1, true);
      coneGeo.translate(0, -4.5, 0);
      coneGeo.rotateX(Math.PI / 2);
      coneGeo.translate(0, 0, 4.5);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xffe2b0,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      sweep.add(cone);
      this.beaconSweep = sweep;
      this.scene.add(sweep);

      const lamp = new THREE.Sprite(
        this.makeGlowSpriteMaterial(0xffd9a0, 0.85),
      );
      lamp.position.set(crown.x, top + 0.42, crown.z);
      lamp.scale.setScalar(3.2);
      this.beaconLamp = lamp;
      this.scene.add(lamp);

      // Mast and guy wires: three thin cylinders and three cables.
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.16, 9, 8),
        new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.55, metalness: 0.6 }),
      );
      mast.position.set(crown.x, top + 4.6, crown.z);
      this.scene.add(mast);
      const stayPts: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const bx = crown.x + Math.cos(a) * crown.hx * 0.85;
        const bz = crown.z + Math.sin(a) * crown.hz * 0.85;
        stayPts.push(new THREE.Vector3(bx, top + 0.1, bz), new THREE.Vector3(crown.x, top + 8.6, crown.z));
      }
      const stays = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(stayPts),
        new THREE.LineBasicMaterial({ color: 0x9aa2aa, transparent: true, opacity: 0.55 }),
      );
      this.scene.add(stays);
    }

    // ── Weather in the void ───────────────────────────────────────────────
    // The arena floats over a cloud sea; between the two there was nothing.
    // A dozen huge soft billboards drifting on their own currents fill that
    // gap. Instanced, so the whole weather system is one draw call, and it
    // never enters the play space: the lowest deck is at y≈20, the highest bank
    // at y≈4, so nothing here can hide a player.
    const fogTex = cloudTexture();
    this.fogBankCount = 14;
    this.fogBank = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: fogTex,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
        vertexColors: false,
      }),
      this.fogBankCount,
    );
    this.fogBank.frustumCulled = false;
    this.fogBank.renderOrder = -1;
    this.scene.add(this.fogBank);
    for (let i = 0; i < this.fogBankCount; i++) {
      const a = (i / this.fogBankCount) * Math.PI * 2 + i * 0.37;
      this.fogBanks.push({
        mesh: this.fogBank,
        speed: 0.9 + ((i * 13) % 7) * 0.25,
        phase: a,
        baseY: -10 - ((i * 23) % 5) * 13,
        size: 150 + ((i * 53) % 9) * 26,
        radius: 60 + ((i * 31) % 7) * 24,
        tint: i % 3 === 0 ? 0xdfe9f2 : 0xf4f6f8,
      });
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

      // ── Rig ────────────────────────────────────────────────────────────────
      // A real joint chain: pelvis → shoulders and neck, hip → knee. Every joint
      // is a Group, so the whole animation is rotation, and each joint merges
      // its own geometry per material — a full skeleton for two extra draws.
      const body = new THREE.Group();
      body.position.y = -0.14;
      group.add(body);

      /** Bakes a small stack of primitive parts into one mesh at a joint. */
      const hinge = (
        parts: { geo: THREE.BufferGeometry; x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }[],
        mat: THREE.Material,
      ): THREE.Mesh => {
        const geos = parts.map((p) => {
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)),
            new THREE.Vector3(1, 1, 1),
          );
          return p.geo.applyMatrix4(m);
        });
        const mesh = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos), mat);
        mesh.castShadow = true;
        return mesh;
      };

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.34, 4, 12), shell);
      torso.position.y = 0.3;
      torso.castShadow = true;
      body.add(torso);

      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.32), plate);
      chest.position.set(0, 0.5, 0);
      chest.castShadow = true;
      body.add(chest);
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.34), accent);
      sash.position.set(0, 0.56, 0);
      body.add(sash);

      // Shoulder pads ride the torso: they are armour, not joints.
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), plate);
        shoulder.position.set(side * 0.3, 0.54, 0);
        shoulder.castShadow = true;
        body.add(shoulder);
      }

      // ── Arms ───────────────────────────────────────────────────────────────
      // Upper arm, forearm and glove in one mesh, hinged at the shoulder: that
      // is all a swing, a brace and a recoil need to read at rifle range.
      const arms: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(side * 0.3, 0.52, 0);
        arm.rotation.z = side * 0.14;
        body.add(arm);
        arm.add(
          hinge(
            [
              { geo: new THREE.CapsuleGeometry(0.078, 0.28, 3, 8), y: -0.2 },
              { geo: new THREE.CapsuleGeometry(0.06, 0.2, 3, 8), y: -0.46, z: -0.07, rx: 0.28 },
              { geo: new THREE.SphereGeometry(0.072, 8, 6), y: -0.6, z: -0.12 },
            ],
            shell,
          ),
        );
        arms.push(arm);
      }

      // ── Head ───────────────────────────────────────────────────────────────
      // Its own pivot, because a duelist's head tracks the shot. A head welded
      // to the chest is the single clearest tell that a model is a mannequin.
      const head = new THREE.Group();
      head.position.set(0, 0.8, 0);
      body.add(head);
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), plate);
      skull.castShadow = true;
      head.add(skull);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.12), visorMat);
      visor.position.set(0, 0, -0.12);
      head.add(visor);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.22), accent);
      crest.position.set(0, 0.14, 0.01);
      head.add(crest);

      // ── Legs ───────────────────────────────────────────────────────────────
      // Hip and knee per leg. The greave and the boot merge into one dark mesh:
      // two materials on a shin is not worth a draw call at 60 m.
      const hips: THREE.Group[] = [];
      const knees: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.12, -0.14, 0);
        group.add(hip);
        hip.add(hinge([{ geo: new THREE.CapsuleGeometry(0.098, 0.26, 3, 8), y: -0.21 }], shell));
        const knee = new THREE.Group();
        knee.position.set(0, -0.4, 0);
        hip.add(knee);
        knee.add(
          hinge(
            [
              { geo: new THREE.CapsuleGeometry(0.086, 0.22, 3, 8), y: -0.16 },
              { geo: new THREE.BoxGeometry(0.17, 0.15, 0.3), y: -0.32, z: -0.05 },
            ],
            plate,
          ),
        );
        hips.push(hip);
        knees.push(knee);
      }

      // ── Weapon mount ───────────────────────────────────────────────────────
      // One transform for both slots: drawing, kicking and swapping are the
      // same three numbers, so they can never disagree.
      const weapon = new THREE.Group();
      body.add(weapon);

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
      rifle.position.set(0.2, 0.34, -0.36);
      weapon.add(rifle);

      // Grapnel launcher in the same hands.
      const launcher = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 12), plate);
      drum.rotation.z = Math.PI / 2;
      launcher.add(drum);
      const bodyGeo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.42), tan);
      bodyGeo.position.z = -0.16;
      launcher.add(bodyGeo);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), accent);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.z = -0.42;
      launcher.add(muzzle);
      launcher.position.set(0.2, 0.34, -0.3);
      launcher.visible = false;
      weapon.add(launcher);

      // Both weapons merge down to one mesh per material: at rifle range the
      // silhouette is what matters, and eleven little boxes per rifle is eleven
      // draw calls for something 40 m away.
      mergeChildren(rifle);
      mergeChildren(launcher);

      // Team-colour shoulder beacon: the readable "that is an enemy" cue.
      const beacon = new THREE.Sprite(this.makeGlowSpriteMaterial(skin.color, 0.55));
      beacon.position.set(0, 0.5, 0.26);
      beacon.scale.setScalar(1.1);
      body.add(beacon);

      // ── Thruster pack ────────────────────────────────────────────────────
      // Solid cones with an additive core: the sprite alone read as a smudge at
      // range, and a player who is moving should look like they are moving.
      const thrust: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.075, 0.42, 8, 1, true),
          new THREE.MeshBasicMaterial({
            color: skin.color,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        cone.rotation.x = Math.PI;
        cone.position.set(side * 0.16, -0.82, 0.14);
        cone.visible = false;
        body.add(cone);
        thrust.push(cone);
        // The nozzle it comes out of, part of the silhouette.
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 10), plate);
        nozzle.position.set(side * 0.16, -0.65, 0.14);
        body.add(nozzle);
      }
      // The pack itself, so the thrusters are attached to something.
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.14), plate);
      pack.position.set(0, 0.44, 0.2);
      pack.castShadow = true;
      body.add(pack);
      const packTrim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.15), accent);
      packTrim.position.set(0, 0.38, 0.2);
      body.add(packTrim);

      // ── Cape ─────────────────────────────────────────────────────────────
      // Four hinged panels hanging off the shoulders. Each lags the one above,
      // so at speed the whole thing streams out behind like cloth, and when you
      // stop it settles. It is the strongest distance cue on the model.
      const cape: THREE.Mesh[] = [];
      const capeMat = new THREE.MeshStandardMaterial({
        color: 0x1b1f26,
        roughness: 0.92,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      let parent: THREE.Object3D = body;
      for (let i = 0; i < 4; i++) {
        const hingeGrp = new THREE.Group();
        hingeGrp.position.set(0, i === 0 ? 0.58 : -0.2, i === 0 ? 0.22 : 0);
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.46 - i * 0.035, 0.21), capeMat);
        seg.position.set(0, -0.105, 0.005);
        seg.castShadow = true;
        hingeGrp.add(seg);
        parent.add(hingeGrp);
        cape.push(hingeGrp as unknown as THREE.Mesh);
        parent = hingeGrp;
      }
      // A team-coloured hem on the last panel: the cape is how you find the
      // enemy, so it carries the colour that means "enemy".
      const hem = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.035), accent);
      hem.position.set(0, -0.2, 0.006);
      parent.add(hem);

      const jetL = this.makeSprite(skin.color, 0.8);
      jetL.position.set(-0.16, -0.74, 0.16);
      body.add(jetL);
      const jetR = this.makeSprite(skin.color, 0.8);
      jetR.position.set(0.16, -0.74, 0.16);
      body.add(jetR);

      // The glint lives on the head, so it tracks the optic instead of the
      // pelvis: if their body turns and their scope does not, the tell is wrong.
      const glintCore = this.makeSprite(0xfff4d6, 0.9);
      glintCore.position.set(0, 0.02, -0.16);
      glintCore.visible = false;
      head.add(glintCore);
      const lamp = this.makeSprite(skin.color, 0.55);
      lamp.position.set(0, -0.02, -0.2);
      head.add(lamp);
      const glintStreak = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.flare,
          color: 0xfff0d0,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glintStreak.position.set(0, 0.02, -0.16);
      glintStreak.visible = false;
      // Squashed hard along one axis: a lens artefact, not a sun.
      glintStreak.scale.set(9, 0.32, 1);
      head.add(glintStreak);

      const glintHalo = this.makeSprite(0xffe0b0, 3.4);
      glintHalo.position.set(0, 0.02, -0.16);
      glintHalo.visible = false;
      head.add(glintHalo);

      const glintFlare = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.flare, color: 0xffe6b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glintFlare.position.set(0, 0.02, -0.16);
      glintFlare.visible = false;
      head.add(glintFlare);

      // Everything on the torso that never moves gets merged per material: the
      // character is 20-odd little boxes, and merging them buys back the draw
      // calls the joints, cape and thrusters cost. Animated parts are preserved.
      mergeChildren(body, new Set<THREE.Object3D>([...cape, ...thrust]));

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
        body,
        head,
        arms,
        hips,
        knees,
        weapon,
        torso,
        visor,
        turn: 0,
        lastYaw: skinIndexYaw(i),
        anim: {
          phase: Math.random() * Math.PI * 2,
          run: 0,
          air: 0,
          slide: 0,
          swing: 0,
          zip: 0,
          squash: 0,
          spawn: 0,
          alive: true,
          kick: 0,
          swap: 0,
          slot: 0,
          wasGrounded: true,
          lastVy: 0,
        },
        jetL,
        jetR,
        thrust,
        cape,
        lamp,
        glintStreak,
        glintHalo,
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
        // World units: the cable thins with distance like a real rope instead of
        // staying a constant smear of pixels, which is what sells the swing.
        linewidth: 0.045,
        worldUnits: true,
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
        linewidth: 0.11,
        worldUnits: true,
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
      // Both heads are built from the issue kit and recoloured/re-shaped when a
      // player's look arrives, so the pool is fixed at two objects for ever.
      const issue = grappleSkin(DEFAULT_LOADOUT.grapple);
      const head = buildGrapnel(issue.claw, issue.clawShape, issue.trail);
      // A hot little halo rides with the claw while it is in the air, so a
      // throw stays visible against the sky at any range.
      const spark = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glow, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      spark.scale.setScalar(0.9);
      spark.name = 'hookspark';
      head.add(spark);
      head.visible = false;
      head.userData.clawShape = issue.clawShape;
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
    // few metres, and a stepped crown. A plain box reads as unbuilt; a little
    // articulated stone reads as a building.
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
    // The inlay and the optic carry the skin's own light: this is what the
    // pulse and the sweep animate, and it is why two rifles of the same shape
    // read as different objects across a room.
    accent.color.setHex(gs.trim);
    accent.emissive.setHex(gs.glow);
    accent.emissiveIntensity = 0.1 + gs.anim.glow * 0.25;
    glass.emissiveIntensity = 0.25 + gs.anim.glow * 0.5;
    this.accentMats = [accent];
    this.glassMats = [glass];
    this.gunAnim = { sweep: gs.anim.sweep, pulse: gs.anim.pulse, glow: gs.anim.glow };

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

    // ── Skin motion: the band and the ornament ───────────────────────────
    if (gs.anim.sweep > 0) {
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(0.088, 0.5),
        new THREE.MeshBasicMaterial({
          map: sweepTexture(),
          color: gs.glow,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(0, 0.0554, -0.4);
      rifle.add(band);
      this.sweepBand = band;
      this.sweepMat = band.material as THREE.MeshBasicMaterial;
    } else {
      this.sweepBand = null;
      this.sweepMat = null;
    }
    this.gunOrnament = gs.anim.orbit === 'none' ? null : new Ornament(gs.anim.orbit, gs.trim, 1);
    if (this.gunOrnament) rifle.add(this.gunOrnament.group);

    // Name plate on the stock: the skin says what it is, in its own colour.
    {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.052, 0.014),
        new THREE.MeshBasicMaterial({ map: namePlateTexture(gs.name, `#${gs.trim.toString(16).padStart(6, '0')}`), transparent: true }),
      );
      plate.position.set(0.0262, 0.005, 0.075);
      plate.rotation.y = Math.PI / 2;
      rifle.add(plate);
    }

    // Hands: the right one is a rig, because it works the bolt. A hand that
    // never leaves the grip while the bolt cycles is the tell that a viewmodel
    // is a picture of a rifle rather than a rifle in someone's hands.
    this.handRig = new THREE.Group();
    const handR = box(0.075, 0.1, 0.13, glove, 0.004, -0.135, -0.03);
    handR.rotation.x = -0.3;
    this.handRig.add(handR);
    const sleeveR = cyl(0.055, 0.07, 0.3, sleeve, 0.07, -0.23, 0.02);
    sleeveR.rotation.set(1.25, 0, 0.16);
    this.handRig.add(sleeveR);
    rifle.add(this.handRig);

    const handL = box(0.082, 0.088, 0.12, glove, -0.006, -0.075, -0.72);
    rifle.add(handL);
    for (let i = 0; i < 3; i++) {
      rifle.add(box(0.078, 0.018, 0.032, gloveDark, -0.004, -0.052 + i * 0.03, -0.74 - i * 0.001));
    }
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
    const ready = buildGrapnel(gr.claw, gr.clawShape, gr.trail);
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
    this.ropeOrnament = gr.anim.orbit === 'none' ? null : new Ornament(gr.anim.orbit, gr.trail, 1);
    if (this.ropeOrnament) grapnel.add(this.ropeOrnament.group);
    const gSleeveR = cyl(0.055, 0.07, 0.3, sleeve, 0.07, -0.23, 0.02);
    gSleeveR.rotation.set(1.25, 0, 0.16);
    grapnel.add(gSleeveR);
    const gSleeveL = cyl(0.05, 0.066, 0.3, sleeve, -0.11, -0.2, -0.14);
    gSleeveL.rotation.set(1.3, 0, -0.4);
    grapnel.add(gSleeveL);

    // Cull the static parts down to one mesh per material (the bolt, spool and
    // the cradle claw stay separate because they animate).
    mergeChildren(ready, new Set());
    mergeChildren(rifle, new Set<THREE.Object3D>([this.boltGroup, this.handRig]));
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
  /** The knees take a landing; the rifle in your hands feels it too. */
  landKick(strength: number): void {
    this.landSpring = Math.max(this.landSpring, clamp(strength, 0, 1));
  }

  hookFire(): void {
    this.hookKick = 1;
    this.punch(-0.03, 0.01);
    // A puff of compressed air and a spray of brass chips leaving the crown.
    const at = new THREE.Vector3(0.02, -0.02, -0.55).applyMatrix4(this.camera.matrixWorld);
    this.particles.burst(at, 0xd8d2c0, 9, { speed: 2.2, size: 0.16, life: 0.32, gravity: 2, drag: 2 });
    this.particles.burst(at, grappleSkin(this.look.grapple).trail, 5, { speed: 3.4, size: 0.1, life: 0.22, gravity: 6 });
  }

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
    // A bite has weight: stone chips and a puff of dust off the surface.
    this.particles.burst(pos, 0xbdb6a6, 10, { speed: 2.6, size: 0.3, life: 0.6, gravity: 4, drag: 2.2 });
    this.waves.spawn(pos, trail, 2.4, 0.3);
    this.fx.impact(pos, null, trail);
  }

  /**
   * A round cracking past the camera: a short white streak along the round's
   * own line plus a hot point at the closest approach. It is the visual half of
   * the crack sound, and it is what makes being shot *at* feel different from
   * being shot.
   */
  nearMiss(point: Vec3, closeness: number): void {
    const k = clamp(closeness, 0, 1);
    this.particles.burst(point, 0xe8f4ff, Math.round(8 + 14 * k), {
      speed: 6 + 10 * k,
      size: 0.1 + 0.1 * k,
      life: 0.18 + 0.1 * k,
      gravity: 0,
      drag: 3,
    });
    this.beams.fire(point, {
      x: point.x - this.camForwardWorld.x * (2 + 6 * k),
      y: point.y - this.camForwardWorld.y * (2 + 6 * k),
      z: point.z - this.camForwardWorld.z * (2 + 6 * k),
    }, 0xffffff, 0.05 + 0.06 * k, 0.09);
    this.fovPulse(1.6 * k);
    this.shake(0.004 + 0.012 * k);
    this.post.flash(0xdceeff, 0.03 + 0.05 * k);
  }

  /**
   * A confirmed hit on the enemy: a tight ring on the body, aligned to the
   * shot, plus a spray of hot motes in the shooter's colour. It is the visual
   * half of the hitmarker, and it is what makes a one-shot rifle feel like it
   * connected rather than simply removed someone.
   */
  hitConfirm(at: Vec3, dir: Vec3, color: number): void {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const n = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    this.fx.rings.spawn(at, 0xffffff, 0.1, 1.1, 0.16, n);
    this.fx.rings.spawn(at, color, 0.15, 1.9, 0.26, n);
    this.shards.burst(at, color, 10, { speed: 9, size: 0.14, life: 0.4, gravity: 6, drag: 2 });
    this.particles.burst(at, 0xfff2d8, 8, { speed: 5, size: 0.14, life: 0.3, gravity: 2, drag: 3 });
  }

  /** Kills punch the lens: a hard FOV kick that decays over half a second. */
  killPunch(): void {
    this.fovPulse(9);
    this.shake(0.05);
  }

  /**
   * Applies the equipped kit. Called on equip and on join; the viewmodel is
   * rebuilt only when the rifle or launcher material set actually changes.
   */
  applyLoadout(look: Loadout): void {
    const changed = look.gun !== this.look.gun || look.grapple !== this.look.grapple;
    this.look = { ...look };
    if (changed) {
      this.rebuildViewmodel();
      // Bringing a new kit into the match should be seen, not silently swapped
      // between frames: the viewmodel rolls over and settles.
      this.inspect = 1;
    }
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
    const index = 1 - this.localIndex;
    let head = this.hookHeads[index];
    if (head) {
      // The silhouette is the skin, so a change of kit swaps the whole head. It
      // happens at most once per match, on the frame their look arrives.
      const spark = head.getObjectByName('hookspark');
      if (head.userData.clawShape !== gr.clawShape) {
        this.scene.remove(head);
        head.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
        head = buildGrapnel(gr.claw, gr.clawShape, gr.trail);
        head.userData.clawShape = gr.clawShape;
        head.visible = false;
        if (spark) head.add(spark);
        this.scene.add(head);
        this.hookHeads[index] = head;
      }
      head.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.metalness !== undefined && mat.metalness > 0.5) mat.color.setHex(gr.claw);
      });
      const core = head.getObjectByName('hookcore') as THREE.Mesh | undefined;
      if (core) {
        const mat = core.material as THREE.MeshStandardMaterial;
        mat.color.setHex(gr.trail);
        mat.emissive.setHex(gr.trail);
      }
    }
  }

  /** Their kill, dressed in their effect. */
  killBurst(at: Vec3, effectId: string, scale = 1, dir?: Vec3): void {
    const fx = killEffect(effectId);
    if (dir) {
      // A shock plate square to the shot: it is the one piece of the burst that
      // tells you *which way* the round came from, at a glance, from any angle.
      const n = { x: dir.x, y: dir.y, z: dir.z };
      const len = Math.hypot(n.x, n.y, n.z) || 1;
      n.x /= len;
      n.y /= len;
      n.z /= len;
      this.waves.spawnAligned(at, fx.ring, 6.5 * scale, 0.55, n);
    }
    // Particulate haze under every effect shape: the geometry does the reading,
    // the particles do the heat.
    this.particles.burst(at, fx.burst, Math.round(26 * scale), { speed: 9 * scale, size: 0.16, life: 0.5, gravity: 10 });
    this.particles.burst(at, fx.motes, Math.round(18 * scale), { speed: 3.5 * scale, size: 0.22, life: 0.85, gravity: -1.2 });
    this.waves.spawn(at, fx.ring, 3.2 * scale, 0.45);
    this.waves.spawn(at, fx.burst, 1.6 * scale, 0.28);
    this.fx.kill(at, fx.shape, { burst: fx.burst, ring: fx.ring, motes: fx.motes }, scale);
    this.post.flash(fx.ring, 0.12 * scale);
    this.post.killShock(fx.ring);
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
    // The body in the world kicks with the rifle in your hands.
    this.shotKick(this.localIndex);
    // The flash carries the kit's own light: an Aurum round burns gold, an
    // Obsidian round burns low and hot. Identical recoil, different signature.
    const gs = gunSkin(this.look.gun);
    const heat = 0.55 + gs.anim.glow * 0.4;
    const flashColor = new THREE.Color(0xffe6b4).lerp(new THREE.Color(gs.glow), heat * 0.5).getHex();
    this.muzzle.material.color.setHex(flashColor);
    this.muzzleFlare.material.color.setHex(flashColor);
    this.muzzleLight.color.setHex(flashColor);
    this.fx.shells.eject(new THREE.Vector3(0.075, 0.02, -0.34));
    // Powder smoke drifts off the brake in world space, so it stays behind when
    // you turn instead of riding the camera like a decal.
    const at = new THREE.Vector3(0, 0.008, -1.4).applyMatrix4(this.camera.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.particles.burst(
      at,
      0xe8e4d8,
      7,
      { speed: 1.6, size: 0.34, life: 0.9, gravity: -0.6, drag: 2.2 },
    );
    for (let i = 0; i < 3; i++) {
      this.particles.ember(
        { x: at.x + fwd.x * 0.3 * i, y: at.y + fwd.y * 0.3 * i, z: at.z + fwd.z * 0.3 * i },
        0xffd9a0,
        0.16,
        0.22,
      );
    }
    this.muzzle.visible = true;
    this.muzzle.material.opacity = 1;
    this.muzzle.scale.setScalar(1.45);
    this.muzzleLight.intensity = 22;
    // The flare is a four-point star with a random roll, so no two shots give
    // the same silhouette; the sprite underneath supplies the hot core.
    this.muzzleFlare.visible = true;
    this.muzzleFlare.material.opacity = 1;
    this.muzzleFlare.material.rotation = Math.random() * Math.PI;
    this.muzzleFlare.scale.setScalar(1.1 + Math.random() * 0.5);
  }

  muzzleFlash(): void {
    this.recoil();
  }

  tracer(from: Vec3, to: Vec3, color: number): void {
    this.beams.fire(from, to, color, 0.34, 0.26);
    this.beams.fire(from, to, 0xffffff, 0.1, 0.16);
  }

  /** A puff of concrete dust where a pair of boots meets a deck. */
  landDust(pos: Vec3, strength: number): void {
    const k = clamp(strength, 0, 1);
    this.particles.burst(pos, 0xd8d2c2, Math.round(6 + k * 12), {
      speed: 1.4 + k * 2.4,
      size: 0.26 + k * 0.16,
      life: 0.5 + k * 0.4,
      gravity: 1.2,
      drag: 2.4,
    });
    if (k > 0.55) this.fx.decals.add(pos, null, 0.9 + k, 3.2);
  }

  spark(pos: Vec3, color: number, count = 5, normal: Vec3 | null = null): void {
    this.particles.burst(pos, color, count, { speed: 9, size: 0.3, life: 0.4, gravity: 18 });
    this.particles.burst(pos, 0xffe2b0, Math.round(count * 0.5), { speed: 6, size: 0.2, life: 0.28, gravity: 22 });
    this.fx.impact(pos, normal, color);
    // One light, moved to the newest impact: a spark that lights nothing reads
    // as paint. This is the only dynamic light in the match, so it is free.
    this.impactLight.position.set(pos.x, pos.y, pos.z);
    this.impactLight.color.setHex(color);
    this.impactLight.intensity = 30;
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
    this.camForwardWorld.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

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

    // Head bob runs off the character's own gait phase, so the camera and the
    // legs are one motion instead of two sines that drift apart. It is the
    // cheapest thing that separates "gliding" from "running".
    {
      const gait = this.players[local.id]?.anim;
      if (gait) {
        const jog = local.grounded ? clamp((local.speed - 1) / 10, 0, 1) : 0;
        const dip = gait.squash * 0.11;
        this.camera.translateY(Math.sin(gait.phase * 2) * 0.032 * jog - dip);
        this.camera.translateX(Math.cos(gait.phase) * 0.022 * jog);
      }
    }

    // FOV: speed is the single strongest "feels fast" cue.
    const speedT = clamp(local.speed / 46, 0, 1);
    this.fovPunch *= Math.exp(-dt * 7);
    // `scopeT` is already the ramp (0.12 s, stepped by the simulation). Smoothing
    // it a second time here was the whole "scoping lags" complaint: 0.17 s of
    // ramp plus a 0.11 s exponential on top of a smoothstep that ignored the
    // first quarter of the travel. Now the lens follows the ramp directly, with
    // only a two-frame filter to hide the 60 Hz steps.
    const zoom = local.scopeT * local.scopeT * (3 - 2 * local.scopeT);
    const hipFov = WEAPON.baseFov + (speedT * WEAPON.maxFovKick + this.fovPunch) * (1 - zoom);
    const targetFov = lerp(hipFov, WEAPON.scopedFov, zoom);
    this.fov = lerp(this.fov, targetFov, 1 - Math.exp(-dt * 45));
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
      // Roll and crouch live on the pelvis pivot: rotating the whole character
      // about its ankles made a slide look like a fall.
      visual.group.rotation.z = 0;
      // Their hands show the same kit they have equipped.
      const slot = isLocal ? local.slot : remote.slot;
      visual.rifle.visible = slot === 0;
      visual.launcher.visible = slot === 1;
      visual.group.rotation.x = 0;

      // Skeleton: hips, knees, pelvis, neck, both arms and the weapon in one
      // call. Every joint is eased toward its target, so a stance change is a
      // motion rather than a snap, and the pose is frame-rate independent.
      this.posePlayer(visual, state, dt);

      const jetOn = isLocal
        ? !local.grounded && (local.speed > 8 || local.vel.y > 2)
        : remote.alive && (remote.speed > 20 || remote.grapple.active);
      for (const jet of [visual.jetL, visual.jetR]) {
        jet.visible = jetOn;
        jet.material.opacity = jetOn ? 0.35 + Math.sin(this.time * 40) * 0.1 : 0;
      }
      // Thruster cones: length follows the throttle, so a swing pushes a long
      // flame and a hop a short one. Flicker is per-frame noise, not a texture.
      const throttle = clamp((state.speed - 6) / 34, 0, 1);
      for (let t = 0; t < visual.thrust.length; t++) {
        const cone = visual.thrust[t];
        const lit = jetOn && throttle > 0.04;
        cone.visible = lit;
        if (lit) {
          const flick = 0.82 + Math.sin(this.time * 54 + t * 2.1) * 0.18;
          cone.scale.set(1, (0.35 + throttle * 1.5) * flick, 1);
          (cone.material as THREE.MeshBasicMaterial).opacity = 0.35 + throttle * 0.5;
        }
      }
      // Cape: each panel lags the body and the panel above it, so speed opens it
      // out and stopping folds it back down. Cheap, and the single best motion
      // read on a character seen from 60 m. The hem also swings with the turn
      // rate, which is what makes a hard cut look like a hard cut.
      if (visual.cape.length) {
        const sp = clamp(state.speed / 30, 0, 1);
        const flutter = Math.sin(this.time * 9 + visual.anim.phase * 0.2) * 0.05;
        const swingAir = visual.anim.swing;
        for (let c = 0; c < visual.cape.length; c++) {
          const panel = visual.cape[c];
          const lag = 0.06 * c;
          const base = -0.08 - (sp * 0.42 + c * 0.1) * (c === 0 ? 1 : 0.9);
          // Rising air pushes the hem up; falling lets it trail. A swing pins
          // the whole cape back because the body is moving with the cable.
          const lift = clamp(state.vel.y / 18, -1, 1) * 0.12;
          panel.rotation.x = lerp(
            panel.rotation.x,
            base - sp * 0.35 - swingAir * 0.35 + flutter * (0.4 + c * 0.3) - lift + lag,
            1 - Math.exp(-dt * 12),
          );
          panel.rotation.z = lerp(
            panel.rotation.z,
            clamp(visual.turn * (0.25 + c * 0.1), -0.4, 0.4),
            1 - Math.exp(-dt * 9),
          );
        }
        visual.lamp.scale.setScalar(0.5 + Math.sin(this.time * 3 + (isLocal ? 0 : 2)) * 0.04);
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
      visual.glintStreak.visible = glintOn;
      visual.glintHalo.visible = glintOn;
      if (glintOn) {
        const k = Math.min(1, intensity);
        const dist = Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z);
        // Sprites are sized in metres, so a glint 90 m away would be a sub-pixel
        // dot. Growing it with distance keeps the tell readable without turning
        // a close-range glint into a bonfire.
        const reach = 1 + clamp(dist / 55, 0, 1.6);
        const pulse = 0.9 + Math.sin(this.time * 7.5) * 0.1;
        visual.glintCore.material.opacity = k * 0.95;
        visual.glintCore.scale.setScalar((0.7 + k * 1.2) * pulse * reach);
        visual.glintFlare.material.opacity = k * 0.7;
        visual.glintFlare.scale.setScalar((1.6 + k * 2.6) * pulse * reach);
        visual.glintFlare.material.rotation = this.time * 0.18;
        // The streak is locked horizontal in screen space: it reads as a lens,
        // and it survives being seen against a white sky.
        visual.glintStreak.material.opacity = k * (0.6 + Math.sin(this.time * 5.2) * 0.2);
        visual.glintStreak.scale.set((6 + k * 7) * reach, 0.22 + k * 0.18, 1);
        visual.glintHalo.material.opacity = k * 0.34;
        visual.glintHalo.scale.setScalar((3.2 + k * 2.4) * reach * pulse);
      } else {
        visual.glintStreak.material.opacity = 0;
        visual.glintHalo.material.opacity = 0;
      }

      if (isRemote && remote.alive && remote.speed > 26) {
        this.particles.ember({ x: pos.x, y: pos.y, z: pos.z }, 0xd8d2c4, 0.2, 0.35);
      }
      if (isRemote) {
        // A short ribbon behind a fast opponent: at 40 m a 1.8 m capsule moving
        // at 30 m/s is nearly invisible, and the streak is what lets you read
        // the swing and lead the shot. Both players get it, so it is fair.
        const cur = { x: pos.x, y: pos.y + 0.85, z: pos.z };
        if (this.lastRemote && remote.alive && remote.speed > 24) {
          const d = Math.hypot(cur.x - this.lastRemote.x, cur.y - this.lastRemote.y, cur.z - this.lastRemote.z);
          if (d > 0.35 && d < 12) {
            this.beams.fire(this.lastRemote, cur, visual.color.getHex(), 0.62, 0.3);
          }
        }
        this.lastRemote = cur;
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
    this.fx.update(dt);
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
    if (this.beaconSweep) this.beaconSweep.rotation.y = this.time * 0.22;
    if (this.fogBank && this.fogBanks.length) {
      for (let i = 0; i < this.fogBanks.length; i++) {
        const f = this.fogBanks[i];
        // Rotating slowly about the spire rather than translating: the banks
        // keep their distance, so no seam ever slides through the camera.
        const a = f.phase + this.time * 0.006 * f.speed;
        this.fogPos.set(
          Math.cos(a) * f.radius,
          f.baseY + Math.sin(this.time * 0.12 + i) * 1.6,
          Math.sin(a) * f.radius,
        );
        // Face the middle of the arena, then lean: they read as strata.
        this.fogAim.set(0, this.fogPos.y + 6, 0);
        this.fogLook.lookAt(this.fogPos, this.fogAim, THREE.Object3D.DEFAULT_UP);
        this.fogQuat.setFromRotationMatrix(this.fogLook);
        this.fogScale.set(f.size, f.size * 0.55, 1);
        this.fogMatrix.compose(this.fogPos, this.fogQuat, this.fogScale);
        this.fogBank.setMatrixAt(i, this.fogMatrix);
      }
      this.fogBank.instanceMatrix.needsUpdate = true;
    }
    if (this.beaconLamp) {
      const blink = Math.pow(Math.max(0, Math.sin(this.time * 1.6)), 6);
      this.beaconLamp.material.opacity = 0.35 + blink * 0.6;
      this.beaconLamp.scale.setScalar(2.8 + blink * 1.4);
    }

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
    // The hand goes with it: lift, draw back, ride forward, settle.
    this.handRig.position.set(0, lifted * 0.028, lifted * 0.055);
    this.handRig.rotation.x = -lifted * 0.22;
    this.handRig.rotation.z = lifted * 0.05;
    // Spool: pays out while the claw is away, and keeps turning while the rope
    // is loaded, because a reel under tension is never still.
    this.hookKick = Math.max(0, this.hookKick - dt * 6);
    const paying = local.hook.active ? 1 : local.grapple.active ? 0.5 : 0;
    this.spool.rotation.x += dt * (26 * paying) + this.hookKick * dt * 40;
    // One claw, one place: while it is out the launcher's cradle is empty.
    const clawAway = local.hook.active || local.grapple.active;
    this.readyClaw.visible = !clawAway;
    if (!clawAway) {
      // Cradle claw: a slow idle spin and a breath, so the grapnel looks armed
      // rather than moulded onto the model.
      this.readyClaw.rotation.z += dt * (local.slot === 1 ? 0.7 : 0.15);
      const arm = 1 + Math.sin(this.time * 2.2) * 0.02;
      this.readyClaw.scale.set(arm, arm, arm);
    }
    this.grapnelModel.position.z = this.hookKick * 0.07;

    // ── Skin motion ────────────────────────────────────────────────────────
    // The pulse and the band run on the equipped kit only, and they are driven
    // by wall time rather than by input, so a skin still looks alive while the
    // player is holding an angle and doing nothing at all.
    this.gunOrnament?.update(this.time);
    this.ropeOrnament?.update(this.time);
    if (this.accentMats.length) {
      const breath = this.gunAnim.pulse > 0
        ? 0.5 + 0.5 * Math.sin(this.time * this.gunAnim.pulse * Math.PI * 2)
        : 0.6;
      for (const m of this.accentMats) m.emissiveIntensity = (0.1 + this.gunAnim.glow * 0.2) + breath * this.gunAnim.glow * 0.55;
      for (const m of this.glassMats) m.emissiveIntensity = 0.25 + this.gunAnim.glow * 0.55 + breath * 0.25;
    }
    if (this.sweepBand && this.sweepMat) {
      const loop = (this.time * this.gunAnim.sweep) % 1;
      this.sweepBand.position.z = -0.14 - loop * 0.62;
      // The band leaves and enters through the ends of the receiver instead of
      // popping, which is the whole trick to a sweep that does not look looped.
      this.sweepMat.opacity = Math.sin(Math.PI * loop) * 0.85;
    }

    // The weapon leaves the frame as the scope glass arrives, not two beats
    // later: the two have to cross-fade or the zoom reads as a cut.
    const scopedNow = local.scopeT > 0.42;
    this.viewmodel.visible = !scopedNow && !view.killcam && local.alive;
    for (const light of this.vmLights) light.visible = this.viewmodel.visible;
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
    // Sprint: the rifle drops and cants across the body. It is the cheapest way
    // to tell the player "you are running" without a speedometer.
    const sprint = clamp((local.speed - 10) / 14, 0, 1) * (local.grounded ? 1 : 0.45);
    const air = local.grounded ? 0 : clamp(-local.vel.y / 22, -0.5, 1);
    // Inspect: a half turn of the wrist and a small rise, then it settles.
    this.inspect = Math.max(0, this.inspect - dt * 1.6);
    const insp = this.inspect * this.inspect * (3 - 2 * this.inspect);
    const inspWave = Math.sin(insp * Math.PI);
    const strafe = clamp((local.vel.x * Math.cos(local.yaw) - local.vel.z * Math.sin(local.yaw)) / 26, -1, 1);
    // Landing: the spring runs down then back up, so the weapon dips under the
    // impact and settles instead of bouncing off a fixed floor.
    this.landSpring = Math.max(0, this.landSpring - dt * 3.4);
    const spring = Math.sin(this.landSpring * Math.PI) * this.landSpring;
    const slidePose = local.sliding ? 1 : 0;
    this.viewmodel.position.set(
      0.22 + Math.sin(this.time * 4.2) * 0.003 + this.swayX - raise * 0.18 - sprint * 0.035 + strafe * 0.012 + slidePose * 0.03,
      -0.2 + bob + breathe + this.swayY - this.weaponKick * 0.025 - raise * 0.05 - sprint * 0.055 + air * 0.02 + inspWave * 0.03 - spring * 0.07 - slidePose * 0.045,
      -0.1 + this.weaponRecoil * 0.14 + sprint * 0.05 - this.hookKick * 0.06,
    );
    this.viewmodel.rotation.set(
      this.weaponRecoil * 0.18 + this.weaponKick * 0.06 - this.swayY * 0.6 + sprint * 0.11 - inspWave * 0.35 - spring * 0.16 - this.hookKick * 0.1,
      -0.04 + Math.cos(this.time * 4.2) * 0.002 + this.swayX * 0.5 - inspWave * 0.5,
      this.weaponRecoil * 0.05 + sprint * 0.22 + strafe * 0.06 + inspWave * 0.9 + slidePose * 0.12,
    );
    if (this.muzzle.visible) {
      this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - dt * 8);
      if (this.muzzle.material.opacity <= 0.01) this.muzzle.visible = false;
    }
    if (this.muzzleFlare.visible) {
      this.muzzleFlare.material.opacity = Math.max(0, this.muzzleFlare.material.opacity - dt * 13);
      this.muzzleFlare.scale.multiplyScalar(1 + dt * 3.5);
      if (this.muzzleFlare.material.opacity <= 0.02) this.muzzleFlare.visible = false;
    }
    this.impactLight.intensity = Math.max(0, this.impactLight.intensity - dt * 260);
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

    // Sun on screen: project the light direction and hand the grade pass a UV.
    // The disc is at infinity, so only its direction matters.
    {
      this.camForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const facing = this.camForward.dot(this.sunDir);
      if (facing > 0.1) {
        this.sunProbe.copy(this.camera.position).addScaledVector(this.sunDir, 1500);
        this.sunProbe.project(this.camera);
        this.sunScreen.set(this.sunProbe.x * 0.5 + 0.5, this.sunProbe.y * 0.5 + 0.5);
        const edge = Math.max(
          0,
          Math.min(
            1,
            Math.min(this.sunScreen.x, 1 - this.sunScreen.x) * 3 + 0.35,
          ),
        ) * Math.max(0, Math.min(1, Math.min(this.sunScreen.y, 1 - this.sunScreen.y) * 3 + 0.35));
        // Scoping dims it: an optic is looking at the target, not at the sky.
        const scopeDim = 1 - local.scopeT * 0.85;
        this.post.setSun(this.sunScreen, clamp(edge * Math.min(1, (facing - 0.1) * 2.4) * scopeDim, 0, 1));
      } else {
        this.post.setSun(this.sunScreen, 0);
      }
    }

    const hurt = this.hurtFlash + (view.hurt ?? 0);
    this.post.setState(
      this.time,
      clamp(speedT * 0.85 + (local.grapple.active ? 0.3 : 0), 0, 1),
      local.scopeT > 0.7 ? 1 : 0,
      clamp(hurt, 0, 1),
    );
  }

  /**
   * Poses one character.
   *
   * Everything is a weight between 0 and 1 (run, air, slide, swing, zip) and
   * every joint is a lerp between the poses those weights select. That is what
   * keeps the transitions continuous: there is no state machine that can snap,
   * and a player who grapples mid-slide gets a blend, not a pop.
   *
   * All rates are per second and applied through `1 - exp(-dt * rate)`, so the
   * timing is the same at 30 fps and at 240.
   */
  private posePlayer(v: PlayerVisual, s: PoseState, dt: number): void {
    const a = v.anim;
    const k = (rate: number): number => 1 - Math.exp(-dt * rate);

    const yawRate = this.normalizeAngle(s.yaw - v.lastYaw) / Math.max(dt, 1e-4);
    v.lastYaw = s.yaw;
    v.turn = lerp(v.turn, clamp(yawRate * 0.14, -1, 1), k(7));

    const runTarget = clamp((s.speed - 0.3) / 8, 0, 1) * (s.grounded ? 1 : 0);
    a.run = lerp(a.run, runTarget, k(9));
    a.slide = lerp(a.slide, s.sliding ? 1 : 0, k(13));
    a.swing = lerp(a.swing, s.grapple.active && s.grapple.mode === 'swing' ? 1 : 0, k(7));
    a.zip = lerp(a.zip, s.grapple.active && s.grapple.mode === 'zip' ? 1 : 0, k(9));
    // Air eases in fast and out slow: leaves the ground hard, lands soft.
    const airTarget = s.grounded ? 0 : 1;
    a.air = lerp(a.air, airTarget, k(airTarget > a.air ? 14 : 7));

    // Respawn: the body builds back up over a quarter second, so a player
    // arriving in front of you never pops into existence.
    if (s.alive && !a.alive) a.spawn = 1;
    a.alive = s.alive;
    a.spawn = Math.max(0, a.spawn - dt * 4.5);
    if (a.spawn > 0) v.group.scale.setScalar(1 - a.spawn * a.spawn * 0.4);
    else if (v.group.scale.x !== 1) v.group.scale.setScalar(1);

    // Landing squash, scaled by the vertical speed carried into the floor.
    // It is the cheapest weight you can add to a jump you did not hear.
    if (s.grounded && !a.wasGrounded) a.squash = clamp(Math.abs(a.lastVy) / 18, 0, 1);
    a.wasGrounded = s.grounded;
    a.lastVy = s.vel.y;
    a.squash *= Math.exp(-dt * 7);

    // Gait phase advances with speed, not with wall clock: stride length stays
    // constant and the feet stay planted while the ground scrolls past.
    const step = clamp(s.speed / 2.4, 0, 1);
    a.phase += dt * (5 + s.speed * 0.55) * step;
    const amp = 0.92 * a.run;
    const swing = a.swing;
    const air = a.air;
    const slide = a.slide;
    const zip = a.zip;

    // ── Legs ───────────────────────────────────────────────────────────────
    let hipL = Math.sin(a.phase) * amp;
    let hipR = Math.sin(a.phase + Math.PI) * amp;
    let kneeL = -Math.max(0, Math.sin(a.phase - 1.0)) * (0.28 + 0.9 * a.run);
    let kneeR = -Math.max(0, Math.sin(a.phase + Math.PI - 1.0)) * (0.28 + 0.9 * a.run);

    // Air: split the legs and tuck the knees, the read every good platformer
    // has used since the eighties.
    hipL = lerp(hipL, 0.6, air);
    hipR = lerp(hipR, -0.2, air);
    kneeL = lerp(kneeL, -1.15, air);
    kneeR = lerp(kneeR, -0.45, air);

    // Slide: one leg out in front, the other folded under the body.
    hipL = lerp(hipL, 1.3, slide);
    hipR = lerp(hipR, 0.7, slide);
    kneeL = lerp(kneeL, -0.12, slide);
    kneeR = lerp(kneeR, -1.05, slide);

    // Swing: legs trail behind and scissor with the pendulum.
    const scissor = Math.sin(this.time * 3.1) * 0.22;
    hipL = lerp(hipL, -0.52 + scissor, swing);
    hipR = lerp(hipR, -0.26 - scissor, swing);
    kneeL = lerp(kneeL, -0.9, swing);
    kneeR = lerp(kneeR, -0.55, swing);

    // Zip: streamlined, knees under the chest.
    hipL = lerp(hipL, -0.18, zip);
    hipR = lerp(hipR, -0.1, zip);
    kneeL = lerp(kneeL, -0.55, zip);
    kneeR = lerp(kneeR, -0.42, zip);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      v.hips[i].rotation.x = i === 0 ? hipL : hipR;
      v.knees[i].rotation.x = i === 0 ? kneeL : kneeR;
      // A little splay in the air keeps the silhouette wide, which is what
      // makes a falling player findable against a deck.
      v.hips[i].rotation.z = side * (0.02 + air * 0.1 + slide * 0.18);
      v.hips[i].rotation.y = side * a.run * 0.06;
    }

    // ── Pelvis, torso and head ─────────────────────────────────────────────
    const lateral = clamp((s.vel.x * Math.cos(s.yaw) - s.vel.z * Math.sin(s.yaw)) / 22, -1, 1);
    v.body.position.y = -0.14 - slide * 0.17 - a.squash * 0.11;
    // Positive X leans the torso back, negative leans it into the run.
    const breath = Math.sin(this.time * 1.5 + a.phase * 0.05) * 0.014 * (1 - a.run) * (1 - slide);
    v.body.rotation.x = -0.1 * a.run - 0.26 * swing + 0.52 * slide - 0.1 * zip - a.squash * 0.1 + breath;
    v.body.rotation.z = -lateral * (0.09 + 0.09 * swing) - v.turn * 0.12 + Math.sin(this.time * 1.2) * 0.012 * (1 - a.run);
    // Shoulders counter-rotate against the hips: that is where a run's life
    // comes from, and it costs one sin().
    v.body.rotation.y = Math.sin(a.phase) * 0.08 * a.run;

    // The head keeps the aim while the body does the work, and levels itself
    // against the torso lean so the visor still points down the barrel.
    v.head.rotation.x = clamp(s.pitch, -1.2, 1.2) - v.body.rotation.x * 0.75;
    v.head.rotation.y = -v.body.rotation.y * 0.8 + (s.sliding ? 0.18 : 0);

    // ── Arms ───────────────────────────────────────────────────────────────
    // The right arm bends at the elbow onto the grip; the left reaches out
    // along the handguard. Both are one rotation per axis, but they converge on
    // the weapon, which is what separates "holding a rifle" from "arms up".
    const scope = clamp((s.scopeT - 0.35) / 0.65, 0, 1);
    const counter = Math.sin(a.phase) * 0.4 * a.run;
    const rightAim = 0.74 + scope * 0.18 + counter;
    const leftAim = 1.22 + scope * 0.1 - counter;
    const rightArm = lerp(lerp(rightAim, 2.3, swing), rightAim, zip);
    const leftArm = lerp(lerp(leftAim, 1.85, swing), leftAim, zip);
    v.arms[0].rotation.x = lerp(leftArm, -0.35, slide);
    v.arms[1].rotation.x = lerp(rightArm, -0.3, slide);
    // Across the body on the grip; elbows out and wide in the air, tucked in a
    // slide, both hands up the cable in a swing.
    v.arms[0].rotation.z = lerp(0.3, -0.45, air) + swing * 0.22 - slide * 0.2;
    v.arms[1].rotation.z = lerp(-0.1, 0.45, air) - swing * 0.22 + slide * 0.2;

    // ── Weapon ─────────────────────────────────────────────────────────────
    // Drawing is a physical motion: the item drops out of the hand and the new
    // one is brought up, so the swap reads at 60 m as well as in first person.
    if (a.slot !== s.slot) {
      a.slot = s.slot;
      a.swap = 1;
    }
    a.swap = Math.max(0, a.swap - dt * 3.4);
    const swap = Math.sin(a.swap * Math.PI);
    a.kick *= Math.exp(-dt * 13);
    v.weapon.position.set(0, -swap * 0.5 - slide * 0.04, a.kick * 0.15);
    v.weapon.rotation.set(a.kick * 0.2, swap * 0.35, swap * 0.4);
    // Recoil also rocks the torso: a rifle with no shooter behind it is a prop.
    v.body.rotation.x += a.kick * 0.07;
  }

  /** A rifle moving on a body: called for the shooter, whoever it is. */
  shotKick(index: number): void {
    const v = this.players[index];
    if (v) v.anim.kick = Math.min(1, v.anim.kick + 0.85);
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
    entry.mat.linewidth = flight ? 0.03 : rope.mode === 'zip' ? 0.055 : 0.045;
    entry.mat.opacity = 0.9;
    entry.sheathMat.linewidth = flight ? 0.07 : rope.mode === 'zip' ? 0.14 : 0.11;
    // The sheath takes the kit's colour too, darkened: a cable is part of the
    // skin, not a black line drawn on top of it.
    const sheathCol = new THREE.Color(clawSkin.rope).multiplyScalar(0.42);
    entry.sheathMat.color.copy(sheathCol);
    // Taut cable hums: the core widens and brightens as the reel loads up.
    const tension = clamp(1 - slack / 3.2, 0, 1);
    entry.mat.linewidth = (flight ? 0.03 : rope.mode === 'zip' ? 0.055 : 0.045) * (1 + tension * 0.35);

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

    // The claw sheds its own trail in flight: a short hot stream tinted to the
    // kit, which is the only thing that makes a 170 m/s projectile readable
    // against a white sky.
    this.ropeMoteAcc[index] += dt * (flight ? 55 : rope.mode === 'zip' ? 30 : 0);
    const shed = Math.min(14, Math.floor(this.ropeMoteAcc[index]));
    for (let i = 0; i < shed; i++) {
      const jitter = 0.12;
      this.particles.ember(
        {
          x: head.position.x + (Math.random() - 0.5) * jitter,
          y: head.position.y + (Math.random() - 0.5) * jitter,
          z: head.position.z + (Math.random() - 0.5) * jitter,
        },
        clawSkin.trail,
        flight ? 0.15 : 0.11,
        flight ? 0.3 : 0.22,
      );
    }
    this.ropeMoteAcc[index] -= shed;

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
        // Base angle comes from the head itself: the fluke count is part of the
        // skin, so it cannot be derived from an index here.
        child.rotation.z = (child.userData.baseAngle as number) ?? 0;
        const fluke = child.children[0];
        if (fluke) fluke.rotation.x = -0.15 - open * 0.95;
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
    // A slow crane around the spire: low enough to see the joists and brackets
    // under the decks (the detail nobody sees while playing), close enough for
    // the structure to fill the frame, and unhurried enough to read as a menu.
    const a = this.time * 0.042;
    const breathe = Math.sin(this.time * 0.11);
    const r = 104 + breathe * 18;
    const rise = 26 + Math.sin(this.time * 0.075) * 20;
    // A hand-held drift on top of the crane: two incommensurate sines, so the
    // shot never looks like it is on a rail.
    const driftX = Math.sin(this.time * 0.63) * 0.9 + Math.sin(this.time * 1.7) * 0.25;
    const driftY = Math.cos(this.time * 0.51) * 0.7 + Math.cos(this.time * 1.3) * 0.2;
    this.camera.position.set(Math.cos(a) * r + driftX, rise + driftY, Math.sin(a) * r + driftX * 0.6);
    this.camera.fov = lerp(this.camera.fov, 52, 1 - Math.exp(-dt * 2.5));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 40 + Math.sin(this.time * 0.09) * 5, 0);
    this.camera.rotateZ(Math.sin(this.time * 0.13) * 0.02);
    this.ringGroup.visible = false;
    this.viewmodel.visible = false;
    for (const p of this.players) {
      p.group.visible = false;
      p.shadow.visible = false;
    }
    this.particles.update(dt);
    this.beams.update(dt);
    this.waves.update(dt);
    this.fx.update(dt);
    this.sky.update(dt, this.camera);
    // The menu shot is the one place the sun is usually in frame, so keep the
    // glare and the shafts live instead of switching the grade off.
    this.camForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const facing = this.camForward.dot(this.sunDir);
    if (facing > 0.1) {
      this.sunProbe.copy(this.camera.position).addScaledVector(this.sunDir, 1500);
      this.sunProbe.project(this.camera);
      this.sunScreen.set(this.sunProbe.x * 0.5 + 0.5, this.sunProbe.y * 0.5 + 0.5);
      const edge = clamp(Math.min(this.sunScreen.x, 1 - this.sunScreen.x) * 3 + 0.4, 0, 1) *
        clamp(Math.min(this.sunScreen.y, 1 - this.sunScreen.y) * 3 + 0.4, 0, 1);
      this.post.setSun(this.sunScreen, edge * clamp((facing - 0.1) * 2.2, 0, 1));
    } else {
      this.post.setSun(this.sunScreen, 0);
    }
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
