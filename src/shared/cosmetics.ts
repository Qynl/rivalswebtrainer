/**
 * Cosmetics, coins and levels.
 *
 * Hard rule: nothing in this file touches gameplay. Every skin is a set of
 * colours and one pattern id; the rifle still cycles in 1.15 s, the claw still
 * flies at the same speed, and the scoreboard cannot tell who paid. A player
 * who has bought everything has exactly the same duel as a player with nothing.
 *
 * Progression lives on the client (localStorage) because there is no account
 * system: coins are a personal trophy case, not an authority. The server only
 * ever accepts a cosmetic id and echoes it to the opponent, after checking it
 * against the catalogue below.
 */

export type CosmeticKind = 'gun' | 'grapple' | 'effect';
/**
 * The moving part of a skin. Colours alone are a paint job; these three knobs
 * are what make a rifle look *owned* — a light band that runs down the
 * receiver, an inlay that breathes, and one decorative part that keeps moving
 * while you are standing still.
 */
export interface SkinAnim {
  /** Light band travel, in bands per second (0 = no band). */
  sweep: number;
  /** Breathing rate of the emissive inlay, Hz (0 = steady). */
  pulse: number;
  /** Steady emissive strength of the inlay and optic glass. */
  glow: number;
  /** The ornament that keeps moving at rest. */
  orbit: 'none' | 'ring' | 'motes' | 'vent' | 'coil' | 'shards';
}
export type Tier = 'field' | 'precision' | 'signature';
export type Pattern = 'solid' | 'carbon' | 'camo' | 'marble' | 'flake' | 'plate';

export interface GunSkin {
  kind: 'gun';
  id: string;
  name: string;
  price: number;
  tier: Tier;
  blurb: string;
  /** Receiver / handguard colour. */
  body: number;
  /** Stock, grip and polymer furniture. */
  panel: number;
  /** Barrel, bolt and optic body. */
  metal: number;
  /** Accent stripe and small machined details. */
  trim: number;
  /** Optic glass and any glowing inlay. */
  glow: number;
  pattern: Pattern;
  anim: SkinAnim;
}

export interface GrappleSkin {
  kind: 'grapple';
  id: string;
  name: string;
  price: number;
  tier: Tier;
  blurb: string;
  /** Cable colour. */
  rope: number;
  /** Claw and shackle metal. */
  claw: number;
  /** Launcher body. */
  body: number;
  /** Drum, guides and other machined parts. */
  spool: number;
  /** Spark / trail colour while the claw is in the air. */
  trail: number;
  /** How the claw reads in flight: a lit core, a shed stream, or both. */
  anim: SkinAnim;
  /**
   * Claw silhouette. Cosmetics may change the shape of the head — it is the
   * same projectile with the same reach and the same bite — but never its size
   * class or its hit geometry.
   */
  clawShape: 'tri' | 'quad' | 'twin' | 'ring';
}

export interface KillEffect {
  kind: 'effect';
  id: string;
  name: string;
  price: number;
  tier: Tier;
  blurb: string;
  /** Particle burst colour. */
  burst: number;
  /** Expanding ring colour. */
  ring: number;
  /** Second particle colour, used for the slower motes. */
  motes: number;
  /** Which procedural sound the kill plays. */
  sound: 'shatter' | 'bloom' | 'pulse' | 'sting';
  /** Which geometry the burst uses. */
  shape: KillShape;
}

/**
 * Kill effects are not recolours of one burst: each has its own geometry.
 * spark  — fast hot spray
 * shard  — tumbling crystal fragments
 * petal  — thin plates that open outward and fall
 * arc    — electric forks between points around the body
 * star   — a white core, then a slow wide ring
 */
export type KillShape = 'spark' | 'shard' | 'petal' | 'arc' | 'star';

export type Cosmetic = GunSkin | GrappleSkin | KillEffect;

const gun = (s: Omit<GunSkin, 'kind'>): GunSkin => ({ kind: 'gun', ...s });
const rope = (s: Omit<GrappleSkin, 'kind'>): GrappleSkin => ({ kind: 'grapple', ...s });
const fx = (s: Omit<KillEffect, 'kind'>): KillEffect => ({ kind: 'effect', ...s });

