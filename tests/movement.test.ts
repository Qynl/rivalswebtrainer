import { describe, expect, it } from 'vitest';
import { createMoveState, stepMovement, type Aabb, type MoveInput, type MoveState } from '../src/game/movement';
import { buildArena } from '../src/game/map';
import { MOVE, PLAYER } from '../src/game/config';

const DT = 1 / 120;
const floor: Aabb[] = [{ min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 0, z: 50 } }];

function input(over: Partial<MoveInput> = {}): MoveInput {
  return { forward: 0, strafe: 0, yaw: 0, jumpPressed: false, jumpHeld: false, crouchHeld: false, crouchPressed: false, ...over };
}

function run(s: MoveState, frames: number, inp: MoveInput | ((i: number) => MoveInput), solids: Aabb[]) {
  for (let i = 0; i < frames; i++) {
    stepMovement(s, typeof inp === 'function' ? inp(i) : inp, DT, solids);
  }
}

describe('movement core', () => {
  it('stands on the floor with no input', () => {
    const s = createMoveState({ x: 0, y: 3, z: 0 });
    run(s, 240, input(), floor);
    expect(s.onGround).toBe(true);
    expect(s.pos.y).toBeCloseTo(0, 2);
  });

  it('accelerates forward to run speed and does not exceed it', () => {
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 120, input({ forward: 1 }), floor);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    expect(speed).toBeGreaterThan(MOVE.runSpeed * 0.9);
    expect(speed).toBeLessThanOrEqual(MOVE.runSpeed + 1e-3);
    // yaw 0 faces -Z
    expect(s.pos.z).toBeLessThan(0);
  });

  it('jumps to a sensible height and lands again', () => {
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 10, input(), floor);
    stepMovement(s, input({ jumpPressed: true, jumpHeld: true }), DT, floor);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      // Hold jump through the rise so the full jump height applies.
      stepMovement(s, input({ jumpHeld: true }), DT, floor);
      peak = Math.max(peak, s.pos.y);
      if (s.onGround && i > 5) break;
    }
    expect(peak).toBeGreaterThan(1.0);
    expect(peak).toBeLessThan(1.8);
    expect(s.onGround).toBe(true);
  });

  it('releasing jump early gives a lower jump than holding it', () => {
    const peakFor = (holdFrames: number) => {
      const s = createMoveState({ x: 0, y: 0, z: 0 });
      run(s, 10, input(), floor);
      stepMovement(s, input({ jumpPressed: true, jumpHeld: true }), DT, floor);
      let peak = 0;
      for (let i = 0; i < 200; i++) {
        stepMovement(s, input({ jumpHeld: i < holdFrames }), DT, floor);
        peak = Math.max(peak, s.pos.y);
      }
      return peak;
    };
    expect(peakFor(2)).toBeLessThan(peakFor(200) * 0.8);
  });

  it('is blocked by a wall', () => {
    const wall: Aabb[] = [...floor, { min: { x: -50, y: 0, z: -2 }, max: { x: 50, y: 5, z: -1 } }];
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 240, input({ forward: 1 }), wall);
    expect(s.pos.z).toBeGreaterThan(-1 - PLAYER.radius - 0.05);
  });

  it('steps up a low stair but not a tall block', () => {
    const solids: Aabb[] = [
      ...floor,
      { min: { x: 1, y: 0, z: -2 }, max: { x: 2, y: 0.4, z: 2 } }, // low step
      { min: { x: 4, y: 0, z: -2 }, max: { x: 5, y: 2.0, z: 2 } }, // too tall
    ];
    const s = createMoveState({ x: -1, y: 0, z: 0 });
    run(s, 120, input({ forward: 0, strafe: 1, yaw: 0 }), solids);
    // strafe +1 at yaw 0 moves +X
    expect(s.pos.x).toBeGreaterThan(1.5);
    expect(s.pos.x).toBeLessThan(4);
  });

  it('a slide starts when crouch is pressed at speed and sets low height', () => {
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 120, input({ forward: 1 }), floor);
    const ev = stepMovement(s, input({ forward: 1, crouchPressed: true, crouchHeld: true }), DT, floor);
    expect(ev.slideStarted).toBe(true);
    expect(s.sliding).toBe(true);
    expect(s.height).toBe(PLAYER.slideHeight);
  });

  it('slide-jump keeps and boosts horizontal momentum', () => {
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 120, input({ forward: 1 }), floor);
    stepMovement(s, input({ forward: 1, crouchPressed: true, crouchHeld: true }), DT, floor);
    const before = Math.hypot(s.vel.x, s.vel.z);
    const ev = stepMovement(s, input({ forward: 1, crouchHeld: true, jumpPressed: true }), DT, floor);
    expect(ev.slideJumped).toBe(true);
    const after = Math.hypot(s.vel.x, s.vel.z);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(MOVE.slideJumpCap + 0.01);
    expect(s.vel.y).toBeGreaterThan(MOVE.jumpVelocity * 0.9);
  });

  it('plain jump from walking does not count as a slide-jump', () => {
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(s, 120, input({ forward: 1 }), floor);
    const ev = stepMovement(s, input({ forward: 1, jumpPressed: true }), DT, floor);
    expect(ev.jumped).toBe(true);
    expect(ev.slideJumped).toBe(false);
  });

  it('the arena map can be traversed without getting stuck in geometry', () => {
    const arena = buildArena();
    const s = createMoveState({ x: -24, y: 0, z: 24 });
    run(s, 60, input(), arena);
    expect(s.onGround).toBe(true);
    // not inside any solid
    const { overlapsAny } = { overlapsAny: (p: typeof s.pos, h: number, sol: Aabb[]) => sol.some(b => p.x + PLAYER.radius > b.min.x && p.x - PLAYER.radius < b.max.x && p.y + h > b.min.y && p.y < b.max.y && p.z + PLAYER.radius > b.min.z && p.z - PLAYER.radius < b.max.z) };
    expect(overlapsAny(s.pos, s.height, arena)).toBe(false);
  });
});
