/**
 * One duel room: two slots, one authoritative simulation, one snapshot stream.
 *
 * The loop is strictly fixed-step (1/60 s). Clients send inputs and shots;
 * the room decides where everyone is and who is dead. Nothing here trusts a
 * client for anything that can decide a kill.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { ARENA } from '../shared/arena.ts';
import {
  canFire,
  clampRewindTime,
  markFired,
  PoseHistory,
  resolveShot,
  resolveShotDir,
  shotOriginError,
} from '../shared/combat.ts';
import { DT, INTERP_DELAY, MATCH, SNAPSHOT_EVERY, TICK_RATE } from '../shared/constants.ts';
import { createMatch, enforceTimeLimit, forfeit, resolveDeaths, stepMatch, type KillEvent, type MatchState } from '../shared/match.ts';
import { Physics } from '../shared/physics.ts';
import type { ClientMsg, MatchSnap, PlayerSnap, ServerMsg, Snapshot } from '../shared/protocol.ts';
import {
  createPlayer,
  respawnPlayer,
  stepPlayer,
  updateEye,
  type InputFrame,
  type PlayerState,
  type SimEvent,
} from '../shared/sim.ts';
import { Bot } from './bot.ts';
import { sanitizeLoadout, type Loadout } from '../shared/cosmetics.ts';

interface Slot {
  ws: WebSocket | null;
  name: string;
  /** Cosmetics only, echoed to the opponent so their view of you matches. */
  look: Loadout;
  token: string;
  connected: boolean;
  leftAt: number | null;
  queue: InputFrame[];
  lastInput: InputFrame;
  ack: number;
  bot: Bot | null;
}

let nextId = 1;

export class Room {
  readonly id = nextId++;
  readonly mode: 'duel' | 'practice';
  private slots: [Slot, Slot];
  private players: [PlayerState, PlayerState];
  private history: [PoseHistory, PoseHistory];
  private phys: Physics;
  private match: MatchState = createMatch();
  private tick = 0;
  private time = 0;
  private started = false;
  private destroyed = false;
  private pendingShots: { slot: number; msg: unknown }[] = [];
  private deaths: KillEvent[] = [];
  private events: SimEvent[] = [];

  constructor(mode: 'duel' | 'practice', phys: Physics) {
    this.mode = mode;
    this.phys = phys;
    this.players = [createPlayer(0, 0), createPlayer(1, 1)];
    this.history = [new PoseHistory(90), new PoseHistory(90)];
    const makeSlot = (i: number): Slot => ({
      ws: null,
      name: i === 0 ? 'PLAYER' : 'OPPONENT',
      look: sanitizeLoadout(undefined),
      token: randomUUID(),
      connected: false,
      leftAt: null,
      queue: [],
      lastInput: { seq: 0, keys: 0, yaw: 0, pitch: 0 },
      ack: 0,
      bot: null,
    });
    this.slots = [makeSlot(0), makeSlot(1)];
    if (mode === 'practice') {
      const bot = new Bot();
      this.slots[1].bot = bot;
      this.slots[1].name = 'SPECTER';
      respawnPlayer(this.players[0], ARENA, 0);
      respawnPlayer(this.players[1], ARENA, 1);
      this.players[1].skin = 1;
      this.begin();
    }
  }

  get full(): boolean {
    return this.slots.every((s) => s.connected || s.leftAt !== null);
  }

  get waiting(): boolean {
    return this.mode === 'duel' && !this.started;
  }

  get dead(): boolean {
    return this.destroyed;
  }

