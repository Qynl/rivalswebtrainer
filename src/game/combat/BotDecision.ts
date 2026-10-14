import type { MovementInput, MovementSnapshot, Vec3 } from '../movement/MovementTypes';
import {
  BOT_DIFFICULTIES,
  type BotDecision,
  type BotDifficultyProfile,
  type BotTacticalState,
  type PerceptionResult,
  type WeaponId,
} from './CombatTypes';
import type { BotMemory } from './BotMemory';

// These are tactical anchors, not teleport destinations. The bot walks toward
// them through the same collision and ramp surfaces as the player.
const ARENA_COVER_POINTS: Vec3[] = [
  { x: -12.4, y: 0, z: -4.8 },
  { x: 12.4, y: 0, z: -4.8 },
  { x: -12.4, y: 0, z: 4.8 },
  { x: 12.4, y: 0, z: 4.8 },
  { x: -8.4, y: 0, z: 0 },
  { x: 8.4, y: 0, z: 0 },
];

export interface BotDecisionContext {
  time: number;
  selfPosition: Vec3;
  selfMovement: MovementSnapshot;
  selfHealth: number;
  targetHealth: number;
  perception: PerceptionResult;
  memory: BotMemory;
  profile: BotDifficultyProfile;
  aimYaw: number;
  canSlide: boolean;
  canJump: boolean;
  slideReady: boolean;
}

function distance2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function headingTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

function directionTo(from: Vec3, to: Vec3): { x: number; z: number; distance: number } {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const distance = Math.hypot(x, z);
  return {
    x: distance > 1e-5 ? x / distance : 0,
    z: distance > 1e-5 ? z / distance : 0,
    distance,
  };
}

function moveInput(
  forward: number,
  strafe: number,
  sprint: boolean,
  slidePressed = false,
  jumpPressed = false,
): MovementInput {
  return {
    forward,
    strafe,
    sprint,
    autoSprint: false,
    slidePressed,
    jumpPressed,
  };
}

