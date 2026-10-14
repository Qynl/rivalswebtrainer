import type { SpawnPoint } from '../arena/ArenaConfig';
import type { CollisionWorld } from '../movement/CollisionWorld';
import { MovementController } from '../movement/MovementController';
import type { MovementInput, Vec3 } from '../movement/MovementTypes';
import {
  BOT_DIFFICULTIES,
  EMPTY_COMBAT_INPUT,
  type BotDifficulty,
  type CombatAim,
  type CombatEvent,
  type CombatInput,
  type CombatSnapshot,
  type MatchPhase,
  type ShotResult,
  type WeaponDefinition,
  type WeaponId,
} from './CombatTypes';
import { BotController, type BotOutput } from './BotController';
import { WeaponLoadout } from './WeaponSystem';

export interface CombatStepResult {
  playerShot: ShotResult | null;
  botShot: ShotResult | null;
  botOutput: BotOutput | null;
}

const MAX_HEALTH = 100;
const ROUND_WINS = 3;
const COUNTDOWN_SECONDS = 2.8;
const ROUND_TIME_LIMIT = 60;
const PLAYER_RADIUS = 0.47;
const BOT_RADIUS = 0.47;
const HEAD_HEIGHT_RATIO = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clone(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function directionFromAim(aim: CombatAim, spread = 0, seed = 0): Vec3 {
  const yaw = aim.yaw + Math.sin(seed * 12.37 + 1.2) * spread;
  const pitch = aim.pitch + Math.cos(seed * 8.31 + 0.4) * spread * 0.72;
  const horizontal = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * horizontal,
  };
}

function rayAabb(
  origin: Vec3,
  direction: Vec3,
  min: Vec3,
  max: Vec3,
  maxDistance: number,
): { distance: number; point: Vec3 } | null {
  let near = 0;
  let far = maxDistance;
  const axes: Array<[number, number, number]> = [
    [origin.x, min.x, max.x],
    [origin.y, min.y, max.y],
    [origin.z, min.z, max.z],
  ];
  const dirs = [direction.x, direction.y, direction.z];
  for (let index = 0; index < axes.length; index += 1) {
    const [value, axisMin, axisMax] = axes[index];
    const axisDirection = dirs[index];
    if (Math.abs(axisDirection) < 1e-7) {
      if (value < axisMin || value > axisMax) return null;
      continue;
    }
    let entry = (axisMin - value) / axisDirection;
    let exit = (axisMax - value) / axisDirection;
    if (entry > exit) [entry, exit] = [exit, entry];
    near = Math.max(near, entry);
    far = Math.min(far, exit);
    if (near > far || far < 0) return null;
  }
  const distance = near >= 0 ? near : far;
  if (distance < 0 || distance > maxDistance) return null;
  return {
    distance,
    point: {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    },
  };
}

function eyePosition(controller: MovementController): Vec3 {
  return {
    x: controller.position.x,
    y: controller.position.y + (controller.sliding ? controller.config.slidingEyeHeight : controller.config.eyeHeight),
    z: controller.position.z,
  };
}

function formatDamage(damage: number, headshot: boolean): string {
  return `${headshot ? 'HEADSHOT' : 'HIT'} -${Math.round(damage)}`;
}

/**
 * Headless 1v1 simulation. Both agents are MovementControllers over the same
 * CollisionWorld; combat only adds perception, weapons, health, and match state.
 */
export class CombatSimulation {
  readonly playerMovement: MovementController;
  readonly bot: BotController;
  readonly playerWeapons = new WeaponLoadout();
  readonly botWeapons = new WeaponLoadout();

  private readonly world: CollisionWorld;
  private readonly playerSpawn: SpawnPoint;
  private readonly botSpawn: SpawnPoint;
  private difficulty: BotDifficulty;
  private active = false;
  private phase: MatchPhase = 'idle';
  private countdown = 0;
  private roundTimeRemaining = ROUND_TIME_LIMIT;
  private round = 1;
  private playerScore = 0;
  private botScore = 0;
  private roundWinner: 'player' | 'bot' | null = null;
  private matchWinner: 'player' | 'bot' | null = null;
  private playerHealth = MAX_HEALTH;
  private botHealth = MAX_HEALTH;
  private time = 0;
  private summaryRemaining = 0;
  private shotIndex = 0;
  private eventId = 0;
  private event: CombatEvent | null = null;
  private eventRemaining = 0;
  private hitMarkerRemaining = 0;
  private damageFlash = 0;
  private lastBotOutput: BotOutput | null = null;

  constructor(
    world: CollisionWorld,
    playerSpawn: SpawnPoint,
    botSpawn: SpawnPoint,
    difficulty: BotDifficulty = 'expert',
  ) {
    this.world = world;
    this.playerSpawn = playerSpawn;
    this.botSpawn = botSpawn;
    this.difficulty = difficulty;
    this.playerMovement = new MovementController(world, {}, playerSpawn.position);
    this.bot = new BotController(world, botSpawn, difficulty);
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  get currentDifficulty(): BotDifficulty {
    return this.difficulty;
  }

  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
    this.bot.setDifficulty(difficulty);
  }

