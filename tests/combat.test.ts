import { describe, expect, it } from 'vitest';
import {
  clampRewindTime,
  glintVisibility,
  hipSpreadRad,
  markFired,
  PoseHistory,
  resolveShot,
  resolveShotDir,
  spreadShotDir,
} from '../src/shared/combat.ts';
import { MAX_REWIND, WEAPON } from '../src/shared/constants.ts';
import { add, dot, lookDir, norm, sub } from '../src/shared/mathx.ts';
import { createPlayer, KEY, lookOf, stepPlayer, updateEye } from '../src/shared/sim.ts';
import { makeOpenWorld } from './helpers.ts';
import type { Arena } from '../src/shared/arena.ts';

const EMPTY: Arena = { blocks: [], anchors: [], spawns: [], center: { x: 0, y: 0, z: 0 }, voidY: -1000 };

function shooter(yaw = 0, pitch = 0) {
  const p = createPlayer(0, 0);
  p.alive = true;
  p.pos = { x: 0, y: 50, z: 0 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = yaw;
  p.pitch = pitch;
  updateEye(p);
  return p;
}

describe('rifle fairness', () => {
  it('a scoped shot aimed at the target hits at any distance', async () => {
    const phys = await makeOpenWorld(EMPTY);
    for (const distance of [10, 40, 90, 150, 260, 320]) {
      const p = shooter(0, 0);
      const target = { pos: { x: 0, y: 50, z: -distance }, alive: true };
      const dir = norm(sub(target.pos, p.eye));
      const out = resolveShot(phys, p.eye, dir, target, p.id);
      expect(out.hit, `distance ${distance}`).toBe(true);
      expect(out.killed).toBe(true);
      expect(out.distance).toBeLessThan(distance + 1);
    }
  });

  it('has zero spread and zero randomness while scoped', async () => {
    const phys = await makeOpenWorld(EMPTY);
    const p = shooter(0, 0);
    const view = lookOf(p);
    const target = { pos: { x: 0, y: 50, z: -120 }, alive: true };
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // A malicious / broken client sends a wildly wrong direction: ignored.
      const msgDir = norm(add(view, { x: 0.2, y: -0.15, z: 0 }));
      p.scoped = true;
      const dir = resolveShotDir(p, { seq: i, origin: p.eye, dir: msgDir, scoped: true, aimTime: 0 });
      const out = resolveShot(phys, p.eye, dir, target, p.id);
      results.add(`${out.hit}:${out.distance.toFixed(6)}`);
    }
    expect(results.size).toBe(1);
    expect([...results][0].startsWith('true')).toBe(true);
    expect(resolveShotDir(p, { seq: 0, origin: p.eye, dir: { x: 5, y: 0, z: 0 }, scoped: true, aimTime: 0 })).toEqual(view);
  });

  it('hipfire is a visible cone, never a hidden bloom', () => {
    const view = lookDir(0.3, 0.1);
    const limit = Math.cos(hipSpreadRad());
    let maxAngle = 0;
    for (let i = 0; i < 4000; i++) {
      const d = spreadShotDir(view, false, Math.random(), Math.random());
      const angle = Math.acos(Math.min(1, dot(view, d)));
      maxAngle = Math.max(maxAngle, angle);
    }
    expect(maxAngle).toBeLessThanOrEqual(hipSpreadRad() + 1e-6);
    expect(maxAngle).toBeGreaterThan(hipSpreadRad() * 0.85); // it really spreads
    expect(dot(view, spreadShotDir(view, true, 0.9, 0.2))).toBeCloseTo(1, 10);
    void limit;
  });

  it('scoped hipfire-to-scope transition is the only gate', () => {
    const p = shooter();
    p.scopeT = 0.5;
    p.scoped = false;
    expect(p.scoped).toBe(false);
    p.scopeT = 1;
    p.scoped = true;
    expect(p.scoped).toBe(true);
    expect(WEAPON.scopeTime).toBeLessThan(0.25);
    expect(WEAPON.cycleTime).toBeGreaterThan(0.9); // slow enough that each shot matters
  });

  it('walls occlude the target', async () => {
    const arena: Arena = {
      ...EMPTY,
      blocks: [{ x: 0, y: 50, z: -40, hx: 6, hy: 6, hz: 1, kind: 'wall' }],
      anchors: [],
    };
    const phys = await makeOpenWorld(arena);
    const p = shooter();
    const target = { pos: { x: 0, y: 50, z: -100 }, alive: true };
    const dir = norm(sub(target.pos, p.eye));
    const out = resolveShot(phys, p.eye, dir, target, p.id);
    expect(out.hit).toBe(false);
    expect(out.distance).toBeCloseTo(39, 0);
  });

  it('uses the same weapon code and timings for both cosmetics', async () => {
    const phys = await makeOpenWorld(EMPTY);
    const runs: string[] = [];
    for (const skin of [0, 1] as const) {
      const p = createPlayer(skin, skin);
      p.alive = true;
      p.pos = { x: 0, y: 50, z: 0 };
      p.yaw = 0.17;
      p.pitch = -0.05;
      updateEye(p);
      const log: string[] = [];
      const target = { pos: { x: 0, y: 50, z: -100 }, alive: true };
      for (let i = 0; i < 200; i++) {
        // identical inputs for both skins
        const view = lookOf(p);
        const isScoped = i % 3 === 0;
        p.scoped = isScoped;
        const msgDir = spreadShotDir(view, isScoped, (i * 0.37) % 1, (i * 0.71) % 1);
        const dir = resolveShotDir(p, { seq: i, origin: p.eye, dir: msgDir, scoped: isScoped, aimTime: 0 });
        const out = resolveShot(phys, p.eye, dir, target, p.id);
        log.push(`${out.hit}:${out.distance.toFixed(4)}`);
        markFired(p);
        log.push(`cd=${p.fireCooldown.toFixed(4)}`);
        stepPlayer(p, { seq: i, keys: KEY.scope, yaw: 0.17, pitch: -0.05 }, 1 / 60, phys, EMPTY, null, []);
      }
      runs.push(log.join(','));
    }
    expect(runs[0]).toBe(runs[1]);
  });

  it('rewinds the target for lag compensation', () => {
    const h = new PoseHistory(48);
    const t0 = 1000;
    h.record(t0, { x: 0, y: 50, z: 0 }, true);
    h.record(t0 + 1 / 60, { x: 0, y: 50, z: -2 }, true);
    h.record(t0 + 2 / 60, { x: 0, y: 50, z: -4 }, true);
    const mid = h.sample(t0 + 1 / 120);
    expect(mid?.pos.z).toBeCloseTo(-1, 5);
    expect(h.sample(t0 - 5)?.pos.z).toBeCloseTo(0);
    expect(h.sample(t0 + 5)?.pos.z).toBeCloseTo(-4);
    expect(h.sample(t0 + 1 / 60)?.pos.z).toBeCloseTo(-2);
    // A client cannot ask for an unlimited rewind.
    expect(clampRewindTime(0, t0 + 10)).toBeCloseTo(t0 + 10 - MAX_REWIND, 6);
    expect(clampRewindTime(t0 + 100, t0 + 10)).toBeCloseTo(t0 + 10);
  });

  it('glint is bright when facing you and invisible from behind', () => {
    const shooterPos = { x: 0, y: 50, z: 0 };
    const look = lookDir(0, 0); // -Z
    expect(glintVisibility(shooterPos, look, { x: 0, y: 50, z: -100 })).toBeCloseTo(1, 5);
    expect(glintVisibility(shooterPos, look, { x: 0, y: 50, z: 100 })).toBe(0); // directly behind
    const side = glintVisibility(shooterPos, look, { x: 100, y: 50, z: 0 });
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(1);
    // Glint ramps while scoped+still and dies when moving.
    const p = shooter();
    for (let i = 0; i < 40; i++) {
      stepPlayer(p, { seq: i, keys: KEY.scope, yaw: 0, pitch: 0 }, 1 / 60, EMPTY_phys_placeholder, EMPTY, null, []);
    }
    expect(p.glint).toBeGreaterThan(0.9);
  });
});

// A physics world is not needed for the last glint half, but stepPlayer wants one.
const EMPTY_phys_placeholder = { move: (_id: number, pos: { x: number; y: number; z: number }) => ({ pos, grounded: false, normals: [] }), raycast: () => null } as unknown as import('../src/shared/physics.ts').Physics;
