/**
 * GLINT & GRAPPLE — every tunable number in one place.
 *
 * Units: metres, seconds, radians. A player is 1.8 units tall, gravity is
 * deliberately heavier than earth (30 vs 9.81) so arcs are short and
 * landings are events. Clients and the server import this file, so the
 * prediction and the authority can never drift apart numerically.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Snapshots are 20 Hz: enough for smooth interpolation, cheap on the wire. */
export const SNAPSHOT_EVERY = 3;
export const SNAPSHOT_HZ = TICK_RATE / SNAPSHOT_EVERY;
/** Render delay for remote players; also the lag-comp input to the server. */
export const INTERP_DELAY = 0.1;
/** How far back the server will rewind a target. */
export const MAX_REWIND = 0.35;

export const PLAYER = {
  radius: 0.36,
  /** Capsule half-height (cylinder part) — total standing height 1.8. */
  halfHeight: 0.54,
  eyeHeight: 1.62,
  /** Hitbox is intentionally a touch wider than the collider: one-shot
   *  kills at 60+ metres must feel like aim, not luck. Symmetric both ways. */
  hitRadius: 0.45,
  hitHalfHeight: 0.6,
  hitYOffset: 0.05,
} as const;

export const MOVE = {
  /** Hard pull. 30 gives a 0.35 s rise and a ~1.85 m jump: snappy, no floating. */
  gravity: 30,
  walkSpeed: 9.6,
  groundAccel: 115,
  /** Exponential ground drag while above walk speed. */
  groundFriction: 4.5,
  slideFriction: 1.0,
  /** Air thrust. 30 was a gentle drift; 48 lets a plain jump go where you point it. */
  airAccel: 48,
  /** Air thrust cap. Swinging (68) still beats flying, which is the point. */
  airMaxSpeed: 28,
  /**
   * Radians per second you can rotate the velocity you already carry toward
   * your input. This is the difference between "drift" and "steer": at 60 m/s
   * thrust alone can never turn you, so momentum is re-aimed instead of fought.
   */
  airSteer: 6.4,
  jumpSpeed: 10.7,
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  /** Below full sprint: crouching at a run has to slide, or the move is dead
   *  weight outside of grapple landings. */
  slideEnterSpeed: 8.6,
  slideMaxTime: 1.8,
  /** Slide dies when it stops being a move, not when it stops being fast. */
  slideExitSpeed: 4.0,
  /** Kick on entry so a crouch at a run reads as committing, not braking. */
  slideBoost: 1.4,
  /** Landing at speed slides; landing slowly just sticks. */
  slideJumpBonus: 1.12,
  crouchSpeed: 5.2,
  dashImpulse: 16,
  dashUp: 3.4,
  dashTime: 0.09,
  dashCooldown: 3.2,
  maxSpeed: 72,
  /** Terminal fall speed keeps the void readable instead of dial-up. */
  maxFallSpeed: 62,
  stepHeight: 0.55,
} as const;

