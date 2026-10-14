import type { Vec3 } from '../movement/MovementTypes';
import {
  BOT_DIFFICULTIES,
  type AimState,
  type BotDifficultyProfile,
  type PerceptionResult,
  type WeaponDefinition,
} from './CombatTypes';

const TAU = Math.PI * 2;

function wrapAngle(value: number): number {
  let result = value % TAU;
  if (result > Math.PI) result -= TAU;
  if (result < -Math.PI) result += TAU;
  return result;
}

function approachAngle(current: number, target: number, amount: number): number {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= amount) return target;
  return current + Math.sign(delta) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function angleToTarget(origin: Vec3, target: Vec3): { yaw: number; pitch: number } {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const z = target.z - origin.z;
  const horizontal = Math.hypot(x, z);
  return {
    yaw: Math.atan2(x, -z),
    pitch: Math.atan2(y, Math.max(horizontal, 1e-5)),
  };
}

/** Smooth, bounded aim that has a reaction window and weapon-specific error. */
export class BotAimController {
  private targetWasVisible = false;
  private acquiredAt = -Infinity;
  private lastVisibleAt = -Infinity;
  private seed = 11.7;

  readonly state: AimState = {
    yaw: Math.PI,
    pitch: 0,
    targetYaw: Math.PI,
    targetPitch: 0,
    confidence: 0,
    tracking: false,
  };

  reset(yaw: number, pitch = 0): void {
    this.state.yaw = yaw;
    this.state.pitch = pitch;
    this.state.targetYaw = yaw;
    this.state.targetPitch = pitch;
    this.state.confidence = 0;
    this.state.tracking = false;
    this.targetWasVisible = false;
    this.acquiredAt = -Infinity;
    this.lastVisibleAt = -Infinity;
  }

  update(
    perception: PerceptionResult,
    selfEye: Vec3,
    dt: number,
    time: number,
    profile: BotDifficultyProfile,
    weapon: WeaponDefinition,
  ): AimState {
    if (perception.visible) {
      if (!this.targetWasVisible) {
        this.acquiredAt = time;
        this.targetWasVisible = true;
      }
      this.lastVisibleAt = time;
      const reactionComplete = time - this.acquiredAt >= profile.reactionTime;
      if (reactionComplete) {
        const lead = clamp(
          profile.predictionLead * (perception.distance / Math.max(weapon.range, 1)),
          0,
          0.12,
        );
        const target = {
          x: perception.targetPosition.x + perception.targetVelocity.x * lead,
          y: perception.targetPosition.y + (perception.targetSliding ? 0.78 : 1.12) + perception.targetVelocity.y * lead,
          z: perception.targetPosition.z + perception.targetVelocity.z * lead,
        };
        const desired = angleToTarget(selfEye, target);
        const jitterScale = profile.aimJitter * (1 - profile.aimQuality);
        const jitterYaw = Math.sin(time * 17.3 + this.seed) * jitterScale;
        const jitterPitch = Math.cos(time * 13.1 + this.seed * 0.7) * jitterScale * 0.7;
        this.state.targetYaw = desired.yaw + jitterYaw;
        this.state.targetPitch = clamp(desired.pitch + jitterPitch, -1.35, 1.35);
        this.state.tracking = true;
      } else {
        this.state.tracking = false;
      }
    } else {
      this.targetWasVisible = false;
      this.state.tracking = false;
      this.state.confidence = Math.max(0, this.state.confidence - dt * 1.8);
    }

    const turn = profile.aimTurnSpeed * dt * (this.state.tracking ? 1 : 0.42);
    this.state.yaw = approachAngle(this.state.yaw, this.state.targetYaw, turn);
    this.state.pitch = approachAngle(this.state.pitch, this.state.targetPitch, turn * 0.76);

    const yawError = Math.abs(wrapAngle(this.state.targetYaw - this.state.yaw));
    const pitchError = Math.abs(this.state.targetPitch - this.state.pitch);
    const error = Math.hypot(yawError, pitchError);
    this.state.confidence = perception.visible && this.state.tracking
      ? clamp(profile.aimQuality * (1 - error / 0.22), 0, 1)
      : 0;
    return { ...this.state };
  }

  shouldFire(perception: PerceptionResult, profile: BotDifficultyProfile): boolean {
    if (!perception.visible || !this.state.tracking) return false;
    const yawError = Math.abs(wrapAngle(this.state.targetYaw - this.state.yaw));
    const pitchError = Math.abs(this.state.targetPitch - this.state.pitch);
    return (
      this.state.confidence >= profile.aimQuality * 0.52 &&
      yawError <= profile.fireCone &&
      pitchError <= profile.fireCone * 0.8
    );
  }

  getDirection(spread = 0, shotIndex = 0): Vec3 {
    const localSeed = this.seed + shotIndex * 19.17;
    const yaw = this.state.yaw + Math.sin(localSeed * 1.37) * spread;
    const pitch = this.state.pitch + Math.cos(localSeed * 1.91) * spread * 0.72;
    const horizontal = Math.cos(pitch);
    return {
      x: Math.sin(yaw) * horizontal,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * horizontal,
    };
  }
}

export function getBotProfile(difficulty: keyof typeof BOT_DIFFICULTIES): BotDifficultyProfile {
  return BOT_DIFFICULTIES[difficulty];
}
