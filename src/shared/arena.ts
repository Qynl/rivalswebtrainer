/**
 * ARENA: "GLINTSPIRE"
 *
 * A vertical ruin of neon slabs suspended over a bottomless void. The design
 * constraints, and how they are met:
 *
 * - VERTICAL: play space runs from y≈10 to y≈74 with three readable strata
 *   (void teeth / shelf deck / crown deck). Falling is always one mistake away.
 * - MIXED: a 100 m open crown lane crosses the map at y≈67 for rifle duels,
 *   while four columns and a mid collar make the centre a knife-fight.
 * - ANCHOR-RICH: 26 pinions, every one placed so a swing can be chained from
 *   it into another. Tests assert coverage from a 6 m grid.
 * - NO DOMINANT PERCH: the spire and the four columns cut the map into
 *   quadrants; the tallest decks see the opposite deck but never the whole map
 *   (tests measure visible area from every deck).
 * - SYMMETRY: every block and anchor is mirrored through the map centre
 *   (x,z → -x,-z) so both spawns are exactly equal. Tests assert this.
 *
 * All blocks are axis-aligned boxes: cheap to collide, cheap to raycast,
 * and the low-poly neon look comes from edges and emissive caps, not meshes.
 */

import type { Vec3 } from './mathx.ts';

export interface Block {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Purely visual/material classification. */
  kind: 'deck' | 'wall' | 'strut' | 'beacon';
}

export interface Anchor {
  x: number;
  y: number;
  z: number;
}

export interface Arena {
  blocks: Block[];
  anchors: Anchor[];
  spawns: { pos: Vec3; yaw: number }[];
  center: Vec3;
  /** Below this y you are void food. */
  voidY: number;
}

const deck = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Block => ({ x, y, z, hx, hy, hz, kind: 'deck' });
const wall = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Block => ({ x, y, z, hx, hy, hz, kind: 'wall' });
const strut = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Block => ({ x, y, z, hx, hy, hz, kind: 'strut' });
const beacon = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Block => ({ x, y, z, hx, hy, hz, kind: 'beacon' });

/** Pair helper: emits a block and its point-mirror, guaranteeing symmetry. */
function pair(b: Block): Block[] {
  return [b, { ...b, x: -b.x, z: -b.z }];
}

function anchorPair(x: number, y: number, z: number): Anchor[] {
  return [
    { x, y, z },
    { x: -x, y, z: -z },
  ];
}

