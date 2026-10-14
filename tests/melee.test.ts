import { describe, expect, it } from 'vitest';
import { Game, type Command } from '../src/game/game';
import { QUICK_MELEE } from '../src/game/config';

const STEP = 1 / 120;

function idle(over: Partial<Command> = {}): Command {
  return {
    move: { forward: 0, strafe: 0, yaw: 0, jumpPressed: false, jumpHeld: false, crouchHeld: false, crouchPressed: false },
    yaw: 0,
    pitch: 0,
    fire: false,
    fireEdge: false,
    melee: false,
    dash: false,
    quick: false,
    reload: false,
    slot: null,
    ...over,
  };
}

function run(g: Game, seconds: number, cmd: Command = idle()): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) g.step(STEP, i === 0 ? cmd : idle());
}

describe('F quick melee', () => {
  it('switches to melee for a moment, then returns to the gun it came from', () => {
    const g = new Game({ primary: 'ak', secondary: 'pistol', melee: 'katana', difficulty: 'easy' }, () => 0.5);
    run(g, 0.05, idle({ slot: 2 }));
    expect(g.player.slot).toBe(2);

    run(g, STEP, idle({ quick: true }));
    expect(g.player.slot).toBe(3);

    run(g, QUICK_MELEE.duration + 0.05);
    expect(g.player.slot).toBe(2);
  });

  it('returns to the sidearm when quick melee was used from slot 1', () => {
    const g = new Game({ primary: 'ak', secondary: 'pistol', melee: 'scythe', difficulty: 'easy' }, () => 0.5);
    run(g, 0.05, idle({ slot: 1 }));
    run(g, STEP, idle({ quick: true }));
    expect(g.player.slot).toBe(3);
    run(g, QUICK_MELEE.duration + 0.05);
    expect(g.player.slot).toBe(1);
  });
});

describe('katana ability', () => {
  it('right click raises a deflect with the katana equipped', () => {
    const g = new Game({ primary: 'ak', secondary: 'pistol', melee: 'katana', difficulty: 'easy' }, () => 0.5);
    run(g, STEP, idle({ dash: true }));
    expect(g.player.scythe.deflectTimer).toBeGreaterThan(0);
    expect(g.player.scythe.dashTimer).toBe(0);
  });

  it('right click dashes, not deflects, with the scythe equipped', () => {
    const g = new Game({ primary: 'ak', secondary: 'pistol', melee: 'scythe', difficulty: 'easy' }, () => 0.5);
    run(g, STEP, idle({ dash: true }));
    expect(g.player.scythe.dashTimer).toBeGreaterThan(0);
    expect(g.player.scythe.deflectTimer).toBe(0);
  });
});
