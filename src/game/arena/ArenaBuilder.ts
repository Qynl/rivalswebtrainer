import * as THREE from 'three';
import { CollisionWorld } from '../movement/CollisionWorld';
import type { Vec3 } from '../movement/MovementTypes';
import {
  ARENA_LAYOUT_NOTES,
  ARENA_SPAWN,
  LAB_SPAWN,
  type ArenaMode,
  type SpawnPoint,
} from './ArenaConfig';
import { addWorldAtmosphere } from './WorldAtmosphere';

export interface ArenaBuildResult {
  world: CollisionWorld;
  spawns: Record<ArenaMode, SpawnPoint>;
}

interface BoxOptions {
  id: string;
  position: Vec3;
  size: Vec3;
  material: THREE.Material;
  collision?: boolean;
  support?: boolean;
  rotationY?: number;
  outline?: boolean;
  tag?: string;
}

const WORLD_BOUNDS = { minX: -40, maxX: 62, minZ: -28, maxZ: 28 };

function material(
  color: number,
  roughness = 0.72,
  metalness = 0.08,
  emissive = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity: emissive ? 0.7 : 0,
  });
}

function addBox(scene: THREE.Scene, world: CollisionWorld, options: BoxOptions): void {
  const {
    id,
    position,
    size,
    material: boxMaterial,
    collision = true,
    support = true,
    rotationY = 0,
    outline = true,
    tag,
  } = options;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    boxMaterial,
  );
  mesh.name = id;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = rotationY;
  mesh.castShadow = size.y > 0.16;
  mesh.receiveShadow = true;
  scene.add(mesh);

  if (outline) {
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x496678, transparent: true, opacity: 0.42 }),
    );
    edge.position.copy(mesh.position);
    edge.rotation.copy(mesh.rotation);
    edge.name = `${id}:edge`;
    scene.add(edge);
  }

  if (collision) {
    world.addBox(id, position, size, tag, support);
  }
}

function addStrip(
  scene: THREE.Scene,
  id: string,
  position: Vec3,
  size: Vec3,
  stripMaterial: THREE.Material,
  rotationY = 0,
): void {
  addBox(scene, new CollisionWorld(), {
    id,
    position,
    size,
    material: stripMaterial,
    collision: false,
    outline: false,
    rotationY,
  });
}

function createRampGeometry(width: number, length: number, low: number, high: number): THREE.BufferGeometry {
  const w = width / 2;
  const l = length / 2;
  const vertices = new Float32Array([
    -w, 0, -l,
    w, 0, -l,
    w, 0, l,
    -w, 0, l,
    -w, low, -l,
    w, low, -l,
    w, high, l,
    -w, high, l,
  ]);
  const indices = [
    // top
    4, 5, 6, 4, 6, 7,
    // bottom
    0, 2, 1, 0, 3, 2,
    // left
    0, 4, 7, 0, 7, 3,
    // right
    1, 2, 6, 1, 6, 5,
    // low end
    0, 1, 5, 0, 5, 4,
    // high end
    3, 7, 6, 3, 6, 2,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addRamp(
  scene: THREE.Scene,
  world: CollisionWorld,
  options: {
    id: string;
    center: Vec3;
    width: number;
    length: number;
    lowHeight: number;
    highHeight: number;
    highToward: 'min' | 'max';
    material: THREE.Material;
  },
): void {
  const { id, center, width, length, lowHeight, highHeight, highToward, material: rampMaterial } = options;
  const mesh = new THREE.Mesh(
    createRampGeometry(width, length, lowHeight, highHeight),
    rampMaterial,
  );
  mesh.name = id;
  mesh.position.set(center.x, center.y, center.z);
  mesh.rotation.y = highToward === 'max' ? 0 : Math.PI;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x55758a, transparent: true, opacity: 0.55 }),
  );
  edge.position.copy(mesh.position);
  edge.rotation.copy(mesh.rotation);
  scene.add(edge);

  world.addRamp({
    id,
    minX: center.x - width / 2,
    maxX: center.x + width / 2,
    minZ: center.z - length / 2,
    maxZ: center.z + length / 2,
    lowHeight,
    highHeight,
    highToward,
  });
}

