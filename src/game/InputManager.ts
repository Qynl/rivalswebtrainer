import type { MovementInput } from './movement/MovementTypes';

/** Keyboard-only input layer. It never mutates the movement controller. */
export class InputManager {
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private slideQueued = false;
  private attached = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.code;
    if (key === 'Space' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
    }
    if (!event.repeat) {
      if (key === 'Space') this.jumpQueued = true;
      if (key === 'KeyC' || key === 'ControlLeft' || key === 'ControlRight') {
        this.slideQueued = true;
      }
    }
    this.keys.add(key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.clear();
  };

  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.clear();
    this.attached = false;
  }

  clear(): void {
    this.keys.clear();
    this.jumpQueued = false;
    this.slideQueued = false;
  }

  snapshot(autoSprint = false): MovementInput {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;

    return {
      forward,
      strafe,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      autoSprint,
      slidePressed: this.slideQueued,
      jumpPressed: this.jumpQueued,
    };
  }

  consumePressed(): void {
    this.jumpQueued = false;
    this.slideQueued = false;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
}
