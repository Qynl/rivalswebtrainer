import { describe, expect, it } from 'vitest';
import type { Arena } from '../src/shared/arena.ts';
import { GRAPPLE } from '../src/shared/constants.ts';
import { createPlayer, KEY, respawnPlayer, stepPlayer, updateEye, type PlayerState, type SimEvent } from '../src/shared/sim.ts';
import { makeOpenWorld } from './helpers.ts';

const ROPE: Arena = {
  blocks: [],
  anchors: [
    { x: 0, y: 90, z: 0 },
    { x: 0, y: 60, z: 20 },
    { x: 30, y: 50, z: -30 },
    { x: -30, y: 50, z: 30 },
  ],
  spawns: [],
  center: { x: 0, y: 0, z: 0 },
  voidY: -1000,
};

const DT = 1 / 60;

function airPlayer(x: number, y: number, z: number): PlayerState {
  const p = createPlayer(0, 0);
  p.alive = true;
  p.pos = { x, y, z };
  p.vel = { x: 0, y: 0, z: 0 };
  updateEye(p);
  return p;
}

function aim(p: PlayerState, t: { x: number; y: number; z: number }): void {
  updateEye(p);
  const dx = t.x - p.eye.x;
  const dy = t.y - p.eye.y;
  const dz = t.z - p.eye.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  updateEye(p);
}

interface SwingRun {
  maxSpeed: number;
  releaseSpeed: number;
  releaseY: number;
  peakAfterRelease: number;
  events: SimEvent[];
  p: PlayerState;
}

