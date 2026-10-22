/**
 * Every tunable number for the player controller lives here so the feel can be
 * adjusted in one place. Values are in pixels / seconds. TILE is the base grid
 * unit used to lay out the test chamber.
 */
export const TILE = 48;

export const WORLD = {
  width: TILE * 70,
  height: TILE * 26,
  gravityWell: TILE * 40, // y below which the player is considered "fallen out"
};

export const PLAYER = {
  width: 26,
  height: 40,
  crouchHeight: 26,
};

export const PHYSICS = {
  // --- horizontal movement ---
  runSpeed: 236, // px/s top ground speed
  groundAccel: 2900, // px/s^2 while a direction is held
  groundTurnAccel: 4600, // px/s^2 when reversing direction (snappy turns)
  groundFriction: 3600, // px/s^2 deceleration with no input
  airSpeed: 236,
  airAccel: 1700,
  airFriction: 900,
  crouchSpeedMul: 0.45,

  // --- gravity & jump ---
  riseGravity: 1480, // while moving upward and jump still held
  apexGravity: 820, // extra floaty zone near the top of the arc
  apexThreshold: 70, // |vel.y| below this counts as "near apex"
  fallGravity: 2000, // while falling
  fastFallGravity: 2650, // while falling and down is held
  maxFallSpeed: 980,
  jumpVelocity: -560, // initial upward velocity on jump/buffer consume
  jumpCutMultiplier: 0.42, // releasing jump early clamps vel.y toward 0 by this factor
  coyoteTime: 0.1, // grace period after walking off a ledge
  jumpBufferTime: 0.12, // grace period for an early jump press

  // --- walls ---
  wallSlideSpeed: 86, // max downward speed while clinging
  wallStickTime: 0.07, // short pause when first touching a wall before sliding
  wallJumpVelX: 320,
  wallJumpVelY: -520,
  wallJumpLockTime: 0.16, // time after a wall jump with reduced air control

  // --- dash (Swift Step analogue) ---
  dashSpeed: 760,
  dashDuration: 0.16,
  dashCooldown: 0.46,
  dashEndCarryMul: 0.55, // fraction of dash speed kept as horizontal momentum after a dash
  dashInvulnTime: 0.16,

  // --- needle attack / pogo ---
  attackDuration: 0.16,
  attackCooldown: 0.22,
  pogoWindow: 0.22,
  pogoVelocity: -640,

  // --- misc ---
  hurtKnockbackX: 260,
  hurtKnockbackY: -340,
  hurtInvulnTime: 0.9,
  hurtLockTime: 0.22,
} as const;

export const MASKS_MAX = 5;