const blocks: Block[] = [
  // ── Central spire: the map's spine and the source of all sightline breaks.
  strut(0, 26, 0, 8, 26, 8),
  // The crown is deliberately small: the shrinking ring ends inside it, so it
  // must be a risky duelling platform, not a fortress with a view of everything.
  deck(0, 53.5, 0, 7.5, 1.5, 7.5),
  // Collar at mid height: a ring of close cover, the knife-fight layer.
  deck(0, 21, 0, 12.5, 1, 12.5),
  // Thin antenna: breaks the crown sniper lane into two windows. It ends in a
  // needle rather than a flat cap on purpose: the antenna top is the highest
  // point on the map and must not be a standable sniper nest.
  strut(0, 64, 0, 0.6, 9, 0.6),
  strut(0, 76.5, 0, 0.2, 3.5, 0.2),
  beacon(0, 56.6, 0, 3.4, 1.6, 3.4),
  // Low parapets instead of pylons: they give the crown 1.2 m of cover from
  // below (and something to crouch behind) without creating a sniper nest.
  ...pair({ ...deck(0, 56.2, -7, 7.5, 0.7, 0.6) }),
  ...pair({ ...deck(-7, 56.2, 0, 0.6, 0.7, 7.5) }),

  // ── Four columns flanking the spire: dense close cover, anchor towers.
  ...pair({ ...strut(24, 34, 24, 3.2, 24, 3.2) }),
  ...pair({ ...strut(24, 34, -24, 3.2, 24, 3.2) }),
  ...pair({ ...deck(24, 58.5, 24, 4.2, 1, 4.2) }),
  ...pair({ ...deck(24, 58.5, -24, 4.2, 1, 4.2) }),

  // ── Spawn decks: identical corner nooks, 93 m from the centre.
  ...pair({ ...deck(-62, 40, -62, 11, 1.5, 11) }),
  ...pair({ ...wall(-75, 45.5, -62, 2, 4, 12) }),
  ...pair({ ...wall(-62, 45.5, -75, 12, 4, 2) }),
  ...pair({ ...deck(-55, 47, -55, 5, 1, 5) }),
  // Canopy 4 m over the spawn floor: you cannot pre-aim a spawn from the spire.
  ...pair({ ...deck(-62, 49, -62, 6.5, 0.8, 6.5) }),
  // Small cover right on the spawn deck so a spawn peek is not free.
  ...pair({ ...wall(-58, 43.6, -68, 2.2, 2.1, 0.7) }),

  // ── Keeps: corner fortresses with a mid balcony and a buttress perch.
  ...pair({ ...strut(44, 26, -62, 11, 26, 11) }),
  ...pair({ ...deck(44, 53.5, -62, 13, 1.5, 13) }),
  ...pair({ ...strut(44, 20, -46, 4, 12, 4) }),
  ...pair({ ...deck(30, 34, -62, 6, 1, 10) }),
  ...pair({ ...wall(44, 56.2, -70, 10, 1.2, 0.8) }),

  // ── Mid shelves and their rails.
  ...pair({ ...deck(-26, 24, -34, 12, 1, 8) }),
  ...pair({ ...wall(-26, 27, -41, 12, 2.4, 1) }),
  ...pair({ ...deck(24, 64, -16, 9, 1.6, 9) }),
  ...pair({ ...wall(24, 66.6, -24, 7, 1.2, 0.7) }),

  // ── Screens: 34 m tall walls that cut the diagonal sightlines.
  ...pair({ ...wall(2, 34, -46, 2, 17, 13) }),

  // ── Bridges and islands.
  ...pair({ ...deck(20, 40, -34, 13, 1, 3) }),
  ...pair({ ...strut(58, 7, -16, 10, 7, 10) }),
  ...pair({ ...deck(-52, 56, -4, 7, 1, 7) }),
  ...pair({ ...deck(-40, 46, 16, 5, 1, 5) }),
  // Crown lane decks: 100 m apart, only the antenna between them.
  ...pair({ ...deck(-46, 66, -8, 7, 1, 7) }),
  ...pair({ ...wall(-40, 69.5, -2, 2.5, 2.5, 6) }),

  // ── Void teeth: low pillars that make the underside a maze, not a drop.
  ...pair({ ...strut(-14, 26, -24, 2.6, 16, 2.6) }),
  ...pair({ ...deck(-14, 42.6, -24, 4, 0.6, 4) }),
  ...pair({ ...strut(34, 16, 6, 3, 6, 3) }),
  ...pair({ ...deck(0, 10, -40, 9, 1, 9) }),

  // ── Spawn-exit rings, low enough to be reachable by a bad fall.
  ...pair({ ...deck(-46, 30, -20, 8, 1, 8) }),
  ...pair({ ...strut(-46, 15, -20, 4, 15, 4) }),
];

const anchors: Anchor[] = [
  { x: 0, y: 74, z: 0 }, // top of the antenna: the biggest pendulum in the map
  { x: 0, y: 90, z: 0 }, // sky hook, only reachable with a chain
  ...anchorPair(13, 63, 13),
  ...anchorPair(13, 63, -13),
  ...anchorPair(24, 64, 24),
  ...anchorPair(24, 64, -24),
  ...anchorPair(44, 59, -62),
  ...anchorPair(-46, 72, -8),
  ...anchorPair(52, 62, 4),
  ...anchorPair(-52, 62, -4),
  ...anchorPair(2, 56, -46),
  ...anchorPair(24, 70, -16),
  ...anchorPair(-26, 30, -34),
  ...anchorPair(30, 40, -62),
  ...anchorPair(-55, 52, -55),
  ...anchorPair(44, 38, -46),
  ...anchorPair(0, 48, 40),
  ...anchorPair(34, 52, -6),
  ...anchorPair(-34, 46, 18),
  ...anchorPair(-70, 64, 6),
  ...anchorPair(20, 82, -34),
  ...anchorPair(-46, 22, 20),
  ...anchorPair(58, 20, -16),
];

/** Yaw that makes a player at `from` face `to` (Three.js convention). */
export function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function buildArena(): Arena {
  const center = { x: 0, y: 46, z: 0 };
  const spawnA = { x: -62, y: 41.5, z: -62 };
  const spawnB = { x: 62, y: 41.5, z: 62 };
  return {
    blocks,
    anchors,
    spawns: [
      { pos: spawnA, yaw: yawTo(spawnA, center) },
      { pos: spawnB, yaw: yawTo(spawnB, center) },
    ],
    center,
    voidY: -28,
  };
}

export const ARENA = buildArena();

/** Axis-aligned helper used for cheap gameplay checks (ring, spawn safety). */
export function insideArena(x: number, y: number, z: number): boolean {
  return Math.abs(x) < 95 && Math.abs(z) < 95 && y > ARENA.voidY && y < 130;
}
