import type {
  MovementInput,
  MovementSnapshot,
  Vec3,
} from '../movement/MovementTypes';

export type WeaponId = 'carbine' | 'sidearm';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  shortName: string;
  damage: number;
  headMultiplier: number;
  fireInterval: number;
  magazineSize: number;
  reserveSize: number;
  reloadTime: number;
  range: number;
  spread: number;
  recoilPitch: number;
  recoilYaw: number;
}

export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  carbine: {
    id: 'carbine',
    name: 'Vector Carbine',
    shortName: 'CARBINE',
    damage: 18,
    headMultiplier: 1.35,
    fireInterval: 0.105,
    magazineSize: 24,
    reserveSize: 96,
    reloadTime: 1.35,
    range: 120,
    spread: 0.004,
    recoilPitch: 0.008,
    recoilYaw: 0.0024,
  },
  sidearm: {
    id: 'sidearm',
    name: 'Pulse Sidearm',
    shortName: 'SIDEARM',
    damage: 34,
    headMultiplier: 1.45,
    fireInterval: 0.28,
    magazineSize: 8,
    reserveSize: 48,
    reloadTime: 1.05,
    range: 100,
    spread: 0.0025,
    recoilPitch: 0.014,
    recoilYaw: 0.004,
  },
};

export interface WeaponState {
  weaponId: WeaponId;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadRemaining: number;
}

export interface CombatInput {
  fireHeld: boolean;
  aimHeld: boolean;
  reloadPressed: boolean;
  weaponSlot: WeaponId | null;
}

export type BotDifficulty = 'easy' | 'skilled' | 'expert' | 'elite' | 'rival';

export interface BotDifficultyProfile {
  label: string;
  reactionTime: number;
  aimTurnSpeed: number;
  aimQuality: number;
  aimJitter: number;
  fireCone: number;
  decisionInterval: number;
  predictionLead: number;
  movementQuality: number;
  tacticalRisk: number;
  adaptationSamples: number;
}

export const BOT_DIFFICULTIES: Record<BotDifficulty, BotDifficultyProfile> = {
  easy: {
    label: 'EASY',
    reactionTime: 0.48,
    aimTurnSpeed: 4.2,
    aimQuality: 0.46,
    aimJitter: 0.05,
    fireCone: 0.055,
    decisionInterval: 0.24,
    predictionLead: 0.02,
    movementQuality: 0.38,
    tacticalRisk: 0.22,
    adaptationSamples: 14,
  },
  skilled: {
    label: 'SKILLED',
    reactionTime: 0.3,
    aimTurnSpeed: 6.6,
    aimQuality: 0.67,
    aimJitter: 0.032,
    fireCone: 0.04,
    decisionInterval: 0.15,
    predictionLead: 0.045,
    movementQuality: 0.62,
    tacticalRisk: 0.38,
    adaptationSamples: 10,
  },
  expert: {
    label: 'EXPERT',
    reactionTime: 0.2,
    aimTurnSpeed: 9.2,
    aimQuality: 0.8,
    aimJitter: 0.022,
    fireCone: 0.031,
    decisionInterval: 0.105,
    predictionLead: 0.065,
    movementQuality: 0.78,
    tacticalRisk: 0.5,
    adaptationSamples: 8,
  },
  elite: {
    label: 'ELITE',
    reactionTime: 0.135,
    aimTurnSpeed: 12.5,
    aimQuality: 0.9,
    aimJitter: 0.014,
    fireCone: 0.024,
    decisionInterval: 0.08,
    predictionLead: 0.085,
    movementQuality: 0.9,
    tacticalRisk: 0.62,
    adaptationSamples: 7,
  },
  rival: {
    label: 'RIVAL',
    reactionTime: 0.09,
    aimTurnSpeed: 15.5,
    aimQuality: 0.95,
    aimJitter: 0.009,
    fireCone: 0.019,
    decisionInterval: 0.06,
    predictionLead: 0.105,
    movementQuality: 0.96,
    tacticalRisk: 0.7,
    adaptationSamples: 6,
  },
};

export interface AimState {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  confidence: number;
  tracking: boolean;
}

export type BotTacticalState =
  | 'searching'
  | 'approaching'
  | 'engaging'
  | 'strafing'
  | 'retreating'
  | 'taking-cover'
  | 'repositioning';

export interface PerceptionResult {
  time: number;
  visible: boolean;
  distance: number;
  horizontalDistance: number;
  relativeElevation: number;
  targetPosition: Vec3;
  targetVelocity: Vec3;
  targetGrounded: boolean;
  targetSliding: boolean;
  targetSprinting: boolean;
  blockerId: string | null;
  lastKnownPosition: Vec3 | null;
  secondsSinceSight: number;
}

export interface BotDecision {
  state: BotTacticalState;
  movement: MovementInput;
  moveYaw: number;
  desiredWeapon: WeaponId;
  wantsFire: boolean;
  reason: string;
}

export interface CombatEvent {
  id: number;
  text: string;
  kind: 'hit' | 'damage' | 'round' | 'system';
}

export type MatchPhase =
  | 'idle'
  | 'countdown'
  | 'fight'
  | 'roundSummary'
  | 'matchSummary';

export interface CombatSnapshot {
  phase: MatchPhase;
  round: number;
  playerScore: number;
  botScore: number;
  roundWinner: 'player' | 'bot' | null;
  matchWinner: 'player' | 'bot' | null;
  countdown: number;
  roundTimeRemaining: number;
  playerHealth: number;
  botHealth: number;
  playerWeapon: WeaponId;
  playerAmmo: number;
  playerReserve: number;
  playerReloading: boolean;
  botWeapon: WeaponId;
  botTacticalState: BotTacticalState;
  botVisible: boolean;
  botDistance: number;
  event: CombatEvent | null;
  hitMarker: boolean;
  damageFlash: number;
  difficulty: BotDifficulty;
}

export interface CombatAgentState {
  id: 'player' | 'bot';
  position: Vec3;
  movement: MovementSnapshot;
  health: number;
  eyePosition: Vec3;
}

export interface CombatAim {
  yaw: number;
  pitch: number;
}

export interface ShotResult {
  fired: boolean;
  hit: boolean;
  headshot: boolean;
  damage: number;
  point: Vec3 | null;
  targetId: 'player' | 'bot' | null;
  blockerId: string | null;
  direction: Vec3;
}

export const EMPTY_COMBAT_INPUT: CombatInput = {
  fireHeld: false,
  aimHeld: false,
  reloadPressed: false,
  weaponSlot: null,
};

export function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}
