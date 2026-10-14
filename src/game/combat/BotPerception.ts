import type { MovementSnapshot, MovementWorld, Vec3 } from '../movement/MovementTypes';
import {
  cloneVec3,
  type PerceptionResult,
} from './CombatTypes';

export interface PerceptionContext {
  time: number;
  selfPosition: Vec3;
  selfEyeHeight: number;
  targetPosition: Vec3;
  targetEyeHeight: number;
  targetVelocity: Vec3;
  targetMovement: MovementSnapshot;
  lastKnownPosition: Vec3 | null;
  lastSeenAt: number;
}

/** Visibility is always derived from the same collision world used by movement. */
export class BotPerceptionSystem {
  observe(world: MovementWorld, context: PerceptionContext): PerceptionResult {
    const origin = {
      x: context.selfPosition.x,
      y: context.selfPosition.y + context.selfEyeHeight,
      z: context.selfPosition.z,
    };
    const target = {
      x: context.targetPosition.x,
      y: context.targetPosition.y + context.targetEyeHeight,
      z: context.targetPosition.z,
    };
    const delta = {
      x: target.x - origin.x,
      y: target.y - origin.y,
      z: target.z - origin.z,
    };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    const horizontalDistance = Math.hypot(delta.x, delta.z);
    const blocker = distance > 1e-5
      ? world.raycast(origin, delta, Math.max(0, distance - 0.38))
      : null;
    const visible = distance <= 1e-5 || blocker === null;
    const lastKnownPosition = visible
      ? cloneVec3(context.targetPosition)
      : context.lastKnownPosition;

    return {
      time: context.time,
      visible,
      distance,
      horizontalDistance,
      relativeElevation: target.y - origin.y,
      targetPosition: cloneVec3(context.targetPosition),
      targetVelocity: cloneVec3(context.targetVelocity),
      targetGrounded: context.targetMovement.grounded,
      targetSliding: context.targetMovement.sliding,
      targetSprinting: context.targetMovement.sprinting,
      blockerId: visible ? null : blocker?.colliderId ?? null,
      lastKnownPosition,
      secondsSinceSight: visible
        ? 0
        : Math.max(0, context.time - context.lastSeenAt),
    };
  }
}