  /** Human joins a free slot. Returns the slot index or null if none. */
  join(ws: WebSocket, name: string, look?: unknown): number | null {
    const idx = this.slots.findIndex((s) => !s.connected && s.leftAt === null);
    if (idx < 0) return null;
    const slot = this.slots[idx];
    slot.ws = ws;
    slot.name = (name || 'PLAYER').slice(0, 14).toUpperCase();
    slot.look = sanitizeLoadout(look);
    slot.connected = true;
    slot.leftAt = null;
    slot.token = randomUUID();
    slot.queue.length = 0;
    slot.lastInput = { seq: 0, keys: 0, yaw: this.players[idx].yaw, pitch: this.players[idx].pitch };
    this.send(slot, {
      t: 'welcome',
      you: idx,
      token: slot.token,
      name: slot.name,
      opponentName: this.slots[1 - idx].name,
      mode: this.mode,
      reconnected: false,
      match: this.matchSnap(),
      time: this.time,
    });
    if (this.mode === 'duel') {
      if (this.slots[0].connected && this.slots[1].connected) this.begin();
      else this.send(slot, { t: 'waiting', text: 'WAITING FOR OPPONENT — FREE SWING' });
    }
    return idx;
  }

  /** Reconnect with the token issued at first join. */
  reconnect(ws: WebSocket, token: string, name: string, look?: unknown): number | null {
    const idx = this.slots.findIndex((s) => s.token === token && (s.leftAt !== null || !s.connected));
    if (idx < 0) return null;
    const slot = this.slots[idx];
    slot.ws = ws;
    slot.connected = true;
    slot.leftAt = null;
    slot.queue.length = 0;
    if (name) slot.name = name.slice(0, 14).toUpperCase();
    if (look !== undefined) slot.look = sanitizeLoadout(look);
    this.send(slot, {
      t: 'welcome',
      you: idx,
      token: slot.token,
      name: slot.name,
      opponentName: this.slots[1 - idx].name,
      mode: this.mode,
      reconnected: true,
      match: this.matchSnap(),
      time: this.time,
    });
    this.sendSnapshot(true);
    this.send(this.slots[1 - idx], { t: 'opponentBack' });
    return idx;
  }

  /** Called when the socket closes. Keeps the slot warm for the reconnect window. */
  disconnect(slotIndex: number, now: number): void {
    const slot = this.slots[slotIndex];
    slot.ws = null;
    slot.connected = false;
    slot.leftAt = now;
    slot.queue.length = 0;
    if (this.mode === 'practice') {
      this.destroyed = true;
      return;
    }
    if (this.match.phase !== 'live') {
      // Nothing to defend: free the seat immediately.
      slot.token = randomUUID();
      slot.leftAt = now;
      return;
    }
    this.send(this.slots[1 - slotIndex], {
      t: 'opponentLeft',
      remaining: Math.round(MATCH.reconnectWindow),
    });
    this.send(this.slots[1 - slotIndex], { t: 'info', text: 'OPPONENT DISCONNECTED', kind: 'leave' });
  }

  receive(slotIndex: number, msg: ClientMsg): void {
    const slot = this.slots[slotIndex];
    switch (msg.t) {
      case 'input': {
        if (!msg.frame || typeof msg.frame.seq !== 'number') return;
        slot.queue.push(msg.frame);
        // Keep a short headroom, never a second of history: stale frames are
        // latency, and the drain in stepPlayers already fast-forwards through
        // a burst. Anything older than 6 frames is dropped from the front.
        if (slot.queue.length > 6) slot.queue.splice(0, slot.queue.length - 6);
        break;
      }
      case 'shot':
        this.pendingShots.push({ slot: slotIndex, msg: msg.shot });
        break;
      case 'ping':
        this.send(slot, { t: 'pong', id: msg.id, c: msg.c, s: this.time });
        break;
      case 'leave': {
        // A voluntary exit is an immediate forfeit, not a reconnect window.
        if (this.mode === 'duel' && this.match.phase === 'live' && !this.dead) {
          forfeit(this.match, slotIndex);
          this.broadcast({ t: 'info', text: 'OPPONENT LEFT', kind: 'forfeit' });
          this.broadcastOver();
          this.destroyed = true;
        } else {
          this.destroyed = true;
        }
        break;
      }
      case 'look':
        // Cosmetics can change between matches; the simulation never notices.
        slot.look = sanitizeLoadout(msg.look);
        break;
      case 'rematch':
        // No rematch state machine: a new match is a new room. Kept as a no-op
        // acknowledgement so an old client message cannot wedge the room.
        this.send(slot, { t: 'info', text: 'MATCH OVER — RETURN TO MENU', kind: 'join' });
        break;
      default:
        break;
    }
  }