function makeLabel(text: string, color: string, background = 'rgba(7, 19, 28, .82)'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 144;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background;
  context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 22);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();
  context.font = '700 42px Inter, Arial, sans-serif';
  context.letterSpacing = '2px';
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(5.6, 1.26, 1);
  return sprite;
}

function addMarker(scene: THREE.Scene, x: number, z: number, index: number): void {
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x86ecff, transparent: true, opacity: 0.75 });
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 1.1), markerMaterial);
  marker.position.set(x, 0.032, z);
  marker.name = `lab:meter:${index}`;
  scene.add(marker);

  const label = makeLabel(`${index}m`, '#b9f4ff', 'rgba(8, 39, 53, .8)');
  label.scale.set(1.05, 0.24, 1);
  label.position.set(x + 0.78, 0.08, z);
  scene.add(label);
}

function addVerticalMeter(scene: THREE.Scene, x: number, z: number): void {
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0x86ecff, transparent: true, opacity: 0.8 });
  for (let y = 0; y <= 5; y += 1) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.028, 0.06), lineMaterial);
    tick.position.set(x, y + 0.04, z);
    scene.add(tick);
    const label = makeLabel(`${y}m`, '#b9f4ff', 'rgba(8, 39, 53, .8)');
    label.scale.set(0.78, 0.18, 1);
    label.position.set(x - 1.65, y + 0.04, z);
    scene.add(label);
  }
}

