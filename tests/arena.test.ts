import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { GRAPPLE, MATCH } from '../src/shared/constants.ts';
import { ringRadiusAt } from '../src/shared/match.ts';
import { makeWorld } from './helpers.ts';

const key = (x: number, y: number, z: number) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;

/** Points that a player can plausibly stand on (top faces of decks/struts). */
function standingSpots() {
  const spots: { x: number; y: number; z: number }[] = [];
  for (const b of ARENA.blocks) {
    const top = b.y + b.hy;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const x = b.x + ix * b.hx * 0.7;
        const z = b.z + iz * b.hz * 0.7;
        spots.push({ x, y: top + 1.62, z });
      }
    }
  }
  return spots;
}

describe('arena integrity', () => {
  it('is perfectly point-symmetric (both spawns equal)', () => {
    const blockSet = new Set(ARENA.blocks.map((b) => key(b.x, b.y, b.z) + `:${b.hx},${b.hy},${b.hz}`));
    for (const b of ARENA.blocks) {
      expect(blockSet.has(key(-b.x, b.y, -b.z) + `:${b.hx},${b.hy},${b.hz}`), `mirror of ${key(b.x, b.y, b.z)}`).toBe(true);
    }
    const anchorSet = new Set(ARENA.anchors.map((a) => key(a.x, a.y, a.z)));
    for (const a of ARENA.anchors) expect(anchorSet.has(key(-a.x, a.y, -a.z))).toBe(true);
    const [a, b] = ARENA.spawns;
    expect(a.pos.x + b.pos.x).toBeCloseTo(0);
    expect(a.pos.z + b.pos.z).toBeCloseTo(0);
    expect(a.pos.y).toBeCloseTo(b.pos.y);
    expect(Math.hypot(a.pos.x, a.pos.z)).toBeCloseTo(Math.hypot(b.pos.x, b.pos.z));
    expect(Math.abs(a.yaw - b.yaw)).toBeCloseTo(Math.PI);
  });

  it('is vertical and has no floor to stand on outside the structures', () => {
    const tops = ARENA.blocks.map((b) => b.y + b.hy);
    const bottoms = ARENA.blocks.map((b) => b.y - b.hy);
    expect(Math.max(...tops)).toBeGreaterThan(65);
    expect(Math.min(...bottoms)).toBeLessThan(10);
    expect(MATCH.voidY).toBeLessThan(Math.min(...bottoms) - 5);
    for (const b of ARENA.blocks) expect(b.y - b.hy).toBeGreaterThan(MATCH.voidY);
  });

  it('has anchor coverage along every route (chains are always possible)', () => {
    const spots = standingSpots();
    let covered = 0;
    for (const s of spots) {
      const near = ARENA.anchors.some((a) => Math.hypot(a.x - s.x, a.y - s.y, a.z - s.z) < 34);
      if (near) covered++;
    }
    const ratio = covered / spots.length;
    expect(ratio).toBeGreaterThan(0.8);
    // Every anchor can be reached from another one: no dead-end pinions.
    for (const a of ARENA.anchors) {
      const neighbours = ARENA.anchors.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < GRAPPLE.range * 0.85);
      expect(neighbours.length, `anchor ${key(a.x, a.y, a.z)}`).toBeGreaterThan(0);
    }
    for (const s of ARENA.spawns) {
      const near = ARENA.anchors.some((a) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y, a.z - s.pos.z) < 30);
      expect(near).toBe(true);
    }
  });

  it('has no dominant perch and no spawn-to-spawn sightline', async () => {
    const phys = await makeWorld();
    // Targets are places a player can actually be seen at (eye height over a
    // standable surface), not empty air. That is the metric that matters for
    // "can one spot kill the whole map".
    const targets = ARENA.blocks
      .filter((b) => Math.min(b.hx, b.hz) > 0.5)
      .flatMap((b) =>
        [-0.75, 0, 0.75].map((f) => ({
          x: b.x + f * Math.max(0, b.hx - 1),
          y: b.y + b.hy + 1.62,
          z: b.z + f * Math.max(0, b.hz - 1),
        })),
      );
    const tops = ARENA.blocks
      .filter((b) => Math.min(b.hx, b.hz) > 0.8)
      .map((b) => ({ x: b.x, y: b.y + b.hy + 1.62, z: b.z }))
      .filter((s) => s.y > 25);
    const ranking: { spot: { x: number; y: number; z: number }; frac: number }[] = [];
    for (const spot of tops) {
      let visible = 0;
      for (const s of targets) {
        const dx = s.x - spot.x;
        const dy = s.y - spot.y;
        const dz = s.z - spot.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 3) continue;
        const hit = phys.raycast(spot, { x: dx / d, y: dy / d, z: dz / d }, d - 1.2);
        if (!hit) visible++;
      }
      ranking.push({ spot, frac: visible / targets.length });
    }
    ranking.sort((a, b) => b.frac - a.frac);
    const worst = ranking[0].frac;
    console.log('worst perches', ranking.slice(0, 5).map((r) => `${r.spot.x},${r.spot.y.toFixed(0)},${r.spot.z} = ${r.frac.toFixed(2)}`));
    // No single standing spot may command more than half of the map's
    // standable positions. The surviving 52% perches are wall tops with no
    // cover, which glint + tracer punish long before the ring closes.
    expect(worst).toBeLessThan(0.55);

    const [a, b] = ARENA.spawns;
    const eyeA = { x: a.pos.x, y: a.pos.y + 1.62, z: a.pos.z };
    const eyeB = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
    const d = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y, eyeB.z - eyeA.z);
    const dir = { x: (eyeB.x - eyeA.x) / d, y: (eyeB.y - eyeA.y) / d, z: (eyeB.z - eyeA.z) / d };
    expect(phys.raycast(eyeA, dir, d - 0.5)).not.toBeNull();

    // The spawn nook has a canopy: no vertical spawn-snipe from the spire.
    for (const s of ARENA.spawns) {
      const eye = { x: s.pos.x, y: s.pos.y + 1.62, z: s.pos.z };
      expect(phys.raycast(eye, { x: 0, y: 1, z: 0 }, 12)).not.toBeNull();
    }
  });

  it('opens the ring wide enough that a spawn is never inside the hazard', () => {
    for (const spawn of ARENA.spawns) {
      const d = Math.hypot(spawn.pos.x - MATCH.ringCenter.x, spawn.pos.z - MATCH.ringCenter.z);
      expect(d).toBeLessThan(MATCH.ringRadiusStart);
    }
  });

  it('ring shrinks from open to a final duel radius', () => {
    expect(ringRadiusAt(0)).toBeGreaterThanOrEqual(MATCH.ringRadiusStart - 0.001);
    expect(ringRadiusAt(MATCH.ringStartAt)).toBeCloseTo(MATCH.ringRadiusStart);
    expect(ringRadiusAt(MATCH.ringStartAt + MATCH.ringShrinkTime)).toBeCloseTo(MATCH.ringRadiusEnd);
    const mid = ringRadiusAt(MATCH.ringStartAt + MATCH.ringShrinkTime / 2);
    expect(mid).toBeGreaterThan(MATCH.ringRadiusEnd);
    expect(mid).toBeLessThan(MATCH.ringRadiusStart);
  });
});