function chooseCoverPoint(self: Vec3, target: Vec3, memory: BotMemory, time: number): Vec3 {
  const targetSide = Math.sign(target.x - self.x) || 1;
  let best = ARENA_COVER_POINTS[0];
  let bestScore = Infinity;
  for (let index = 0; index < ARENA_COVER_POINTS.length; index += 1) {
    const point = ARENA_COVER_POINTS[index];
    const distance = distance2D(self, point);
    const targetDistance = distance2D(target, point);
    const sidePenalty = Math.sign(point.x - target.x) === targetSide ? 1.8 : 0;
    const repeatedPenalty = memory.lastRetreatBin !== null
      && Math.abs(memory.lastRetreatBin - Math.round(Math.atan2(point.x, point.z) * 2) / 2) < 0.1
      ? 3.5
      : 0;
    const deterministicVariation = Math.sin(time * 0.41 + index * 3.7) * 0.8;
    const score = distance + targetDistance * 0.12 + sidePenalty + repeatedPenalty + deterministicVariation;
    if (score < bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

function chooseStrafeSign(context: BotDecisionContext): number {
  const learned = context.memory.repeatedStrafeDirection;
  if (learned !== 0 && context.memory.repeatedStrafeSamples >= context.profile.adaptationSamples) {
    // Change side against a repeatedly observed player strafe, but keep a
    // small deterministic alternation so adaptation never becomes a script.
    const alternate = Math.sin(context.time * 0.53) > 0.35 ? -learned : learned;
    return alternate || 1;
  }
  return Math.sin(context.time * (1.7 + context.profile.tacticalRisk) + 1.3) > 0 ? 1 : -1;
}

export function chooseBotDecision(context: BotDecisionContext): BotDecision {
  const {
    time,
    selfPosition,
    selfMovement,
    selfHealth,
    targetHealth,
    perception,
    memory,
    profile,
    canSlide,
    canJump,
    slideReady,
  } = context;
  const targetPosition = perception.visible
    ? perception.targetPosition
    : perception.lastKnownPosition;
  const target = targetPosition ?? { x: 0, y: 0, z: 0 };
  const direction = directionTo(selfPosition, target);
  const lowHealth = selfHealth <= 32;
  const underPressure = memory.isUnderThreat(time);
  const shouldSeekCover = lowHealth || (underPressure && selfHealth < 62);
  const strafeSign = chooseStrafeSign(context);
  let state: BotTacticalState = 'searching';
  let movement = moveInput(0, 0, false);
  let moveYaw = context.aimYaw;
  let reason = 'searching last known position';
  let desiredWeapon: WeaponId = perception.distance < 11 ? 'sidearm' : 'carbine';

  if (!perception.visible) {
    if (perception.lastKnownPosition && perception.secondsSinceSight < 2.4) {
      state = 'searching';
      moveYaw = headingTo(selfPosition, target);
      movement = moveInput(1, strafeSign * 0.22, true);
      reason = perception.blockerId
        ? `last seen behind ${perception.blockerId}`
        : 'moving to last sighting';
    } else {
      state = 'repositioning';
      const searchPoint = {
        x: Math.sin(time * 0.34) * 9,
        y: 0,
        z: Math.cos(time * 0.29) * 8,
      };
      moveYaw = headingTo(selfPosition, searchPoint);
      movement = moveInput(1, strafeSign * 0.35, true);
      reason = 'rebuilding a useful angle';
    }
  } else if (shouldSeekCover) {
    const cover = chooseCoverPoint(selfPosition, perception.targetPosition, memory, time);
    moveYaw = headingTo(selfPosition, cover);
    movement = moveInput(1, strafeSign * 0.18, true, false, false);
    state = 'taking-cover';
    reason = lowHealth ? 'low health: break line of sight' : 'recent damage: change angle';
    memory.noteRetreat(cover);
  } else if (perception.distance > 28) {
    state = 'approaching';
    moveYaw = headingTo(selfPosition, perception.targetPosition);
    movement = moveInput(1, strafeSign * 0.28, true);
    reason = 'close distance while maintaining lateral motion';
  } else if (perception.distance < 7.2) {
    state = 'retreating';
    moveYaw = headingTo(selfPosition, perception.targetPosition);
    movement = moveInput(-1, strafeSign, true);
    reason = 'create a safe weapon distance';
  } else {
    state = 'strafing';
    moveYaw = headingTo(selfPosition, perception.targetPosition);
    const forward = perception.targetSliding || !perception.targetGrounded ? 0.08 : 0.2;
    movement = moveInput(forward, strafeSign, false);
    reason = memory.repeatedStrafeSamples >= profile.adaptationSamples
      ? 'countering a learned lateral habit'
      : 'hold a changing duel angle';
  }

  const exposedCross = perception.visible && perception.distance > 12 && state !== 'taking-cover';
  const slidePressed = (
    canSlide &&
    slideReady &&
    exposedCross &&
    profile.movementQuality > 0.45 &&
    Math.sin(time * 1.31 + profile.tacticalRisk * 4) > 0.15
  );
  const jumpPressed = (
    canJump &&
    selfMovement.sliding &&
    profile.movementQuality > 0.5 &&
    Math.sin(time * 2.4 + 0.8) > 0.1
  );
  if (slidePressed) reason = 'slide across exposed sightline';
  if (jumpPressed) reason = 'slide-jump to preserve momentum';

  if (targetHealth < 36 && perception.visible && profile.tacticalRisk > 0.55) {
    reason = 'pressure a vulnerable target';
  }

  return {
    state,
    movement: {
      ...movement,
      slidePressed,
      jumpPressed,
    },
    moveYaw,
    desiredWeapon,
    wantsFire: perception.visible && perception.distance <= 115,
    reason,
  };
}

export function getDifficultyProfile(difficulty: keyof typeof BOT_DIFFICULTIES): BotDifficultyProfile {
  return BOT_DIFFICULTIES[difficulty];
}