  beginMatch(): void {
    this.active = true;
    this.round = 1;
    this.playerScore = 0;
    this.botScore = 0;
    this.matchWinner = null;
    this.time = 0;
    this.shotIndex = 0;
    this.bot.resetMatch(this.botSpawn);
    this.startRound();
    this.publishEvent('ROUND 1 / FIGHT', 'round');
  }

  stopMatch(): void {
    this.active = false;
    this.phase = 'idle';
    this.playerMovement.reset(this.playerSpawn.position);
    this.bot.resetRound(this.botSpawn);
  }

  nextRound(): void {
    if (!this.active) return;
    if (this.phase === 'matchSummary') {
      this.beginMatch();
      return;
    }
    if (this.phase !== 'roundSummary') return;
    this.round += 1;
    this.startRound();
    this.publishEvent(`ROUND ${this.round} / FIGHT`, 'round');
  }

  step(
    dt: number,
    movementInput: MovementInput,
    playerAim: CombatAim,
    combatInput: CombatInput = EMPTY_COMBAT_INPUT,
  ): CombatStepResult {
    const result: CombatStepResult = {
      playerShot: null,
      botShot: null,
      botOutput: this.lastBotOutput,
    };
    if (!this.active) return result;

    this.time += dt;
    this.eventRemaining = Math.max(0, this.eventRemaining - dt);
    if (this.eventRemaining === 0) this.event = null;
    this.hitMarkerRemaining = Math.max(0, this.hitMarkerRemaining - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.playerWeapons.update(dt);
    this.botWeapons.update(dt);

    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 0) {
        this.phase = 'fight';
        this.publishEvent('FIGHT', 'round');
      }
      return result;
    }
    if (this.phase !== 'fight') {
      this.summaryRemaining = Math.max(0, this.summaryRemaining - dt);
      return result;
    }

