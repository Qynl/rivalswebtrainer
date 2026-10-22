import { ARENA, buildArena, type Arena } from '../src/shared/arena.ts';
import { initRapier, Physics } from '../src/shared/physics.ts';
import { createPlayer, respawnPlayer, stepPlayer, updateEye, type InputFrame, type PlayerState, type SimEvent } from '../src/shared/sim.ts';

export async function makeWorld(arena = buildArena()): Promise<Physics> {
  await initRapier();
  return new Physics(arena);
}

export function spawn(id: 0 | 1, arena = ARENA): PlayerState {
  const p = createPlayer(id, id);
  respawnPlayer(p, arena, id);
  return p;
}

export interface DriveOptions {
  ticks: number;
  keys?: (tick: number) => number;
  yaw?: number;
  pitch?: number;
  opponent?: PlayerState | null;
  onTick?: (tick: number) => void;
}

export interface DriveResult {
  player: PlayerState;
  events: SimEvent[];
  speeds: number[];
  ys: number[];
}

/** Runs the real fixed-step simulation with a scripted input. */
export function drive(
  phys: Physics,
  p: PlayerState,
  opts: DriveOptions,
  arena = ARENA,
): DriveResult {
  const events: SimEvent[] = [];
  const speeds: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < opts.ticks; i++) {
    const frame: InputFrame = {
      seq: i + 1,
      keys: opts.keys ? opts.keys(i) : 0,
      yaw: opts.yaw ?? p.yaw,
      pitch: opts.pitch ?? p.pitch,
    };
    stepPlayer(p, frame, 1 / 60, phys, arena, opts.opponent ?? null, events);
    speeds.push(p.speed);
    ys.push(p.pos.y);
    opts.onTick?.(i);
  }
  return { player: p, events, speeds, ys };
}

export function place(p: PlayerState, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
  p.pos = { x, y: y + 0.9, z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = yaw;
  p.pitch = pitch;
  p.alive = true;
  p.grounded = false;
  p.grapple.active = false;
  updateEye(p);
}

/** A big flat pad in empty space: isolates movement tuning from map geometry. */
export const PAD: Arena = {
  blocks: [{ x: 0, y: -1, z: 0, hx: 45, hy: 1, hz: 45, kind: 'deck' }],
  anchors: [
    { x: 0, y: 40, z: 0 },
    { x: 30, y: 30, z: 0 },
    { x: -30, y: 30, z: 0 },
  ],
  spawns: [],
  center: { x: 0, y: 0, z: 0 },
  voidY: -1000,
};

export async function makePadWorld(): Promise<Physics> {
  await initRapier();
  return new Physics(PAD);
}

/** A physics world with no geometry: used to tune the rope in isolation. */
export async function makeOpenWorld(arena: Arena): Promise<Physics> {
  await initRapier();
  return new Physics(arena);
}
