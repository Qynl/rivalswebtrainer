import { describe, expect, it } from 'vitest';
import { MovementRecorder } from './MovementRecorder';
import type { MovementSnapshot } from './movement/MovementTypes';

const snapshot: MovementSnapshot = {
  position: { x: 1, y: 2, z: 3 },
  velocity: { x: 4, y: 5, z: 6 },
  horizontalSpeed: 7.21,
  grounded: false,
  state: 'jumping',
  sprinting: true,
  sliding: false,
  slideElapsed: 0,
  slideRemaining: 0.68,
  jumpElapsed: 0.12,
  coyoteRemaining: 0,
  jumpBufferRemaining: 0,
  groundNormal: { x: 0, y: 1, z: 0 },
  lastCollision: null,
  justLanded: false,
  simulationTime: 0.12,
};

describe('MovementRecorder', () => {
  it('stores an initial state and a replayable fixed-step input/yaw stream', () => {
    const recorder = new MovementRecorder();
    recorder.start(snapshot, Math.PI);
    recorder.record(snapshot, {
      forward: 1,
      strafe: 0,
      sprint: true,
      autoSprint: false,
      slidePressed: false,
      jumpPressed: true,
    }, Math.PI + 0.1);

    const recording = recorder.stop(1 / 120);
    expect(recording.version).toBe(1);
    expect(recording.fixedTimeStep).toBe(1 / 120);
    expect(recording.initialPosition).toEqual(snapshot.position);
    expect(recording.initialYaw).toBe(Math.PI);
    expect(recording.samples[0].input.jumpPressed).toBe(true);
    expect(recording.samples[0].yaw).toBeCloseTo(Math.PI + 0.1);
  });
});
