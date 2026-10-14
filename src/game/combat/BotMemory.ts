import type { MovementSnapshot, Vec3 } from '../movement/MovementTypes';
import type { PerceptionResult } from './CombatTypes';

interface SightRecord {
  time: number;
  position: Vec3;
  velocity: Vec3;
  visible: boolean;
}

interface StrafeRecord {
  time: number;
  lateral: number;
}

/** Bounded short-term memory; it never stores hidden player state. */
export class BotMemory {
  private readonly sightings: SightRecord[] = [];
  private readonly strafes: StrafeRecord[] = [];
  private lastKnownPosition: Vec3 | null = null;
  private lastSeenAt = -Infinity;
  private damageThreatUntil = 0;
  private failedApproaches = 0;
  private retreatBin: number | null = null;

  clear(): void {
    this.sightings.length = 0;
    this.strafes.length = 0;
    this.lastKnownPosition = null;
    this.lastSeenAt = -Infinity;
    this.damageThreatUntil = 0;
    this.failedApproaches = 0;
    this.retreatBin = null;
  }

  observe(perception: PerceptionResult, time: number, playerMovement: MovementSnapshot): void {
    if (perception.visible) {
      this.lastKnownPosition = { ...perception.targetPosition };
      this.lastSeenAt = time;
    }
    this.sightings.push({
      time,
      position: { ...perception.targetPosition },
      velocity: { ...perception.targetVelocity },
      visible: perception.visible,
    });
    if (this.sightings.length > 30) this.sightings.shift();

    const lateral = playerMovement.velocity.x;
    if (Math.abs(lateral) > 1.25 && perception.visible) {
      this.strafes.push({
        time,
        lateral: Math.sign(lateral),
      });
      if (this.strafes.length > 32) this.strafes.shift();
    }
  }

  noteDamage(time: number): void {
    this.damageThreatUntil = Math.max(this.damageThreatUntil, time + 0.7);
  }

  noteFailedApproach(): void {
    this.failedApproaches = Math.min(8, this.failedApproaches + 1);
  }

  noteRetreat(position: Vec3): void {
    this.retreatBin = Math.round(Math.atan2(position.x, position.z) * 2) / 2;
  }

  get lastKnown(): Vec3 | null {
    return this.lastKnownPosition ? { ...this.lastKnownPosition } : null;
  }

  get lastSeenTime(): number {
    return this.lastSeenAt;
  }

  isUnderThreat(time: number): boolean {
    return time < this.damageThreatUntil;
  }

  get failedApproachCount(): number {
    return this.failedApproaches;
  }

  get repeatedStrafeDirection(): number {
    if (this.strafes.length < 6) return 0;
    const recent = this.strafes.slice(-12);
    const sum = recent.reduce((total, sample) => total + sample.lateral, 0);
    if (Math.abs(sum) < recent.length * 0.45) return 0;
    return Math.sign(sum);
  }

  get repeatedStrafeSamples(): number {
    return this.strafes.length;
  }

  get lastRetreatBin(): number | null {
    return this.retreatBin;
  }
}