  private begin(): void {
    if (this.started) return;
    this.started = true;
    this.match = createMatch();
    respawnPlayer(this.players[0], ARENA, 0);
    respawnPlayer(this.players[1], ARENA, 1);
    this.players[1].skin = 1;
    for (let i = 0; i < 2; i++) {
      this.slots[i].lastInput = { seq: 0, keys: 0, yaw: this.players[i].yaw, pitch: 0 };
      this.slots[i].queue.length = 0;
    }
    this.broadcast({ t: 'info', text: 'DUEL START', kind: 'join' });
    this.sendSnapshot(true);
  }

  /** Fixed-step advance. `now` is the wall clock the server manager uses. */
  update(now: number): void {
    if (this.destroyed) return;
    if (this.match.phase === 'over') {
      // Freeze the world on the final frame; keep the scoreboard streaming.
      this.tick++;
      if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot(true);
      this.handleDisconnects(now);
      return;
    }
    if (this.mode === 'duel' && !this.started) {
      // Lobby: let the waiting player move and swing, but do not run the match.
      this.deaths.length = 0;
      this.stepPlayers(DT, false);
      this.tick++;
      if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot(false);
      return;
    }

    this.deaths.length = 0;
    this.processShots();
    this.stepPlayers(DT, true);
    this.stepMatchState(DT);
    this.tick++;
    this.time += DT;

    this.handleDisconnects(now);

    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot(false);
  }

