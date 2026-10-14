// Central tuning. All units are metres and seconds.

export const PLAYER = {
  radius: 0.35,
  standHeight: 1.8,
  slideHeight: 0.9,
  eyeStand: 1.6,
  eyeSlide: 0.75,
  maxHp: 100,
  stepHeight: 0.55,
} as const;

export const MOVE = {
  gravity: 26,
  jumpVelocity: 8.4,
  /** releasing jump early cuts upward velocity for variable jump height */
  jumpCutMult: 0.42,
  /** holding jump auto-hops on landing (bunny-hop friendly) */
  autoHop: true,
  /** jump still works briefly after walking off a ledge */
  coyoteTime: 0.12,
  runSpeed: 7.4,
  groundAccel: 62,
  groundFriction: 7,
  airAccel: 42,
  airWishCap: 8,
  slideMinSpeed: 6,
  slideStartBoost: 1.8,
  slideMaxStart: 11.5,
  slideFriction: 1.2,
  slideAccel: 4.5,
  slideEndSpeed: 3.2,
  slideMaxTime: 1.8,
  slideJumpWindow: 0.2,
  slideJumpMult: 1.14,
  slideJumpCap: 14.5,
  slideJumpVelBonus: 1.05,
  jumpBuffer: 0.12,
} as const;

export const SCYTHE = {
  range: 2.4,
  arcDeg: 110,
  damage: 45,
  swingTime: 0.35,
  swingCooldown: 0.45,
  hitWindowStart: 0.08,
  hitWindowEnd: 0.22,
  dashSpeed: 22,
  dashTime: 0.16,
  dashCooldown: 2.5,
  dashDamage: 30,
  dashHitRange: 1.6,
} as const;

/** Katana: faster, longer slash. Right click deflects incoming shots and reflects them. */
export const KATANA = {
  range: 2.7,
  arcDeg: 140,
  damage: 40,
  swingTime: 0.3,
  swingCooldown: 0.35,
  hitWindowStart: 0.06,
  hitWindowEnd: 0.18,
  deflectTime: 0.35,
  deflectCooldown: 3,
  reflectMult: 0.75,
} as const;

export type MeleeId = 'scythe' | 'katana';

export interface MeleeDef {
  range: number;
  arcDeg: number;
  damage: number;
  swingTime: number;
  swingCooldown: number;
  hitWindowStart: number;
  hitWindowEnd: number;
}

export const MELEE: Record<MeleeId, MeleeDef> = { scythe: SCYTHE, katana: KATANA };

/** F quick melee: a short melee attack, then the previous gun comes back. */
export const QUICK_MELEE = { duration: 0.6 } as const;

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'ak' | 'puma';

export const WEAPON_IDS: WeaponId[] = ['pistol', 'smg', 'rifle', 'ak', 'puma'];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** display class, e.g. 'ASSAULT RIFLE' */
  type: string;
  /** ideal engagement distance used by the bot AI */
  rangePref: number;
  damage: number;
  headMult: number;
  fireInterval: number; // seconds between shots
  auto: boolean;
  burst: number; // shots per trigger pull (1 = normal)
  magSize: number;
  reloadTime: number;
  spread: number; // radians of max cone
  recoil: number; // view kick in radians
  range: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'SIDEARM', type: 'PISTOL', rangePref: 8, damage: 24, headMult: 1.6, fireInterval: 0.22,
    auto: false, burst: 1, magSize: 12, reloadTime: 1.1, spread: 0.004, recoil: 0.03, range: 120,
  },
  smg: {
    id: 'smg', name: 'VECTOR SMG', type: 'SMG', rangePref: 6, damage: 13, headMult: 1.5, fireInterval: 0.085,
    auto: true, burst: 1, magSize: 30, reloadTime: 1.6, spread: 0.02, recoil: 0.012, range: 90,
  },
  rifle: {
    id: 'rifle', name: 'MARKSMAN RIFLE', type: 'BURST RIFLE', rangePref: 14, damage: 22, headMult: 2.0, fireInterval: 0.55,
    auto: false, burst: 3, magSize: 18, reloadTime: 2.0, spread: 0.006, recoil: 0.05, range: 200,
  },
  // Full-auto assault rifle: hard-hitting, moderate rate, strong recoil.
  ak: {
    id: 'ak', name: 'BRUTE-47', type: 'ASSAULT RIFLE', rangePref: 11, damage: 26, headMult: 1.7, fireInterval: 0.1,
    auto: true, burst: 1, magSize: 30, reloadTime: 2.1, spread: 0.013, recoil: 0.032, range: 160,
  },
  // Run-and-gun SMG: fastest fire rate, big mag, forgiving but weak per bullet.
  puma: {
    id: 'puma', name: 'PANTHER', type: 'RUN-AND-GUN SMG', rangePref: 6, damage: 11, headMult: 1.5, fireInterval: 0.062,
    auto: true, burst: 1, magSize: 34, reloadTime: 1.35, spread: 0.026, recoil: 0.01, range: 70,
  },
};

export const BOT_DIFFICULTY = {
  easy: { reaction: 0.55, aimError: 0.14, accuracy: 0.35, speedMult: 0.85, strafeChance: 0.2, slideChance: 0.05, dashChance: 0.1, meleeChance: 0.15 },
  normal: { reaction: 0.35, aimError: 0.08, accuracy: 0.55, speedMult: 0.95, strafeChance: 0.4, slideChance: 0.15, dashChance: 0.25, meleeChance: 0.3 },
  hard: { reaction: 0.22, aimError: 0.045, accuracy: 0.7, speedMult: 1.0, strafeChance: 0.6, slideChance: 0.3, dashChance: 0.4, meleeChance: 0.45 },
  nightmare: { reaction: 0.14, aimError: 0.02, accuracy: 0.85, speedMult: 1.0, strafeChance: 0.75, slideChance: 0.45, dashChance: 0.55, meleeChance: 0.6 },
} as const;

export type Difficulty = keyof typeof BOT_DIFFICULTY;

export const MATCH = {
  rounds: 5,
  roundTime: 90,
  intermission: 2.5,
  respawnDelay: 1.2,
  mouseSens: 0.0022,
} as const;
