/**
 * All movement tuning lives here so a calibration change never has to hunt
 * through input, rendering, or UI code. Values are in the trainer's world
 * units; they are intentionally not presented as Roblox stud measurements.
 */
export interface MovementConfig {
  fixedTimeStep: number;
  maxCatchUpSteps: number;

  playerRadius: number;
  standingHeight: number;
  slidingHeight: number;
  eyeHeight: number;
  slidingEyeHeight: number;
  maxStepHeight: number;

  walkSpeed: number;
  sprintSpeed: number;
  slideSpeed: number;
  slideMaxSpeed: number;
  groundAcceleration: number;
  sprintAcceleration: number;
  groundFriction: number;
  brakingFriction: number;

  airAcceleration: number;
  airBraking: number;
  airSpeedCap: number;
  gravity: number;
  jumpVelocity: number;

  slideMinimumSpeed: number;
  slideDuration: number;
  slideDeceleration: number;
  slideSteering: number;
  slideJumpGrace: number;
  jumpBufferTime: number;
  coyoteTime: number;
  landingStateTime: number;
}

/**
 * Baseline tuned from the public evidence in RESEARCH_REPORT.md. The source
 * material establishes the existence and relative importance of movement tech,
 * not the underlying constants, so these are calibration estimates rather than
 * claims about the Roblox implementation.
 */
export const DEFAULT_MOVEMENT_CONFIG: Readonly<MovementConfig> = Object.freeze({
  fixedTimeStep: 1 / 120,
  maxCatchUpSteps: 8,

  playerRadius: 0.42,
  standingHeight: 1.82,
  slidingHeight: 1.02,
  eyeHeight: 1.56,
  slidingEyeHeight: 0.86,
  maxStepHeight: 0.48,

  walkSpeed: 10.8,
  sprintSpeed: 15.6,
  slideSpeed: 18.6,
  slideMaxSpeed: 20.4,
  groundAcceleration: 58,
  sprintAcceleration: 68,
  groundFriction: 35,
  brakingFriction: 48,

  airAcceleration: 15.5,
  airBraking: 2.4,
  airSpeedCap: 20.8,
  gravity: 34,
  jumpVelocity: 15.9,

  slideMinimumSpeed: 7.25,
  slideDuration: 0.68,
  slideDeceleration: 13.2,
  slideSteering: 10.5,
  slideJumpGrace: 0.22,
  jumpBufferTime: 0.12,
  coyoteTime: 0.09,
  landingStateTime: 0.11,
});

export type MovementConfigOverride = Partial<MovementConfig>;

export function createMovementConfig(
  overrides: MovementConfigOverride = {},
): MovementConfig {
  return { ...DEFAULT_MOVEMENT_CONFIG, ...overrides };
}
