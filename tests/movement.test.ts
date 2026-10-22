import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/game/config';
import type { Rect } from '../src/game/geometry';
import type { Level } from '../src/game/level';
import { createPlayerState, stepPlayer, type InputFrame, type PlayerState } from '../src/game/movement';

const DT = 1 / 120;

function flat(input: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    downHeld: false,
    jumpPressed: false,
    jumpHeld: false,
    dashPressed: false,
    attackPressed: false,
    ...input,
  };
}

function makeLevel(overrides: Partial<Level> = {}): Level {
  const floor: Rect = { x: -1000, y: 400, w: 4000, h: 100 };
  return {
    width: 4000,
    height: 1000,
    spawn: { x: 100, y: 400 - 40 },
    solids: [floor],
    hazards: [],
    bouncePads: [],
    benches: [],
    breakables: [],
    fireflies: [],
    vines: [],
    ...overrides,
  };
}

function settle(player: PlayerState, level: Level, frames = 5): void {
  for (let i = 0; i < frames; i++) stepPlayer(player, flat(), level, DT);
}

describe('ground movement', () => {
  it('accelerates up to run speed and stops with friction', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    for (let i = 0; i < 60; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    expect(p.vel.x).toBeCloseTo(PHYSICS.runSpeed, 0);

    for (let i = 0; i < 60; i++) stepPlayer(p, flat(), level, DT);
    expect(p.vel.x).toBe(0);
  });

  it('reverses direction faster than it accelerates from rest', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    for (let i = 0; i < 60; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    stepPlayer(p, flat({ moveX: -1 }), level, DT);
    const deltaReversing = Math.abs(p.vel.x - PHYSICS.runSpeed);

    const p2 = createPlayerState(level.spawn);
    settle(p2, level);
    stepPlayer(p2, flat({ moveX: -1 }), level, DT);
    const deltaFromRest = Math.abs(p2.vel.x);

    expect(deltaReversing).toBeGreaterThan(deltaFromRest);
  });
});

