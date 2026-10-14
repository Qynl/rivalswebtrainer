export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MovementStateName =
  | 'grounded'
  | 'sprinting'
  | 'jumping'
  | 'airborne'
  | 'sliding'
  | 'landing';

export interface MovementInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  autoSprint: boolean;
  slidePressed: boolean;
  jumpPressed: boolean;
}

export interface MovementSnapshot {
  position: Vec3;
  velocity: Vec3;
  horizontalSpeed: number;
  grounded: boolean;
  state: MovementStateName;
  sprinting: boolean;
  sliding: boolean;
  slideElapsed: number;
  slideRemaining: number;
  jumpElapsed: number;
  coyoteRemaining: number;
  jumpBufferRemaining: number;
  groundNormal: Vec3;
  lastCollision: string | null;
  justLanded: boolean;
  simulationTime: number;
}

export interface MovementWorld {
  surfaceAt(x: number, z: number): {
    id: string;
    height: number;
    normal: Vec3;
    tag?: string;
  } | null;
  canOccupy(position: Vec3, radius: number, height: number): boolean;
  moveHorizontal(
    position: Vec3,
    delta: Vec3,
    radius: number,
    height: number,
  ): {
    position: Vec3;
    collided: boolean;
    normal: Vec3;
    colliderId?: string;
  };
  resolveVertical(
    previousY: number,
    nextY: number,
    velocityY: number,
    position: Vec3,
    radius: number,
    height: number,
  ): {
    y: number;
    velocityY: number;
    hitCeiling: boolean;
    hitFloor: boolean;
    colliderId?: string;
  };
}
