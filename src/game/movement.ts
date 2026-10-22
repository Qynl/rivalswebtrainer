import { PHYSICS, PLAYER } from './config';
import type { Rect, Vec2 } from './geometry';
import { clamp, rectsOverlap, sign } from './geometry';
import type { Level } from './level';

export type Facing = 1 | -1;

export interface InputFrame {
  moveX: number; // -1..1
  downHeld: boolean; // crouch on ground / aim-down in air (gates pogo & fast-fall)
  jumpPressed: boolean; // edge this frame
  jumpHeld: boolean;
  dashPressed: boolean; // edge
  attackPressed: boolean; // edge
}

export type AttackKind = 'side' | 'down' | null;

export interface PlayerState {
  pos: Vec2; // top-left of the current (possibly crouched) hitbox
  vel: Vec2;
  facing: Facing;
  width: number;
  height: number;

  onGround: boolean;
  onWall: 0 | 1 | -1; // -1 = wall to the left, 1 = wall to the right
  crouching: boolean;

  coyote: number;
  jumpBuffer: number;
  jumping: boolean; // true from jump start until grounded again (drives gravity curve)

  wallStick: number; // short pause before a wall-cling starts sliding
  wallJumpLock: number; // seconds of reduced air control after a wall jump

  dashTimer: number;
  dashCooldown: number;
  dashReady: boolean;
  dashDir: Vec2;

  attackTimer: number;
  attackCooldown: number;
  attackKind: AttackKind;
  pogoConsumed: boolean;

  hurtTimer: number; // invulnerable + input-locked after taking a hit
  invulnTimer: number; // invulnerable only (covers dash i-frames too)

  facingLockTimer: number; // attacks/dashes briefly lock the facing direction
}

export interface PlayerEvents {
  jumped: boolean;
  wallJumped: boolean;
  landed: boolean;
  dashed: boolean;
  dashEnded: boolean;
  attacked: AttackKind;
  pogoed: boolean;
  fellOut: boolean;
}

export function createPlayerState(spawn: Vec2): PlayerState {
  return {
    pos: { ...spawn },
    vel: { x: 0, y: 0 },
    facing: 1,
    width: PLAYER.width,
    height: PLAYER.height,
    onGround: false,
    onWall: 0,
    crouching: false,
    coyote: 0,
    jumpBuffer: 0,
    jumping: false,
    wallStick: 0,
    wallJumpLock: 0,
    dashTimer: 0,
    dashCooldown: 0,
    dashReady: true,
    dashDir: { x: 1, y: 0 },
    attackTimer: 0,
    attackCooldown: 0,
    attackKind: null,
    pogoConsumed: false,
    hurtTimer: 0,
    invulnTimer: 0,
    facingLockTimer: 0,
  };
}

function emptyEvents(): PlayerEvents {
  return {
    jumped: false,
    wallJumped: false,
    landed: false,
    dashed: false,
    dashEnded: false,
    attacked: null,
    pogoed: false,
    fellOut: false,
  };
}

/** Quake-style accelerate-toward-target for the single horizontal axis. */
function accelerate1D(vel: Vec2, wish: number, targetSpeed: number, accel: number, dt: number): void {
  const current = vel.x * wish;
  const add = targetSpeed - current;
  if (add <= 0) return;
  vel.x += wish * Math.min(accel * dt, add);
}

function applyFriction1D(vel: Vec2, friction: number, dt: number): void {
  const speed = Math.abs(vel.x);
  if (speed < 1e-4) {
    vel.x = 0;
    return;
  }
  const drop = friction * dt;
  vel.x = sign(vel.x) * Math.max(speed - drop, 0);
}