function addArena(scene: THREE.Scene, world: CollisionWorld): void {
  const floor = material(0xc2dbe1, 0.94, 0.02);
  const cover = material(0xe7eeee, 0.72, 0.04);
  const coverDark = material(0x6e96a6, 0.78, 0.08);
  const trim = material(0x3f9eb7, 0.46, 0.18);
  const rampMaterial = material(0xd2e4e7, 0.82, 0.04);
  const spawnMaterial = material(0x5d8da1, 0.72, 0.08);

  const arenaFloor = new THREE.Mesh(
    new THREE.BoxGeometry(34, 0.12, 34),
    floor,
  );
  arenaFloor.position.set(0, -0.06, 0);
  arenaFloor.receiveShadow = true;
  arenaFloor.name = 'arena:floor';
  scene.add(arenaFloor);

  // The public references describe a compact, clean grid with ramps on both
  // ends and mirrored angled cover. These are the blockout's intentional axes.
  for (let i = -4; i <= 4; i += 1) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.012, 31.6),
      new THREE.MeshBasicMaterial({ color: 0x638b99, transparent: true, opacity: 0.3 }),
    );
    line.position.set(i * 3.5, 0.012, 0);
    scene.add(line);
  }
  for (let i = -4; i <= 4; i += 1) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(31.6, 0.012, 0.018),
      new THREE.MeshBasicMaterial({ color: 0x638b99, transparent: true, opacity: 0.3 }),
    );
    line.position.set(0, 0.014, i * 3.5);
    scene.add(line);
  }

  addBox(scene, world, {
    id: 'arena:west-boundary', position: { x: -17.3, y: 1.35, z: 0 },
    size: { x: 0.7, y: 2.7, z: 34 }, material: coverDark, tag: 'arena boundary',
  });
  addBox(scene, world, {
    id: 'arena:east-boundary', position: { x: 17.3, y: 1.35, z: 0 },
    size: { x: 0.7, y: 2.7, z: 34 }, material: coverDark, tag: 'arena boundary',
  });
  addBox(scene, world, {
    id: 'arena:north-boundary', position: { x: 0, y: 1.35, z: 17.3 },
    size: { x: 34, y: 2.7, z: 0.7 }, material: coverDark, tag: 'arena boundary',
  });
  addBox(scene, world, {
    id: 'arena:south-boundary', position: { x: 0, y: 1.35, z: -17.3 },
    size: { x: 34, y: 2.7, z: 0.7 }, material: coverDark, tag: 'arena boundary',
  });

  addRamp(scene, world, {
    id: 'arena:south-ramp', center: { x: 0, y: 0, z: -12.9 }, width: 9,
    length: ARENA_LAYOUT_NOTES.rampLength, lowHeight: 0.05,
    highHeight: ARENA_LAYOUT_NOTES.rampHeight, highToward: 'max', material: rampMaterial,
  });
  addRamp(scene, world, {
    id: 'arena:north-ramp', center: { x: 0, y: 0, z: 12.9 }, width: 9,
    length: ARENA_LAYOUT_NOTES.rampLength, lowHeight: 0.05,
    highHeight: ARENA_LAYOUT_NOTES.rampHeight, highToward: 'min', material: rampMaterial,
  });

  addBox(scene, world, {
    id: 'arena:center-platform', position: { x: 0, y: 0.625, z: 0 },
    size: { x: 7.2, y: 1.25, z: 5.4 }, material: cover, tag: 'center platform',
  });
  addBox(scene, world, {
    id: 'arena:center-wall', position: { x: 0, y: 2.0, z: 0 },
    size: { x: 4.4, y: 1.5, z: 0.8 }, material: coverDark, tag: 'center cover',
  });
  addBox(scene, world, {
    id: 'arena:center-trim', position: { x: 0, y: 1.29, z: 0 },
    size: { x: 7.35, y: 0.06, z: 5.55 }, material: trim, collision: false, outline: false,
  });

  const angled = [
    { x: -9.3, z: -6.3, rotation: Math.PI / 4 },
    { x: 9.3, z: -6.3, rotation: -Math.PI / 4 },
    { x: -9.3, z: 6.3, rotation: -Math.PI / 4 },
    { x: 9.3, z: 6.3, rotation: Math.PI / 4 },
  ];
  angled.forEach((block, index) => {
    addBox(scene, world, {
      id: `arena:angled-cover-${index}`,
      position: { x: block.x, y: 1.05, z: block.z },
      size: { x: 3.4, y: 2.1, z: 3.2 }, material: cover,
      rotationY: block.rotation, tag: 'angled cover',
    });
  });

  const sideCovers = [
    [-12.4, -1.6], [12.4, -1.6], [-12.4, 1.6], [12.4, 1.6],
  ];
  sideCovers.forEach(([x, z], index) => {
    addBox(scene, world, {
      id: `arena:side-cover-${index}`,
      position: { x, y: 0.68, z }, size: { x: 2.0, y: 1.36, z: 4.8 },
      material: coverDark, tag: 'side cover',
    });
  });

  // Small spawn decks make the two approaches legible without closing the
  // sightline across the middle.
  addBox(scene, world, {
    id: 'arena:south-spawn-deck', position: { x: 0, y: 0.12, z: -15.3 },
    size: { x: 12, y: 0.24, z: 2.2 }, material: spawnMaterial, tag: 'spawn deck',
  });
  addBox(scene, world, {
    id: 'arena:north-spawn-deck', position: { x: 0, y: 0.12, z: 15.3 },
    size: { x: 12, y: 0.24, z: 2.2 }, material: spawnMaterial, tag: 'spawn deck',
  });

  const label = makeLabel('ARENA  /  MIRRORED BLOCKOUT', '#d4fbff');
  label.position.set(0, 4.9, 0);
  scene.add(label);

  const directionLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 6),
    new THREE.MeshBasicMaterial({ color: 0x8fe8f3, transparent: true, opacity: 0.65 }),
  );
  directionLight.position.set(0, 0.06, -10.1);
  scene.add(directionLight);
}

