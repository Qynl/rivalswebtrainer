import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './CollisionWorld';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { MovementController } from './MovementController';
import type { MovementInput } from './MovementTypes';

const dt = DEFAULT_MOVEMENT_CONFIG.fixedTimeStep;

function makeInput(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    forward: 0,
    strafe: 0,
    sprint: false,
    autoSprint: false,
    slidePressed: false,
    jumpPressed: false,
    ...overrides,
  };
}

function makeFlatWorld(): CollisionWorld {
  const world = new CollisionWorld();
  world.addFloor('floor', { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  return world;
}

function simulate(
  controller: MovementController,
  seconds: number,
  input: MovementInput,
  yaw = Math.PI,
): void {
  const steps = Math.round(seconds / dt);
  for (let index = 0; index < steps; index += 1) {
    controller.step(input, dt, yaw);
  }
}

describe('MovementController', () => {
  it('accelerates to a capped sprint speed without a diagonal boost', () => {
    const straight = new MovementController(makeFlatWorld());
    const diagonal = new MovementController(makeFlatWorld());

    simulate(straight, 1.2, makeInput({ forward: 1, sprint: true }));
    simulate(diagonal, 1.2, makeInput({ forward: 1, strafe: 1, sprint: true }));

    expect(straight.sprinting).toBe(true);
    expect(straight.getHorizontalSpeed()).toBeCloseTo(DEFAULT_MOVEMENT_CONFIG.sprintSpeed, 2);
    expect(diagonal.getHorizontalSpeed()).toBeCloseTo(straight.getHorizontalSpeed(), 2);
    expect(diagonal.position.z).toBeGreaterThan(0);
  });

  it('keeps horizontal and vertical jump physics independent', () => {
    const controller = new MovementController(makeFlatWorld());
    const startZ = controller.position.z;
    let peak = controller.position.y;
    let airborneSteps = 0;
    let landed = false;
    let sawLandingState = false;

    controller.step(makeInput({ forward: 1, jumpPressed: true }), dt, Math.PI);
    for (let index = 0; index < 240; index += 1) {
      controller.step(makeInput({ forward: 1 }), dt, Math.PI);
      peak = Math.max(peak, controller.position.y);
      if (!controller.grounded) airborneSteps += 1;
      if (controller.state === 'landing') sawLandingState = true;
      if (index > 20 && controller.grounded) {
        landed = true;
        break;
      }
    }

    expect(peak).toBeGreaterThan(3.3);
    expect(peak).toBeLessThan(4.2);
    expect(airborneSteps).toBeGreaterThan(70);
    expect(landed).toBe(true);
    expect(sawLandingState).toBe(true);
    expect(controller.position.z).toBeGreaterThan(startZ + 5);
  });

  it('falls from a raised platform instead of teleporting down a large edge', () => {
    const world = makeFlatWorld();
    world.addBox('raised-platform', { x: 0, y: 1, z: 0 }, { x: 4, y: 2, z: 4 }, 'platform');
    const controller = new MovementController(world, {}, { x: 0, y: 0, z: 0 });

    simulate(controller, 0.3, makeInput({ forward: 1, sprint: true }), Math.PI / 2);

    expect(controller.position.x).toBeGreaterThan(2.4);
    expect(controller.grounded).toBe(false);
    expect(controller.position.y).toBeGreaterThan(0.8);
  });

  it('enters a slide only with sprint momentum and carries it into a slide-jump', () => {
    const controller = new MovementController(makeFlatWorld());
    simulate(controller, 0.8, makeInput({ forward: 1, sprint: true }));
    const beforeSlide = controller.getHorizontalSpeed();

    controller.step(
      makeInput({ forward: 1, sprint: true, slidePressed: true }),
      dt,
      Math.PI,
    );
    expect(controller.sliding).toBe(true);
    expect(controller.state).toBe('sliding');
    expect(controller.getHorizontalSpeed()).toBeGreaterThan(beforeSlide);

    const speedAtJump = controller.getHorizontalSpeed();
    controller.step(makeInput({ forward: 1, jumpPressed: true }), dt, Math.PI);
    expect(controller.sliding).toBe(false);
    expect(controller.state).toBe('jumping');
    expect(controller.velocity.y).toBeGreaterThan(0);
    expect(controller.getHorizontalSpeed()).toBeGreaterThan(speedAtJump * 0.96);
  });

  it('resolves a high-speed approach against a wall instead of tunnelling through it', () => {
    const world = makeFlatWorld();
    world.addBox('wall', { x: 0, y: 2, z: 5 }, { x: 12, y: 4, z: 0.8 }, 'wall');
    const controller = new MovementController(world, {}, { x: 0, y: 0, z: 0 });

    simulate(controller, 1.5, makeInput({ forward: 1, sprint: true }));

    expect(controller.position.z).toBeLessThanOrEqual(5 - 0.4 + 0.02);
    expect(controller.lastCollision).toBe('wall');
    expect(controller.velocity.z).toBeCloseTo(0, 4);
  });

  it('follows an analytic ramp surface and exposes its ground normal', () => {
    const world = makeFlatWorld();
    world.addRamp({
      id: 'ramp',
      minX: -3,
      maxX: 3,
      minZ: 0,
      maxZ: 6,
      lowHeight: 0,
      highHeight: 2,
      highToward: 'max',
    });
    const controller = new MovementController(world, {}, { x: 0, y: 0, z: -1 });

    simulate(controller, 0.55, makeInput({ forward: 1, sprint: true }));

    expect(controller.position.z).toBeGreaterThan(0.5);
    expect(controller.position.y).toBeGreaterThan(0.1);
    expect(controller.groundNormal.y).toBeLessThan(0.99);
    expect(controller.grounded).toBe(true);
  });

  it('raycasts the same cover solids used for movement', () => {
    const world = makeFlatWorld();
    world.addBox('cover', { x: 0, y: 1, z: -4 }, { x: 6, y: 2, z: 0.8 }, 'cover');

    const hit = world.raycast(
      { x: 0, y: 1.3, z: 0 },
      { x: 0, y: 0, z: -1 },
      20,
    );

    expect(hit?.colliderId).toBe('cover');
    expect(hit?.distance).toBeCloseTo(3.6, 5);
    expect(hit?.point.z).toBeCloseTo(-3.6, 5);
  });

  it('is stable when the same input is simulated at two render rates', () => {
    const sixty = new MovementController(makeFlatWorld());
    const oneTwenty = new MovementController(makeFlatWorld());
    const input = makeInput({ forward: 1, sprint: true });

    // A 60 Hz renderer runs two 120 Hz simulation ticks per frame. The
    // render cadence must not change the controller's result.
    for (let frame = 0; frame < 60; frame += 1) {
      sixty.step(input, dt, Math.PI);
      sixty.step(input, dt, Math.PI);
    }
    for (let index = 0; index < 120; index += 1) oneTwenty.step(input, dt, Math.PI);

    expect(sixty.position.z).toBeCloseTo(oneTwenty.position.z, 6);
    expect(sixty.getHorizontalSpeed()).toBeCloseTo(oneTwenty.getHorizontalSpeed(), 3);
  });
});
