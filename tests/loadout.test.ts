/**
 * The two-slot loadout. One trigger, two things it can do: a bullet and a
 * claw. These tests pin the rules the player feels — press 2, click, and a
 * hook leaves your hand; swap back and it lets go with the boost.
 */
import { describe, expect, it } from 'vitest';
import type { Arena } from '../src/shared/arena.ts';
import { KEY, createPlayer, stepPlayer, updateEye, type PlayerState, type SimEvent } from '../src/shared/sim.ts';
import { makeOpenWorld } from './helpers.ts';

const PAD: Arena = {
  blocks: [],
  anchors: [{ x: 0, y: 70, z: -20 }],
  spawns: [],
  center: { x: 0, y: 0, z: 0 },
  voidY: -1000,
};

const DT = 1 / 60;

function stand(): PlayerState {
  const p = createPlayer(0, 0);
  p.alive = true;
  p.pos = { x: 0, y: 40, z: 0 };
  p.vel = { x: 0, y: 0, z: 0 };
  updateEye(p);
  const dx = 0 - p.eye.x;
  const dy = 70 - p.eye.y;
  const dz = -20 - p.eye.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  updateEye(p);
  return p;
}

function run(phys: Awaited<ReturnType<typeof makeOpenWorld>>, p: PlayerState, ticks: number, keys: (i: number) => number, events: SimEvent[]): void {
  for (let i = 0; i < ticks; i++) {
    stepPlayer(p, { seq: i + 1, keys: keys(i), yaw: p.yaw, pitch: p.pitch }, DT, phys, PAD, null, events);
  }
}

describe('loadout', () => {
  it('starts on the rifle and equips the grapnel on 2', async () => {
    const phys = await makeOpenWorld(PAD);
    const p = stand();
    expect(p.slot).toBe(0);
    const events: SimEvent[] = [];
    run(phys, p, 1, () => KEY.slotGrapple, events);
    expect(p.slot).toBe(1);
    expect(events.some((e) => e.type === 'equip')).toBe(true);
    run(phys, p, 1, () => KEY.slotRifle, []);
    expect(p.slot).toBe(0);
  });

  it('throws a claw that flies before it bites', async () => {
    const phys = await makeOpenWorld(PAD);
    const p = stand();
    const events: SimEvent[] = [];
    run(phys, p, 1, () => KEY.slotGrapple, events);
    run(phys, p, 1, () => KEY.fire, events);
    expect(p.hook.active).toBe(true);
    expect(p.grapple.active).toBe(false);
    expect(events.some((e) => e.type === 'hookFire')).toBe(true);
    // Hold the trigger: the claw travels, then the rope is live.
    let ticksToBite = 1;
    while (!p.grapple.active && ticksToBite < 40) {
      run(phys, p, 1, () => KEY.fire, events);
      ticksToBite++;
    }
    expect(p.grapple.active).toBe(true);
    expect(ticksToBite).toBeGreaterThan(2);
    expect(p.grapple.target).toBe(0);
    expect(events.some((e) => e.type === 'hookHit')).toBe(true);
  });

  it('fires nothing at all while the grapnel is equipped', async () => {
    const phys = await makeOpenWorld(PAD);
    const p = stand();
    run(phys, p, 1, () => KEY.slotGrapple, []);
    const events: SimEvent[] = [];
    run(phys, p, 2, (i) => (i === 0 ? KEY.fire : 0), events);
    expect(p.fireCooldown).toBe(0); // no bolt was spent
    expect(p.hook.active || p.grapple.active || events.some((e) => e.type === 'hookMiss')).toBe(true);
  });

  it('lets go with the release boost when you swap back to the rifle', async () => {
    const phys = await makeOpenWorld(PAD);
    const p = stand();
    run(phys, p, 1, () => KEY.slotGrapple, []);
    // Hook it, then swing for half a second to build speed.
    for (let i = 0; i < 30; i++) run(phys, p, 1, () => KEY.fire, []);
    expect(p.grapple.active).toBe(true);
    run(phys, p, 20, () => KEY.fire | KEY.forward, []);
    const before = p.speed;
    const events: SimEvent[] = [];
    run(phys, p, 1, () => KEY.slotRifle, events);
    expect(p.slot).toBe(0);
    expect(p.grapple.active).toBe(false);
    expect(events.some((e) => e.type === 'boost' || e.type === 'release')).toBe(true);
    expect(p.speed).toBeGreaterThanOrEqual(before * 0.9);
  });
});