export const GUN_SKINS: GunSkin[] = [
  gun({
    id: 'service',
    name: 'SERVICE ISSUE',
    price: 0,
    tier: 'field',
    blurb: 'Sand furniture, blued steel. Drawn from the armoury and never cleaned.',
    body: 0xa78e5b,
    panel: 0x24272c,
    metal: 0x33383f,
    trim: 0xc9a86a,
    glow: 0x223a4a,
    pattern: 'solid',
    anim: { sweep: 0, pulse: 0, glow: 0.15, orbit: 'none' },
  }),
  gun({
    id: 'carbon',
    name: 'CARBON WEAVE',
    price: 600,
    tier: 'field',
    blurb: 'Woven carbon over a graphite chassis. Light in the hand, quiet in the light.',
    body: 0x2b2f36,
    panel: 0x191c21,
    metal: 0x4a4f57,
    trim: 0x8fa3b8,
    glow: 0x2a4a62,
    pattern: 'carbon',
    anim: { sweep: 0.55, pulse: 0, glow: 0.35, orbit: 'none' },
  }),
  gun({
    id: 'sandstorm',
    name: 'SANDSTORM',
    price: 750,
    tier: 'precision',
    blurb: 'Three-tone desert paint, worn through on every corner that touches a wall.',
    body: 0xc2a76b,
    panel: 0x6a5b43,
    metal: 0x3d423f,
    trim: 0xd8c08a,
    glow: 0x3d5240,
    pattern: 'camo',
    anim: { sweep: 0, pulse: 0.35, glow: 0.2, orbit: 'motes' },
  }),
  gun({
    id: 'viper',
    name: 'VIPER',
    price: 1150,
    tier: 'field',
    blurb: 'Olive drab over a green-shifted chassis. Built to disappear against moss and shadow.',
    body: 0x5c6440,
    panel: 0x2c3126,
    metal: 0x3a3f34,
    trim: 0x9aa86a,
    glow: 0x2f4a2a,
    pattern: 'camo',
    anim: { sweep: 0.35, pulse: 0.2, glow: 0.3, orbit: 'motes' },
  }),
  gun({
    id: 'ivory',
    name: 'IVORY ROUND',
    price: 900,
    tier: 'precision',
    blurb: 'Bone polymer and polished brass. A duelling pistol in rifle clothing.',
    body: 0xe4ddcd,
    panel: 0x2a2a2c,
    metal: 0x8d8574,
    trim: 0xd7b977,
    glow: 0x35506a,
    pattern: 'plate',
    anim: { sweep: 0.8, pulse: 0.2, glow: 0.3, orbit: 'motes' },
  }),
  gun({
    id: 'frostline',
    name: 'FROSTLINE',
    price: 1850,
    tier: 'precision',
    blurb: 'Glacier polymer under a coral-blue inlay. Cold enough that the barrel fogs.',
    body: 0xc8d6df,
    panel: 0x1d2a33,
    metal: 0x7d8f9b,
    trim: 0xbcdcea,
    glow: 0x5fc8e6,
    pattern: 'plate',
    anim: { sweep: 1.15, pulse: 0.35, glow: 0.95, orbit: 'shards' },
  }),
  gun({
    id: 'obsidian',
    name: 'OBSIDIAN',
    price: 1400,
    tier: 'signature',
    blurb: 'Blacked-out chassis with a gold bore. Built for the player who never misses twice.',
    body: 0x14161a,
    panel: 0x0b0d10,
    metal: 0x2a2e34,
    trim: 0xd8b063,
    glow: 0x6b4a1c,
    pattern: 'flake',
    anim: { sweep: 1.35, pulse: 1.1, glow: 0.85, orbit: 'vent' },
  }),
  gun({
    id: 'aurum',
    name: 'AURUM',
    price: 2600,
    tier: 'signature',
    blurb: 'Hand-cut gold leaf over marble. Objectively excessive. Emotionally correct.',
    body: 0xd9c08a,
    panel: 0x3a3126,
    metal: 0xe8d7a8,
    trim: 0xfff0c4,
    glow: 0x8a5a12,
    pattern: 'marble',
    anim: { sweep: 1.8, pulse: 0.55, glow: 1.15, orbit: 'ring' },
  }),
];