describe('jumping', () => {
  it('jumps from the ground and rises', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    expect(p.onGround).toBe(true);
    const ev = stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    expect(ev.jumped).toBe(true);
    expect(p.vel.y).toBeLessThan(0);
  });

  it('coyote time lets a jump fire just after leaving a ledge', () => {
    const ledge: Rect = { x: 0, y: 400, w: 100, h: 50 };
    const level = makeLevel({ solids: [ledge] });
    const p = createPlayerState({ x: 40, y: 400 - 40 });
    settle(p, level);
    expect(p.onGround).toBe(true);

    // walk off the ledge
    for (let i = 0; i < 80 && p.onGround; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    expect(p.onGround).toBe(false);
    expect(p.coyote).toBeGreaterThan(0);

    const ev = stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    expect(ev.jumped).toBe(true);
  });

  it('does not allow a jump once coyote time has fully elapsed', () => {
    const ledge: Rect = { x: 0, y: 400, w: 100, h: 50 };
    const level = makeLevel({ solids: [ledge] });
    const p = createPlayerState({ x: 40, y: 400 - 40 });
    settle(p, level);
    for (let i = 0; i < 80 && p.onGround; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    expect(p.onGround).toBe(false);

    for (let i = 0; i < 30; i++) stepPlayer(p, flat(), level, DT);
    expect(p.coyote).toBe(0);
    const ev = stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    expect(ev.jumped).toBe(false);
  });

  it('buffers an early jump press and fires it on landing', () => {
    const level = makeLevel();

    // First, find out how many frames the jump arc takes without any further input.
    const dry = createPlayerState(level.spawn);
    settle(dry, level);
    stepPlayer(dry, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    let framesToLand = 0;
    for (let i = 0; i < 400; i++) {
      const ev = stepPlayer(dry, flat(), level, DT);
      framesToLand++;
      if (ev.landed) break;
    }

    // Replay the same arc, but press jump a few frames before the real landing -
    // well inside the buffer window - and confirm it still fires right on touchdown.
    const p = createPlayerState(level.spawn);
    settle(p, level);
    stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    const pressAtFrame = Math.max(0, framesToLand - 5);
    let jumpedAgain = false;
    for (let i = 0; i < framesToLand + 2; i++) {
      const ev = stepPlayer(p, flat({ jumpPressed: i === pressAtFrame }), level, DT);
      if (ev.jumped) jumpedAgain = true;
    }
    expect(jumpedAgain).toBe(true);
  });

  it('a short tap yields less height than holding the jump', () => {
    const level = makeLevel();

    function peakHeight(hold: boolean): number {
      const p = createPlayerState(level.spawn);
      settle(p, level);
      stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
      let minY = p.pos.y;
      for (let i = 0; i < 200; i++) {
        stepPlayer(p, flat({ jumpHeld: hold }), level, DT);
        minY = Math.min(minY, p.pos.y);
        if (p.vel.y > 0 && p.onGround === false && minY < p.pos.y - 5) break;
      }
      return level.spawn.y - minY;
    }

    const shortHop = peakHeight(false);
    const fullJump = peakHeight(true);
    expect(fullJump).toBeGreaterThan(shortHop * 1.3);
  });
});

describe('wall interactions', () => {
  it('slides down slowly while clinging to a wall', () => {
    const wall: Rect = { x: 150, y: -1000, w: 40, h: 2000 };
    const floor: Rect = { x: -1000, y: 400, w: 4000, h: 100 };
    const level = makeLevel({ solids: [floor, wall] });
    const p = createPlayerState({ x: 108, y: 200 });
    p.vel.y = 300;
    for (let i = 0; i < 40; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    expect(p.onWall).toBe(1);
    expect(p.vel.y).toBeLessThanOrEqual(PHYSICS.wallSlideSpeed + 1);
  });

  it('wall-jumps away from the wall', () => {
    const wall: Rect = { x: 150, y: -1000, w: 40, h: 2000 };
    const floor: Rect = { x: -1000, y: 400, w: 4000, h: 100 };
    const level = makeLevel({ solids: [floor, wall] });
    const p = createPlayerState({ x: 108, y: 200 });
    p.vel.y = 300;
    for (let i = 0; i < 20; i++) stepPlayer(p, flat({ moveX: 1 }), level, DT);
    expect(p.onWall).toBe(1);
    const ev = stepPlayer(p, flat({ moveX: 1, jumpPressed: true, jumpHeld: true }), level, DT);
    expect(ev.wallJumped).toBe(true);
    expect(p.vel.x).toBeLessThan(0);
    expect(p.vel.y).toBeLessThan(0);
  });
});

describe('dash', () => {
  it('bursts forward at dash speed and grants brief invulnerability', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    const ev = stepPlayer(p, flat({ dashPressed: true }), level, DT);
    expect(ev.dashed).toBe(true);
    expect(p.vel.x).toBeCloseTo(PHYSICS.dashSpeed, 0);
    expect(p.invulnTimer).toBeGreaterThan(0);
  });

  it('cannot be re-triggered until the cooldown elapses', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    stepPlayer(p, flat({ dashPressed: true }), level, DT);
    for (let i = 0; i < 5; i++) stepPlayer(p, flat(), level, DT);
    const ev = stepPlayer(p, flat({ dashPressed: true }), level, DT);
    expect(ev.dashed).toBe(false);
  });

  it('refreshes when the player touches the ground again', () => {
    const level = makeLevel();
    const p = createPlayerState(level.spawn);
    settle(p, level);
    stepPlayer(p, flat({ jumpPressed: true, jumpHeld: true }), level, DT);
    stepPlayer(p, flat({ dashPressed: true }), level, DT);
    expect(p.dashReady).toBe(false);
    for (let i = 0; i < 400 && !p.onGround; i++) stepPlayer(p, flat(), level, DT);
    expect(p.onGround).toBe(true);
    expect(p.dashReady).toBe(true);
  });
});

describe('pogo', () => {
  it('bounces upward off a bounce pad when attacking downward in the air', () => {
    const pad: Rect = { x: 90, y: 300, w: 40, h: 16 };
    const floor: Rect = { x: -1000, y: 800, w: 4000, h: 100 };
    const level = makeLevel({ solids: [floor], bouncePads: [pad] });
    const p = createPlayerState({ x: 90, y: 250 });
    p.vel.y = 200;
    let pogoed = false;
    for (let i = 0; i < 30 && !pogoed; i++) {
      const ev = stepPlayer(p, flat({ downHeld: true, attackPressed: i === 0 }), level, DT);
      if (ev.pogoed) pogoed = true;
    }
    expect(pogoed).toBe(true);
    expect(p.vel.y).toBeCloseTo(PHYSICS.pogoVelocity, 0);
    expect(p.dashReady).toBe(true);
  });
});

describe('falling out of the world', () => {
  it('reports fellOut once the player drops well below the level', () => {
    const level = makeLevel({ height: 500 });
    const p = createPlayerState({ x: 0, y: 0 });
    p.pos.y = level.height + 500;
    const ev = stepPlayer(p, flat(), level, DT);
    expect(ev.fellOut).toBe(true);
  });
});
