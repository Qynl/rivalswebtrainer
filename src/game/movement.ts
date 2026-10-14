import { MOVE, PLAYER } from './config';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned solid. Player-vs-box uses strict overlap so touching is free. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface MoveInput {
  forward: number; // -1..1, +1 = W
  strafe: number; // -1..1, +1 = D
  yaw: number; // camera yaw in radians (0 looks down -Z)
  jumpPressed: boolean; // edge
  jumpHeld: boolean; // held; release cuts the jump short
  crouchHeld: boolean;
  crouchPressed: boolean; // edge
}

export interface MoveState {
  pos: Vec3; // feet position
  vel: Vec3;
  onGround: boolean;
  sliding: boolean;
  slideTime: number;
  timeSinceSlideEnd: number;
  jumpBuffer: number;
  /** counts down after leaving the ground; jumping inside it still works */
  coyote: number;
  height: number;
  /** true from a slide-jump until the player lands */
  slideJumping: boolean;
}

export interface MoveEvents {
  jumped: boolean;
  slideJumped: boolean;
  slideStarted: boolean;
  slideEnded: boolean;
  landed: boolean;
}

export function createMoveState(pos: Vec3): MoveState {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    onGround: false,
    sliding: false,
    slideTime: 0,
    timeSinceSlideEnd: 99,
    jumpBuffer: 0,
    coyote: 0,
    height: PLAYER.standHeight,
    slideJumping: false,
  };
}

const KEYS = ['x', 'y', 'z'] as const;
const SUBSTEP = 0.02;

export function overlapsAny(p: Vec3, height: number, solids: readonly Aabb[]): boolean {
  const r = PLAYER.radius;
  for (const b of solids) {
    if (p.x + r <= b.min.x || p.x - r >= b.max.x) continue;
    if (p.y + height <= b.min.y || p.y >= b.max.y) continue;
    if (p.z + r <= b.min.z || p.z - r >= b.max.z) continue;
    return true;
  }
  return false;
}

/** Moves along one axis in small substeps. Returns true if blocked. */
function moveAxis(p: Vec3, axis: 0 | 1 | 2, amount: number, height: number, solids: readonly Aabb[]): boolean {
  if (amount === 0) return false;
  const k = KEYS[axis];
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / SUBSTEP));
  const step = amount / steps;
  for (let i = 0; i < steps; i++) {
    const prev = p[k];
    p[k] = prev + step;
    if (overlapsAny(p, height, solids)) {
      // Bisect to the exact contact so the body rests flush against the surface.
      let lo = prev;
      let hi = prev + step;
      for (let j = 0; j < 10; j++) {
        const mid = (lo + hi) / 2;
        p[k] = mid;
        if (overlapsAny(p, height, solids)) hi = mid;
        else lo = mid;
      }
      p[k] = lo;
      return true;
    }
  }
  return false;
}

/** Horizontal move (x then z). Returns blocked flag and mutates p. */
function moveHorizontal(p: Vec3, vel: Vec3, dt: number, height: number, solids: readonly Aabb[]): boolean {
  const bx = moveAxis(p, 0, vel.x * dt, height, solids);
  const bz = moveAxis(p, 2, vel.z * dt, height, solids);
  return bx || bz;
}

function horizontalSpeed(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}

/** Quake-style accelerate toward a wish direction. */
function accelerate(vel: Vec3, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  const current = vel.x * wx + vel.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(accel * dt * wishSpeed, add);
  vel.x += wx * gain;
  vel.z += wz * gain;
}

function applyFriction(vel: Vec3, friction: number, dt: number): void {
  const speed = horizontalSpeed(vel);
  if (speed < 1e-6) return;
  const drop = Math.max(speed, 1.5) * friction * dt;
  const newSpeed = Math.max(speed - drop, 0) / speed;
  vel.x *= newSpeed;
  vel.z *= newSpeed;
}

