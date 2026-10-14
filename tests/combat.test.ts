import { describe, expect, it } from 'vitest';
import { castRay, createWeaponState, inScytheArc, tryFire, type Target } from '../src/game/combat';

// Target standing 10 m in front of the origin along -Z (yaw 0 looks down -Z).
function targetAt(z: number): Target {
  return {
    id: 'bot',
    body: { min: { x: -0.35, y: 0, z: z - 0.35 }, max: { x: 0.35, y: 1.8, z: z + 0.35 } },
    head: { min: { x: -0.28, y: 1.45, z: z - 0.28 }, max: { x: 0.28, y: 1.85, z: z + 0.28 } },
  };
}

const origin = { x: 0, y: 1.6, z: 0 };
const forward = { x: 0, y: 0, z: -1 };

describe('castRay', () => {
  it('hits a body target in front of the origin', () => {
    const chest = { x: 0, y: 1.0, z: 0 };
    const hit = castRay(chest, forward, [], [targetAt(-10)], 100);
    expect(hit.targetId).toBe('bot');
    expect(hit.isHead).toBe(false);
    expect(hit.distance).toBeCloseTo(9.65, 1);
  });

  it('counts a shot at eye level through the head as a headshot', () => {
    const hit = castRay(origin, forward, [], [targetAt(-10)], 100);
    expect(hit.targetId).toBe('bot');
    expect(hit.isHead).toBe(true);
    expect(hit.distance).toBeCloseTo(9.72, 1);
  });

  it('reports a headshot when the ray crosses the head box', () => {
    const hit = castRay({ x: 0, y: 1.65, z: 0 }, forward, [], [targetAt(-10)], 100);
    expect(hit.targetId).toBe('bot');
    expect(hit.isHead).toBe(true);
  });

  it('misses when the ray points away from the target', () => {
    const hit = castRay(origin, { x: 1, y: 0, z: 0 }, [], [targetAt(-10)], 100);
    expect(hit.targetId).toBeNull();
  });

  it('does not reach a target beyond weapon range', () => {
    const hit = castRay(origin, forward, [], [targetAt(-10)], 5);
    expect(hit.targetId).toBeNull();
  });
});

describe('tryFire', () => {
  it('fires a semi-auto pistol once per trigger edge, not while held', () => {
    const w = createWeaponState('pistol');
    expect(tryFire(w, true, true)).toBe(1);
    expect(tryFire(w, true, false)).toBe(0);
  });

  it('consumes ammo for every shot fired', () => {
    const w = createWeaponState('pistol');
    const before = w.ammo;
    tryFire(w, true, true);
    expect(w.ammo).toBe(before - 1);
  });
});

describe('inScytheArc', () => {
  it('hits a target directly in front within range', () => {
    expect(inScytheArc({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: -1.5 })).toBe(true);
  });

  it('ignores a target behind the attacker', () => {
    expect(inScytheArc({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: 1.5 })).toBe(false);
  });

  it('ignores a target beyond the scythe range', () => {
    expect(inScytheArc({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: -5 })).toBe(false);
  });
});