export const GRAPPLE_SKINS: GrappleSkin[] = [
  rope({
    id: 'brass',
    name: 'BRASS LINE',
    price: 0,
    tier: 'field',
    blurb: 'The issue rig: brass claw, tarred cable, a drum that has seen weather.',
    rope: 0x2a2f36,
    claw: 0xc9a86a,
    body: 0x3f434a,
    spool: 0x2a2d33,
    trail: 0xffe0a8,
    anim: { sweep: 0, pulse: 0.4, glow: 0.3, orbit: 'none' },
    clawShape: 'tri',
  }),
  rope({
    id: 'steel',
    name: 'COLD STEEL',
    price: 400,
    tier: 'field',
    blurb: 'Gunmetal claw and a cable that disappears in grey light.',
    rope: 0x8d99a6,
    claw: 0xb8c2cc,
    body: 0x53585f,
    spool: 0x3a3f45,
    trail: 0xd8e6f2,
    anim: { sweep: 0.9, pulse: 0, glow: 0.4, orbit: 'none' },
    clawShape: 'quad',
  }),
  rope({
    id: 'ember',
    name: 'EMBER COIL',
    price: 800,
    tier: 'precision',
    blurb: 'Copper claw, cinder cable, and a spark that stays in the air a beat too long.',
    rope: 0x8a4a2c,
    claw: 0xd98a4a,
    body: 0x4a2f24,
    spool: 0x33211a,
    trail: 0xffa860,
    anim: { sweep: 1.6, pulse: 1.6, glow: 0.9, orbit: 'coil' },
    clawShape: 'twin',
  }),
  rope({
    id: 'glacier',
    name: 'GLACIER',
    price: 1100,
    tier: 'precision',
    blurb: 'Pale steel and a cable that reads white against the sky. Nothing hides.',
    rope: 0xd6e6f0,
    claw: 0xe8f2f8,
    body: 0x9aa8b4,
    spool: 0x6d7b88,
    trail: 0xc9ecff,
    anim: { sweep: 1.1, pulse: 0.5, glow: 0.6, orbit: 'shards' },
    clawShape: 'quad',
  }),
  rope({
    id: 'patina',
    name: 'PATINA',
    price: 1800,
    tier: 'precision',
    blurb: 'Verdigris brass that has been in the sea. The cable smells of rope and copper.',
    rope: 0x4a7a68,
    claw: 0x7fc4a8,
    body: 0x2f5148,
    spool: 0x1f3a34,
    trail: 0xa8f0d2,
    anim: { sweep: 0.8, pulse: 0.8, glow: 0.75, orbit: 'shards' },
    clawShape: 'ring',
  }),
  rope({
    id: 'abyss',
    name: 'ABYSS LINE',
    price: 1600,
    tier: 'signature',
    blurb: 'Black brine cord and a claw that looks like it came out of a shipwreck.',
    rope: 0x1d2a2c,
    claw: 0x3f6f6a,
    body: 0x18221f,
    spool: 0x101817,
    trail: 0x74e0cf,
    anim: { sweep: 0.6, pulse: 0.9, glow: 0.7, orbit: 'coil' },
    clawShape: 'twin',
  }),
  rope({
    id: 'gilded',
    name: 'GILDED HAUL',
    price: 2200,
    tier: 'signature',
    blurb: 'Gold shackle, silk-wrapped cable. The most expensive way to fall off a map.',
    rope: 0xd8b063,
    claw: 0xffe6a8,
    body: 0x5a4620,
    spool: 0x3d2f14,
    trail: 0xffd88a,
    anim: { sweep: 2.1, pulse: 0.7, glow: 1.2, orbit: 'ring' },
    clawShape: 'ring',
  }),
];

export const KILL_EFFECTS: KillEffect[] = [
  fx({
    id: 'spark',
    name: 'SPARK BURST',
    price: 0,
    tier: 'field',
    blurb: 'The standard: a short hot spray where they stood.',
    burst: 0xffe0a8,
    ring: 0xe6b264,
    motes: 0xffffff,
    sound: 'sting',
    shape: 'spark',
  }),
  fx({
    id: 'shatter',
    name: 'SHATTER',
    price: 500,
    tier: 'field',
    blurb: 'They come apart like glass and the ring cracks outward.',
    burst: 0xeaf4ff,
    ring: 0xa8ccf0,
    motes: 0xffffff,
    sound: 'shatter',
    shape: 'shard',
  }),
  fx({
    id: 'bloom',
    name: 'SUNBLOOM',
    price: 900,
    tier: 'precision',
    blurb: 'A gold flower opens where the shot landed, and closes again.',
    burst: 0xffd27a,
    ring: 0xffa040,
    motes: 0xfff0c0,
    sound: 'bloom',
    shape: 'petal',
  }),
  fx({
    id: 'static',
    name: 'STATIC DISCHARGE',
    price: 1200,
    tier: 'precision',
    blurb: 'Everything in the air goes white and sharp for a quarter of a second.',
    burst: 0xbfeaff,
    ring: 0x5bc8e8,
    motes: 0xffffff,
    sound: 'pulse',
    shape: 'arc',
  }),
  fx({
    id: 'ash',
    name: 'ASHFALL',
    price: 1800,
    tier: 'precision',
    blurb: 'They burn down to grey petals, and the flakes keep falling after the ring is gone.',
    burst: 0xcfc7bb,
    ring: 0x9a938a,
    motes: 0xffe6c4,
    sound: 'bloom',
    shape: 'petal',
  }),
  fx({
    id: 'prism',
    name: 'PRISM BREAK',
    price: 2400,
    tier: 'signature',
    blurb: 'Light splits off the body in six forks and every one lands a different colour.',
    burst: 0xd8f0ff,
    ring: 0xff9ad8,
    motes: 0x9af0ff,
    sound: 'pulse',
    shape: 'arc',
  }),
  fx({
    id: 'nova',
    name: 'NOVA',
    price: 2000,
    tier: 'signature',
    blurb: 'A white star, then a slow gold ring that the whole map can read.',
    burst: 0xffffff,
    ring: 0xffd27a,
    motes: 0xffe0a0,
    sound: 'bloom',
    shape: 'star',
  }),
];