export const GRAPPLE = {
  range: 62,
  /** Anchor nodes are spheres of this radius around the visual pinion. */
  anchorRadius: 2.6,
  /** After release the rope cannot re-attach for this long... */
  cooldown: 0.3,
  /** ...unless you release inside the chain window, which is the skill gate. */
  chainWindow: 0.52,
  chainSpeedBonus: 0.045,
  chainMaxStacks: 4,
  /** Tap shorter than this becomes a zip; holding past it becomes a swing. */
  zipTapTime: 0.19,
  zipSpeed: 48,
  /** Velocity convergence rate for the zip yank (1/s). */
  zipDamping: 18,
  zipArrive: 4.5,
  zipHop: 7.2,
  /**
   * Rope is a hard tether: outward velocity is projected away at the taut
   * point, and a stiff, critically damped spring takes up any stretch.
   * The old 34/6.5 pair had a damping ratio of 0.56 — underdamped, so the
   * rope bobbed like a bungee every time it loaded. 90/19 is ratio 1.0:
   * it takes the load once and stops.
   */
  swingSpring: 90,
  swingDamp: 19,
  /** Metres per second the rope can be shortened (jump) or fed out (crouch). */
  reelIn: 17,
  reelOut: 13,
  /** Projection removes 92% of outward radial speed; the remaining 8% is
   *  what gives the rope its satisfying snap instead of feeling like a rail. */
  outwardProjection: 0.92,
  swingSteer: 26,
  swingMaxSpeed: 68,
  /** Release boost: scaled by speed, so a fast swing is worth more. */
  releaseBoostSpeed: 0.2,
  releaseBoostMin: 1.6,
  releaseBoostMax: 11,
  releaseUp: 3.2,
  minRopeLength: 4.5,
  /** The hook is a projectile now: a visible claw crosses the gap before the
   *  rope bites. 170 m/s makes a 25 m hop land in about 0.15 s, which reads as
   *  instant but still lets you see the throw. */
  hookSpeed: 230,
  hookMaxTime: 0.42,
  /** The claw forgives the last few degrees of a throw: inside this cone it
   *  curves onto the nearest pinion instead of sailing past it. It cannot
   *  invent a target you were not already pointing near, it is pure geometry
   *  (identical on both machines) and it is identical for both players. */
  assistDeg: 12,
  /** Convergence rate of that curve (1/s per tick). Low enough to see it bend. */
  assistRate: 16,
  /** Time of a "quick" click after the hook bites, before it becomes a swing. */
  /** Rope length blends so a moving opponent doesn't teleport-yank you. */
  opponentElastic: 0.9,
} as const;

export const WEAPON = {
  /** One shot, then a slow bolt: every shot is a decision. */
  cycleTime: 1.15,
  hipSpreadDeg: 2.4,
  /** The zoom itself. 0.12 s is fast enough to feel like a reflex, not a wait. */
  scopeTime: 0.12,
  unscopeTime: 0.085,
  /** Vertical FOV. 70 v (≈100 h at 16:9) is the modern tactical-shooter
   *  frame; 34 v is a ~2.4x optic, so the scope genuinely reaches out. */
  scopedFov: 34,
  baseFov: 70,
  maxFovKick: 20,
  /** Scope glint: fully bright after holding still this long. */
  glintRamp: 0.3,
  glintAngularSpeed: 22 * (Math.PI / 180),
  glintMoveSpeed: 3.5,
  /** Glint is a forward-facing lens: invisible if you are behind the shooter. */
  glintBehindCut: -0.25,
  /** Kill feed / juice timing. */
  hitstop: 0.075,
} as const;

export const MATCH = {
  killsToWin: 3,
  respawnDelay: 2.6,
  spawnProtect: 1.1,
  warmup: 1.5,
  /** Ring: starts shrinking at 25 s, final radius at 80 s. */
  ringStartAt: 25,
  ringShrinkTime: 55,
  /** Opens wider than the map (spawn decks sit at 87.7 m) so a respawn is
   *  never born outside the hazard; it bites from ~40 s as it closes. */
  ringRadiusStart: 100,
  ringRadiusEnd: 24,
  ringCenter: { x: 0, y: 46, z: 0 },
  /** Seconds outside before the void takes you. */
  ringGrace: 2.2,
  voidY: -28,
  /** Grace period to survive a disconnect and resume. */
  reconnectWindow: 20,
} as const;

export const NET = {
  inputSendHz: 60,
  pingHz: 2,
  /** Every 2 seconds the client sends a full extrapolation keyframe for the
   *  remote capsule only if prediction diverges past this. */
  maxPredictionError: 0.08,
  historyTicks: 40,
} as const;

/**
 * Cosmetic kits. These are the ONLY differences between the two players:
 * colour, weapon silhouette and audio pitch. Every stat is shared, and the
 * server resolves both players through the same code path with no skin input.
 */
export const SKINS = [
  {
    id: 'azure',
    name: 'AZURE',
    color: 0x5bc8e8,
    glow: '#5bc8e8',
    accent: '#e6b264',
    weapon: 'lance',
    pitch: 1,
  },
  {
    id: 'ember',
    name: 'EMBER',
    color: 0xe8795a,
    glow: '#e8795a',
    accent: '#e6b264',
    weapon: 'needle',
    pitch: 0.84,
  },
] as const;
export type SkinIndex = 0 | 1;