  private stepPlayers(dt: number, live: boolean): void {
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      const slot = this.slots[i];
      let frame: InputFrame;
      if (slot.bot) {
        const out = slot.bot.update(p, this.players[1 - i], this.phys, ARENA, dt, {
          cx: MATCH.ringCenter.x,
          cz: MATCH.ringCenter.z,
          radius: this.match.ringRadius,
          active: this.match.ringActive,
        });
        frame = out.frame;
        if (out.fire) this.pendingShots.push({ slot: i, msg: slot.bot.shot(p) });
      } else if (slot.queue.length > 0) {
        frame = slot.queue.shift()!;
        slot.lastInput = frame;
        slot.ack = frame.seq;
      } else {
        // Packet loss: re-use the last held input (keys keep applying) but do
        // not advance the ack, so the client replays from the last confirmed frame.
        frame = { ...slot.lastInput, seq: slot.ack };
      }
      this.events.length = 0;
      stepPlayer(p, frame, dt, this.phys, ARENA, this.players[1 - i], this.events);
      // ── Backlog drain ─────────────────────────────────────────────────────
      // One queued frame per tick is only correct on a perfect network. A 60 Hz
      // input stream always arrives in clumps, and every extra frame sitting in
      // the queue is one tick of *permanent* input latency — which is exactly
      // why the player who joined (and so is on the worse route) felt a step
      // behind for the whole match. Any surplus is consumed in the same tick:
      // each frame still advances this player by exactly one tick of movement,
      // so nothing speeds up, the backlog simply empties.
      let drained = 0;
      while (slot.queue.length > 1 && drained < 3) {
        const next = slot.queue.shift()!;
        slot.lastInput = next;
        slot.ack = next.seq;
        stepPlayer(p, next, dt, this.phys, ARENA, this.players[1 - i], this.events);
        drained++;
      }
      // In the lobby there is no ring and no score, so falling just respawns.
      if (!live && p.pos.y < MATCH.voidY) {
        respawnPlayer(p, ARENA, i as 0 | 1);
      }
      this.history[i].record(this.time, p.pos, p.alive);
    }
  }

  private stepMatchState(dt: number): void {
    stepMatch(this.match, dt, this.players, this.deaths);
    if (this.deaths.length > 0) {
      resolveDeaths(this.match, this.players, this.deaths);
      this.broadcastKills(this.deaths);
    }
    enforceTimeLimit(this.match);
    if (this.match.phase === 'over') {
      this.broadcastOver();
    }
    // Consume respawn flags: a dead player always comes back.
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      if (p.pendingRespawn) {
        respawnPlayer(p, ARENA, i as 0 | 1);
        p.protect = MATCH.spawnProtect;
        p.pendingRespawn = false;
        this.history[i].record(this.time, p.pos, true);
      }
    }
  }

  private processShots(): void {
    if (this.pendingShots.length === 0) return;
    const shots = this.pendingShots.splice(0, this.pendingShots.length);
    for (const { slot, msg } of shots) {
      const p = this.players[slot];
      const other = this.players[1 - slot];
      const shot = msg as {
        seq?: number;
        origin?: { x: number; y: number; z: number };
        dir?: { x: number; y: number; z: number };
        scoped?: boolean;
        aimTime?: number;
      };
      // Shots are rifle-only: a client holding the grapnel cannot fire bullets.
      if (!p.alive || p.slot !== 0 || !canFire(p) || !shot || !shot.dir) continue;
      if (p.protect > 0) continue; // spawn protection is total, both ways
      const origin = shot.origin ?? p.eye;
      if (shotOriginError(origin, p.eye) > 2.5) continue; // teleport/aimbot sanity
      const dir = resolveShotDir(p, {
        seq: shot.seq ?? 0,
        origin: p.eye,
        dir: shot.dir,
        scoped: !!shot.scoped,
        aimTime: shot.aimTime ?? 0,
      });
      const aimAt = clampRewindTime(shot.aimTime && shot.aimTime > 0 ? shot.aimTime : this.time - INTERP_DELAY, this.time);
      const rewind = this.history[1 - slot].sample(aimAt);
      const target = rewind ? { pos: rewind.pos, alive: rewind.alive && other.alive } : { pos: other.pos, alive: other.alive };
      const out = resolveShot(this.phys, p.eye, dir, target, p.id);
      markFired(p);
      this.broadcast({
        t: 'shot',
        shooter: slot,
        seq: shot.seq ?? 0,
        origin: { ...p.eye },
        end: out.end,
        hit: out.hit,
        scoped: p.scoped,
      });
      if (out.hit && target.alive && other.alive) {
        this.deaths.push({ killer: slot, victim: 1 - slot, cause: 'shot', at: { ...other.pos } });
      }
    }
  }

  private broadcastKills(deaths: KillEvent[]): void {
    for (const d of deaths) {
      this.broadcast({
        t: 'kill',
        event: d,
        scores: [this.match.scores[0], this.match.scores[1]],
        phase: this.match.phase,
        winner: this.match.winner,
        draw: this.match.draw,
        drawAward: this.match.drawAward,
        victimAt: d.at,
      });
    }
  }

  private broadcastOver(): void {
    if (this.match.phase !== 'over' || this.overSent) return;
    this.overSent = true;
    this.broadcast({
      t: 'over',
      winner: this.match.winner,
      draw: this.match.draw,
      scores: [this.match.scores[0], this.match.scores[1]],
      forfeited: this.match.forfeited,
    });
  }
  private overSent = false;

  private handleDisconnects(now: number): void {
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i];
      if (slot.connected || slot.leftAt === null) continue;
      if (this.mode === 'practice') {
        this.destroyed = true;
        return;
      }
      const waitedMs = now - slot.leftAt;
      if (this.match.phase !== 'live') {
        // Nothing at stake yet: free the seat as soon as the socket is gone.
        if (waitedMs > 1000) {
          slot.leftAt = null;
          slot.token = randomUUID();
        }
        continue;
      }
      if (waitedMs > MATCH.reconnectWindow * 1000) {
        forfeit(this.match, i);
        this.broadcast({ t: 'info', text: 'OPPONENT DID NOT RETURN', kind: 'forfeit' });
        this.broadcastOver();
        this.destroyed = true;
      }
    }
    if (this.slots.every((s) => !s.connected && s.leftAt !== null)) {
      const last = Math.max(this.slots[0].leftAt ?? now, this.slots[1].leftAt ?? now);
      if (now - last > MATCH.reconnectWindow * 1000) this.destroyed = true;
    }
  }

  private playerSnap(i: number): PlayerSnap {
    const p = this.players[i];
    return {
      id: p.id,
      pos: p.pos,
      vel: p.vel,
      yaw: p.yaw,
      pitch: p.pitch,
      alive: p.alive,
      grounded: p.grounded,
      sliding: p.sliding,
      scoped: p.scoped,
      scopeT: p.scopeT,
      glint: p.glint,
      protect: p.protect,
      exposure: p.exposure,
      respawnIn: Math.max(0, p.respawnIn),
      speed: p.speed,
      grapple: {
        active: p.grapple.active,
        mode: p.grapple.mode,
        anchor: p.grapple.anchor,
        length: p.grapple.length,
        chain: p.grapple.chain,
        target: p.grapple.target,
      },
      slot: p.slot,
      hook: { active: p.hook.active, pos: p.hook.pos },
      look: this.slots[i].look,
    };
  }

  private matchSnap(): MatchSnap {
    return {
      phase: this.match.phase,
      time: this.match.time,
      scores: [this.match.scores[0], this.match.scores[1]],
      winner: this.match.winner,
      draw: this.match.draw,
      ringRadius: this.match.ringRadius,
      ringActive: this.match.ringActive,
      lastKill: this.match.lastKill,
      forfeited: this.match.forfeited,
      drawAward: this.match.drawAward,
    };
  }

  private sendSnapshot(_force: boolean): void {
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i];
      if (!slot.connected || !slot.ws) continue;
      const snap: Snapshot = {
        t: 'snap',
        tick: this.tick,
        time: this.time,
        ack: slot.ack,
        you: i,
        players: [this.playerSnap(0), this.playerSnap(1)],
        match: this.matchSnap(),
      };
      slot.ws.send(JSON.stringify({ t: 'snap', snap } satisfies ServerMsg));
    }
  }

  private send(slot: Slot, msg: ServerMsg): void {
    if (slot.ws && slot.connected) slot.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const slot of this.slots) if (slot.ws && slot.connected) slot.ws.send(raw);
  }

  /** Test/introspection helper: the authoritative state. */
  inspect(): { players: [PlayerState, PlayerState]; match: MatchState; time: number; started: boolean } {
    return { players: this.players, match: this.match, time: this.time, started: this.started };
  }

  /** Test helper: apply a validated shot directly (bypasses the socket). */
  forceShot(slot: number, msg: unknown): void {
    this.pendingShots.push({ slot, msg });
  }

  setInput(slot: number, frame: InputFrame): void {
    this.slots[slot].queue.push(frame);
  }

  get tickCount(): number {
    return this.tick;
  }

  get tickRate(): number {
    return TICK_RATE;
  }

  /** Test helper: mark a seat connected without a socket. */
  attachFake(slot: number, name: string): string {
    const s = this.slots[slot];
    s.connected = true;
    s.name = name;
    s.leftAt = null;
    return s.token;
  }

  detach(slot: number, now: number): void {
    this.disconnect(slot, now);
  }

  /** Test helpers for ring/void positions without touching internals. */
  teleport(slot: number, pos: { x: number; y: number; z: number }): void {
    const p = this.players[slot];
    p.pos = { ...pos };
    updateEye(p);
    this.history[slot].record(this.time, p.pos, p.alive);
  }

  finish(): void {
    this.destroyed = true;
  }

  /** Clears the socket references so the manager can close the room. */
  get sockets(): (WebSocket | null)[] {
    return [this.slots[0].ws, this.slots[1].ws];
  }

  get isPractice(): boolean {
    return this.mode === 'practice';
  }
}
