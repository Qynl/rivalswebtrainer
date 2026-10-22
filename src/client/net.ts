/**
 * WebSocket client with:
 * - a 20 Hz snapshot stream,
 * - ping/RTT measurement (used for the HUD and for lag-comp aim times),
 * - automatic reconnect with the seat token, so a dropped tab resumes the match.
 */

import type { ClientMsg, ServerMsg, Snapshot } from '../shared/protocol.ts';
import type { InputFrame } from '../shared/sim.ts';
import type { ShotMessage } from '../shared/combat.ts';

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export class Net {
  state: ConnState = 'idle';
  latency = 0;
  /** Estimated server clock (seconds) minus local performance clock. */
  clockOffset = 0;
  token = '';
  you = 0;
  opponentName = 'OPPONENT';
  playerName = 'PLAYER';
  /** Cosmetic kit sent on (re)connect; the server validates every id. */
  look: { gun: string; grapple: string; effect: string } = { gun: 'service', grapple: 'brass', effect: 'spark' };

  onSnapshot: ((snap: Snapshot) => void) | null = null;
  onShot: ((msg: Extract<ServerMsg, { t: 'shot' }>) => void) | null = null;
  onKill: ((msg: Extract<ServerMsg, { t: 'kill' }>) => void) | null = null;
  onOver: ((msg: Extract<ServerMsg, { t: 'over' }>) => void) | null = null;
  onInfo: ((msg: Extract<ServerMsg, { t: 'info' }>) => void) | null = null;
  onWelcome: ((msg: Extract<ServerMsg, { t: 'welcome' }>) => void) | null = null;
  onWaiting: ((text: string) => void) | null = null;
  onOpponentLeft: ((remaining: number) => void) | null = null;
  onOpponentBack: (() => void) | null = null;
  onState: ((s: ConnState) => void) | null = null;
  onReconnected: (() => void) | null = null;

  private ws: WebSocket | null = null;
  private mode: 'duel' | 'practice' = 'duel';
  private reconnectTimer: number | null = null;
  private reconnectDeadline = 0;
  private pingId = 0;
  private pingTimer: number | null = null;
  private pings = new Map<number, { sent: number; c: number }>();
  private everJoined = false;

  /** Cosmetic change mid-match: the server re-validates and echoes it. */
  sendLook(look: { gun: string; grapple: string; effect: string }): void {
    this.send({ t: 'look', look });
  }

  connect(name: string, mode: 'duel' | 'practice', token = ''): void {
    this.playerName = name;
    this.mode = mode;
    if (token) this.token = token;
    this.everJoined = false;
    this.open();
  }

  private open(): void {
    this.closeSocket();
    this.setState(this.everJoined ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.setState('open');
      this.send({
        t: 'hello',
        name: this.playerName,
        mode: this.mode,
        token: this.token || undefined,
        look: this.look,
      });
      this.startPing();
    };
    ws.onmessage = (ev) => this.handle(ev.data as string);
    ws.onclose = () => {
      if (this.state === 'closed') return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* the close handler owns recovery */
    };
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    if (this.everJoined && this.token) {
      if (!this.reconnectDeadline) this.reconnectDeadline = performance.now() + 19000;
      if (performance.now() < this.reconnectDeadline) {
        if (this.reconnectTimer !== null) return;
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.open();
        }, 900);
        return;
      }
    }
    this.setState('closed');
  }

  private startPing(): void {
    const send = (): void => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const id = ++this.pingId;
      this.pings.set(id, { sent: performance.now(), c: performance.now() / 1000 });
      this.send({ t: 'ping', id, c: performance.now() / 1000 });
    };
    send();
    if (this.pingTimer === null) this.pingTimer = window.setInterval(send, 2000);
  }

  private handle(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome': {
        this.token = msg.token;
        this.you = msg.you;
        this.opponentName = msg.opponentName;
        this.everJoined = true;
        this.reconnectDeadline = 0;
        try {
          localStorage.setItem('gg_token', msg.token);
          localStorage.setItem('gg_name', this.playerName);
        } catch {
          /* private mode: reconnect tokens just live in memory */
        }
        this.onWelcome?.(msg);
        if (msg.reconnected) this.onReconnected?.();
        break;
      }
      case 'snap':
        // Server clock estimate: snapshot time is when the server sent it.
        this.clockOffset = msg.snap.time - performance.now() / 1000;
        this.onSnapshot?.(msg.snap);
        break;
      case 'shot':
        this.onShot?.(msg);
        break;
      case 'kill':
        this.onKill?.(msg);
        break;
      case 'over':
        this.reconnectDeadline = 0;
        this.onOver?.(msg);
        break;
      case 'info':
        this.onInfo?.(msg);
        break;
      case 'waiting':
        this.onWaiting?.(msg.text);
        break;
      case 'opponentLeft':
        this.onOpponentLeft?.(msg.remaining);
        break;
      case 'opponentBack':
        this.onOpponentBack?.();
        break;
      case 'pong': {
        const p = this.pings.get(msg.id);
        if (p) {
          // Smooth the RTT: one lucky ping is not a better connection, and the
          // raw number swings by 20 ms between samples on a stable line.
          const rtt = performance.now() - p.sent;
          this.latency = this.latency === 0 ? rtt : this.latency * 0.7 + rtt * 0.3;
          this.pings.delete(msg.id);
        }
        break;
      }
      case 'error':
        this.onInfo?.({ t: 'info', text: msg.text, kind: 'leave' });
        break;
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  private closeSocket(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* already gone */
      }
      this.ws = null;
    }
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(frame: InputFrame): void {
    this.send({ t: 'input', frame });
  }

  sendShot(shot: ShotMessage): void {
    this.send({ t: 'shot', shot });
  }

  /** Server time (seconds) that corresponds to "now". */
  serverNow(): number {
    return performance.now() / 1000 + this.clockOffset;
  }

  leave(): void {
    this.reconnectDeadline = 0;
    this.send({ t: 'leave' });
    this.closeSocket();
    this.setState('closed');
  }

  disconnectNow(): void {
    this.closeSocket();
    this.setState('closed');
  }
}