function addLab(scene: THREE.Scene, world: CollisionWorld): void {
  const floor = material(0x4b8797, 0.84, 0.08);
  const track = material(0x6daeba, 0.68, 0.12);
  const structure = material(0x7baab5, 0.7, 0.08);
  const accent = material(0x2f9eb6, 0.38, 0.18, 0x1b6775);
  const warning = material(0xf4bd69, 0.48, 0.2, 0x6f3b14);

  const labFloor = new THREE.Mesh(new THREE.BoxGeometry(42, 0.12, 34), floor);
  labFloor.position.set(38, -0.06, 0);
  labFloor.receiveShadow = true;
  labFloor.name = 'lab:floor';
  scene.add(labFloor);

  // Acceleration / measured-distance lane.
  addBox(scene, world, {
    id: 'lab:acceleration-track', position: { x: 25, y: 0.08, z: 0 },
    size: { x: 4.2, y: 0.16, z: 29 }, material: track, tag: 'flat track',
  });
  for (let i = -7; i <= 7; i += 1) addMarker(scene, 25, i * 2, i);
  const speedLabel = makeLabel('01  /  ACCELERATION + DISTANCE', '#b9f4ff');
  speedLabel.position.set(25, 3.9, 0);
  scene.add(speedLabel);

  // Jump height ladder/platforms.
  addBox(scene, world, {
    id: 'lab:jump-platform-1', position: { x: 34.2, y: 0.5, z: -8 },
    size: { x: 4.5, y: 1, z: 3.2 }, material: structure, tag: 'jump platform',
  });
  addBox(scene, world, {
    id: 'lab:jump-platform-2', position: { x: 34.2, y: 1.5, z: -1.9 },
    size: { x: 4.5, y: 1, z: 3.2 }, material: structure, tag: 'jump platform',
  });
  addBox(scene, world, {
    id: 'lab:jump-platform-3', position: { x: 34.2, y: 2.5, z: 4.2 },
    size: { x: 4.5, y: 1, z: 3.2 }, material: structure, tag: 'jump platform',
  });
  addVerticalMeter(scene, 36.8, -5.2);
  const jumpLabel = makeLabel('02  /  JUMP HEIGHT', '#b9f4ff');
  jumpLabel.position.set(34.2, 5, -2);
  scene.add(jumpLabel);

  // Ramps and a slide lane.
  addRamp(scene, world, {
    id: 'lab:ramp-a', center: { x: 43.5, y: 0, z: -9.5 }, width: 5.2,
    length: 5.5, lowHeight: 0.04, highHeight: 1.7, highToward: 'max', material: structure,
  });
  addRamp(scene, world, {
    id: 'lab:ramp-b', center: { x: 43.5, y: 0, z: 0.2 }, width: 5.2,
    length: 5.5, lowHeight: 0.04, highHeight: 1.7, highToward: 'min', material: structure,
  });
  addBox(scene, world, {
    id: 'lab:slide-track', position: { x: 43.5, y: 0.08, z: 8.5 },
    size: { x: 5.4, y: 0.16, z: 6.2 }, material: track, tag: 'slide track',
  });
  for (let i = -2; i <= 2; i += 1) {
    addMarker(scene, 43.5, 8.5 + i, i);
  }
  const rampLabel = makeLabel('03  /  RAMPS + SLIDE', '#b9f4ff');
  rampLabel.position.set(43.5, 4.4, 1.5);
  scene.add(rampLabel);

  // Narrow passage and wall test are deliberately compact and forgiving.
  addBox(scene, world, {
    id: 'lab:corridor-left', position: { x: 52.5, y: 1.2, z: 6.2 },
    size: { x: 0.7, y: 2.4, z: 8.5 }, material: structure, tag: 'narrow passage',
  });
  addBox(scene, world, {
    id: 'lab:corridor-right', position: { x: 57.5, y: 1.2, z: 6.2 },
    size: { x: 0.7, y: 2.4, z: 8.5 }, material: structure, tag: 'narrow passage',
  });
  addBox(scene, world, {
    id: 'lab:collision-wall', position: { x: 55, y: 1.6, z: -7.8 },
    size: { x: 0.7, y: 3.2, z: 6.5 }, material: warning, tag: 'wall collision',
  });
  addBox(scene, world, {
    id: 'lab:corner-test', position: { x: 58.5, y: 0.9, z: -1.1 },
    size: { x: 2.2, y: 1.8, z: 2.2 }, material: structure, tag: 'corner collision',
  });
  const collisionLabel = makeLabel('04  /  EDGES + WALLS', '#ffd89a');
  collisionLabel.position.set(55, 4.2, -7.8);
  scene.add(collisionLabel);

  // A compact sequence combining movement transitions.
  const courseX = 32;
  addBox(scene, world, {
    id: 'lab:course-start', position: { x: courseX, y: 0.1, z: 13 },
    size: { x: 3.6, y: 0.2, z: 2.5 }, material: accent, tag: 'combo course',
  });
  addBox(scene, world, {
    id: 'lab:course-cover', position: { x: courseX + 5, y: 0.8, z: 13 },
    size: { x: 2.8, y: 1.6, z: 2.8 }, material: structure, tag: 'combo course',
  });
  addRamp(scene, world, {
    id: 'lab:course-ramp', center: { x: courseX + 9, y: 0, z: 13 }, width: 3.6,
    length: 4.2, lowHeight: 0.04, highHeight: 1.35, highToward: 'max', material: structure,
  });
  const courseLabel = makeLabel('05  /  SPRINT  →  SLIDE  →  JUMP', '#b9f4ff');
  courseLabel.position.set(courseX + 5, 3.8, 13);
  scene.add(courseLabel);

  // Accent stripes visually separate lab stations while keeping draw calls low.
  for (const z of [-16.3, 16.3]) {
    addStrip(scene, `lab:accent-${z}`, { x: 38, y: 0.04, z }, { x: 41, y: 0.04, z: 0.08 }, accent);
  }
}