export const CATALOGUE: Record<CosmeticKind, Cosmetic[]> = {
  gun: GUN_SKINS,
  grapple: GRAPPLE_SKINS,
  effect: KILL_EFFECTS,
};

export interface Loadout {
  gun: string;
  grapple: string;
  effect: string;
}

/** Everyone starts here; the store can never leave you empty-handed. */
export const DEFAULT_LOADOUT: Loadout = { gun: 'service', grapple: 'brass', effect: 'spark' };

export function cosmeticsOf(kind: CosmeticKind): Cosmetic[] {
  return CATALOGUE[kind];
}

export function cosmeticById(kind: CosmeticKind, id: string): Cosmetic | undefined {
  return CATALOGUE[kind].find((c) => c.id === id);
}

export function gunSkin(id: string): GunSkin {
  return (cosmeticById('gun', id) as GunSkin | undefined) ?? GUN_SKINS[0];
}

export function grappleSkin(id: string): GrappleSkin {
  return (cosmeticById('grapple', id) as GrappleSkin | undefined) ?? GRAPPLE_SKINS[0];
}

export function killEffect(id: string): KillEffect {
  return (cosmeticById('effect', id) as KillEffect | undefined) ?? KILL_EFFECTS[0];
}

/**
 * Anything arriving from a client is a claim, not a fact. Unknown ids fall back
 * to the default set instead of becoming an error the opponent can trigger.
 */
export function sanitizeLoadout(input: unknown): Loadout {
  const raw = (input ?? {}) as Partial<Record<keyof Loadout, unknown>>;
  const pick = (kind: CosmeticKind, value: unknown, fallback: string): string =>
    typeof value === 'string' && cosmeticById(kind, value) ? value : fallback;
  return {
    gun: pick('gun', raw.gun, DEFAULT_LOADOUT.gun),
    grapple: pick('grapple', raw.grapple, DEFAULT_LOADOUT.grapple),
    effect: pick('effect', raw.effect, DEFAULT_LOADOUT.effect),
  };
}

// ── Economy ────────────────────────────────────────────────────────────────

export const ECONOMY = {
  /** Coins and experience for a single kill. */
  killCoins: 25,
  killXp: 30,
  winCoins: 140,
  winXp: 120,
  lossCoins: 45,
  lossXp: 45,
  drawCoins: 80,
  drawXp: 70,
  /** Coins paid out on reaching a new level. */
  levelCoins: 120,
  /** Levels exist to pace the store, not to gate anything. */
  maxLevel: 40,
} as const;

/** Experience needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 240 + (Math.max(1, level) - 1) * 160;
}

export interface LevelState {
  level: number;
  /** Experience inside the current level. */
  into: number;
  /** Experience the current level needs in total. */
  need: number;
  /** 0..1 for the HUD bar. */
  fraction: number;
}

export function levelFromXp(xp: number): LevelState {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  while (level < ECONOMY.maxLevel && remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  const need = xpForLevel(level);
  const into = level >= ECONOMY.maxLevel ? need : remaining;
  return { level, into, need, fraction: level >= ECONOMY.maxLevel ? 1 : need > 0 ? into / need : 1 };
}

export interface MatchReward {
  coins: number;
  xp: number;
  kills: number;
  win: boolean;
  draw: boolean;
}

export function matchReward(kills: number, outcome: 'win' | 'loss' | 'draw'): MatchReward {
  const safeKills = Math.max(0, Math.floor(kills));
  const base =
    outcome === 'win'
      ? { coins: ECONOMY.winCoins, xp: ECONOMY.winXp }
      : outcome === 'draw'
        ? { coins: ECONOMY.drawCoins, xp: ECONOMY.drawXp }
        : { coins: ECONOMY.lossCoins, xp: ECONOMY.lossXp };
  return {
    coins: base.coins + safeKills * ECONOMY.killCoins,
    xp: base.xp + safeKills * ECONOMY.killXp,
    kills: safeKills,
    win: outcome === 'win',
    draw: outcome === 'draw',
  };
}

/** Coins awarded for crossing each level boundary between two experience totals. */
export function levelUpBonus(before: LevelState, after: LevelState): number {
  return Math.max(0, after.level - before.level) * ECONOMY.levelCoins;
}