function canStandAt(s: MoveState, solids: readonly Aabb[]): boolean {
  return !overlapsAny(s.pos, PLAYER.standHeight, solids);
}

/** Gives an instantaneous horizontal impulse (used by the scythe dash). */
export function addHorizontalImpulse(s: MoveState, dx: number, dz: number, speed: number): void {
  const len = Math.hypot(dx, dz) || 1;
  s.vel.x = (dx / len) * speed;
  s.vel.z = (dz / len) * speed;
}

/** Advances the movement simulation by dt seconds. Mutates state. */
export function stepMovement(s: MoveState, input: MoveInput, dt: number, solids: readonly Aabb[]): MoveEvents {
  const ev: MoveEvents = { jumped: false, slideJumped: false, slideStarted: false, slideEnded: false, landed: false };
  const wasGround = s.onGround;

  // Wish direction on the ground plane.
  const fx = -Math.sin(input.yaw);
  const fz = -Math.cos(input.yaw);
  const rx = Math.cos(input.yaw);
  const rz = -Math.sin(input.yaw);
  let wx = fx * input.forward + rx * input.strafe;
  let wz = fz * input.forward + rz * input.strafe;
  const wlen = Math.hypot(wx, wz);
  const hasWish = wlen > 1e-4;
  if (hasWish) {
    wx /= wlen;
    wz /= wlen;
  }

  s.timeSinceSlideEnd += dt;
  if (input.jumpPressed) s.jumpBuffer = MOVE.jumpBuffer;
  else s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  s.coyote = s.onGround ? MOVE.coyoteTime : Math.max(0, s.coyote - dt);

  // --- Slide state machine -------------------------------------------------
  if (s.onGround && !s.sliding && input.crouchPressed && horizontalSpeed(s.vel) >= MOVE.slideMinSpeed) {
    s.sliding = true;
    s.slideTime = 0;
    const speed = horizontalSpeed(s.vel);
    const target = Math.min(Math.max(speed, speed + MOVE.slideStartBoost), MOVE.slideMaxStart);
    const k = speed > 1e-6 ? target / speed : 1;
    s.vel.x *= k;
    s.vel.z *= k;
    ev.slideStarted = true;
  }

  // Slide-jump: jumping during a slide, or within a short window after a slide.
  const canSlideJump =
    s.jumpBuffer > 0 && (s.sliding || (s.onGround && s.timeSinceSlideEnd < MOVE.slideJumpWindow));
  // Coyote time lets a jump fire just after walking off a ledge; auto-hop repeats
  // the jump while the key is held so bunny-hopping needs no timing.
  const coyoteJump = s.jumpBuffer > 0 && !s.onGround && s.coyote > 0;
  const hopJump = MOVE.autoHop && input.jumpHeld && s.onGround;
  const wantsJump = (s.jumpBuffer > 0 || hopJump) && (s.onGround || canSlideJump || coyoteJump);
  if (wantsJump) {
    const wasSliding = s.sliding || s.timeSinceSlideEnd < MOVE.slideJumpWindow;
    s.jumpBuffer = 0;
    s.onGround = false;
    s.coyote = 0;
    s.vel.y = MOVE.jumpVelocity;
    ev.jumped = true;
    if (wasSliding) {
      const speed = horizontalSpeed(s.vel);
      if (speed > 1e-6) {
        const boosted = Math.min(speed * MOVE.slideJumpMult, Math.max(speed, MOVE.slideJumpCap));
        const k = boosted / speed;
        s.vel.x *= k;
        s.vel.z *= k;
      }
      s.vel.y *= MOVE.slideJumpVelBonus;
      s.slideJumping = true;
      ev.slideJumped = true;
    }
    if (s.sliding) {
      s.sliding = false;
      s.timeSinceSlideEnd = 0;
      ev.slideEnded = true;
    }
  }

  // Slide ends: crouch released, too slow, or too long.
  if (s.sliding && s.onGround) {
    s.slideTime += dt;
    const tooSlow = horizontalSpeed(s.vel) < MOVE.slideEndSpeed;
    const tooLong = s.slideTime > MOVE.slideMaxTime;
    if (!input.crouchHeld || tooSlow || tooLong) {
      s.sliding = false;
      s.timeSinceSlideEnd = 0;
      ev.slideEnded = true;
    }
  }

  // Stand-up collision: keep crouch-height while there is no headroom.
  if (s.sliding || !canStandAt(s, solids)) {
    s.height = PLAYER.slideHeight;
  } else {
    s.height = PLAYER.standHeight;
  }

  // --- Horizontal velocity -------------------------------------------------
  if (s.onGround) {
    if (s.sliding) {
      applyFriction(s.vel, MOVE.slideFriction, dt);
      if (hasWish) accelerate(s.vel, wx, wz, MOVE.slideAccel, MOVE.slideAccel, dt);
    } else {
      // Holding jump preserves speed on landing (bunny-hop friendly).
      const bhopHold = input.jumpPressed || s.jumpBuffer > 0;
      if (!hasWish && !bhopHold) applyFriction(s.vel, MOVE.groundFriction, dt);
      if (hasWish) {
        accelerate(s.vel, wx, wz, MOVE.runSpeed, MOVE.groundAccel, dt);
        if (!bhopHold) applyFriction(s.vel, MOVE.groundFriction * 0.25, dt);
      }
    }
  } else {
    if (hasWish) accelerate(s.vel, wx, wz, Math.min(MOVE.runSpeed, MOVE.airWishCap), MOVE.airAccel, dt);
  }

  // --- Vertical velocity ---------------------------------------------------
  if (s.onGround && s.vel.y <= 0) {
    s.vel.y = -2; // ground snap
  } else {
    // Variable jump height: releasing jump while rising cuts the upward velocity.
    if (!input.jumpHeld && s.vel.y > 0 && !s.slideJumping) s.vel.y *= MOVE.jumpCutMult;
    s.vel.y -= MOVE.gravity * dt;
  }

  // --- Integrate with collision -------------------------------------------
  const start: Vec3 = { ...s.pos };
  const p = s.pos;
  const blocked = moveHorizontal(p, s.vel, dt, s.height, solids);

  // Step-up: if blocked on the ground, try raising by stepHeight and moving again.
  if (blocked && s.onGround) {
    const raised: Vec3 = { x: start.x, y: start.y + PLAYER.stepHeight, z: start.z };
    if (!overlapsAny(raised, s.height, solids)) {
      const alt: Vec3 = { ...raised };
      moveHorizontal(alt, s.vel, dt, s.height, solids);
      const dxAlt = alt.x - start.x;
      const dzAlt = alt.z - start.z;
      const dxCur = p.x - start.x;
      const dzCur = p.z - start.z;
      if (dxAlt * dxAlt + dzAlt * dzAlt > dxCur * dxCur + dzCur * dzCur + 1e-8) {
        p.x = alt.x;
        p.y = alt.y;
        p.z = alt.z;
      }
    }
  }

  const yBlocked = moveAxis(p, 1, s.vel.y * dt, s.height, solids);
  if (yBlocked) {
    if (s.vel.y < 0) {
      s.onGround = true;
      if (!wasGround) ev.landed = true;
      s.slideJumping = false;
    }
    s.vel.y = 0;
  } else {
    s.onGround = false;
  }

  // Keep the player from being stuck: if we are still in the ground-snap state but blocked by
  // nothing below us, allow falling next frame.
  if (s.onGround && s.vel.y < 0) s.vel.y = 0;

  // Sliding while airborne cancels, the slide-jump keeps horizontal speed.
  if (!s.onGround && s.sliding) {
    s.sliding = false;
    s.timeSinceSlideEnd = 0;
    ev.slideEnded = true;
  }

  return ev;
}
