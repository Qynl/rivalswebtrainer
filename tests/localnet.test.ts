// @vitest-environment jsdom
/**
 * The offline authority.
 *
 * On a static host there is no Node process, so the same `Room` runs in the
 * page. What matters is that the protocol below the game is unchanged: a
 * welcome, a 20 Hz snapshot stream, and a fixed-step simulation, all driven
 * without a socket. If this passes, a GitHub Pages build is playable.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initRapier } from '../src/shared/physics.ts';
import type { LocalNet as L } from '../src/client/localnet.ts';

let LocalNet: typeof L;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await initRapier();
  LocalNet = (await import('../src/client/localnet.ts')).LocalNet;
});

describe('in-page authority', () => {
  it('welcomes, streams snapshots and simulates without a server', async () => {
    const net = new LocalNet();
    let welcomed = 0;
    let snaps = 0;
    let lastTime = 0;
    let lastScore = -1;
    net.onWelcome = (msg) => {
      welcomed++;
      expect(msg.mode).toBe('practice');
      expect(msg.opponentName).toBe('SPECTER');
    };
    net.onSnapshot = (snap) => {
      snaps++;
      // The authority clock only ever moves forward, one tick at a time.
      expect(snap.time).toBeGreaterThanOrEqual(lastTime);
      lastTime = snap.time;
      lastScore = snap.match.scores[0];
    };
    net.connect('TESTER', 'practice');
    expect(net.state).toBe('open');
    expect(net.offline).toBe(true);

    await sleep(500);
    net.sendInput({ seq: 1, keys: 0, yaw: 0.4, pitch: 0 });
    await sleep(300);

    expect(welcomed).toBe(1);
    // 20 Hz stream over ~0.8 s, with room for a slow CI machine.
    expect(snaps).toBeGreaterThan(4);
    expect(lastTime).toBeGreaterThan(0.2);
    expect(lastScore).toBe(0);
    net.disconnectNow();
    expect(net.state).toBe('closed');
  }, 20000);

  it('stops cleanly, so a rematch can start from the same object', async () => {
    const net = new LocalNet();
    let welcomes = 0;
    net.onWelcome = () => welcomes++;
    net.connect('TESTER', 'practice');
    await sleep(150);
    net.leave();
    expect(net.state).toBe('closed');
    net.connect('TESTER', 'practice');
    await sleep(150);
    expect(welcomes).toBe(2);
    net.disconnectNow();
  }, 20000);
});
