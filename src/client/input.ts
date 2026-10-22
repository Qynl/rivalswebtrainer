/**
 * Input.
 *
 * Responsiveness rules from the brief, implemented here:
 * - keys are sampled on every frame AND latched between fixed steps, so a
 *   press that happens between two 60 Hz ticks is never swallowed;
 * - mouse look accumulates raw deltas and is consumed once per render frame;
 * - Escape releases the pointer and opens the pause panel instead of quitting.
 */

import { KEY } from '../shared/sim.ts';

export interface LookDelta {
  dx: number;
  dy: number;
}

export class Input {
  keys = 0;
  sensitivity = 0.0021;
  scopedSensitivity = 0.55;
  locked = false;
  look: LookDelta = { dx: 0, dy: 0 };
  onLockChange: ((locked: boolean) => void) | null = null;
  onEscape: (() => void) | null = null;
  private pressedThisFrame = 0;
  private target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys = 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.set(KEY.fire, true);
      if (e.button === 2) this.set(KEY.scope, true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.set(KEY.fire, false);
      if (e.button === 2) this.set(KEY.scope, false);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'Escape') {
      if (down) this.onEscape?.();
      return;
    }
    const map: Record<string, number> = {
      KeyW: KEY.forward,
      ArrowUp: KEY.forward,
      KeyS: KEY.back,
      ArrowDown: KEY.back,
      KeyA: KEY.left,
      ArrowLeft: KEY.left,
      KeyD: KEY.right,
      ArrowRight: KEY.right,
      Space: KEY.jump,
      ShiftLeft: KEY.grapple,
      ShiftRight: KEY.grapple,
      ControlLeft: KEY.crouch,
      KeyC: KEY.crouch,
      KeyE: KEY.dash,
    };
    const bit = map[e.code];
    if (bit && down) e.preventDefault();
    if (bit) this.set(bit, down);
  }

  private set(bit: number, down: boolean): void {
    if (down) {
      if (!(this.keys & bit)) this.pressedThisFrame |= bit;
      this.keys |= bit;
    } else {
      this.keys &= ~bit;
    }
  }

  press(bit: number): void {
    if (!(this.keys & bit)) this.pressedThisFrame |= bit;
    this.keys |= bit;
  }

  release(bit: number): void {
    this.keys &= ~bit;
  }

  /** One-shot bits pressed since the last call (used by the pause menu). */
  takePressed(): number {
    const p = this.pressedThisFrame;
    this.pressedThisFrame = 0;
    return p;
  }

  requestLock(): void {
    const el = this.target as HTMLElement & { requestPointerLock?: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void };
    if (el.requestPointerLock && !this.locked) {
      try {
        const r = el.requestPointerLock({ unadjustedMovement: true });
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => el.requestPointerLock?.());
      } catch {
        el.requestPointerLock();
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.keys = 0;
    this.look.dx = 0;
    this.look.dy = 0;
  }
}
