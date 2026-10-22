/** Wire protocol. Plain JSON: 1v1 traffic is tiny and debuggability wins. */

import type { ShotMessage } from './combat.ts';
import type { KillEvent, MatchPhase } from './match.ts';
import type { InputFrame } from './sim.ts';
import type { Vec3 } from './mathx.ts';

export interface PlayerSnap {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  grounded: boolean;
  sliding: boolean;
  scoped: boolean;
  scopeT: number;
  glint: number;
  protect: number;
  exposure: number;
  respawnIn: number;
  speed: number;
  grapple: {
    active: boolean;
    mode: 'none' | 'swing' | 'zip';
    anchor: Vec3;
    length: number;
    chain: number;
    target: 0 | 1;
  };
}

export interface MatchSnap {
  phase: MatchPhase;
  time: number;
  scores: [number, number];
  winner: number | null;
  draw: boolean;
  ringRadius: number;
  ringActive: boolean;
  lastKill: KillEvent | null;
  forfeited: number | null;
  drawAward: boolean;
}

export type ClientMsg =
  | { t: 'hello'; name: string; mode: 'duel' | 'practice'; token?: string }
  | { t: 'input'; frame: InputFrame }
  | { t: 'shot'; shot: ShotMessage }
  | { t: 'ping'; id: number; c: number }
  | { t: 'rematch' }
  | { t: 'leave' };

export interface Snapshot {
  t: 'snap';
  tick: number;
  /** Server clock, seconds. */
  time: number;
  ack: number;
  you: number;
  players: [PlayerSnap, PlayerSnap];
  match: MatchSnap;
}

export type ServerMsg =
  | {
      t: 'welcome';
      you: number;
      token: string;
      name: string;
      opponentName: string;
      mode: 'duel' | 'practice';
      reconnected: boolean;
      match: MatchSnap;
      time: number;
    }
  | { t: 'waiting'; text: string }
  | { t: 'snap'; snap: Snapshot }
  | {
      t: 'shot';
      shooter: number;
      seq: number;
      origin: Vec3;
      end: Vec3;
      hit: boolean;
      scoped: boolean;
    }
  | {
      t: 'kill';
      event: KillEvent;
      scores: [number, number];
      phase: MatchPhase;
      winner: number | null;
      draw: boolean;
      drawAward: boolean;
      victimAt: Vec3;
    }
  | { t: 'pong'; id: number; c: number; s: number }
  | { t: 'info'; text: string; kind: 'join' | 'leave' | 'reconnect' | 'forfeit' }
  | { t: 'opponentLeft'; remaining: number }
  | { t: 'opponentBack' }
  | { t: 'over'; winner: number | null; draw: boolean; scores: [number, number]; forfeited: number | null }
  | { t: 'error'; text: string };
