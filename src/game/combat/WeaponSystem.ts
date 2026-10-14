import {
  WEAPON_DEFINITIONS,
  type WeaponDefinition,
  type WeaponId,
  type WeaponState,
} from './CombatTypes';

function makeState(weaponId: WeaponId): WeaponState {
  const definition = WEAPON_DEFINITIONS[weaponId];
  return {
    weaponId,
    ammo: definition.magazineSize,
    reserve: definition.reserveSize,
    cooldown: 0,
    reloadRemaining: 0,
  };
}

/**
 * Deterministic weapon/loadout state. Damage and visibility are resolved by
 * CombatSimulation; this class only owns rate-of-fire, ammo, and reload rules.
 */
export class WeaponLoadout {
  private readonly states: Record<WeaponId, WeaponState> = {
    carbine: makeState('carbine'),
    sidearm: makeState('sidearm'),
  };
  private activeWeapon: WeaponId = 'carbine';

  reset(): void {
    this.states.carbine = makeState('carbine');
    this.states.sidearm = makeState('sidearm');
    this.activeWeapon = 'carbine';
  }

  update(dt: number): void {
    for (const state of Object.values(this.states)) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.reloadRemaining > 0) {
        state.reloadRemaining = Math.max(0, state.reloadRemaining - dt);
        if (state.reloadRemaining === 0) this.finishReload(state);
      }
    }
  }

  get active(): WeaponState {
    return this.states[this.activeWeapon];
  }

  get activeDefinition(): WeaponDefinition {
    return WEAPON_DEFINITIONS[this.activeWeapon];
  }

  get activeId(): WeaponId {
    return this.activeWeapon;
  }

  getState(weaponId: WeaponId = this.activeWeapon): WeaponState {
    return this.states[weaponId];
  }

  getDefinition(weaponId: WeaponId = this.activeWeapon): WeaponDefinition {
    return WEAPON_DEFINITIONS[weaponId];
  }

  switchTo(weaponId: WeaponId): boolean {
    if (weaponId === this.activeWeapon) return false;
    if (this.active.reloadRemaining > 0) return false;
    this.activeWeapon = weaponId;
    return true;
  }

  requestReload(): boolean {
    const state = this.active;
    const definition = this.activeDefinition;
    if (
      state.reloadRemaining > 0 ||
      state.ammo >= definition.magazineSize ||
      state.reserve <= 0
    ) return false;
    state.reloadRemaining = definition.reloadTime;
    state.cooldown = Math.max(state.cooldown, 0.08);
    return true;
  }

  tryFire(): WeaponDefinition | null {
    const state = this.active;
    if (
      state.reloadRemaining > 0 ||
      state.cooldown > 1e-7 ||
      state.ammo <= 0
    ) return null;
    state.ammo -= 1;
    state.cooldown = this.activeDefinition.fireInterval;
    return this.activeDefinition;
  }

  forceReload(): void {
    const state = this.active;
    if (state.reloadRemaining > 0) state.reloadRemaining = 0;
    this.finishReload(state);
  }

  private finishReload(state: WeaponState): void {
    const definition = WEAPON_DEFINITIONS[state.weaponId];
    const amount = Math.min(
      definition.magazineSize - state.ammo,
      state.reserve,
    );
    state.ammo += amount;
    state.reserve -= amount;
  }
}