    this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - dt);
    if (this.roundTimeRemaining <= 0) {
      this.finishRound(this.playerHealth >= this.botHealth ? 'player' : 'bot');
      return result;
    }

    if (combatInput.weaponSlot) this.playerWeapons.switchTo(combatInput.weaponSlot);
    if (combatInput.reloadPressed) this.playerWeapons.requestReload();
    if (combatInput.fireHeld && this.playerWeapons.active.ammo === 0) {
      this.playerWeapons.requestReload();
    }

    this.playerMovement.step(movementInput, dt, playerAim.yaw);
    this.lastBotOutput = this.bot.update(
      dt,
      this.time,
      this.playerMovement,
      this.playerHealth,
      this.botWeapons.activeDefinition,
      this.botHealth,
    );
    result.botOutput = this.lastBotOutput;
    this.botWeapons.switchTo(this.lastBotOutput.decision.desiredWeapon);
    if (this.botWeapons.active.ammo === 0 || (!this.lastBotOutput.decision.wantsFire && this.botWeapons.active.ammo < 3)) {
      this.botWeapons.requestReload();
    }

    if (combatInput.fireHeld && this.playerHealth > 0 && this.botHealth > 0) {
      const weapon = this.playerWeapons.tryFire();
      if (weapon) {
        result.playerShot = this.resolveShot(
          'player',
          this.playerMovement,
          this.bot.movement,
          playerAim,
          weapon,
          this.shotIndex++,
        );
        this.handleShotResult(result.playerShot, weapon);
      }
    }

    if (
      this.lastBotOutput.decision.wantsFire &&
      this.lastBotOutput.aim.confidence > 0 &&
      this.playerHealth > 0 &&
      this.botHealth > 0
    ) {
      const weapon = this.botWeapons.tryFire();
      if (weapon) {
        result.botShot = this.resolveShot(
          'bot',
          this.bot.movement,
          this.playerMovement,
          {
            yaw: this.lastBotOutput.aim.yaw,
            pitch: this.lastBotOutput.aim.pitch,
          },
          weapon,
          this.shotIndex++,
          this.lastBotOutput.profile.aimQuality,
        );
        this.handleShotResult(result.botShot, weapon);
      }
    }

    // Player movement is intentionally stepped before weapon resolution so a
    // shot never rewrites movement state.
    return result;
  }

  getSnapshot(): CombatSnapshot {
    const botOutput = this.lastBotOutput;
    return {
      phase: this.phase,
      round: this.round,
      playerScore: this.playerScore,
      botScore: this.botScore,
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      countdown: this.countdown,
      roundTimeRemaining: this.roundTimeRemaining,
      playerHealth: this.playerHealth,
      botHealth: this.botHealth,
      playerWeapon: this.playerWeapons.activeId,
      playerAmmo: this.playerWeapons.active.ammo,
      playerReserve: this.playerWeapons.active.reserve,
      playerReloading: this.playerWeapons.active.reloadRemaining > 0,
      botWeapon: this.botWeapons.activeId,
      botTacticalState: botOutput?.decision.state ?? 'searching',
      botVisible: botOutput?.perception.visible ?? false,
      botDistance: botOutput?.perception.distance ?? Infinity,
      event: this.event,
      hitMarker: this.hitMarkerRemaining > 0,
      damageFlash: this.damageFlash,
      difficulty: this.difficulty,
    };
  }

  getPlayerEye(): Vec3 {
    return eyePosition(this.playerMovement);
  }

  getBotEye(): Vec3 {
    return eyePosition(this.bot.movement);
  }

  private startRound(): void {
    this.playerMovement.reset(this.playerSpawn.position);
    this.bot.resetRound(this.botSpawn);
    this.playerWeapons.reset();
    this.botWeapons.reset();
    this.playerHealth = MAX_HEALTH;
    this.botHealth = MAX_HEALTH;
    this.roundWinner = null;
    this.countdown = COUNTDOWN_SECONDS;
    this.roundTimeRemaining = ROUND_TIME_LIMIT;
    this.summaryRemaining = 0;
    this.phase = 'countdown';
    this.lastBotOutput = null;
    this.damageFlash = 0;
    this.hitMarkerRemaining = 0;
  }

  private resolveShot(
    attacker: 'player' | 'bot',
    attackerMovement: MovementController,
    targetMovement: MovementController,
    aim: CombatAim,
    weapon: WeaponDefinition,
    shotIndex: number,
    botAimQuality = 1,
  ): ShotResult {
    const origin = eyePosition(attackerMovement);
    const spread = attacker === 'bot'
      ? weapon.spread * (1.3 - botAimQuality * 0.4)
      : weapon.spread * 0.36;
    const direction = directionFromAim(aim, spread, shotIndex + (attacker === 'bot' ? 4 : 0));
    const wallHit = this.world.raycast(origin, direction, weapon.range);
    const actorHit = rayAabb(
      origin,
      direction,
      {
        x: targetMovement.position.x - (attacker === 'player' ? BOT_RADIUS : PLAYER_RADIUS),
        y: targetMovement.position.y,
        z: targetMovement.position.z - (attacker === 'player' ? BOT_RADIUS : PLAYER_RADIUS),
      },
      {
        x: targetMovement.position.x + (attacker === 'player' ? BOT_RADIUS : PLAYER_RADIUS),
        y: targetMovement.position.y + targetMovement.getCollisionHeight(),
        z: targetMovement.position.z + (attacker === 'player' ? BOT_RADIUS : PLAYER_RADIUS),
      },
      weapon.range,
    );
    const blocked = wallHit && actorHit && wallHit.distance < actorHit.distance - 0.025;
    const hit = Boolean(actorHit && !blocked);
    const targetHeight = targetMovement.getCollisionHeight();
    const headshot = hit && actorHit
      ? actorHit.point.y >= targetMovement.position.y + targetHeight * HEAD_HEIGHT_RATIO
      : false;
    const damage = hit
      ? weapon.damage * (headshot ? weapon.headMultiplier : 1)
      : 0;
    const point = hit
      ? actorHit?.point ?? null
      : wallHit?.point ?? null;
    return {
      fired: true,
      hit,
      headshot,
      damage,
      point,
      targetId: hit ? (attacker === 'player' ? 'bot' : 'player') : null,
      blockerId: blocked || (!hit && wallHit) ? wallHit?.colliderId ?? null : null,
      direction,
    };
  }

  private handleShotResult(result: ShotResult, weapon: WeaponDefinition): void {
    if (!result.fired) return;
    if (!result.hit || !result.targetId) return;
    if (result.targetId === 'bot') {
      this.botHealth = clamp(this.botHealth - result.damage, 0, MAX_HEALTH);
      this.hitMarkerRemaining = 0.1;
      this.publishEvent(formatDamage(result.damage, result.headshot), 'hit');
      if (this.botHealth <= 0) this.finishRound('player');
    } else {
      this.playerHealth = clamp(this.playerHealth - result.damage, 0, MAX_HEALTH);
      this.damageFlash = Math.min(1, this.damageFlash + 0.72);
      this.publishEvent(`BOT ${formatDamage(result.damage, result.headshot)}`, 'damage');
      this.bot.noteDamage(this.time);
      if (this.playerHealth <= 0) this.finishRound('bot');
    }
    void weapon;
  }

  private finishRound(winner: 'player' | 'bot'): void {
    if (this.phase !== 'fight') return;
    this.roundWinner = winner;
    if (winner === 'player') this.playerScore += 1;
    else this.botScore += 1;
    const matchWinner = this.playerScore >= ROUND_WINS
      ? 'player'
      : this.botScore >= ROUND_WINS
        ? 'bot'
        : null;
    this.matchWinner = matchWinner;
    this.phase = matchWinner ? 'matchSummary' : 'roundSummary';
    this.summaryRemaining = 2.5;
    this.publishEvent(
      matchWinner
        ? `${matchWinner === 'player' ? 'MATCH WON' : 'MATCH LOST'} / ${this.playerScore}-${this.botScore}`
        : `${winner === 'player' ? 'ROUND WON' : 'ROUND LOST'} / ${this.playerScore}-${this.botScore}`,
      'round',
    );
  }

  private publishEvent(text: string, kind: CombatEvent['kind']): void {
    this.eventId += 1;
    this.event = { id: this.eventId, text, kind };
    this.eventRemaining = 1.4;
  }
}