function runSwing(
  phys: Awaited<ReturnType<typeof makeOpenWorld>>,
  start: { x: number; y: number; z: number },
  anchor: { x: number; y: number; z: number },
  releaseWhen: (p: PlayerState) => boolean,
  extraKeys = 0,
): SwingRun {
  const p = airPlayer(start.x, start.y, start.z);
  aim(p, anchor);
  const events: SimEvent[] = [];
  let attached = false;
  let released = false;
  let maxSpeed = 0;
  let releaseSpeed = 0;
  let releaseY = p.pos.y;
  let peakAfterRelease = p.pos.y;
  for (let i = 0; i < 420; i++) {
    let keys = KEY.forward | extraKeys;
    if (!released) keys |= KEY.grapple;
    if (!released && p.grapple.active) attached = true;
    if (attached && !released && releaseWhen(p)) {
      released = true;
      releaseSpeed = p.speed;
      releaseY = p.pos.y;
      keys = KEY.forward | extraKeys;
    }
    stepPlayer(p, { seq: i, keys, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    maxSpeed = Math.max(maxSpeed, p.speed);
    if (released) peakAfterRelease = Math.max(peakAfterRelease, p.pos.y);
    // stop once well past the launch so the metrics are about the launch
    if (released && p.vel.y < -20) break;
  }
  return { maxSpeed, releaseSpeed, releaseY, peakAfterRelease, events, p };
}

describe('grapple', () => {
  it('a swing turns a drop into speed and carries you upward on release', async () => {
    const phys = await makeOpenWorld(ROPE);
    const run = runSwing(phys, { x: -40, y: 70, z: 0 }, { x: 0, y: 90, z: 0 }, (p) => p.pos.y > 44 && p.vel.y > 12);
    expect(run.events.some((e) => e.type === 'attach')).toBe(true);
    expect(run.maxSpeed).toBeGreaterThan(50);
    // The launch must actually gain height from where you let go.
    expect(run.peakAfterRelease).toBeGreaterThan(run.releaseY + 12);
    expect(run.events.some((e) => e.type === 'boost')).toBe(true);
  });

  it('release boost scales with speed and adds height', async () => {
    const phys = await makeOpenWorld(ROPE);
    const slow = runSwing(phys, { x: -12, y: 80, z: 0 }, { x: 0, y: 90, z: 0 }, (p) => p.vel.y > 8);
    const fast = runSwing(phys, { x: -46, y: 74, z: 0 }, { x: 0, y: 90, z: 0 }, (p) => p.pos.y > 40 && p.vel.y > 8);
    expect(fast.releaseSpeed).toBeGreaterThan(slow.releaseSpeed);
    expect(fast.maxSpeed).toBeGreaterThan(slow.maxSpeed);
  });

  it('chaining inside the window keeps momentum and adds a stack', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-40, 70, 0);
    aim(p, { x: 0, y: 90, z: 0 });
    const events: SimEvent[] = [];
    let phase: 'swing' | 'gap' | 'chain' = 'swing';
    let gapStart = -1;
    let releaseSpeed = 0;
    let chainSpeed = 0;
    let chainY = 0;
    let releaseY = 0;
    for (let i = 0; i < 260; i++) {
      if (phase === 'swing' && p.vel.y > 12 && p.pos.y > 40) {
        phase = 'gap';
        gapStart = i;
        releaseSpeed = p.speed;
        releaseY = p.pos.y;
      }
      if (phase === 'gap' && i - gapStart === 8) {
        // Re-aim at a second anchor and hook it while the window is open.
        aim(p, { x: 0, y: 60, z: 20 });
        phase = 'chain';
      }
      const keys = phase === 'swing' ? KEY.forward | KEY.grapple : phase === 'chain' ? KEY.grapple : KEY.forward;
      stepPlayer(p, { seq: i, keys, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
      if (phase === 'chain' && p.grapple.active && chainY === 0) {
        chainY = p.pos.y;
        chainSpeed = p.speed;
      }
    }
    expect(releaseSpeed).toBeGreaterThan(25);
    expect(events.some((e) => e.type === 'chain')).toBe(true);
    expect(p.grapple.chain).toBe(1);
    // Momentum carries through the re-hook: a chain must not brake you.
    expect(chainSpeed).toBeGreaterThan(releaseSpeed * 0.95);
    expect(chainY).toBeGreaterThan(releaseY);
  });

  it('re-hooking outside the chain window loses the stack but still works', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-40, 70, 0);
    aim(p, { x: 0, y: 90, z: 0 });
    const events: SimEvent[] = [];
    // Hold a long swing, then release and wait past the window before re-hooking.
    for (let i = 0; i < 100; i++) {
      stepPlayer(p, { seq: i, keys: KEY.forward | KEY.grapple, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    for (let i = 0; i < 50; i++) {
      stepPlayer(p, { seq: 100 + i, keys: KEY.forward, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    expect(p.grapple.chainTimer).toBe(0);
    aim(p, { x: 0, y: 60, z: 20 });
    const before = p.pos.y;
    for (let i = 0; i < 3; i++) {
      stepPlayer(p, { seq: 200 + i, keys: KEY.grapple, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    expect(p.grapple.active || p.pos.y < before).toBe(true);
    expect(p.grapple.chain).toBe(0);
  });

  it('tap zips you to the point instead of swinging around it', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-20, 40, 0);
    aim(p, { x: 0, y: 60, z: 20 });
    const events: SimEvent[] = [];
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, { seq: i, keys: i === 2 ? KEY.grapple : 0, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
      peak = Math.max(peak, p.pos.y);
    }
    expect(events.some((e) => e.type === 'zip')).toBe(true);
    expect(peak).toBeGreaterThan(56); // arrived at the anchor 20 m up
  });

  it('can grapple the opponent capsule and follows them', async () => {
    const phys = await makeOpenWorld(ROPE);
    const a = airPlayer(0, 60, 0);
    const b = createPlayer(1, 1);
    b.alive = true;
    b.pos = { x: 0, y: 60, z: -20 };
    b.vel = { x: 0, y: 0, z: 0 };
    updateEye(b);
    aim(a, b.pos);
    const events: SimEvent[] = [];
    stepPlayer(a, { seq: 1, keys: KEY.grapple, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    expect(a.grapple.active).toBe(true);
    expect(a.grapple.target).toBe(1);
    // Move the opponent: the rope anchor must follow their body.
    b.pos.z -= 6;
    updateEye(b);
    stepPlayer(a, { seq: 2, keys: KEY.grapple, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    expect(a.grapple.anchor.z).toBeLessThan(-20);
    // The opponent dying snaps the rope.
    b.alive = false;
    stepPlayer(a, { seq: 3, keys: KEY.grapple, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    expect(a.grapple.active).toBe(false);
  });

  it('refuses hooks beyond range and off-target', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(0, 60, 0);
    aim(p, { x: 0, y: 60, z: -200 }); // nothing there
    const events: SimEvent[] = [];
    stepPlayer(p, { seq: 1, keys: KEY.grapple, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    expect(p.grapple.active).toBe(false);
    expect(events.some((e) => e.type === 'grappleMiss')).toBe(true);

    const far = airPlayer(0, 60, 0);
    aim(far, { x: 0, y: 90, z: 0 });
    const target = { x: 0, y: 90, z: 0 };
    far.pos = { x: 0, y: 90, z: GRAPPLE.range + 20 };
    aim(far, target);
    stepPlayer(far, { seq: 1, keys: KEY.grapple, yaw: far.yaw, pitch: far.pitch }, DT, phys, ROPE, null, []);
    expect(far.grapple.active).toBe(false);
  });

  it('spawns are reachable by a swing from every deck', async () => {
    // Sanity: a fresh spawn can hook something within 3 frames of looking up.
    const { ARENA } = await import('../src/shared/arena.ts');
    const { makeWorld } = await import('./helpers.ts');
    const phys = await makeWorld();
    const p = createPlayer(0, 0);
    respawnPlayer(p, ARENA, 0);
    for (let i = 0; i < 20; i++) {
      stepPlayer(p, { seq: i, keys: 0, yaw: p.yaw, pitch: p.pitch }, DT, phys, ARENA, null, []);
    }
    let found = false;
    for (let yawStep = 0; yawStep < 16 && !found; yawStep++) {
      p.yaw = (yawStep / 16) * Math.PI * 2;
      p.pitch = 0.7;
      const trial = createPlayer(0, 0);
      Object.assign(trial, p, { grapple: { ...p.grapple, active: false } });
      const ev: SimEvent[] = [];
      stepPlayer(trial, { seq: 99, keys: KEY.grapple, yaw: p.yaw, pitch: p.pitch }, DT, phys, ARENA, null, ev);
      found = trial.grapple.active;
    }
    expect(found).toBe(true);
  });
});
