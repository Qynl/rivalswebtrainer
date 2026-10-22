/**
 * Match rules: continuous rounds (kill, respawn, fight again), first to three.
 * The ring starts closing 25 s in and reaches its final radius at 80 s.
 *
 * Edge cases owned here rather than in the server loop:
 * - every death in a tick is collected first, then resolved in one batch, so
 *   both players dying on the same frame scores both and ends as a draw
 *   instead of racing;
 * - a void or ring death credits the opponent only if the opponent is alive;
 * - a dead player always respawns: the server consumes `pendingRespawn`;
 * - the match always ends: scores, or the ring, or the 5-minute hard cap.
 */

import { MATCH } from './constants.ts';
import { clamp, lerp, smoothstep, type Vec3 } from './mathx.ts';
import type { PlayerState } from './sim.ts';

export type KillCause = 'shot' | 'void' | 'ring' | 'forfeit';
export type MatchPhase = 'warmup' | 'live' | 'over';

export interface KillEvent {
  /** -1 = no credit (you fell with nobody to blame). */
  killer: number;
  victim: number;
  cause: KillCause;
  at: Vec3;
}

export interface MatchState {
  phase: MatchPhase;
  time: number;
  scores: [number, number];
  winner: number | null;
  draw: boolean;
  ringRadius: number;
  ringActive: boolean;
  lastKill: KillEvent | null;
  kills: KillEvent[];
  forfeited: number | null;
  drawAward: boolean;
}

export function createMatch(): MatchState {
  return {
    phase: 'warmup',
    time: 0,
    scores: [0, 0],
    winner: null,
    draw: false,
    ringRadius: MATCH.ringRadiusStart,
    ringActive: false,
    lastKill: null,
    kills: [],
    forfeited: null,
    drawAward: false,
  };
}

export function ringRadiusAt(time: number): number {
  const t = clamp((time - MATCH.ringStartAt) / MATCH.ringShrinkTime, 0, 1);
  // Smoothstep: a slow creep first, a stampede at the end.
  return lerp(MATCH.ringRadiusStart, MATCH.ringRadiusEnd, smoothstep(0, 1, t));
}

export function ringDistance(pos: Vec3): number {
  return Math.hypot(pos.x - MATCH.ringCenter.x, pos.z - MATCH.ringCenter.z);
}

/**
 * Timers, ring and respawn clocks. Void/ring deaths are appended to `deaths`
 * so the caller can resolve them in the same batch as shot kills.
 */
export function stepMatch(
  m: MatchState,
  dt: number,
  players: [PlayerState, PlayerState],
  deaths: KillEvent[],
): void {
  if (m.phase === 'over') return;
  m.time += dt;
  if (m.phase === 'warmup' && m.time >= MATCH.warmup) m.phase = 'live';
  m.ringRadius = ringRadiusAt(m.time);
  m.ringActive = m.time >= MATCH.ringStartAt;

  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p.alive) {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0 && m.phase === 'live') p.pendingRespawn = true;
      continue;
    }
    const alreadyDying = deaths.some((d) => d.victim === i);
    if (alreadyDying) continue;
    if (p.pos.y < MATCH.voidY) {
      deaths.push({ killer: players[1 - i].alive ? 1 - i : -1, victim: i, cause: 'void', at: { ...p.pos } });
      continue;
    }
    if (m.ringActive && ringDistance(p.pos) > m.ringRadius) {
      p.exposure += dt;
      if (p.exposure >= MATCH.ringGrace) {
        deaths.push({ killer: players[1 - i].alive ? 1 - i : -1, victim: i, cause: 'ring', at: { ...p.pos } });
      }
    } else {
      p.exposure = Math.max(0, p.exposure - dt * 1.6);
    }
  }
}

/**
 * Applies a whole tick's deaths: at most one per player, scores once, sets
 * respawn clocks, then decides whether the match is over.
 */
export function resolveDeaths(m: MatchState, players: [PlayerState, PlayerState], deaths: KillEvent[]): void {
  const victims = new Set<number>();
  for (const d of deaths) {
    if (victims.has(d.victim)) continue;
    victims.add(d.victim);
    m.kills.push(d);
    m.lastKill = d;
    if (d.killer >= 0 && d.killer !== d.victim) m.scores[d.killer as 0 | 1] += 1;
    const p = players[d.victim];
    p.alive = false;
    p.respawnIn = MATCH.respawnDelay;
    p.exposure = 0;
    p.grapple.active = false;
    p.grapple.mode = 'none';
    p.vel = { x: 0, y: 0, z: 0 };
  }
  // A batch where both players died and the scores landed perfectly level at
  // the target is a draw, not a win for whoever was iterated last.
  const bothDead = victims.size === 2;
  if (m.scores[0] >= MATCH.killsToWin && m.scores[1] >= MATCH.killsToWin) {
    m.phase = 'over';
    m.winner = m.scores[0] === m.scores[1] ? null : m.scores[0] > m.scores[1] ? 0 : 1;
    m.draw = m.winner === null;
    m.drawAward = bothDead && MATCH.killsToWin === m.scores[0] && m.scores[0] === m.scores[1];
  } else if (m.scores[0] >= MATCH.killsToWin || m.scores[1] >= MATCH.killsToWin) {
    m.phase = 'over';
    m.winner = m.scores[0] > m.scores[1] ? 0 : 1;
    m.draw = false;
  }
}

/** Hard safety valve: no match may outlive this. Higher score wins, else draw. */
export const MATCH_HARD_LIMIT = 300;

export function enforceTimeLimit(m: MatchState): void {
  if (m.phase === 'over' || m.time < MATCH_HARD_LIMIT) return;
  m.phase = 'over';
  if (m.scores[0] === m.scores[1]) {
    m.winner = null;
    m.draw = true;
  } else {
    m.winner = m.scores[0] > m.scores[1] ? 0 : 1;
    m.draw = false;
  }
}

export function forfeit(m: MatchState, loser: number): void {
  if (m.phase === 'over') return;
  m.phase = 'over';
  m.forfeited = loser;
  m.winner = 1 - loser;
  m.draw = false;
}