/** Moves one axis in short substeps so fast motion (dashes) can't tunnel through thin solids. */
const MAX_STEP = 6;
function sweepAxis(
  x: number,
  y: number,
  w: number,
  h: number,
  axis: 'x' | 'y',
  delta: number,
  solids: readonly Rect[],
): { pos: number; blocked: boolean } {
  if (delta === 0) return { pos: axis === 'x' ? x : y, blocked: false };
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_STEP));
  const inc = delta / steps;
  let cx = x;
  let cy = y;
  for (let i = 0; i < steps; i++) {
    const nx = axis === 'x' ? cx + inc : cx;
    const ny = axis === 'y' ? cy + inc : cy;
    const test: Rect = { x: nx, y: ny, w, h };
    let blocked = false;
    for (const s of solids) {
      if (rectsOverlap(test, s)) {
        blocked = true;
        break;
      }
    }
    if (blocked) return { pos: axis === 'x' ? cx : cy, blocked: true };
    cx = nx;
    cy = ny;
  }
  return { pos: axis === 'x' ? cx : cy, blocked: false };
}

const PROBE = 2; // thin probe strip, in px, used for ground/wall adjacency checks
const PROBE_MARGIN = 3; // shrink probes away from corners so a ledge isn't both "wall" and "ground"

function anyOverlap(test: Rect, solids: readonly Rect[]): boolean {
  for (const s of solids) {
    if (rectsOverlap(test, s)) return true;
  }
  return false;
}

/**
 * Adjacency is checked with a small probe *after* integration, independent of this
 * frame's velocity. Deriving "on ground"/"on wall" purely from whether the sweep was
 * blocked this frame flickers whenever velocity settles to zero (a resting body stops
 * moving into the floor, so the sweep sees no collision at all) - the probe avoids that.
 */
function probeGround(x: number, y: number, w: number, h: number, solids: readonly Rect[]): boolean {
  const test: Rect = { x: x + PROBE_MARGIN, y: y + h, w: Math.max(1, w - PROBE_MARGIN * 2), h: PROBE };
  return anyOverlap(test, solids);
}

function probeWall(x: number, y: number, w: number, h: number, dir: 1 | -1, solids: readonly Rect[]): boolean {
  const test: Rect = {
    x: dir === 1 ? x + w : x - PROBE,
    y: y + PROBE_MARGIN,
    w: PROBE,
    h: Math.max(1, h - PROBE_MARGIN * 2),
  };
  return anyOverlap(test, solids);
}

function moveAndCollide(s: PlayerState, dt: number, solids: readonly Rect[]) {
  const dx = s.vel.x * dt;
  const rx = sweepAxis(s.pos.x, s.pos.y, s.width, s.height, 'x', dx, solids);
  s.pos.x = rx.pos;
  if (rx.blocked) s.vel.x = 0;

  const dy = s.vel.y * dt;
  const ry = sweepAxis(s.pos.x, s.pos.y, s.width, s.height, 'y', dy, solids);
  s.pos.y = ry.pos;
  const onCeiling = ry.blocked && dy < 0;
  if (ry.blocked) s.vel.y = onCeiling ? Math.max(s.vel.y, 0) : 0;

  const onGround = probeGround(s.pos.x, s.pos.y, s.width, s.height, solids);
  const wallLeft = probeWall(s.pos.x, s.pos.y, s.width, s.height, -1, solids);
  const wallRight = probeWall(s.pos.x, s.pos.y, s.width, s.height, 1, solids);

  return { onGround, onCeiling, wallLeft, wallRight };
}

export function attackHitbox(s: PlayerState): Rect | null {
  if (s.attackTimer <= 0 || !s.attackKind) return null;
  if (s.attackKind === 'down') {
    const w = s.width * 0.9;
    return { x: s.pos.x + (s.width - w) / 2, y: s.pos.y + s.height - 4, w, h: 22 };
  }
  const w = 34;
  const h = 22;
  const x = s.facing === 1 ? s.pos.x + s.width - 4 : s.pos.x - w + 4;
  return { x, y: s.pos.y + s.height * 0.3, w, h };
}

