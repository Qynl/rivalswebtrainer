import { describe, expect, it } from 'vitest';
import { WeaponLoadout } from './WeaponSystem';

describe('WeaponLoadout', () => {
  it('enforces fire cadence and magazine size', () => {
    const loadout = new WeaponLoadout();
    const first = loadout.tryFire();
    expect(first?.id).toBe('carbine');
    expect(loadout.tryFire()).toBeNull();

    loadout.update(first!.fireInterval);
    expect(loadout.tryFire()?.id).toBe('carbine');
    expect(loadout.active.ammo).toBe(22);
  });

  it('reloads only from reserve ammo and keeps weapon slots independent', () => {
    const loadout = new WeaponLoadout();
    for (let index = 0; index < 4; index += 1) {
      loadout.tryFire();
      loadout.update(0.2);
    }
    expect(loadout.active.ammo).toBe(20);
    expect(loadout.requestReload()).toBe(true);
    loadout.update(2);
    expect(loadout.active.ammo).toBe(24);
    expect(loadout.active.reserve).toBe(92);

    expect(loadout.switchTo('sidearm')).toBe(true);
    expect(loadout.active.ammo).toBe(8);
  });
});
