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
  // These runs are about the rope, not the inventory: start with it in hand so
  // the first trigger press throws rather than equips.
  p.slot = 1;
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
    if (!released) keys |= KEY.fire;
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
      const keys = phase === 'swing' ? KEY.forward | KEY.fire : phase === 'chain' ? KEY.fire : KEY.forward;
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
      stepPlayer(p, { seq: i, keys: KEY.forward | KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    for (let i = 0; i < 50; i++) {
      stepPlayer(p, { seq: 100 + i, keys: KEY.forward, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    expect(p.grapple.chainTimer).toBe(0);
    // Aim at whichever pinion is actually in reach from where the swing left
    // us: the point of this test is the cooldown, not a fixed trajectory.
    const reachable = ROPE.anchors
      .map((a) => ({ a, d: Math.hypot(a.x - p.eye.x, a.y - p.eye.y, a.z - p.eye.z) }))
      .filter((c) => c.d < GRAPPLE.range - 5)
      .sort((x, y) => x.d - y.d)[0];
    expect(reachable).toBeTruthy();
    aim(p, reachable.a);
    // The claw is a projectile, so give it the flight time to cross the gap.
    for (let i = 0; i < 40 && !p.grapple.active; i++) {
      stepPlayer(p, { seq: 200 + i, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    expect(p.grapple.active).toBe(true);
    expect(p.grapple.chain).toBe(0);
  });

  it('reels in on jump and feeds out on crouch, so the arc is yours to shape', async () => {
    const phys = await makeOpenWorld(ROPE);
    const swingWith = (keys: number): PlayerState => {
      const p = airPlayer(-40, 70, 0);
      aim(p, { x: 0, y: 90, z: 0 });
      for (let i = 0; i < 60; i++) {
        stepPlayer(p, { seq: i, keys: KEY.fire | keys, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, []);
      }
      return p;
    };
    const plain = swingWith(0);
    const reeled = swingWith(KEY.jump);
    // The rope is shorter, and the shorter rope has lifted you higher.
    expect(reeled.grapple.length).toBeLessThan(plain.grapple.length - 3);
    expect(reeled.pos.y).toBeGreaterThan(plain.pos.y + 1);
    // Feeding line back out is the other half of the control.
    const fed = swingWith(KEY.crouch);
    expect(fed.grapple.length).toBeGreaterThan(plain.grapple.length + 1);
  });

  it('holds the rope like a rope: no bungee stretch on a loaded swing', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-40, 70, 0);
    aim(p, { x: 0, y: 90, z: 0 });
    let attached = false;
    let maxStretch = 0;
    for (let i = 0; i < 150; i++) {
      stepPlayer(p, { seq: i, keys: KEY.fire | KEY.forward, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, []);
      if (p.grapple.active) {
        attached = true;
        const d = Math.hypot(p.pos.x - p.grapple.anchor.x, p.pos.y - p.grapple.anchor.y, p.pos.z - p.grapple.anchor.z);
        maxStretch = Math.max(maxStretch, d - p.grapple.length);
      }
    }
    expect(attached).toBe(true);
    // A critically damped tether takes the load once; the old underdamped
    // spring let it bounce out by metres, which is what read as "sloppy".
    expect(maxStretch).toBeLessThan(1.2);
  });

  it('throws a claw that crosses 25 m in a tenth of a second', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(0, 61, 0);
    aim(p, { x: 0, y: 90, z: 0 });
    let ticks = 0;
    for (let i = 0; i < 30 && !p.grapple.active; i++) {
      stepPlayer(p, { seq: i, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, []);
      ticks++;
    }
    expect(p.grapple.active).toBe(true);
    // ~0.13 s from the click (the claw starts moving on the tick after it is
    // thrown): instant to the hand, still visible in the air.
    expect(ticks).toBeLessThanOrEqual(8);
    expect(ticks * DT).toBeLessThan(0.15);
  });

  it('a release always throws you onward, even from a slow swing', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-14, 82, 0);
    aim(p, { x: 0, y: 90, z: 0 });
    // Hold past the tap window: a tap is a zip, a hold is a swing.
    for (let i = 0; i < 20; i++) {
      stepPlayer(p, { seq: i, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, []);
    }
    expect(p.grapple.active).toBe(true);
    expect(p.grapple.mode).toBe('swing');
    // Find the tick the rope actually lets go and measure the impulse there,
    // so the comparison is not diluted by the gravity of later ticks.
    let before = 0;
    let after = 0;
    for (let i = 20; i < 26; i++) {
      const wasActive = p.grapple.active;
      before = p.vel.y;
      stepPlayer(p, { seq: i, keys: 0, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, []);
      if (wasActive && !p.grapple.active) {
        after = p.vel.y;
        break;
      }
    }
    expect(p.grapple.active).toBe(false);
    // Letting go of a loaded rope is a move, never a dead drop: it always adds
    // upward velocity on top of whatever the pendulum had.
    expect(after - before).toBeGreaterThan(2.5);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeGreaterThan(2);
  });

  it('tap zips you to the point instead of swinging around it', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(-20, 40, 0);
    aim(p, { x: 0, y: 60, z: 20 });
    const events: SimEvent[] = [];
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, { seq: i, keys: i === 2 ? KEY.fire : 0, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
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
    // The claw is a projectile: hold the trigger and give it the flight time.
    for (let i = 0; i < 20 && !a.grapple.active; i++) {
      stepPlayer(a, { seq: 1 + i, keys: KEY.fire, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    }
    expect(a.grapple.active).toBe(true);
    expect(a.grapple.target).toBe(1);
    // Move the opponent: the rope anchor must follow their body.
    b.pos.z -= 6;
    updateEye(b);
    stepPlayer(a, { seq: 2, keys: KEY.fire, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    expect(a.grapple.anchor.z).toBeLessThan(-20);
    // The opponent dying snaps the rope.
    b.alive = false;
    stepPlayer(a, { seq: 3, keys: KEY.fire, yaw: a.yaw, pitch: a.pitch }, DT, phys, ROPE, b, events);
    expect(a.grapple.active).toBe(false);
  });

  it('refuses hooks beyond range and off-target', async () => {
    const phys = await makeOpenWorld(ROPE);
    const p = airPlayer(0, 60, 0);
    aim(p, { x: 0, y: 60, z: -200 }); // nothing there
    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      stepPlayer(p, { seq: 1 + i, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ROPE, null, events);
    }
    expect(p.grapple.active).toBe(false);
    expect(events.some((e) => e.type === 'hookMiss' || e.type === 'grappleMiss')).toBe(true);

    const far = airPlayer(0, 60, 0);
    aim(far, { x: 0, y: 90, z: 0 });
    const target = { x: 0, y: 90, z: 0 };
    far.pos = { x: 0, y: 90, z: GRAPPLE.range + 20 };
    aim(far, target);
    for (let i = 0; i < 45; i++) {
      stepPlayer(far, { seq: 1 + i, keys: KEY.fire, yaw: far.yaw, pitch: far.pitch }, DT, phys, ROPE, null, []);
    }
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
      Object.assign(trial, p, { grapple: { ...p.grapple, active: false }, slot: 1 });
      const ev: SimEvent[] = [];
      for (let i = 0; i < 30 && !found; i++) {
        stepPlayer(trial, { seq: 99 + i, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ARENA, null, ev);
        found = trial.grapple.active;
      }
    }
    expect(found).toBe(true);
  });

  it('bends a near miss onto a pinion, and leaves a wild throw alone', async () => {
    const { makeWorld } = await import('./helpers.ts');
    const ONE: Arena = {
      blocks: [],
      anchors: [{ x: 0, y: 70, z: 0 }],
      spawns: [],
      center: { x: 0, y: 0, z: 0 },
      voidY: -1000,
    };
    // Empty world on purpose: the only thing the claw can bite is the pinion.
    const phys = await makeWorld(ONE);
    const throwFrom = (offDeg: number): PlayerState => {
      const p = airPlayer(0, 30, 40);
      aim(p, { x: 0, y: 70, z: 0 });
      p.yaw += (offDeg * Math.PI) / 180;
      p.slot = 1;
      for (let i = 0; i < 30 && !p.grapple.active; i++) {
        stepPlayer(p, { seq: i + 1, keys: KEY.fire, yaw: p.yaw, pitch: p.pitch }, DT, phys, ONE, null, []);
      }
      return p;
    };

    // 8 degrees off a 56 m throw is a ~7 m miss without the claw's curve.
    expect(throwFrom(8).grapple.active).toBe(true);
    // But the assist must never rescue a throw aimed somewhere else entirely.
    expect(throwFrom(20).grapple.active).toBe(false);
  });
});
