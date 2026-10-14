import type { Command } from './game/game';

const PITCH_LIMIT = Math.PI / 2 - 0.02;

/** Collects keyboard/mouse state and produces a Command for the player each frame. */
export class Input {
  private held = new Set<string>();
  private edges = new Set<string>();
  private lmbHeld = false;
  private lmbEdge = false;
  private rmbEdge = false;
  private yaw = 0;
  private pitch = 0;
  private slotEdge: 1 | 2 | 3 | null = null;
  locked = false;
  sensitivity = 0.0022;
  invertY = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      if (!this.held.has(e.code) && !e.repeat) this.edges.add(e.code);
      this.held.add(e.code);
      if (e.code === 'Digit1') this.slotEdge = 1;
      if (e.code === 'Digit2') this.slotEdge = 2;
      if (e.code === 'Digit3') this.slotEdge = 3;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.lmbHeld = true;
        this.lmbEdge = true;
      } else if (e.button === 2) {
        this.rmbEdge = true;
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.lmbHeld = false;
    });
    window.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= (this.invertY ? -1 : 1) * e.movementY * this.sensitivity;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.lmbHeld = false;
        this.held.clear();
      }
    });
  }

  requestLock(): void {
    void this.canvas.requestPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Whether a key was pressed since the last read (edge). */
  consumeEdge(code: string): boolean {
    if (this.edges.has(code)) {
      this.edges.delete(code);
      return true;
    }
    return false;
  }

  /** Builds the player's Command for this simulation tick. Clears one-shot edges. */
  sample(): Command {
    const h = (c: string) => this.held.has(c);
    const forward = (h('KeyW') ? 1 : 0) - (h('KeyS') ? 1 : 0);
    const strafe = (h('KeyD') ? 1 : 0) - (h('KeyA') ? 1 : 0);
    const cmd: Command = {
      move: {
        forward,
        strafe,
        yaw: this.yaw,
        jumpPressed: this.consumeEdge('Space'),
        jumpHeld: h('Space'),
        crouchHeld: h('ControlLeft') || h('KeyC'),
        crouchPressed: this.consumeEdge('ControlLeft') || this.consumeEdge('KeyC'),
      },
      yaw: this.yaw,
      pitch: this.pitch,
      fire: this.lmbHeld,
      fireEdge: this.lmbEdge,
      melee: this.lmbEdge,
      dash: this.rmbEdge,
      quick: this.consumeEdge('KeyF'),
      reload: this.consumeEdge('KeyR'),
      slot: this.slotEdge,
    };
    this.lmbEdge = false;
    this.rmbEdge = false;
    this.slotEdge = null;
    return cmd;
  }

  /** Sets the view angles, used when the match starts so the camera faces the arena. */
  setView(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get viewYaw(): number {
    return this.yaw;
  }
}
