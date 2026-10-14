import { MovementController } from '../movement/MovementController';
import type { CollisionWorld } from '../movement/CollisionWorld';
import type { SpawnPoint } from '../arena/ArenaConfig';
import {
  BOT_DIFFICULTIES,
  type AimState,
  type BotDecision,
  type BotDifficulty,
  type BotDifficultyProfile,
  type PerceptionResult,
  type WeaponDefinition,
} from './CombatTypes';
import { BotAimController } from './BotAim';
import { chooseBotDecision } from './BotDecision';
import { BotMemory } from './BotMemory';
import { BotPerceptionSystem } from './BotPerception';
import { WEAPON_DEFINITIONS } from './CombatTypes';

export interface BotOutput {
  perception: PerceptionResult;
  decision: BotDecision;
  aim: AimState;
  profile: BotDifficultyProfile;
  weapon: WeaponDefinition;
}

/** Orchestrates perception, memory, decisions, aim, and the shared movement API. */
export class BotController {
  readonly movement: MovementController;
  readonly memory = new BotMemory();
  readonly perceptionSystem = new BotPerceptionSystem();
  readonly aim = new BotAimController();

  private difficulty: BotDifficulty;
  private nextDecisionAt = 0;
  private nextSlideAt = 0;
  private decision: BotDecision = {
    state: 'searching',
    movement: {
      forward: 0,
      strafe: 0,
      sprint: false,
      autoSprint: false,
      slidePressed: false,
      jumpPressed: false,
    },
    moveYaw: Math.PI,
    desiredWeapon: 'carbine',
    wantsFire: false,
    reason: 'waiting for round start',
  };
  private perception: PerceptionResult = {
    time: 0,
    visible: false,
    distance: Infinity,
    horizontalDistance: Infinity,
    relativeElevation: 0,
    targetPosition: { x: 0, y: 0, z: 0 },
    targetVelocity: { x: 0, y: 0, z: 0 },
    targetGrounded: true,
    targetSliding: false,
    targetSprinting: false,
    blockerId: null,
    lastKnownPosition: null,
    secondsSinceSight: Infinity,
  };

  constructor(
    world: CollisionWorld,
    spawn: SpawnPoint,
    difficulty: BotDifficulty = 'expert',
  ) {
    this.movement = new MovementController(world, {}, spawn.position);
    this.difficulty = difficulty;
    this.aim.reset(spawn.yaw, 0);
  }

  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
  }

  get difficultyProfile(): BotDifficultyProfile {
    return BOT_DIFFICULTIES[this.difficulty];
  }

  get currentDecision(): BotDecision {
    return this.decision;
  }

  get currentPerception(): PerceptionResult {
    return this.perception;
  }

  resetRound(spawn: SpawnPoint): void {
    this.movement.reset(spawn.position);
    this.aim.reset(spawn.yaw, 0);
    this.nextDecisionAt = 0;
    this.nextSlideAt = 0;
    this.decision = {
      ...this.decision,
      state: 'searching',
      reason: 'round reset',
      wantsFire: false,
    };
  }

  resetMatch(spawn: SpawnPoint): void {
    this.memory.clear();
    this.resetRound(spawn);
  }

  noteDamage(time: number): void {
    this.memory.noteDamage(time);
  }

  update(
    dt: number,
    time: number,
    player: MovementController,
    playerHealth: number,
    weapon: WeaponDefinition,
    botHealth = 100,
  ): BotOutput {
    const profile = this.difficultyProfile;
    if (time >= this.nextDecisionAt) {
      this.perception = this.perceptionSystem.observe(this.movement.world, {
        time,
        selfPosition: this.movement.position,
        selfEyeHeight: this.movement.sliding ? this.movement.config.slidingEyeHeight : this.movement.config.eyeHeight,
        targetPosition: player.position,
        targetEyeHeight: player.sliding ? player.config.slidingEyeHeight : player.config.eyeHeight,
        targetVelocity: player.velocity,
        targetMovement: player.getSnapshot(),
        lastKnownPosition: this.memory.lastKnown,
        lastSeenAt: this.memory.lastSeenTime,
      });
      this.memory.observe(this.perception, time, player.getSnapshot());
      this.decision = chooseBotDecision({
        time,
        selfPosition: this.movement.position,
        selfMovement: this.movement.getSnapshot(),
        selfHealth: botHealth,
        targetHealth: playerHealth,
        perception: this.perception,
        memory: this.memory,
        profile,
        aimYaw: this.aim.state.yaw,
        canSlide: this.movement.grounded,
        canJump: true,
        slideReady: time >= this.nextSlideAt,
      });
      this.nextDecisionAt = time + profile.decisionInterval;
    }

    const selfEye = {
      x: this.movement.position.x,
      y: this.movement.position.y + (this.movement.sliding ? this.movement.config.slidingEyeHeight : this.movement.config.eyeHeight),
      z: this.movement.position.z,
    };
    const aim = this.aim.update(
      this.perception,
      selfEye,
      dt,
      time,
      profile,
      weapon,
    );
    const input = this.decision.movement;
    const wasSliding = this.movement.sliding;
    this.movement.step(input, dt, this.decision.moveYaw);
    if (!wasSliding && this.movement.sliding) this.nextSlideAt = time + 0.78;
    if (this.movement.lastCollision && this.movement.getHorizontalSpeed() < 2) {
      this.memory.noteFailedApproach();
    }

    return {
      perception: this.perception,
      decision: this.decision,
      aim,
      profile,
      weapon: WEAPON_DEFINITIONS[this.decision.desiredWeapon],
    };
  }
}