/** Advances the player simulation by dt seconds. Mutates `s` in place. */
export function stepPlayer(s: PlayerState, input: InputFrame, level: Level, dt: number): PlayerEvents {
  const ev = emptyEvents();
  const wasGrounded = s.onGround;

  // --- timers ---
  s.coyote = s.onGround ? PHYSICS.coyoteTime : Math.max(0, s.coyote - dt);
  s.jumpBuffer = input.jumpPressed ? PHYSICS.jumpBufferTime : Math.max(0, s.jumpBuffer - dt);
  s.wallJumpLock = Math.max(0, s.wallJumpLock - dt);
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  s.attackCooldown = Math.max(0, s.attackCooldown - dt);
  s.facingLockTimer = Math.max(0, s.facingLockTimer - dt);
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);
  s.invulnTimer = Math.max(0, s.invulnTimer - dt);

  const hurtLocked = s.hurtTimer > 0;

  // --- facing ---
  if (!hurtLocked && s.facingLockTimer <= 0 && input.moveX !== 0) {
    s.facing = input.moveX > 0 ? 1 : -1;
  }

  // --- crouch (cosmetic + speed only; hitbox stays constant for simple, reliable collision) ---
  s.crouching = s.onGround && input.downHeld && s.dashTimer <= 0;

  // --- dash start ---
  if (!hurtLocked && input.dashPressed && s.dashReady && s.dashTimer <= 0 && s.dashCooldown <= 0) {
    const dashingDown = !s.onGround && input.downHeld;
    s.dashDir = dashingDown ? { x: 0, y: 1 } : { x: s.facing, y: 0 };
    s.dashTimer = PHYSICS.dashDuration;
    s.dashReady = false;
    s.dashCooldown = PHYSICS.dashCooldown;
    s.vel.x = s.dashDir.x * PHYSICS.dashSpeed;
    s.vel.y = s.dashDir.y * PHYSICS.dashSpeed;
    s.invulnTimer = Math.max(s.invulnTimer, PHYSICS.dashInvulnTime);
    s.jumping = true;
    s.facingLockTimer = PHYSICS.dashDuration;
    ev.dashed = true;
  }

  if (s.dashTimer > 0) {
    s.dashTimer = Math.max(0, s.dashTimer - dt);
    if (s.dashTimer === 0) {
      s.vel.x = s.dashDir.x * PHYSICS.dashSpeed * PHYSICS.dashEndCarryMul;
      s.vel.y = s.dashDir.y === 0 ? 0 : s.vel.y * PHYSICS.dashEndCarryMul;
      ev.dashEnded = true;
    }
  } else {
    // --- horizontal movement ---
    const wish = input.moveX;
    const speedMul = s.crouching ? PHYSICS.crouchSpeedMul : 1;
    if (!hurtLocked) {
      if (s.onGround) {
        const target = PHYSICS.runSpeed * speedMul;
        if (wish !== 0) {
          const reversing = sign(s.vel.x) !== 0 && sign(s.vel.x) !== sign(wish);
          accelerate1D(s.vel, wish, target, reversing ? PHYSICS.groundTurnAccel : PHYSICS.groundAccel, dt);
        } else {
          applyFriction1D(s.vel, PHYSICS.groundFriction, dt);
        }
      } else {
        const lockScale = s.wallJumpLock > 0 ? 0.25 : 1;
        if (wish !== 0) {
          accelerate1D(s.vel, wish, PHYSICS.airSpeed * lockScale, PHYSICS.airAccel * lockScale, dt);
        } else {
          applyFriction1D(s.vel, PHYSICS.airFriction, dt);
        }
      }
    }

    // --- gravity & variable jump height ---
    if (s.onGround) {
      if (s.vel.y >= 0) s.vel.y = 0;
      s.jumping = false;
    } else {
      const rising = s.vel.y < 0;
      const nearApex = Math.abs(s.vel.y) < PHYSICS.apexThreshold;
      let g: number;
      if (rising) {
        g = nearApex ? PHYSICS.apexGravity : PHYSICS.riseGravity;
      } else {
        g = input.downHeld ? PHYSICS.fastFallGravity : PHYSICS.fallGravity;
      }
      s.vel.y = Math.min(s.vel.y + g * dt, PHYSICS.maxFallSpeed);
      if (!input.jumpHeld && rising && s.jumping) {
        s.vel.y = Math.max(s.vel.y, PHYSICS.jumpVelocity * PHYSICS.jumpCutMultiplier);
      }
    }

    // --- wall cling ---
    if (!s.onGround && s.onWall !== 0 && s.vel.y > 0 && input.moveX === s.onWall) {
      s.wallStick = s.wallStick > 0 ? s.wallStick - dt : 0;
      if (s.wallStick <= 0) s.vel.y = Math.min(s.vel.y, PHYSICS.wallSlideSpeed);
      else s.vel.y = Math.min(s.vel.y, 10);
    } else {
      s.wallStick = PHYSICS.wallStickTime;
    }

    // --- jump / wall jump ---
    const wantsJump = s.jumpBuffer > 0;
    const canGroundJump = s.onGround || s.coyote > 0;
    if (!hurtLocked && wantsJump && canGroundJump) {
      s.vel.y = PHYSICS.jumpVelocity;
      s.jumping = true;
      s.coyote = 0;
      s.jumpBuffer = 0;
      ev.jumped = true;
    } else if (!hurtLocked && wantsJump && !s.onGround && s.onWall !== 0) {
      s.vel.y = PHYSICS.wallJumpVelY;
      s.vel.x = -s.onWall * PHYSICS.wallJumpVelX;
      s.facing = -s.onWall as Facing;
      s.jumping = true;
      s.wallJumpLock = PHYSICS.wallJumpLockTime;
      s.jumpBuffer = 0;
      s.dashReady = true;
      s.facingLockTimer = 0.08;
      ev.wallJumped = true;
    }
  }

  // --- attack / pogo ---
  if (!hurtLocked && input.attackPressed && s.attackCooldown <= 0) {
    const down = !s.onGround && input.downHeld;
    s.attackKind = down ? 'down' : 'side';
    s.attackTimer = PHYSICS.attackDuration;
    s.attackCooldown = PHYSICS.attackDuration + PHYSICS.attackCooldown;
    s.pogoConsumed = false;
    if (down) s.facingLockTimer = Math.max(s.facingLockTimer, PHYSICS.attackDuration);
    ev.attacked = s.attackKind;
  }
  if (s.attackTimer > 0) {
    s.attackTimer = Math.max(0, s.attackTimer - dt);
    if (s.attackKind === 'down' && !s.pogoConsumed && s.vel.y >= 0) {
      const box = attackHitbox(s);
      if (box) {
        for (const pad of level.bouncePads) {
          if (rectsOverlap(box, pad)) {
            s.vel.y = PHYSICS.pogoVelocity;
            s.jumping = true;
            s.dashReady = true;
            s.pogoConsumed = true;
            s.attackTimer = 0;
            ev.pogoed = true;
            break;
          }
        }
      }
    }
  }
  if (s.attackTimer <= 0) s.attackKind = null;

  // --- integrate + collide ---
  const { onGround, wallLeft, wallRight } = moveAndCollide(s, dt, level.solids);
  s.onGround = onGround;
  s.onWall = wallLeft ? -1 : wallRight ? 1 : 0;

  if (s.onGround) {
    s.dashReady = true;
    if (!wasGrounded) ev.landed = true;
  }

  // --- fell into the void ---
  if (s.pos.y > level.height + 400) {
    ev.fellOut = true;
  }

  return ev;
}

export function applyHurt(s: PlayerState, fromX: number): void {
  if (s.invulnTimer > 0) return;
  const away = s.pos.x + s.width / 2 < fromX ? -1 : 1;
  s.vel.x = away * PHYSICS.hurtKnockbackX;
  s.vel.y = PHYSICS.hurtKnockbackY;
  s.hurtTimer = PHYSICS.hurtLockTime;
  s.invulnTimer = PHYSICS.hurtInvulnTime;
  s.jumping = true;
  s.dashTimer = 0;
}

export function respawn(s: PlayerState, at: Vec2): void {
  s.pos = { ...at };
  s.vel = { x: 0, y: 0 };
  s.onGround = false;
  s.onWall = 0;
  s.dashTimer = 0;
  s.dashReady = true;
  s.attackTimer = 0;
  s.attackKind = null;
  s.hurtTimer = 0;
  s.invulnTimer = PHYSICS.hurtInvulnTime * 0.5;
}

export function clampToWorld(s: PlayerState, worldWidth: number): void {
  s.pos.x = clamp(s.pos.x, 0, worldWidth - s.width);
}
