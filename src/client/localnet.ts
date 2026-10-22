/**
 * Offline authority: the real duel room, running in the page.
 *
 * A static host (GitHub Pages) has no Node process, but it does have a browser
 * that can run the same fixed-step `Room` the server runs — the physics, the
 * match rules, the lag compensation and the bot are all shared code with no
 * Node dependency. This transport feeds that room the same protocol messages a
 * socket would, so the client code above it is byte-for-byte identical: same
 * prediction, same interpolation, same HUD.
 *
 * The room is not a cut-down demo. Whatever it decides here is exactly what the
 * server would have decided, which is why offline practice is a fair rehearsal
 * for a real duel.
 */

import { ARENA } from '../shared/arena.ts';
import { DT } from '../shared/constants.ts';
import { Physics } from '../shared/physics.ts';
import type { ClientMsg } from '../shared/protocol.ts';
import { Room, type SocketLike } from '../server/room.ts';
import { TransportBase } from './net.ts';

export class LocalNet extends TransportBase {
  /** The HUD says LOCAL, and a score here is a score against the bot. */
  readonly offline = true;
  private room: Room | null = null;
  private slot = 0;
  private timer: number | null = null;
  private last = 0;
  private acc = 0;
  /** The room sends into this, and it arrives back on `handle` immediately. */
  private readonly pipe: SocketLike = {
    send: (raw: string): void => this.handle(raw),
  };

  connect(name: string, _mode: 'duel' | 'practice'): void {
    this.teardown();
    this.playerName = name;
    this.setState('open');
    this.latency = 0;
    this.clockOffset = 0;
    // Practice is the only room that can start with one human, and it is the
    // only honest offline opponent: a duel with nobody on the other end is a
    // loading screen. The menu labels what you are getting.
    this.room = new Room('practice', new Physics(ARENA));
    this.slot = this.room.join(this.pipe, name, this.look) ?? 0;
    this.last = performance.now();
    this.acc = 0;
    this.timer = window.setInterval(() => this.pump(), 4);
  }

  /**
   * Fixed-step pump, the same accumulator the server uses: wall time can jitter
   * all it likes, the authority always advances in 1/60 s ticks.
   */
  private pump(): void {
    const room = this.room;
    if (!room) return;
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      room.update(Date.now());
      this.acc -= DT;
      steps++;
    }
    if (this.acc > DT * 6) this.acc = 0;
    if (room.dead) this.disconnectNow();
  }

  protected send(msg: ClientMsg): void {
    this.room?.receive(this.slot, msg);
  }

  leave(): void {
    this.room?.receive(this.slot, { t: 'leave' });
    this.disconnectNow();
  }

  disconnectNow(): void {
    this.teardown();
    this.setState('closed');
  }

  /** Stop the pump and drop the room without announcing a state change. */
  private teardown(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.room) {
      this.room.finish();
      this.room = null;
    }
  }
}
