import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { MATCH } from '../src/shared/constants.ts';
import {
  createMatch,
  enforceTimeLimit,
  forfeit,
  MATCH_HARD_LIMIT,
  resolveDeaths,
  ringRadiusAt,
  stepMatch,
  type KillEvent,
} from '../src/shared/match.ts';
import { createPlayer, respawnPlayer } from '../src/shared/sim.ts';

const DT = 1 / 60;

function players() {
  const a = createPlayer(0, 0);
  const b = createPlayer(1, 1);
  respawnPlayer(a, ARENA, 0);
  respawnPlayer(b, ARENA, 1);
  return [a, b] as [ReturnType<typeof createPlayer>, ReturnType<typeof createPlayer>];
}

describe('match rules', () => {
  it('moves from warmup to live and never stalls', () => {
    const m = createMatch();
    const [a, b] = players();
    expect(m.phase).toBe('warmup');
    for (let i = 0; i < 100; i++) stepMatch(m, DT, [a, b], []);
    expect(m.phase).toBe('live');
  });

  it('credits a void death to the opponent and respawns the victim', () => {
    const m = createMatch();
    m.phase = 'live';
    const [a, b] = players();
    b.pos.y = MATCH.voidY - 2;
    const deaths: KillEvent[] = [];
    stepMatch(m, DT, [a, b], deaths);
    expect(deaths.length).toBe(1);
    resolveDeaths(m, [a, b], deaths);
    expect(m.scores).toEqual([1, 0]);
    expect(b.alive).toBe(false);
    expect(b.respawnIn).toBeCloseTo(MATCH.respawnDelay);
    // The clock runs down and flags a respawn.
    for (let i = 0; i < Math.ceil(MATCH.respawnDelay / DT) + 2; i++) stepMatch(m, DT, [a, b], []);
    expect(b.pendingRespawn).toBe(true);
  });

  it('gives no credit when you fall while the opponent is dead', () => {
    const m = createMatch();
    m.phase = 'live';
    const [a, b] = players();
    b.alive = false;
    a.pos.y = MATCH.voidY - 2;
    const deaths: KillEvent[] = [];
    stepMatch(m, DT, [a, b], deaths);
    resolveDeaths(m, [a, b], deaths);
    expect(deaths[0].killer).toBe(-1);
    expect(m.scores).toEqual([0, 0]);
  });

  it('handles both players dying on the same frame as a draw, not a crash', () => {
    const m = createMatch();
    m.phase = 'live';
    m.scores = [2, 2];
    const [a, b] = players();
    const deaths: KillEvent[] = [
      { killer: 1, victim: 0, cause: 'shot', at: { x: 0, y: 0, z: 0 } },
      { killer: 0, victim: 1, cause: 'shot', at: { x: 0, y: 0, z: 0 } },
    ];
    resolveDeaths(m, [a, b], deaths);
    expect(m.scores).toEqual([3, 3]);
    expect(m.phase).toBe('over');
    expect(m.draw).toBe(true);
    expect(m.winner).toBeNull();
  });

  it('ends a best-of-three at three kills', () => {
    const m = createMatch();
    m.phase = 'live';
    m.scores = [2, 1];
    const [a, b] = players();
    resolveDeaths(m, [a, b], [{ killer: 0, victim: 1, cause: 'shot', at: { x: 0, y: 0, z: 0 } }]);
    expect(m.phase).toBe('over');
    expect(m.winner).toBe(0);
    expect(m.draw).toBe(false);
    expect(m.scores).toEqual([3, 1]);
  });

  it('kills campers outside the ring after the grace period', () => {
    const m = createMatch();
    m.phase = 'live';
    m.time = MATCH.ringStartAt + MATCH.ringShrinkTime; // fully closed
    const [a, b] = players();
    a.pos = { x: 0, y: 50, z: 0 }; // inside the final ring
    b.pos = { x: 0, y: 50, z: 90 }; // outside the final ring
    let deaths: KillEvent[] = [];
    for (let i = 0; i < Math.ceil(MATCH.ringGrace / DT) + 6; i++) {
      deaths = [];
      stepMatch(m, DT, [a, b], deaths);
      if (deaths.length) break;
    }
    expect(deaths.length).toBe(1);
    expect(deaths[0].cause).toBe('ring');
    expect(deaths[0].killer).toBe(0);
    expect(ringRadiusAt(m.time)).toBeCloseTo(MATCH.ringRadiusEnd);
  });

  it('forfeits cleanly when an opponent never returns', () => {
    const m = createMatch();
    m.phase = 'live';
    forfeit(m, 1);
    expect(m.phase).toBe('over');
    expect(m.winner).toBe(0);
    expect(m.forfeited).toBe(1);
  });

  it('always terminates, even at a stalemate', () => {
    const m = createMatch();
    m.phase = 'live';
    m.time = MATCH_HARD_LIMIT + 1;
    m.scores = [1, 1];
    enforceTimeLimit(m);
    expect(m.phase).toBe('over');
    expect(m.draw).toBe(true);
  });

  it('scores never disagree: every death adds exactly one point', () => {
    const m = createMatch();
    m.phase = 'live';
    const [a, b] = players();
    const deaths: KillEvent[] = [];
    for (let i = 0; i < 5; i++) {
      deaths.length = 0;
      deaths.push({ killer: i % 2, victim: (i + 1) % 2, cause: 'shot', at: { x: 0, y: 0, z: 0 } });
      resolveDeaths(m, [a, b], deaths);
      a.alive = true;
      b.alive = true;
      if ((m.phase as string) === 'over') break;
    }
    expect(m.scores[0] + m.scores[1]).toBe(m.kills.length);
  });
});
