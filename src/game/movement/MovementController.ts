import type { MovementConfig } from './MovementConfig';
import { createMovementConfig } from './MovementConfig';
import type {
  MovementInput,
  MovementSnapshot,
  MovementStateName,
  MovementWorld,
  Vec3,
} from './MovementTypes';

const UP: Vec3 = { x: 0, y: 1, z: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function length2D(x: number, z: number): number {
  return Math.hypot(x, z);
}

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(current + amount, target);
  if (current > target) return Math.max(current - amount, target);
  return target;
}

function approachVector(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  amount: number,
): { x: number; z: number } {
  const deltaX = targetX - currentX;
  const deltaZ = targetZ - currentZ;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance <= amount || distance <= 1e-8) {
    return { x: targetX, z: targetZ };
  }
  const scale = amount / distance;
  return { x: currentX + deltaX * scale, z: currentZ + deltaZ * scale };
}

function capHorizontalSpeed(velocity: Vec3, maxSpeed: number): void {
  const speed = length2D(velocity.x, velocity.z);
  if (speed > maxSpeed && speed > 1e-8) {
    const scale = maxSpeed / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function emptyInput(): MovementInput {
  return {
    forward: 0,
    strafe: 0,
    sprint: false,
    autoSprint: false,
    slidePressed: false,
    jumpPressed: false,
  };
}

/**
 * Fixed-step FPS movement controller.
 *
 * The controller owns the complete movement state machine. Rendering only
 * reads snapshots from it; no keyboard handler directly changes position.
 */
export class MovementController {
  readonly config: MovementConfig;
  readonly world: MovementWorld;

  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  readonly groundNormal: Vec3 = { x: 0, y: 1, z: 0 };

  state: MovementStateName = 'grounded';
  grounded = true;
  sprinting = false;
  sliding = false;
  slideElapsed = 0;
  jumpElapsed = 0;
  coyoteRemaining = 0;
  jumpBufferRemaining = 0;
  lastCollision: string | null = null;
  justLanded = false;
  simulationTime = 0;

  private landingRemaining = 0;
  private postSlideMomentumRemaining = 0;

  constructor(
    world: MovementWorld,
    configOverrides: Partial<MovementConfig> = {},
    spawn: Vec3 = { x: 0, y: 0, z: 0 },
  ) {
    this.world = world;
    this.config = createMovementConfig(configOverrides);
    this.reset(spawn);
  }

  reset(spawn: Vec3): void {
    const surface = this.world.surfaceAt(spawn.x, spawn.z);
    this.position.x = spawn.x;
    this.position.z = spawn.z;
    this.position.y = surface ? surface.height : spawn.y;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.groundNormal.x = surface?.normal.x ?? UP.x;
    this.groundNormal.y = surface?.normal.y ?? UP.y;
    this.groundNormal.z = surface?.normal.z ?? UP.z;
    this.state = 'grounded';
    this.grounded = true;
    this.sprinting = false;
    this.sliding = false;
    this.slideElapsed = 0;
    this.jumpElapsed = 0;
    this.coyoteRemaining = 0;
    this.jumpBufferRemaining = 0;
    this.lastCollision = null;
    this.justLanded = false;
    this.landingRemaining = 0;
    this.postSlideMomentumRemaining = 0;
    this.simulationTime = 0;
  }

  getCollisionHeight(): number {
    return this.sliding ? this.config.slidingHeight : this.config.standingHeight;
  }

  getHorizontalSpeed(): number {
    return length2D(this.velocity.x, this.velocity.z);
  }

  /** One deterministic simulation tick. `yaw` is camera yaw in radians. */
  step(
    input: MovementInput = emptyInput(),
    dt = this.config.fixedTimeStep,
    yaw = 0,
  ): void {
    if (dt <= 0) return;
    const deltaTime = Math.min(dt, 0.05);
    const wasGrounded = this.grounded;
    const wasSliding = this.sliding;
    this.justLanded = false;
    this.lastCollision = null;
    this.simulationTime += deltaTime;

    if (input.jumpPressed) {
      this.jumpBufferRemaining = this.config.jumpBufferTime;
    } else {
      this.jumpBufferRemaining = Math.max(
        0,
        this.jumpBufferRemaining - deltaTime,
      );
    }
    this.landingRemaining = Math.max(0, this.landingRemaining - deltaTime);
    this.postSlideMomentumRemaining = Math.max(
      0,
      this.postSlideMomentumRemaining - deltaTime,
    );

    if (this.grounded) {
      this.coyoteRemaining = this.config.coyoteTime;
    } else {
      this.coyoteRemaining = Math.max(0, this.coyoteRemaining - deltaTime);
    }

    const forward = clamp(input.forward, -1, 1);
    const strafe = clamp(input.strafe, -1, 1);
    const wish = this.getWishDirection(forward, strafe, yaw);
    const currentHorizontalSpeed = this.getHorizontalSpeed();
    const wantsSprint =
      (input.sprint || (input.autoSprint && forward > 0.05)) &&
      forward > 0.05;

    if (
      !this.sliding &&
      this.grounded &&
      input.slidePressed &&
      wantsSprint &&
      currentHorizontalSpeed >= this.config.slideMinimumSpeed
    ) {
      this.enterSlide(wish.x, wish.z);
    }

    if (this.sliding) {
      this.simulateSlide(wish.x, wish.z, deltaTime);
    } else if (this.grounded) {
      this.sprinting = wantsSprint;
      this.simulateGround(wish.x, wish.z, wantsSprint, deltaTime);
    } else {
      this.sprinting = false;
      this.simulateAir(wish.x, wish.z, deltaTime);
    }

    // A buffered jump can fire on the same tick as a slide entry, a coyote
    // frame, or a landing. The slide path intentionally carries horizontal
    // velocity rather than applying a second arbitrary speed multiplier.
    if (
      this.jumpBufferRemaining > 0 &&
      (this.grounded || this.sliding || this.coyoteRemaining > 0)
    ) {
      this.performJump(wasSliding || this.sliding);
    }

    const feetBeforeMove = this.position.y;
    const collisionHeight = this.getCollisionHeight();
    const moved = this.world.moveHorizontal(
      this.position,
      {
        x: this.velocity.x * deltaTime,
        y: 0,
        z: this.velocity.z * deltaTime,
      },
      this.config.playerRadius,
      collisionHeight,
    );
    this.position.x = moved.position.x;
    this.position.z = moved.position.z;
    if (moved.collided) {
      this.lastCollision = moved.colliderId ?? 'wall';
      if (Math.abs(moved.normal.x) > 0.5) this.velocity.x = 0;
      if (Math.abs(moved.normal.z) > 0.5) this.velocity.z = 0;
    }

    if (this.grounded) {
      this.resolveGroundAfterMove(feetBeforeMove);
    } else {
      this.resolveAirAfterMove(feetBeforeMove, deltaTime);
    }

    if (wasGrounded && !this.grounded) {
      this.coyoteRemaining = this.config.coyoteTime;
    }

    if (this.grounded && this.sliding) {
      const shouldEnd =
        this.slideElapsed >= this.config.slideDuration ||
        this.getHorizontalSpeed() < this.config.slideMinimumSpeed * 0.48;
      if (shouldEnd && this.world.canOccupy(
        this.position,
        this.config.playerRadius,
        this.config.standingHeight,
      )) {
        this.exitSlide();
      }
    }

    this.updateState(deltaTime);
  }

  getSnapshot(): MovementSnapshot {
    return {
      position: cloneVec3(this.position),
      velocity: cloneVec3(this.velocity),
      horizontalSpeed: this.getHorizontalSpeed(),
      grounded: this.grounded,
      state: this.state,
      sprinting: this.sprinting,
      sliding: this.sliding,
      slideElapsed: this.slideElapsed,
      slideRemaining: Math.max(0, this.config.slideDuration - this.slideElapsed),
      jumpElapsed: this.jumpElapsed,
      coyoteRemaining: this.coyoteRemaining,
      jumpBufferRemaining: this.jumpBufferRemaining,
      groundNormal: cloneVec3(this.groundNormal),
      lastCollision: this.lastCollision,
      justLanded: this.justLanded,
      simulationTime: this.simulationTime,
    };
  }

  private getWishDirection(
    forward: number,
    strafe: number,
    yaw: number,
  ): { x: number; z: number } {
    const forwardX = Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    let x = forwardX * forward + rightX * strafe;
    let z = forwardZ * forward + rightZ * strafe;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    return { x, z };
  }

  private enterSlide(wishX: number, wishZ: number): void {
    this.sliding = true;
    this.slideElapsed = 0;
    this.sprinting = true;
    this.state = 'sliding';

    const currentSpeed = this.getHorizontalSpeed();
    const slideLaunchSpeed = Math.min(
      this.config.slideSpeed,
      Math.max(currentSpeed, this.config.sprintSpeed * 1.04),
    );
    if (currentSpeed > 1e-5) {
      const directionX = this.velocity.x / currentSpeed;
      const directionZ = this.velocity.z / currentSpeed;
      const launch = Math.max(currentSpeed, slideLaunchSpeed);
      this.velocity.x = directionX * launch;
      this.velocity.z = directionZ * launch;
    } else if (Math.hypot(wishX, wishZ) > 1e-5) {
      this.velocity.x = wishX * slideLaunchSpeed;
      this.velocity.z = wishZ * slideLaunchSpeed;
    }
  }

  private exitSlide(): void {
    this.sliding = false;
    this.slideElapsed = 0;
  }

  private simulateGround(
    wishX: number,
    wishZ: number,
    sprinting: boolean,
    dt: number,
  ): void {
    const wishLength = Math.hypot(wishX, wishZ);
    const targetSpeed = sprinting ? this.config.sprintSpeed : this.config.walkSpeed;
    const targetX = wishX * targetSpeed;
    const targetZ = wishZ * targetSpeed;
    if (wishLength > 1e-5) {
      const acceleration = sprinting
        ? this.config.sprintAcceleration
        : this.config.groundAcceleration;
      const next = approachVector(
        this.velocity.x,
        this.velocity.z,
        targetX,
        targetZ,
        acceleration * dt,
      );
      this.velocity.x = next.x;
      this.velocity.z = next.z;
    } else {
      const friction = this.getHorizontalSpeed() > targetSpeed
        ? this.config.brakingFriction
        : this.config.groundFriction;
      const nextSpeed = approach(this.getHorizontalSpeed(), 0, friction * dt);
      const currentSpeed = this.getHorizontalSpeed();
      if (currentSpeed > 1e-5) {
        const scale = nextSpeed / currentSpeed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      } else {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    const allowedSpeed = this.postSlideMomentumRemaining > 0
      ? this.config.slideMaxSpeed
      : targetSpeed;
    capHorizontalSpeed(this.velocity, allowedSpeed);
  }

  private simulateSlide(wishX: number, wishZ: number, dt: number): void {
    this.slideElapsed += dt;
    const wishLength = Math.hypot(wishX, wishZ);
    const currentSpeed = this.getHorizontalSpeed();

    if (wishLength > 1e-5) {
      // Steering accelerates toward the requested direction without erasing
      // the momentum that makes a slide-jump useful.
      const targetSpeed = Math.max(currentSpeed, this.config.slideSpeed);
      const next = approachVector(
        this.velocity.x,
        this.velocity.z,
        wishX * targetSpeed,
        wishZ * targetSpeed,
        this.config.slideSteering * dt,
      );
      this.velocity.x = next.x;
      this.velocity.z = next.z;
    } else {
      const nextSpeed = Math.max(
        0,
        currentSpeed - this.config.slideDeceleration * dt,
      );
      if (currentSpeed > 1e-5) {
        const scale = nextSpeed / currentSpeed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }
    capHorizontalSpeed(this.velocity, this.config.slideMaxSpeed);
  }

  private simulateAir(wishX: number, wishZ: number, dt: number): void {
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1e-5) {
      const wishSpeed = this.config.airSpeedCap;
      const alongWish = this.velocity.x * wishX + this.velocity.z * wishZ;
      const addSpeed = Math.max(
        0,
        Math.min(wishSpeed - alongWish, this.config.airAcceleration * dt),
      );
      this.velocity.x += wishX * addSpeed;
      this.velocity.z += wishZ * addSpeed;
    } else {
      const speed = this.getHorizontalSpeed();
      const nextSpeed = approach(speed, 0, this.config.airBraking * dt);
      if (speed > 1e-5) {
        const scale = nextSpeed / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }
    capHorizontalSpeed(this.velocity, this.config.airSpeedCap);
  }

  private performJump(fromSlide: boolean): void {
    this.velocity.y = this.config.jumpVelocity;
    this.position.y += 0.001;
    this.grounded = false;
    this.coyoteRemaining = 0;
    this.jumpBufferRemaining = 0;
    this.jumpElapsed = 0;
    this.state = 'jumping';
    if (fromSlide) {
      this.postSlideMomentumRemaining = this.config.slideJumpGrace;
      this.sliding = false;
      this.slideElapsed = 0;
    }
  }

  private resolveGroundAfterMove(previousFeetY: number): void {
    const surface = this.world.surfaceAt(this.position.x, this.position.z);
    if (!surface) {
      this.grounded = false;
      this.velocity.y = 0;
      return;
    }

    const heightDelta = surface.height - previousFeetY;
    if (
      heightDelta <= this.config.maxStepHeight + 1e-4 &&
      heightDelta >= -this.config.maxStepHeight - 1e-4
    ) {
      this.position.y = surface.height;
      this.velocity.y = 0;
      this.grounded = true;
      this.copyNormal(surface.normal);
      return;
    }

    // A raised platform that cannot be stepped onto, or a drop larger than a
    // controller step, becomes an edge. Preserve
    // horizontal momentum and let gravity start on the next fixed tick.
    this.grounded = false;
    this.velocity.y = 0;
    this.groundNormal.x = 0;
    this.groundNormal.y = 1;
    this.groundNormal.z = 0;
  }

  private resolveAirAfterMove(previousFeetY: number, dt: number): void {
    this.velocity.y -= this.config.gravity * dt;
    const nextFeetY = this.position.y + this.velocity.y * dt;
    const vertical = this.world.resolveVertical(
      previousFeetY,
      nextFeetY,
      this.velocity.y,
      this.position,
      this.config.playerRadius,
      this.getCollisionHeight(),
    );
    this.position.y = vertical.y;
    this.velocity.y = vertical.velocityY;
    if (vertical.colliderId) this.lastCollision = vertical.colliderId;

    const surface = this.world.surfaceAt(this.position.x, this.position.z);
    const crossedSurface =
      surface &&
      this.velocity.y <= 0 &&
      previousFeetY >= surface.height - 0.05 &&
      this.position.y <= surface.height + 0.05;

    if (vertical.hitFloor || crossedSurface) {
      if (surface && crossedSurface) {
        this.position.y = surface.height;
        this.copyNormal(surface.normal);
      }
      this.velocity.y = 0;
      this.grounded = true;
      this.justLanded = true;
      this.landingRemaining = this.config.landingStateTime;
      this.jumpElapsed = 0;
      return;
    }

    this.grounded = false;
    this.jumpElapsed += dt;
    if (this.velocity.y > 0) {
      this.groundNormal.x = 0;
      this.groundNormal.y = 1;
      this.groundNormal.z = 0;
    }
  }

  private copyNormal(normal: Vec3): void {
    this.groundNormal.x = normal.x;
    this.groundNormal.y = normal.y;
    this.groundNormal.z = normal.z;
  }

  private updateState(_dt: number): void {
    if (this.sliding) {
      this.state = 'sliding';
      return;
    }
    if (!this.grounded) {
      this.state = this.velocity.y > 0 ? 'jumping' : 'airborne';
      return;
    }
    if (this.justLanded || this.landingRemaining > 0) {
      this.state = 'landing';
      return;
    }
    this.state = this.sprinting ? 'sprinting' : 'grounded';
  }
}
