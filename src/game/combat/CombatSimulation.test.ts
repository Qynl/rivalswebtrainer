import { describe, expect, it } from 'vitest';
import { BOT_SPAWN, ARENA_SPAWN } from '../arena/ArenaConfig';
import { CollisionWorld } from '../movement/CollisionWorld';
import type { MovementInput } from '../movement/MovementTypes';
import { CombatSimulation } from './CombatSimulation';
import { BotPerceptionSystem } from './BotPerception';

const idleMovement: MovementInput = {
  forward: 0,
  strafe: 0,
  sprint: false,
  autoSprint: false,
  slidePressed: false,
  jumpPressed: false,
};

function makeWorld(): CollisionWorld {
  const world = new CollisionWorld();
  world.addFloor('floor', { minX: -40, maxX: 40, minZ: -40, maxZ: 40 });
  return world;
}

describe('combat simulation', () => {
  it('uses collision cover for perception instead of tracking through walls', () => {
    const world = makeWorld();
    world.addBox('cover', { x: 0, y: 1.4, z: 0 }, { x: 4, y: 2.8, z: 0.7 });
    const perception = new BotPerceptionSystem().observe(world, {
      time: 1,
      selfPosition: { x: 0, y: 0, z: -6 },
      selfEyeHeight: 1.56,
      targetPosition: { x: 0, y: 0, z: 6 },
      targetEyeHeight: 1.56,
      targetVelocity: { x: 0, y: 0, z: 0 },
      targetMovement: {
        position: { x: 0, y: 0, z: 6 },
        velocity: { x: 0, y: 0, z: 0 },
        horizontalSpeed: 0,
        grounded: true,
        state: 'grounded',
        sprinting: false,
        sliding: false,
        slideElapsed: 0,
        slideRemaining: 0,
        jumpElapsed: 0,
        coyoteRemaining: 0,
        jumpBufferRemaining: 0,
        groundNormal: { x: 0, y: 1, z: 0 },
        lastCollision: null,
        justLanded: false,
        simulationTime: 1,
      },
      lastKnownPosition: null,
      lastSeenAt: -Infinity,
    });

    expect(perception.visible).toBe(false);
    expect(perception.blockerId).toBe('cover');
    expect(perception.lastKnownPosition).toBeNull();
  });

  it('does not shoot through a solid wall', () => {
    const world = makeWorld();
    world.addBox('wall', { x: 0, y: 1.8, z: 0 }, { x: 8, y: 3.6, z: 0.8 }, 'wall');
    const simulation = new CombatSimulation(world, ARENA_SPAWN, BOT_SPAWN, 'skilled');
    simulation.beginMatch();
    for (let index = 0; index < 340; index += 1) {
      const result = simulation.step(
        1 / 120,
        idleMovement,
        { yaw: Math.PI, pitch: 0 },
        { fireHeld: true, aimHeld: false, reloadPressed: false, weaponSlot: null },
      );
      if (result.playerShot) {
        expect(result.playerShot.hit).toBe(false);
        expect(result.playerShot.blockerId).toBe('wall');
        return;
      }
    }
    throw new Error('combat did not reach the firing phase');
  });

  it('damages the bot through the shared combat ray and keeps the match state explicit', () => {
    const simulation = new CombatSimulation(makeWorld(), ARENA_SPAWN, BOT_SPAWN, 'skilled');
    simulation.beginMatch();
    for (let index = 0; index < 340; index += 1) {
      const result = simulation.step(
        1 / 120,
        idleMovement,
        { yaw: Math.PI, pitch: 0 },
        { fireHeld: true, aimHeld: false, reloadPressed: false, weaponSlot: null },
      );
      if (result.playerShot?.hit) {
        expect(result.playerShot.targetId).toBe('bot');
        break;
      }
    }

    const snapshot = simulation.getSnapshot();
    expect(['countdown', 'fight', 'roundSummary', 'matchSummary']).toContain(snapshot.phase);
    expect(snapshot.botHealth).toBeLessThan(100);
    expect(snapshot.playerHealth).toBeGreaterThan(0);
  });
});
