import { TILE, WORLD } from './config';
import type { Rect, Vec2 } from './geometry';

export interface Breakable {
  id: string;
  rect: Rect;
  kind: 'grass' | 'pot' | 'pod';
  broken: boolean;
  respawnTimer: number;
}

export interface Firefly {
  x: number;
  y: number;
  r: number;
  phase: number;
}

export interface Level {
  width: number;
  height: number;
  spawn: Vec2;
  solids: Rect[];
  hazards: Rect[];
  bouncePads: Rect[];
  benches: Rect[];
  breakables: Breakable[];
  fireflies: Firefly[];
  /** Decorative vine/chain hang points drawn by the renderer, purely cosmetic. */
  vines: { x: number; y: number; len: number }[];
}

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/**
 * Builds "The Mossbound Hollow" - a short vertical slice built to exercise every
 * piece of the movement kit. Gap widths below were measured by scripting the actual
 * `stepPlayer` controller rather than guessed:
 *  - a plain running jump reliably clears ~2.5 tiles
 *  - a jump timed into an air-dash reliably clears ~4.5 tiles
 *  - a wall-jump, holding toward the far wall, reaches ~1.8 tiles of horizontal gap
 */
export function buildTestChamber(): Level {
  const solids: Rect[] = [];
  const hazards: Rect[] = [];
  const bouncePads: Rect[] = [];
  const benches: Rect[] = [];
  const breakables: Breakable[] = [];
  const fireflies: Firefly[] = [];
  const vines: { x: number; y: number; len: number }[] = [];

  const groundLevel = WORLD.height; // bottom of every standing surface in the chamber
  const floorY = groundLevel - TILE * 3;
  const floorH = TILE * 3;
  let x = 0;

  // --- starting plaza ---
  const plazaW = TILE * 8;
  solids.push(rect(x, floorY, plazaW, floorH));
  const spawn = { x: TILE * 1.5, y: floorY - 60 };
  x += plazaW;

  // --- gap 1: a plain running jump (~2.4 tiles) ---
  const gap1 = TILE * 2.4;
  hazards.push(rect(x, floorY + TILE * 0.6, gap1, TILE * 2.2));
  x += gap1;

  const plat2W = TILE * 6;
  solids.push(rect(x, floorY, plat2W, floorH));
  x += plat2W;

  // --- gap 2: needs a jump timed into a dash (~4.4 tiles) ---
  const gap2 = TILE * 4.4;
  hazards.push(rect(x, floorY + TILE * 0.6, gap2, TILE * 2.2));
  x += gap2;

  const plat3W = TILE * 5;
  solids.push(rect(x, floorY, plat3W, floorH));
  x += plat3W;

  // --- a short staircase up to the first bench ---
  solids.push(rect(x, floorY - TILE, TILE * 2, floorH + TILE));
  x += TILE * 2;
  solids.push(rect(x, floorY - TILE * 2.4, TILE * 3, floorH + TILE * 2.4));
  benches.push(rect(x + TILE * 0.9, floorY - TILE * 2.4 - 18, TILE, 18));
  x += TILE * 3;
  const landingW = TILE * 3;
  const landingTopY = floorY - TILE * 2.4;
  solids.push(rect(x, landingTopY, landingW, groundLevel - landingTopY));
  const chimneyX = x + landingW;
  x = chimneyX;

  // --- wall-jump chimney: a vertical shaft reached by jumping off the landing ledge.
  // The right wall sits a SHORT distance from the ledge -- short enough that the very
  // first leap catches it right near the top of its arc (not deep into the descent).
  // Catching that high means the kick-off rebound has nearly a full jump's worth of
  // height left to spend, which is what lets it reach all the way up to the left
  // pillar above. The left pillar only exists ABOVE a clearance line set higher than
  // any unassisted jump can reach, so the first leap passes safely beneath it; it is
  // there purely to catch the kick-off rebound, continuing the climb wall to wall.
  // (A wall whose base met the ledge's own walking height would overlap a standing
  // player's body and seal the ledge shut -- that is the trap this clearance avoids.)
  const chimneyWallW = TILE * 0.9;
  const chimneyEntrySpan = TILE * 2.3; // ledge-to-right-wall gap -- tuned so the entry leap
  // catches the right wall right near its apex instead of well into its fall
  const chimneyClearGap = TILE * 1.05; // open width a body needs to pass through while climbing
  const chimneyLeftWallW = chimneyEntrySpan - chimneyClearGap; // wide catch face filling the rest
  const chimneyHeight = TILE * 6;
  const chimneyTopY = landingTopY - chimneyHeight;
  const chimneyLeftClearance = TILE * 3; // keeps the upper-left wall above any entry jump's reach
  const chimneyLeftBottomY = landingTopY - chimneyLeftClearance;
  solids.push(rect(chimneyX, chimneyTopY, chimneyLeftWallW, chimneyLeftBottomY - chimneyTopY)); // upper-left wall
  const rightWallX = chimneyX + chimneyEntrySpan;
  solids.push(rect(rightWallX, chimneyTopY, chimneyWallW, groundLevel - chimneyTopY)); // right wall
  const chimneyCapW = rightWallX + chimneyWallW - chimneyX;
  // No ceiling over the shaft at all -- both walls' own top edges (flush at chimneyTopY) are the
  // exit ledges. A header flush with the right wall's face would just extend it into one taller
  // wall with nothing to land on top of, so the gap stays open all the way up and the player
  // steps out by walking across whichever wall-top they're standing on once they clear it.
  hazards.push(rect(chimneyX, groundLevel - TILE * 0.5, chimneyCapW, TILE * 0.5));
  const gauntletY = chimneyTopY;
  x = chimneyX + chimneyCapW;

  // --- pogo gauntlet: a spiked pit spanned by two silk pods. The first sits close to the ledge
  // (a body falls fast -- by ~2 tiles out it's already dropped well past a pod sitting at ledge
  // height); the second is spaced by the measured period of a chained pogo arc (bounce, rise,
  // fall, re-catch at the same height). The far platform sits where the SECOND arc naturally
  // comes back down on its own, so there's no third link for compounding drift to break. ---
  solids.push(rect(x, gauntletY, TILE * 1.5, TILE * 1.1));
  x += TILE * 1.5;
  const gauntletStartX = x;
  const gauntletLen = TILE * 8.75;
  hazards.push(rect(gauntletStartX, gauntletY + TILE * 0.55, gauntletLen, TILE * 0.5));
  // Pods are tall (not just a thin disc) so a chained pogo arc that's drifted a bit off the
  // textbook rhythm by the time it reaches the next one still connects -- the visible bloom at
  // the top is only the "business end", the stem below is still part of the bounce hitbox.
  const podW = TILE * 0.8;
  const podH = TILE * 1.8;
  bouncePads.push(rect(gauntletStartX + TILE * 0.9, gauntletY + 6, podW, podH));
  bouncePads.push(rect(gauntletStartX + TILE * 5, gauntletY + 6, podW, podH));
  x = gauntletStartX + gauntletLen;
  solids.push(rect(x, gauntletY - TILE * 0.2, TILE * 4, TILE * 1.3));
  x += TILE * 4;

  // --- floating stepping stones up to the high overlook bench (~2.3 tile hops) ---
  const stoneY0 = gauntletY - TILE * 0.2;
  solids.push(rect(x, stoneY0 - TILE * 1.6, TILE * 2.2, TILE * 0.8));
  x += TILE * 2.2 + TILE * 2.3;
  solids.push(rect(x, stoneY0 - TILE * 3.1, TILE * 2.2, TILE * 0.8));
  x += TILE * 2.2 + TILE * 2.3;
  const overlookW = TILE * 7;
  const overlookTopY = stoneY0 - TILE * 4.2;
  solids.push(rect(x, overlookTopY, overlookW, TILE * 4.2 + TILE));
  benches.push(rect(x + TILE * 1, overlookTopY - 18, TILE, 18));
  const potX = x + TILE * 3;
  x += overlookW;

  // --- long final descent back to solid ground (tests fast-fall + landing dust) ---
  solids.push(rect(x, floorY, TILE * 10, floorH));
  const finalX = x + TILE * 10;

  const width = finalX + TILE * 4;
  const height = WORLD.height;

  // decorative breakable foliage
  const grassSpots: [number, number][] = [
    [TILE * 1, floorY - 14],
    [TILE * 2.2, floorY - 14],
    [TILE * 5.4, floorY - 14],
    [plazaW + gap1 + TILE * 1.2, floorY - 14],
    [plazaW + gap1 + TILE * 3.6, floorY - 14],
  ];
  grassSpots.forEach(([gx, gy], i) => {
    breakables.push({ id: `grass-${i}`, rect: rect(gx, gy, 14, 14), kind: 'grass', broken: false, respawnTimer: 0 });
  });
  const potSpots: [number, number][] = [
    [plazaW + gap1 + TILE * 2, floorY - 24],
    [potX, overlookTopY - 22],
  ];
  potSpots.forEach(([px, py], i) => {
    breakables.push({ id: `pot-${i}`, rect: rect(px, py, 20, 24), kind: 'pot', broken: false, respawnTimer: 0 });
  });

  for (let i = 0; i < 34; i++) {
    fireflies.push({
      x: Math.random() * width,
      y: floorY - Math.random() * (TILE * 14),
      r: 1.4 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
    });
  }
  for (let i = 0; i < 14; i++) {
    vines.push({ x: (i / 14) * width + Math.random() * 60, y: 0, len: 60 + Math.random() * 200 });
  }

  return {
    width,
    height,
    spawn,
    solids,
    hazards,
    bouncePads,
    benches,
    breakables,
    fireflies,
    vines,
  };
}