export function buildArena(scene: THREE.Scene): ArenaBuildResult {
  addWorldAtmosphere(scene);
  const world = new CollisionWorld();
  world.addFloor('world-floor', WORLD_BOUNDS, 0, 'flat ground');

  // Keep the player inside the playable island at high speed. These are also
  // useful collision tests in the lab, not invisible teleport walls.
  world.addBox('world:north-wall', { x: 11, y: 2.6, z: 27.8 }, { x: 102, y: 5.2, z: 0.6 }, 'world boundary', false);
  world.addBox('world:south-wall', { x: 11, y: 2.6, z: -27.8 }, { x: 102, y: 5.2, z: 0.6 }, 'world boundary', false);
  world.addBox('world:east-wall', { x: 61.8, y: 2.6, z: 0 }, { x: 0.6, y: 5.2, z: 56, }, 'world boundary', false);
  world.addBox('world:west-wall', { x: -40.8, y: 2.6, z: 0 }, { x: 0.6, y: 5.2, z: 56 }, 'world boundary', false);

  const worldFloor = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX, 0.1, WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ),
    material(0x6d9baa, 0.97, 0.02),
  );
  worldFloor.position.set(
    (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2,
    -0.055,
    (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2,
  );
  worldFloor.receiveShadow = true;
  worldFloor.name = 'world:floor';
  scene.add(worldFloor);

  const grid = new THREE.GridHelper(102, 51, 0x477d8e, 0x7faebb);
  grid.position.set(11, 0.012, 0);
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.34;
  scene.add(grid);

  addArena(scene, world);
  addLab(scene, world);

  const labDivider = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 2.8, 33),
    material(0x64cdd9, 0.4, 0.25, 0x1e6670),
  );
  labDivider.position.set(18.2, 1.4, 0);
  labDivider.name = 'world:mode-divider';
  labDivider.castShadow = true;
  scene.add(labDivider);

  const dividerLabel = makeLabel('MOVEMENT LAB', '#b9f4ff');
  dividerLabel.position.set(19.4, 4.2, 0);
  dividerLabel.scale.set(3.5, 0.8, 1);
  scene.add(dividerLabel);

  return {
    world,
    spawns: {
      arena: ARENA_SPAWN,
      lab: LAB_SPAWN,
    },
  };
}
