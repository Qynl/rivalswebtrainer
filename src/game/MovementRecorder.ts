import type { MovementInput, MovementSnapshot, Vec3 } from './movement/MovementTypes';

export interface MovementRecordSample {
  timestamp: number;
  position: MovementSnapshot['position'];
  velocity: MovementSnapshot['velocity'];
  state: MovementSnapshot['state'];
  grounded: boolean;
  collision: string | null;
  input: MovementInput;
  yaw: number;
}

export interface MovementRecording {
  version: 1;
  fixedTimeStep: number;
  initialPosition: Vec3;
  initialVelocity: Vec3;
  initialYaw: number;
  samples: MovementRecordSample[];
}

/** Bounded recorder used by the lab and by regression investigations. */
export class MovementRecorder {
  readonly maxSamples: number;
  private recording = false;
  private samples: MovementRecordSample[] = [];
  private initialPosition: Vec3 = { x: 0, y: 0, z: 0 };
  private initialVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private initialYaw = 0;

  constructor(maxSamples = 12000) {
    this.maxSamples = maxSamples;
  }

  start(snapshot?: MovementSnapshot, yaw = 0): void {
    this.samples.length = 0;
    this.initialPosition = snapshot ? { ...snapshot.position } : { x: 0, y: 0, z: 0 };
    this.initialVelocity = snapshot ? { ...snapshot.velocity } : { x: 0, y: 0, z: 0 };
    this.initialYaw = yaw;
    this.recording = true;
  }

  stop(fixedTimeStep: number): MovementRecording {
    this.recording = false;
    return {
      version: 1,
      fixedTimeStep,
      initialPosition: { ...this.initialPosition },
      initialVelocity: { ...this.initialVelocity },
      initialYaw: this.initialYaw,
      samples: this.samples.map((sample) => ({
        ...sample,
        position: { ...sample.position },
        velocity: { ...sample.velocity },
        input: { ...sample.input },
      })),
    };
  }

  clear(): void {
    this.samples.length = 0;
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  record(snapshot: MovementSnapshot, input: MovementInput, yaw = 0): void {
    if (!this.recording || this.samples.length >= this.maxSamples) return;
    this.samples.push({
      timestamp: snapshot.simulationTime,
      position: { ...snapshot.position },
      velocity: { ...snapshot.velocity },
      state: snapshot.state,
      grounded: snapshot.grounded,
      collision: snapshot.lastCollision,
      input: { ...input },
      yaw,
    });
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  /** Returns a copy suitable for localStorage or downloading as JSON. */
  export(fixedTimeStep: number): MovementRecording {
    return this.stop(fixedTimeStep);
  }
}
