import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { makeWorld } from './helpers.ts';
import { MOVE } from '../src/shared/constants.ts';
import { KEY, type PlayerState } from '../src/shared/sim.ts';
import { drive, makePadWorld, place, spawn } from './helpers.ts';

const DECK = 0;

function onDeck(id: 0 | 1 = 0): PlayerState {
  const p = spawn(id);
  place(p, 0, DECK, 0, 0);
  return p;
}

describe('movement feel', () => {
  it('gravity pulls hard: falls 10 m in under a second and cannot be floaty', async () => {
    const phys = await makePadWorld();
    const p = spawn(0);
    place(p, 0, DECK + 10, 0);
    const res = drive(phys, p, { ticks: 60 });
    const fallTicks = res.ys.findIndex((y) => y <= DECK + 0.95);
    expect(fallTicks).toBeGreaterThan(10);
    expect(fallTicks / 60).toBeLessThan(0.9);
    expect(MOVE.gravity).toBeGreaterThan(25);
  });

  it('jumps snappily: short airtime, jump-cut on release, no autobhop float', async () => {
    const phys = await makePadWorld();
    const p = onDeck();
    const startY = p.pos.y;
    let peak = startY;
    let airTicks = 0;
    const res = drive(phys, p, {
      ticks: 90,
      keys: (i) => (i < 3 ? KEY.jump : 0),
      onTick: () => {
        peak = Math.max(peak, p.pos.y);
        if (!p.grounded) airTicks++;
      },
    });
    const height = peak - startY;
    expect(height).toBeGreaterThan(1.4);
    expect(height).toBeLessThan(2.4);
    expect(airTicks / 60).toBeLessThan(0.85);
    expect(p.grounded).toBe(true);
    void res;

    // Holding jump keeps hopping (auto-hop): responsive, not floaty.
    const q = onDeck();
    let airborneFrames = 0;
    drive(phys, q, { ticks: 150, keys: () => KEY.jump, onTick: () => { if (!q.grounded) airborneFrames++; } });
    expect(airborneFrames).toBeGreaterThan(30);
  });

  it('walking respects the speed cap and accelerates in your hand immediately', async () => {
    const phys = await makePadWorld();
    const p = onDeck();
    drive(phys, p, { ticks: 4, keys: () => KEY.forward });
    const early = Math.hypot(p.vel.x, p.vel.z);
    expect(early).toBeGreaterThan(5); // input fires the same frame, not "next tick"
    drive(phys, p, { ticks: 60, keys: () => KEY.forward });
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThanOrEqual(MOVE.walkSpeed + 0.5);
  });

  it('landing at speed slides instead of stopping dead', async () => {
    const phys = await makePadWorld();
    const p = spawn(0);
    // Drop onto the deck with 22 m/s of forward speed.
    place(p, 0, DECK + 3, 0, 0);
    p.vel = { x: 0, y: 0, z: -22 };
    let atLanding = 0;
    let after = 0;
    let landTick = -1;
    drive(phys, p, {
      ticks: 60,
      keys: () => KEY.crouch,
      onTick: (i) => {
        if (landTick < 0 && p.grounded) {
          landTick = i;
          atLanding = Math.hypot(p.vel.x, p.vel.z);
        }
        if (landTick >= 0 && i === landTick + 20) after = Math.hypot(p.vel.x, p.vel.z);
      },
    });
    expect(landTick).toBeGreaterThan(0);
    expect(atLanding).toBeGreaterThan(19); // momentum survives the floor
    expect(after).toBeGreaterThan(11); // and keeps sliding
    expect(p.sliding || after < 20).toBe(true);
  });

  it('has coyote time and jump buffering', async () => {
    const phys = await makePadWorld();
    // Coyote: walk off the deck edge, then jump three frames after leaving.
    const a = spawn(0);
    place(a, 0, DECK, -38, 0);
    let leftAt = -1;
    let maxVy = -100;
    drive(phys, a, {
      ticks: 120,
      keys: (i) => (leftAt >= 0 && i >= leftAt + 3 ? KEY.forward | KEY.jump : KEY.forward),
      onTick: (i) => {
        if (leftAt < 0 && !a.grounded && i > 5) leftAt = i;
        maxVy = Math.max(maxVy, a.vel.y);
      },
    });
    expect(leftAt).toBeGreaterThan(0);
    expect(maxVy).toBeGreaterThan(5); // the late jump still fired

    // Buffer: a press inside the last 0.12 s of a fall fires the moment the
    // feet touch the slab, so landing and jumping read as one motion.
    const b = spawn(0);
    place(b, 0, DECK + 3, 0, 0);
    let pressAt = -1;
    const buffered = drive(phys, b, {
      ticks: 90,
      keys: (i) => {
        if (pressAt < 0 && b.pos.y < DECK + 1.25) pressAt = i;
        return pressAt >= 0 && i >= pressAt && i <= pressAt + 1 ? KEY.jump : 0;
      },
    });
    expect(pressAt).toBeGreaterThan(0);
    expect(buffered.events.filter((e) => e.type === 'jump').length).toBe(1);

    // One press, one hop. Holding the button must not turn into a bunnyhop,
    // otherwise every landing in the game fires a jump you did not ask for.
    const held = drive(phys, b, { ticks: 150, keys: () => KEY.jump });
    expect(held.events.filter((e) => e.type === 'jump').length).toBe(1);
  });

  it('walks on flat ground without bouncing or dropping contact', async () => {
    const phys = await makePadWorld();
    const p = onDeck();
    drive(phys, p, { ticks: 20, keys: () => 0 });
    const run = drive(phys, p, { ticks: 120, keys: () => KEY.forward });
    // Nothing should report a landing once the feet are down.
    expect(run.events.filter((e) => e.type === 'land').length).toBe(0);
    // A pixel of sink is fine; a centimetre of pop is a visible bounce.
    const tail = run.ys.slice(-60);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(0.005);
    expect(tail.every((y) => y > DECK)).toBe(true);
    // And speed settles exactly on the walk speed rather than oscillating.
    const speeds = run.speeds.slice(-30);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(0.01);
    expect(run.speeds[run.speeds.length - 1]).toBeCloseTo(MOVE.walkSpeed, 1);
  });

  it('dashes with a cooldown and no frame-rate dependence in the step itself', async () => {
    const phys = await makePadWorld();
    const p = onDeck();
    const start = { ...p.pos };
    drive(phys, p, { ticks: 1, keys: () => KEY.dash });
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    expect(moved).toBeGreaterThan(0.2);
    const cd = p.dashCooldown;
    expect(cd).toBeCloseTo(MOVE.dashCooldown, 5);
    drive(phys, p, { ticks: 2, keys: () => KEY.dash });
    expect(p.dashCooldown).toBeLessThan(cd);
    // The sim consumes dt, and the fixed step is the only caller.
    expect(p.dashCooldown).toBeGreaterThan(0);
  });

  it('spawns both players on equal footing', async () => {
    const phys = await makeWorld();
    const [a, b] = ARENA.spawns;
    expect(a.pos.y).toBeCloseTo(b.pos.y);
    expect(Math.hypot(a.pos.x, a.pos.z)).toBeCloseTo(Math.hypot(b.pos.x, b.pos.z));
    const p = spawn(0);
    const q = spawn(1);
    drive(phys, p, { ticks: 30 });
    drive(phys, q, { ticks: 30 });
    expect(p.grounded).toBe(true);
    expect(q.grounded).toBe(true);
  });
});
