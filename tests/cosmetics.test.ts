import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  DEFAULT_LOADOUT,
  ECONOMY,
  GUN_SKINS,
  GRAPPLE_SKINS,
  KILL_EFFECTS,
  cosmeticById,
  levelFromXp,
  matchReward,
  sanitizeLoadout,
  xpForLevel,
} from '../src/shared/cosmetics.ts';
import { Progress } from '../src/client/progress.ts';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('cosmetics catalogue', () => {
  it('has a free, owned-by-default item in every category', () => {
    expect(GUN_SKINS[0].price).toBe(0);
    expect(GRAPPLE_SKINS[0].price).toBe(0);
    expect(KILL_EFFECTS[0].price).toBe(0);
    expect(cosmeticById('gun', DEFAULT_LOADOUT.gun)).toBeTruthy();
    expect(cosmeticById('grapple', DEFAULT_LOADOUT.grapple)).toBeTruthy();
    expect(cosmeticById('effect', DEFAULT_LOADOUT.effect)).toBeTruthy();
  });

  it('keeps ids unique and prices sane', () => {
    const seen = new Set<string>();
    for (const list of Object.values(CATALOGUE)) {
      for (const item of list) {
        const key = `${item.kind}:${item.id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(item.price).toBeGreaterThanOrEqual(0);
        expect(item.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects unknown ids from the wire instead of throwing', () => {
    const clean = sanitizeLoadout({ gun: 'nope', grapple: 42, effect: null });
    expect(clean).toEqual(DEFAULT_LOADOUT);
    const mixed = sanitizeLoadout({ gun: GRAPPLE_SKINS[1].id, grapple: GRAPPLE_SKINS[1].id });
    expect(mixed.gun).toBe(DEFAULT_LOADOUT.gun);
    expect(mixed.grapple).toBe(GRAPPLE_SKINS[1].id);
  });
});

describe('levels and rewards', () => {
  it('needs more experience for each level and never goes backwards', () => {
    let previous = 0;
    for (let level = 1; level <= ECONOMY.maxLevel; level++) {
      const need = xpForLevel(level);
      expect(need).toBeGreaterThan(previous);
      previous = need;
    }
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(0).fraction).toBe(0);
    expect(levelFromXp(xpForLevel(1) - 1).level).toBe(1);
    expect(levelFromXp(xpForLevel(1)).level).toBe(2);
  });

  it('pays per kill on top of the outcome bonus', () => {
    const win = matchReward(3, 'win');
    expect(win.coins).toBe(ECONOMY.winCoins + 3 * ECONOMY.killCoins);
    expect(win.xp).toBe(ECONOMY.winXp + 3 * ECONOMY.killXp);
    const loss = matchReward(1, 'loss');
    expect(loss.coins).toBe(ECONOMY.lossCoins + ECONOMY.killCoins);
    expect(matchReward(-4, 'draw').kills).toBe(0);
  });
});

describe('progress profile', () => {
  it('starts with the starter kit and nothing else', () => {
    const progress = new Progress(undefined);
    expect(progress.state.coins).toBe(0);
    expect(progress.owns('gun', DEFAULT_LOADOUT.gun)).toBe(true);
    expect(progress.owns('gun', 'aurum')).toBe(false);
    expect(progress.equip('gun', 'aurum')).toBe(false);
  });

  it('refuses purchases without coins and keeps the purse honest', () => {
    const progress = new Progress(undefined);
    const poor = progress.buy('gun', 'carbon');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe('poor');
    progress.state.coins = 10_000;
    const bought = progress.buy('gun', 'carbon');
    expect(bought.ok).toBe(true);
    expect(progress.state.coins).toBe(10_000 - GUN_SKINS[1].price);
    expect(progress.state.loadout.gun).toBe('carbon');
    expect(progress.buy('gun', 'carbon').reason).toBe('owned');
  });

  it('persists through storage and drops an unowned equipped item on load', () => {
    const storage = new MemoryStorage();
    const progress = new Progress(undefined);
    progress.state.coins = 5000;
    progress.buy('grapple', 'ember');
    progress.save(storage);

    const reloaded = Progress.load(storage);
    expect(reloaded.state.coins).toBe(5000 - GRAPPLE_SKINS[2].price);
    expect(reloaded.state.loadout.grapple).toBe('ember');

    // A hand-edited profile claiming an unowned skin must not keep it equipped.
    const raw = JSON.parse(storage.getItem('gg.progress.v1')!);
    raw.loadout.gun = 'aurum';
    storage.setItem('gg.progress.v1', JSON.stringify(raw));
    const sanitized = Progress.load(storage);
    expect(sanitized.state.loadout.gun).toBe(DEFAULT_LOADOUT.gun);
  });

  it('awards coins, xp and a level bonus for crossing a boundary', () => {
    const progress = new Progress(undefined);
    const first = progress.applyReward(matchReward(3, 'win'));
    expect(first.after.level).toBeGreaterThanOrEqual(1);
    expect(progress.state.coins).toBe(matchReward(3, 'win').coins + first.bonus);

    // Force a level crossing: enough XP for the next level, minus one.
    progress.state.xp = xpForLevel(1) - 5;
    const before = progress.level;
    const payout = progress.applyReward(matchReward(1, 'loss'));
    expect(payout.after.level).toBe(before.level + 1);
    expect(payout.bonus).toBe(ECONOMY.levelCoins);
  });

  it('gives every skin a motion kit and every kill effect its own geometry', () => {
    // Cosmetic-only rule: these fields are read by the renderer, never by the
    // simulation. The catalogue test exists so a new skin cannot ship without
    // the animation data the renderer expects.
    const orbits = new Set(['none', 'ring', 'motes', 'vent', 'coil', 'shards']);
    for (const g of GUN_SKINS) {
      expect(orbits.has(g.anim.orbit)).toBe(true);
      expect(g.anim.sweep).toBeGreaterThanOrEqual(0);
      expect(g.anim.glow).toBeGreaterThanOrEqual(0);
    }
    for (const r of GRAPPLE_SKINS) {
      expect(orbits.has(r.anim.orbit)).toBe(true);
      expect(r.anim.pulse).toBeGreaterThanOrEqual(0);
    }
    const shapes = new Set(KILL_EFFECTS.map((f) => f.shape));
    for (const f of KILL_EFFECTS) expect(['spark', 'shard', 'petal', 'arc', 'star']).toContain(f.shape);
    // The catalogue must use every geometry it has: a new effect that is only a
    // recolour of an old one is not worth a price tag.
    expect(shapes.size).toBe(5);
  });
});
