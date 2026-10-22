import type { InputFrame } from './game/movement';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const DOWN = ['ArrowDown', 'KeyS'];
const JUMP = ['Space', 'ArrowUp', 'KeyW'];
const DASH = ['ShiftLeft', 'ShiftRight', 'KeyK'];
const ATTACK = ['KeyJ', 'KeyX', 'KeyZ'];
const PAUSE = ['Escape'];

const BLOCK_DEFAULT = new Set([...LEFT, ...RIGHT, ...DOWN, ...JUMP, ...DASH, ...ATTACK, 'Tab']);

export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private consumedThisPoll = new Set<string>();

  attach(target: HTMLElement | Window = window): void {
    target.addEventListener('keydown', ((e: KeyboardEvent) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    }) as EventListener);
    target.addEventListener('keyup', ((e: KeyboardEvent) => {
      this.down.delete(e.code);
    }) as EventListener);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.pressed.clear();
    });
  }

  private anyDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  private anyPressed(codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c) && !this.consumedThisPoll.has(c));
  }

  private consume(codes: string[]): void {
    for (const c of codes) this.consumedThisPoll.add(c);
  }

  pausePressed(): boolean {
    const hit = this.anyPressed(PAUSE);
    if (hit) this.consume(PAUSE);
    return hit;
  }

  /** Reads the current frame's intent as an InputFrame and clears edge flags. */
  poll(): InputFrame {
    const left = this.anyDown(LEFT);
    const right = this.anyDown(RIGHT);
    const moveX = (right ? 1 : 0) - (left ? 1 : 0);
    const frame: InputFrame = {
      moveX,
      downHeld: this.anyDown(DOWN),
      jumpPressed: this.anyPressed(JUMP),
      jumpHeld: this.anyDown(JUMP),
      dashPressed: this.anyPressed(DASH),
      attackPressed: this.anyPressed(ATTACK),
    };
    this.consume(JUMP);
    this.consume(DASH);
    this.consume(ATTACK);
    this.pressed.clear();
    this.consumedThisPoll.clear();
    return frame;
  }
}
