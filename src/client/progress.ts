/**
 * The player's trophy case: coins, experience, owned cosmetics, equipped kit.
 *
 * Stored in localStorage because the duel itself is server-authoritative and
 * ephemeral — there is no account to hang a profile on, and a lost connection
 * must never cost you a skin. The server never reads this; it only receives the
 * three equipped ids, validated against the catalogue.
 */

import {
  DEFAULT_LOADOUT,
  ECONOMY,
  cosmeticById,
  levelFromXp,
  levelUpBonus,
  sanitizeLoadout,
  type CosmeticKind,
  type LevelState,
  type Loadout,
  type MatchReward,
} from '../shared/cosmetics.ts';

const KEY = 'gg.progress.v1';

export interface ProgressState {
  coins: number;
  xp: number;
  kills: number;
  wins: number;
  matches: number;
  owned: string[];
  loadout: Loadout;
}

function emptyState(): ProgressState {
  return {
    coins: 0,
    xp: 0,
    kills: 0,
    wins: 0,
    matches: 0,
    // The three starter items are never charged for and never lost.
    owned: ['gun:service', 'grapple:brass', 'effect:spark'],
    loadout: { ...DEFAULT_LOADOUT },
  };
}

export interface BuyResult {
  ok: boolean;
  reason: 'bought' | 'owned' | 'poor' | 'unknown';
}

export class Progress {
  state: ProgressState;

  constructor(state: Partial<ProgressState> | undefined = undefined) {
    this.state = Progress.normalize(state);
  }

  static load(storage?: Storage): Progress {
    const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (!store) return new Progress(emptyState());
    try {
      const raw = store.getItem(KEY);
      if (!raw) return new Progress(emptyState());
      return new Progress(JSON.parse(raw) as Partial<ProgressState>);
    } catch {
      // A corrupt profile is not worth a crash: start clean, keep playing.
      return new Progress(emptyState());
    }
  }

  static normalize(raw: Partial<ProgressState> | undefined): ProgressState {
    const base = emptyState();
    if (!raw || typeof raw !== 'object') return base;
    const num = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
    const owned = new Set<string>(base.owned);
    if (Array.isArray(raw.owned)) {
      for (const id of raw.owned) if (typeof id === 'string') owned.add(id);
    }
    const loadout = sanitizeLoadout(raw.loadout);
    // Never let the equipped kit point at something the profile does not own.
    for (const kind of ['gun', 'grapple', 'effect'] as CosmeticKind[]) {
      const id = loadout[kind];
      if (!owned.has(`${kind}:${id}`)) loadout[kind] = base.loadout[kind];
    }
    return {
      coins: num(raw.coins, 0),
      xp: num(raw.xp, 0),
      kills: num(raw.kills, 0),
      wins: num(raw.wins, 0),
      matches: num(raw.matches, 0),
      owned: [...owned],
      loadout,
    };
  }

  save(storage?: Storage): void {
    const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (!store) return;
    try {
      store.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Private mode / quota: progress is a nicety, never a blocker.
    }
  }

  get level(): LevelState {
    return levelFromXp(this.state.xp);
  }

  owns(kind: CosmeticKind, id: string): boolean {
    return this.state.owned.includes(`${kind}:${id}`);
  }

  buy(kind: CosmeticKind, id: string): BuyResult {
    const item = cosmeticById(kind, id);
    if (!item) return { ok: false, reason: 'unknown' };
    if (this.owns(kind, id)) return { ok: false, reason: 'owned' };
    if (this.state.coins < item.price) return { ok: false, reason: 'poor' };
    this.state.coins -= item.price;
    this.state.owned.push(`${kind}:${id}`);
    this.state.loadout[kind] = id;
    this.save();
    return { ok: true, reason: 'bought' };
  }

  equip(kind: CosmeticKind, id: string): boolean {
    if (!this.owns(kind, id)) return false;
    this.state.loadout[kind] = id;
    this.save();
    return true;
  }

  /**
   * Commits a finished match. Returns the level transition so the results
   * screen can celebrate it, and pays the level-up bonus for every boundary
   * crossed (a huge match can cross two).
   */
  applyReward(reward: MatchReward): { before: LevelState; after: LevelState; bonus: number } {
    const before = this.level;
    this.state.coins += reward.coins;
    this.state.xp += reward.xp;
    this.state.kills += reward.kills;
    this.state.matches += 1;
    if (reward.win) this.state.wins += 1;
    const after = this.level;
    const bonus = levelUpBonus(before, after);
    this.state.coins += bonus;
    this.save();
    return { before, after, bonus };
  }

  /** Live in-match credit, so the kill banner can show the purse filling up. */
  previewCoins(kills: number): number {
    return kills * ECONOMY.killCoins;
  }
}

export type { CosmeticKind, Loadout };
