import { MATCH } from './config';

export type RoundResult = 'player' | 'bot' | 'draw';

export interface MatchState {
  round: number; // 1-based current round
  playerWins: number;
  botWins: number;
  phase: 'live' | 'intermission' | 'over';
  roundTimeLeft: number;
  intermissionLeft: number;
  lastResult: RoundResult | null;
  winner: 'player' | 'bot' | 'draw' | null;
}

export function createMatch(): MatchState {
  return {
    round: 1,
    playerWins: 0,
    botWins: 0,
    phase: 'live',
    roundTimeLeft: MATCH.roundTime,
    intermissionLeft: 0,
    lastResult: null,
    winner: null,
  };
}

/** Ends the current round with a result and moves to intermission or game over. */
export function endRound(m: MatchState, result: RoundResult): void {
  if (m.phase !== 'live') return;
  m.lastResult = result;
  if (result === 'player') m.playerWins++;
  else if (result === 'bot') m.botWins++;
  // A draw (timeout with equal state) gives no point to either side.
  const roundsPlayed = m.round;
  const remaining = MATCH.rounds - roundsPlayed;
  const clinched = m.playerWins > MATCH.rounds / 2 || m.botWins > MATCH.rounds / 2;
  if (roundsPlayed >= MATCH.rounds || clinched) {
    m.phase = 'over';
    m.winner = m.playerWins > m.botWins ? 'player' : m.botWins > m.playerWins ? 'bot' : 'draw';
    return;
  }
  void remaining;
  m.phase = 'intermission';
  m.intermissionLeft = MATCH.intermission;
}

/** Advances the timer. Returns true when the round time just ran out. */
export function tickMatch(m: MatchState, dt: number): boolean {
  if (m.phase === 'intermission') {
    m.intermissionLeft -= dt;
    if (m.intermissionLeft <= 0) {
      m.round++;
      m.phase = 'live';
      m.roundTimeLeft = MATCH.roundTime;
    }
    return false;
  }
  if (m.phase === 'live') {
    m.roundTimeLeft = Math.max(0, m.roundTimeLeft - dt);
    return m.roundTimeLeft <= 0;
  }
  return false;
}

/** Winner by timeout: higher HP wins, equal HP is a draw. */
export function timeoutResult(playerHp: number, botHp: number): RoundResult {
  if (playerHp > botHp) return 'player';
  if (botHp > playerHp) return 'bot';
  return 'draw';
}
