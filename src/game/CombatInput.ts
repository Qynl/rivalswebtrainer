import type { CombatInput, WeaponId } from './combat/CombatTypes';

/** Mouse/weapon input is deliberately separate from movement input. */
export class CombatInputManager {
  private fireHeld = false;
  private aimHeld = false;
  private reloadQueued = false;
  private weaponSlot: WeaponId | null = null;
  private attached = false;

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) this.fireHeld = true;
    if (event.button === 2) {
      this.aimHeld = true;
      event.preventDefault();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.fireHeld = false;
    if (event.button === 2) this.aimHeld = false;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (document.pointerLockElement) event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'KeyR') this.reloadQueued = true;
    if (event.code === 'Digit1') this.weaponSlot = 'carbine';
    if (event.code === 'Digit2') this.weaponSlot = 'sidearm';
  };

  private readonly onBlur = (): void => this.clear();

  attach(): void {
    if (this.attached) return;
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
    this.clear();
    this.attached = false;
  }

  clear(): void {
    this.fireHeld = false;
    this.aimHeld = false;
    this.reloadQueued = false;
    this.weaponSlot = null;
  }

  snapshot(): CombatInput {
    return {
      fireHeld: this.fireHeld,
      aimHeld: this.aimHeld,
      reloadPressed: this.reloadQueued,
      weaponSlot: this.weaponSlot,
    };
  }

  consumePressed(): void {
    this.reloadQueued = false;
    this.weaponSlot = null;
  }
}
