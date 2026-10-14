import type { Aabb, Vec3 } from './movement';

export interface ArenaBox extends Aabb {
  color: number;
  kind: 'floor' | 'wall' | 'crate' | 'platform' | 'stair' | 'pillar';
}

export const ARENA_HALF = 32; // arena spans [-32, 32] on X and Z

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, kind: ArenaBox['kind']): ArenaBox {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
    color,
    kind,
  };
}

/** Builds the solids for the "Foundry" arena. Y is up, floor top is y=0. */
export function buildArena(): ArenaBox[] {
  const H = ARENA_HALF;
  const boxes: ArenaBox[] = [
    box(-H - 1, -1, -H - 1, H + 1, 0, H + 1, 0x2a2f36, 'floor'),
    // outer walls
    box(-H - 1, 0, -H - 1, H + 1, 6, -H, 0x3b4450, 'wall'),
    box(-H - 1, 0, H, H + 1, 6, H + 1, 0x3b4450, 'wall'),
    box(-H - 1, 0, -H - 1, -H, 6, H + 1, 0x3b4450, 'wall'),
    box(H, 0, -H - 1, H + 1, 6, H + 1, 0x3b4450, 'wall'),
    // central raised block with stairs on both ends
    box(-4, 0, -4, 4, 2.4, 4, 0x5a6878, 'platform'),
    box(4, 0, -1.5, 5.5, 0.5, 1.5, 0x5a6878, 'stair'),
    box(5.5, 0, -1.5, 7, 1.0, 1.5, 0x5a6878, 'stair'),
    box(7, 0, -1.5, 8.5, 1.5, 1.5, 0x5a6878, 'stair'),
    box(-5.5, 0, -1.5, -4, 0.5, 1.5, 0x5a6878, 'stair'),
    box(-7, 0, -1.5, -5.5, 1.0, 1.5, 0x5a6878, 'stair'),
    box(-8.5, 0, -1.5, -7, 1.5, 1.5, 0x5a6878, 'stair'),
    // long lanes: low walls
    box(-20, 0, -12, -14, 1.4, -10.5, 0x6b5a48, 'crate'),
    box(14, 0, 10.5, 20, 1.4, 12, 0x6b5a48, 'crate'),
    box(-22, 0, 14, -18, 2.6, 18, 0x6b5a48, 'crate'),
    box(18, 0, -18, 22, 2.6, -14, 0x6b5a48, 'crate'),
    // pillars
    box(-12, 0, 8, -10, 6, 10, 0x4a5563, 'pillar'),
    box(10, 0, -9, 12, 6, -7, 0x4a5563, 'pillar'),
    // cover crates scattered
    box(-8, 0, 16, -6, 1.2, 18, 0x6b5a48, 'crate'),
    box(6, 0, 18, 8, 1.2, 20, 0x6b5a48, 'crate'),
    box(-2, 0, -20, 0, 1.2, -18, 0x6b5a48, 'crate'),
    box(22, 0, 4, 24, 1.2, 6, 0x6b5a48, 'crate'),
    box(-24, 0, -4, -22, 1.2, -2, 0x6b5a48, 'crate'),
    // raised ledge on the east side (reachable by the crate step)
    box(24, 0, 20, 30, 3.0, 26, 0x5a6878, 'platform'),
    box(22, 0, 20, 24, 0.9, 26, 0x5a6878, 'stair'),
  ];
  return boxes;
}

/** Spawn points at opposite corners of the arena. */
export const SPAWNS: { player: Vec3; bot: Vec3 } = {
  player: { x: -24, y: 0, z: 24 },
  bot: { x: 24, y: 0, z: -24 },
};

export const SPAWN_CANDIDATES: Vec3[] = [
  { x: -24, y: 0, z: 24 },
  { x: 24, y: 0, z: -24 },
  { x: -24, y: 0, z: -24 },
  { x: 24, y: 0, z: 24 },
  { x: 0, y: 0, z: 26 },
  { x: 0, y: 0, z: -26 },
];
