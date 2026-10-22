/**
 * Client bootstrap: menu → match → results, prediction, interpolation, juice.
 *
 * Prediction: the local capsule runs the shared 1/60 s simulation. Every tick
 * is recorded with the state *before* it. When a snapshot arrives, the server's
 * ack identifies which tick the authority had simulated; if the predicted pose
 * differs, we restore and replay the unacked inputs. So a swing is instant and
 * still server-correct.
 *
 * Remote players are interpolated 100 ms in the past, which is also the pose
 * the server rewinds to for lag compensation: what you see is what you hit.
 */

import { ARENA } from '../shared/arena.ts';
import type { ShotMessage } from '../shared/combat.ts';
import { glintVisibility, markFired, muzzleOffset, resolveShot, spreadShotDir } from '../shared/combat.ts';
import { DT, INTERP_DELAY, MATCH, SKINS, WEAPON } from '../shared/constants.ts';
import { ECONOMY, killEffect, matchReward, type Loadout } from '../shared/cosmetics.ts';
import { clamp, dist, lerp, lookDir, smoothstep, type Vec3 } from '../shared/mathx.ts';
import { initRapier, Physics } from '../shared/physics.ts';
import type { PlayerSnap, ServerMsg, Snapshot } from '../shared/protocol.ts';
import {
  clonePlayerState,
  createPlayer,
  findGrappleTarget,
  KEY,
  lookOf,
  respawnPlayer,
  stepPlayer,
  updateEye,
  type InputFrame,
  type PlayerState,
  type SimEvent,
} from '../shared/sim.ts';
import { Armory } from './armory.ts';
import { Sfx } from './audio.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { Net, type ConnState, type Transport } from './net.ts';
import { LocalNet } from './localnet.ts';
import { Progress } from './progress.ts';
import { Renderer, type RemoteView, type RopeView } from './renderer.ts';

interface HistoryEntry {
  seq: number;
  frame: InputFrame;
  before: PlayerState;
}

interface SnapBuf {
  time: number;
  snap: Snapshot;
}

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

class Game {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private hud = new Hud();
  private sfx = new Sfx();
  private input: Input;
  /** The authority. A socket when there is a server, the room itself when not. */
  private net: Transport = new Net();
  /** Set while a remote connection is being attempted and nothing has answered. */
  private fallbackTimer: number | null = null;
  /** Coins, level and equipped cosmetics. Local to this browser on purpose. */
  private progress = Progress.load();
  private armory: Armory;
  /** Kills this match, for the coin and XP payout at the results screen. */
  private matchKills = 0;
  /** What the claw would bite right now, mirrored from the world reticle. */
  private hookAim: 0 | 1 | 2 = 0;
  private phys: Physics;

  private local: PlayerState = createPlayer(0, 0);
  /** Synthetic opponent used only for local prediction (grapple targeting). */
  private remoteSim: PlayerState = createPlayer(1, 1);
  private remoteView: RemoteView = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    scopeT: 0,
    yaw: 0,
    pitch: 0,
    alive: false,
    sliding: false,
    scoped: false,
    glint: 0,
    speed: 0,
    grapple: { active: false, mode: 'none', anchor: { x: 0, y: 0, z: 0 }, length: 0, target: 0 },
    slot: 0,
    hook: { active: false, pos: { x: 0, y: 0, z: 0 } },
  };
  private remotePrev: PlayerState = createPlayer(1, 1);

  private snapBuf: SnapBuf[] = [];
  /** Adaptive interpolation delay, sized from measured snapshot jitter. */
  private interpDelay = INTERP_DELAY;
  /** Monotonic playback clock for remote interpolation, in server seconds. */
  private playhead = 0;
  private playheadValid = false;
  private snapJitter = 0;
  private lastSnapArrival = 0;
  private history: HistoryEntry[] = [];
  private seq = 0;
  private accumulator = 0;
  private lastFrame = 0;
  /** Last rendered frame delta, used by the interpolation playback clock. */
  private frameDt = 1 / 60;
  private events: SimEvent[] = [];
  private you: 0 | 1 = 0;
  private mode: 'duel' | 'practice' = 'practice';
  private inMatch = false;
  private started = false;
  private menuOpen = true;
  private resultsOpen = false;
  private paused = false;
  private hitstop = 0;
  /** Forgiving window so a click that lands mid-bolt still fires. */
  private fireBuffer = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private killcam: { t: number; killerPos: Vec3; victimPos: Vec3 } | null = null;
  private respawnIn = 0;
  private protect = 0;
  private hintUntil = 0;
  private lastScopeAt = 0;
  private ringWarnSound = 0;
  private matchOver = false;
  private serverMatchTime = 0;
  private lastPhase = '';
  private chainAt = 0;
  private prevEye: Vec3 = { x: 0, y: 0, z: 0 };
  /** Frame-time average and the adaptive-resolution nudge it drives. */
  private frameTimeEma = 1 / 60;
  private quality = 1;
  private qualityTimer = 0;

  constructor() {
    this.canvas = el<HTMLCanvasElement>('view');
    this.renderer = new Renderer(this.canvas, ARENA);
    this.phys = new Physics(ARENA);
    this.input = new Input(this.canvas);
    this.bindUi();
    this.bindTransport(new Net());
    this.armory = new Armory(this.progress, () => this.applyLoadout(), this.sfx);
    this.applyLoadout();
    this.resetLocalSpawn(0);
    this.hintUntil = performance.now() + 9000;
    this.hud.showMenu(true);
    this.hud.setMenuStatus('READY', 'ok');
    const savedName = (() => {
      try {
        return localStorage.getItem('gg_name') ?? '';
      } catch {
        return '';
      }
    })();
    if (savedName) el<HTMLInputElement>('callsign').value = savedName;
    if (params.get('name')) el<HTMLInputElement>('callsign').value = params.get('name')!.slice(0, 14);
    window.addEventListener('resize', () => this.renderer.resize());
    // Debug handle: the headless client test drives and inspects the live game.
    (window as unknown as { __gg?: Game }).__gg = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Setup ────────────────────────────────────────────────────────────────
  private bindUi(): void {
    const nameInput = el<HTMLInputElement>('callsign');
    const joinDuel = el<HTMLButtonElement>('play-duel');
    const joinBot = el<HTMLButtonElement>('play-bot');
    const sens = el<HTMLInputElement>('sens');
    const sens2 = el<HTMLInputElement>('sens2');
    const vol = el<HTMLInputElement>('vol');
    const vol2 = el<HTMLInputElement>('vol2');
    const savedSens = Number(localStorage.getItem('gg_sens') ?? '1') || 1;
    const savedVol = Number(localStorage.getItem('gg_vol') ?? '0.65');
    sens.value = String(savedSens);
    sens2.value = String(savedSens);
    vol.value = String(savedVol);
    vol2.value = String(savedVol);
    this.input.sensitivity = 0.0021 * savedSens;
    this.sfx.setVolume(savedVol);

    const applySens = (v: number): void => {
      this.input.sensitivity = 0.0021 * v;
      sens.value = String(v);
      sens2.value = String(v);
      localStorage.setItem('gg_sens', String(v));
    };
    const applyVol = (v: number): void => {
      this.sfx.setVolume(v);
      vol.value = String(v);
      vol2.value = String(v);
      localStorage.setItem('gg_vol', String(v));
    };
    sens.oninput = () => applySens(Number(sens.value));
    sens2.oninput = () => applySens(Number(sens2.value));
    vol.oninput = () => applyVol(Number(vol.value));
    vol2.oninput = () => applyVol(Number(vol2.value));

    const start = (mode: 'duel' | 'practice'): void => {
      this.sfx.unlock();
      this.sfx.ui('click');
      const name = (nameInput.value || 'PLAYER').trim().slice(0, 14).toUpperCase();
      localStorage.setItem('gg_name', name);
      this.mode = mode;
      this.enterMatchScreen();
      this.connectRemote(name, mode);
      this.hud.setMenuNote(mode === 'duel' ? 'SEARCHING FOR A DUEL…' : 'DEPLOYING SPECTER…');
    };
    joinDuel.onclick = () => start('duel');
    joinBot.onclick = () => start('practice');
    for (const b of [joinDuel, joinBot]) {
      b.onmouseenter = () => {
        this.sfx.unlock();
        this.sfx.ui('hover');
      };
    }

    el('result-menu').onclick = () => {
      this.sfx.ui('back');
      this.toMenu();
    };
    el('result-armory').onclick = () => {
      this.sfx.ui('click');
      this.hud.hideResults();
      this.armory.show('gun');
    };
    el('armory-open').onclick = () => {
      this.sfx.ui('click');
      this.hud.showMenu(false);
      this.armory.show('gun');
    };
    window.addEventListener('gg:armory-closed', () => {
      // Wherever the armory was opened from, come back to a sane screen.
      this.progress.save();
      if (this.inMatch && this.matchOver) this.hud.showResultsOnly();
      else if (!this.inMatch) {
        this.menuOpen = true;
        this.hud.showMenu(true);
        this.refreshProfile();
      }
    });
    el('result-again').onclick = () => {
      this.sfx.ui('click');
      this.net.disconnectNow();
      this.net.token = '';
      this.leaveMatchState();
      this.enterMatchScreen();
      this.net.connect(this.net.playerName, this.mode);
    };
    el('pause-resume').onclick = () => this.resume();
    el('pause-quit').onclick = () => {
      this.sfx.ui('back');
      this.net.leave();
      this.toMenu();
    };

    this.input.onEscape = () => {
      if (!this.inMatch || this.resultsOpen) return;
      if (this.paused) this.resume();
      else this.pauseGame();
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.inMatch && !this.resultsOpen && !this.paused) this.pauseGame();
    };
    this.canvas.addEventListener('mousedown', () => {
      this.sfx.unlock();
      if (this.inMatch && !this.paused && !this.resultsOpen) this.input.requestLock();
    });
  }

  /** Pushes the equipped kit into the renderer and the next hello message. */
  /**
   * Everything the server needs to know about our appearance, before and during
   * a match. Sent on join and whenever the armory changes something.
   */
  private applyLoadout(): void {
    const look: Loadout = { ...this.progress.state.loadout };
    this.net.look = look;
    this.renderer.applyLoadout(look);
    this.stats();
    // A live opponent should see the change now, not after a reconnect.
    if (this.net.state === 'open') this.net.sendLook(look);
  }

  /** Menu purse: level, XP bar and coin count. */
  private stats(): void {
    const level = this.progress.level;
    const state = this.progress.state;
    const lv = el('menu-level');
    const xp = el('menu-xp');
    const coins = el('menu-coins');
    if (lv) lv.textContent = `LV ${level.level}`;
    if (xp) xp.style.width = `${Math.round(level.fraction * 100)}%`;
    if (coins) coins.textContent = String(state.coins);
  }

  private refreshProfile(): void {
    this.stats();
  }

  /**
   * Binds the game's handlers to a transport. Transport objects are swapped
   * exactly once per match attempt (socket → in-page room when no server
   * answers), so the whole surface is re-bound rather than patched.
   */
  private bindTransport(t: Transport): void {
    this.net = t;
    t.onState = (s: ConnState) => this.onConnState(s);
    t.onWelcome = (msg) => {
      this.clearFallback();
      this.you = msg.you as 0 | 1;
      this.local.id = this.you;
      this.local.skin = this.you;
      this.remoteSim.id = 1 - this.you;
      this.remoteSim.skin = (1 - this.you) as 0 | 1;
      this.renderer.setSkin(this.you);
      this.hud.setWeaponLabel(SKINS[this.you].weapon === 'lance' ? 'LANCE' : 'NEEDLE');
      this.hud.setScore(msg.match.scores[0], msg.match.scores[1], this.you, this.you === 0 ? msg.name : msg.opponentName, this.you === 0 ? msg.opponentName : msg.name);
      this.inMatch = true;
      this.resultsOpen = false;
      this.matchOver = false;
      this.hud.hideResults();
      this.hud.showGame(true);
      this.hud.showMenu(false);
      this.hud.setMenuNote('');
      this.input.requestLock();
      this.hintUntil = performance.now() + 9000;
      this.resetLocalSpawn(this.you);
      this.snapBuf = [];
      this.playheadValid = false;
      this.lastSnapArrival = 0;
      this.history = [];
      this.killcam = null;
      if (msg.reconnected) {
        this.hud.toastMsg('RECONNECTED — MATCH RESUMED', 2600);
        this.hud.feedLine('RECONNECTED', 'system');
      } else {
        this.hud.toastMsg(msg.mode === 'practice' ? 'PRACTICE: SPECTER' : 'DUEL ACCEPTED', 2000);
      }
      this.started = true;
      this.lastPhase = msg.match.phase;
    };
    t.onWaiting = (text) => {
      this.hud.toastMsg(text, 3200);
      this.hud.setMenuNote(text);
    };
    t.onSnapshot = (snap) => this.onSnapshot(snap);
    t.onShot = (msg) => this.onShotMsg(msg);
    t.onKill = (msg) => this.onKillMsg(msg);
    t.onOver = (msg) => this.onOverMsg(msg);
    t.onInfo = (msg) => {
      const mine = msg.text.includes(SKINS[this.you].name) || msg.text.startsWith(this.net.playerName);
      this.hud.feedLine(msg.text, msg.kind === 'leave' || msg.kind === 'forfeit' ? 'them' : mine ? 'me' : 'system');
    };
    t.onOpponentLeft = (remaining) => {
      this.hud.bannerText('OPPONENT DISCONNECTED', 'them', 2600);
      this.hud.toastMsg(`OPPONENT DISCONNECTED — ${remaining}s TO RETURN`, 2600);
      this.hud.feedLine('OPPONENT DISCONNECTED', 'them');
      this.hud.setNet(this.net.latency, 'RECONNECTING', 'warn');
    };
    t.onOpponentBack = () => {
      this.hud.bannerText('OPPONENT RETURNED', 'system', 1800);
      this.hud.feedLine('OPPONENT RETURNED', 'system');
    };
    t.onReconnected = () => {
      this.history = [];
      this.snapBuf = [];
      this.playheadValid = false;
      this.lastSnapArrival = 0;
      this.hud.toastMsg('RECONNECTED', 1800);
    };
  }

  /**
   * Where the authority lives.
   *
   * Same origin by default, which is the bundled server. A hosted build (Pages)
   * can point at a server somewhere else with `?server=wss://host/ws` or a
   * build-time `VITE_WS_URL`; with neither and nothing listening, the match
   * falls back to the in-page room so the page is always playable.
   */
  private serverUrl(): string {
    const explicit = params.get('server') ?? '';
    if (explicit) return explicit;
    const built = (import.meta.env?.VITE_WS_URL as string | undefined) ?? '';
    if (built) return built;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private clearFallback(): void {
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private connectRemote(name: string, mode: 'duel' | 'practice'): void {
    const remote = new Net();
    remote.url = this.serverUrl();
    this.bindTransport(remote);
    remote.connect(name, mode);
    // Nothing answered within a couple of seconds: this is a static host, so
    // run the same duel in the page instead of sitting on CONNECTING for ever.
    this.clearFallback();
    this.fallbackTimer = window.setTimeout(() => {
      if (this.net !== remote || remote.state === 'open') return;
      remote.disconnectNow();
      this.goOffline(name);
    }, 2600);
  }

  private goOffline(name: string): void {
    const local = new LocalNet();
    this.bindTransport(local);
    this.mode = 'practice';
    local.connect(name, 'practice');
    this.hud.toastMsg('NO SERVER — LOCAL SCRIMMAGE VS SPECTER', 3200);
    this.hud.feedLine('OFFLINE · IN-PAGE AUTHORITY', 'system');
    this.hud.setMenuNote('LOCAL SCRIMMAGE — RUN THE NODE SERVER FOR REAL DUELS');
  }

  private onConnState(s: ConnState): void {
    if (s === 'open') {
      this.hud.setNet(this.net.latency, this.net.offline ? 'LOCAL' : 'ONLINE', 'ok');
    } else if (s === 'connecting') {
      this.hud.setNet(0, 'CONNECTING', 'warn');
    } else if (s === 'reconnecting') {
      this.hud.setNet(this.net.latency, 'RECONNECTING', 'warn');
      if (this.inMatch && !this.resultsOpen) this.hud.toastMsg('CONNECTION LOST — RECONNECTING…', 2400);
    } else if (s === 'closed') {
      this.hud.setNet(this.net.latency, 'OFFLINE', 'bad');
      if (this.inMatch && !this.resultsOpen && !this.matchOver) {
        this.hud.toastMsg('CONNECTION LOST', 2600);
      }
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  private enterMatchScreen(): void {
    this.matchKills = 0;
    this.menuOpen = false;
    this.hud.showMenu(false);
    this.hud.showGame(true);
    this.hud.hideResults();
    this.paused = false;
    this.hud.showPause(false);
    this.inMatch = true;
    this.input.requestLock();
  }

  private leaveMatchState(): void {
    this.inMatch = false;
    this.started = false;
    this.matchOver = false;
    this.snapBuf = [];
    this.playheadValid = false;
    this.lastSnapArrival = 0;
    this.history = [];
    this.killcam = null;
    this.remoteView.alive = false;
    this.resultsOpen = false;
    this.paused = false;
    this.hud.showGame(false);
  }

  private toMenu(): void {
    this.input.exitLock();
    this.leaveMatchState();
    this.net.disconnectNow();
    this.menuOpen = true;
    this.hud.hideResults();
    this.hud.showPause(false);
    this.hud.showMenu(true);
    this.hud.setMenuStatus('READY', 'ok');
    this.hud.setMenuNote('CLICK TO LOCK THE MOUSE · ESC FOR MENU');
    this.sfx.stopAll();
  }

  private pauseGame(): void {
    if (!this.inMatch || this.resultsOpen) return;
    this.paused = true;
    this.hud.showPause(true);
    this.input.exitLock();
  }

  private resume(): void {
    this.paused = false;
    this.hud.showPause(false);
    this.input.requestLock();
  }

  private resetLocalSpawn(slot: 0 | 1): void {
    respawnPlayer(this.local, ARENA, slot);
    this.lookYaw = this.local.yaw;
    this.lookPitch = 0;
    this.local.protect = 0;
    this.accumulator = 0;
    this.phys.setPosition(this.local.id, this.local.pos);
  }

  // ── Network handlers ─────────────────────────────────────────────────────
  private onSnapshot(snap: Snapshot): void {
    this.serverMatchTime = snap.match.time;
    // ── Jitter measurement ──────────────────────────────────────────────────
    // Snapshots are sent on a fixed 20 Hz cadence, so any deviation in their
    // arrival spacing is network jitter. Sizing the interpolation buffer from
    // the measurement (instead of a constant) is what makes a lossy or mobile
    // connection play smoothly without adding a fixed delay for everyone else.
    const arrival = performance.now() / 1000;
    if (this.lastSnapArrival > 0) {
      const gap = arrival - this.lastSnapArrival;
      const dev = Math.abs(gap - 1 / 20);
      // Fast attack, slow release: a bad patch is absorbed immediately, and
      // the buffer only relaxes once the line has been quiet for a while.
      this.snapJitter = dev > this.snapJitter ? this.snapJitter * 0.55 + dev * 0.45 : this.snapJitter * 0.94 + dev * 0.06;
      this.snapJitter = clamp(this.snapJitter, 0, 0.25);
    }
    this.lastSnapArrival = arrival;
    const wantedDelay = clamp(0.075 + this.snapJitter * 3.2, 0.075, 0.3);
    // Grow at once, shrink gently: shrinking fast makes the picture stutter.
    this.interpDelay = wantedDelay > this.interpDelay
      ? this.interpDelay + (wantedDelay - this.interpDelay) * 0.5
      : this.interpDelay + (wantedDelay - this.interpDelay) * 0.02;

    this.snapBuf.push({ time: snap.time, snap });
    while (this.snapBuf.length > 24) this.snapBuf.shift();
    const mine = snap.players[this.you];
    const theirs = snap.players[1 - this.you];
    if (!mine) return;
    this.reconcile(mine, snap.ack);
    this.respawnIn = mine.respawnIn;
    this.protect = mine.protect;
    this.remoteSim.pos = { ...theirs.pos };
    this.remoteSim.alive = theirs.alive;
    this.remoteSim.yaw = theirs.yaw;
    this.remoteSim.pitch = theirs.pitch;
    updateEye(this.remoteSim);
    // Cosmetics are cosmetic: no simulation state is derived from them.
    if (theirs.look && (this.remoteView.look?.gun !== theirs.look.gun
      || this.remoteView.look?.grapple !== theirs.look.grapple
      || this.remoteView.look?.effect !== theirs.look.effect)) {
      this.remoteView.look = { ...theirs.look };
      this.renderer.applyRemoteLook(theirs.look);
    }

    this.hud.setScore(snap.match.scores[0], snap.match.scores[1], this.you, this.net.playerName, this.net.opponentName);
    if (snap.match.phase !== this.lastPhase) {
      if (snap.match.phase === 'live' && this.lastPhase === 'warmup') {
        this.hud.bannerText('FIGHT', 'me', 900);
        this.sfx.fightStart();
      }
      this.lastPhase = snap.match.phase;
    }
    if (snap.match.phase === 'over' && !this.matchOver) {
      this.matchOver = true;
    }
  }

  private reconcile(serverSnap: PlayerSnap, ack: number): void {
    if (!this.local.alive) {
      // Respawn detection: the authority says we are back.
      if (serverSnap.alive) {
        this.applyServerState(serverSnap, true);
        this.history = [];
        this.killcam = null;
        this.sfx.spawn();
      }
      return;
    }
    if (!serverSnap.alive) {
      this.applyServerState(serverSnap, true);
      this.history = [];
      return;
    }
    const idx = this.history.findIndex((h) => h.seq === ack);
    if (idx < 0) {
      this.applyServerState(serverSnap, false);
      return;
    }
    const predicted = this.history[idx].before;
    const err = dist(predicted.pos, serverSnap.pos);
    const stateMismatch =
      predicted.alive !== serverSnap.alive ||
      Math.abs(predicted.grapple.chain - serverSnap.grapple.chain) > 1 ||
      (predicted.grapple.active && !serverSnap.grapple.active && predicted.grapple.mode === 'swing');
    if (err > 0.09 || stateMismatch) {
      this.applyServerState(serverSnap, false);
      // Replay the inputs the authority has not consumed yet.
      const keepYaw = this.lookYaw;
      const keepPitch = this.lookPitch;
      for (let i = idx + 1; i < this.history.length; i++) {
        const entry = this.history[i];
        this.events.length = 0;
        stepPlayer(this.local, entry.frame, DT, this.phys, ARENA, this.remoteSim, this.events);
      }
      this.local.yaw = keepYaw;
      this.local.pitch = keepPitch;
      this.local.look = lookDir(this.lookYaw, this.lookPitch);
      updateEye(this.local);
      this.history.splice(0, idx + 1);
    } else {
      this.history.splice(0, idx + 1);
    }
  }

  private applyServerState(s: PlayerSnap, hard: boolean): void {
    this.local.pos = { ...s.pos };
    this.local.vel = { ...s.vel };
    this.local.alive = s.alive;
    this.local.grounded = s.grounded;
    this.local.sliding = s.sliding;
    this.local.scopeT = s.scopeT;
    this.local.scoped = s.scoped;
    this.local.protect = s.protect;
    this.local.exposure = s.exposure;
    this.local.respawnIn = s.respawnIn;
    this.local.grapple.active = s.grapple.active;
    this.local.grapple.mode = s.grapple.mode;
    this.local.grapple.anchor = { ...s.grapple.anchor };
    this.local.grapple.length = s.grapple.length;
    this.local.grapple.chain = s.grapple.chain;
    this.local.grapple.target = s.grapple.target;
    this.local.fireCooldown = Math.max(this.local.fireCooldown, 0);
    if (hard) {
      this.applyServerYaw(s.yaw, s.pitch);
    }
    updateEye(this.local);
    this.phys.setPosition(this.local.id, this.local.pos);
  }

  private applyServerYaw(yaw: number, pitch: number): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
    this.local.yaw = yaw;
    this.local.pitch = pitch;
    this.local.look = lookDir(yaw, pitch);
  }

  private onShotMsg(msg: Extract<ServerMsg, { t: 'shot' }>): void {
    const mine = msg.shooter === this.you;
    const color = mine ? SKINS[this.you].color : SKINS[1 - this.you].color;
    this.renderer.tracer(msg.origin, msg.end, color);
    this.renderer.spark(msg.end, color, msg.hit ? 6 : 3);
    if (msg.hit) {
      this.hud.hitmarker(true);
      if (mine) {
        this.renderer.hitConfirm(msg.end, {
          x: msg.end.x - msg.origin.x,
          y: msg.end.y - msg.origin.y,
          z: msg.end.z - msg.origin.z,
        }, color);
      }
      if (!mine) {
        // We got shot: the kill event handles the rest, this is the impact.
        this.renderer.shake(0.02);
        this.renderer.hurt(0.35);
        this.hud.damage();
        const dx = msg.origin.x - this.local.eye.x;
        const dz = msg.origin.z - this.local.eye.z;
        const bearing = Math.atan2(-dx, -dz);
        let rel = bearing - this.lookYaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        this.hud.hitDirection(rel);
      }
    }
    if (!mine) {
      const sp = this.sfx.spatial(msg.origin, this.local.eye, this.lookYaw);
      this.sfx.shot(false, sp.pan, sp.distance);
      // Their rifle moves, because a shot with no body behind it is a texture.
      this.renderer.shotKick(1 - this.you);
      if (!msg.hit) this.nearMiss(msg);
    }
  }

  /**
   * A supersonic round passing close enough to break the air.
   *
   * Distance is measured to the *segment*, not to the muzzle or the impact, so
   * a shot that cracks past your head at 2 m from a shooter 60 m away registers
   * even though both of its endpoints are far off. Purely cosmetic: it fires
   * after the server has already resolved the shot, and it can never change a
   * hit.
   */
  private nearMiss(msg: Extract<ServerMsg, { t: 'shot' }>): void {
    const eye = this.local.eye;
    const ax = msg.origin.x;
    const ay = msg.origin.y;
    const az = msg.origin.z;
    const bx = msg.end.x;
    const by = msg.end.y;
    const bz = msg.end.z;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-3) return;
    let t = ((eye.x - ax) * dx + (eye.y - ay) * dy + (eye.z - az) * dz) / len2;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const cz = az + dz * t;
    const miss = Math.hypot(eye.x - cx, eye.y - cy, eye.z - cz);
    const radius = 5.5;
    if (miss > radius) return;
    const closeness = 1 - miss / radius;
    const point = { x: cx, y: cy, z: cz };
    this.renderer.nearMiss(point, closeness);
    const sp = this.sfx.spatial(point, eye, this.lookYaw);
    this.sfx.crack(closeness, sp.pan);
    // A physical flinch, not a damage flash: the whole picture jolts a hair.
    this.renderer.punch((Math.random() - 0.5) * 0.02 * closeness, (Math.random() - 0.5) * 0.03 * closeness);
  }

  private onKillMsg(msg: Extract<ServerMsg, { t: 'kill' }>): void {
    const me = this.you;
    this.hud.setScore(msg.scores[0], msg.scores[1], me, this.net.playerName, this.net.opponentName);
    if (msg.event.killer === me) {
      this.hud.hitmarker(true);
      this.hud.killBanner(`ELIMINATED  +${ECONOMY.killCoins} ◆`);
      this.renderer.killPunch();
      this.sfx.hitmarker(true);
      this.renderer.punch(-0.035, 0);
      this.renderer.shake(0.014);
      this.hud.feedLine(`YOU KILLED ${this.net.opponentName}`, 'me');
      this.renderer.shatter(msg.victimAt, SKINS[1 - me].color);
      this.matchKills += 1;
      this.hud.coinPopup(ECONOMY.killCoins);
      const fx = killEffect(this.progress.state.loadout.effect);
      this.renderer.killBurst(msg.victimAt, fx.id, 1, {
        x: msg.victimAt.x - this.local.eye.x,
        y: msg.victimAt.y - this.local.eye.y,
        z: msg.victimAt.z - this.local.eye.z,
      });
      this.sfx.killFx(fx.sound);
      this.hitstop = WEAPON.hitstop;
    } else if (msg.event.victim === me) {
      this.sfx.death();
      this.hud.damage();
      this.renderer.hurt(0.9);
      this.renderer.shatter(msg.victimAt, SKINS[me].color);
      // The effect that killed you is the killer's, so you learn what to buy.
      if (this.remoteView.look) {
        this.renderer.killBurst(msg.victimAt, this.remoteView.look.effect, 0.8, {
          x: this.local.eye.x - msg.victimAt.x,
          y: this.local.eye.y - msg.victimAt.y,
          z: this.local.eye.z - msg.victimAt.z,
        });
      }
      const killerIdx = msg.event.killer === 1 - me ? 1 - me : -1;
      if (killerIdx >= 0) {
        this.killcam = { t: 0, killerPos: { ...this.remoteSim.pos }, victimPos: { ...msg.victimAt } };
        this.hud.killBanner(`KILLED BY ${this.net.opponentName}`);
        this.hud.feedLine(`${this.net.opponentName} KILLED YOU`, 'them');
      } else {
        this.hud.killBanner(msg.event.cause === 'ring' ? 'CONSUMED BY THE RING' : 'LOST TO THE VOID');
        this.hud.feedLine(msg.event.cause === 'ring' ? 'THE RING TOOK YOU' : 'YOU FELL', 'them');
      }
      this.renderer.shake(0.03);
    } else {
      this.hud.feedLine(`${this.net.opponentName} DIED`, 'system');
    }
    if (msg.phase === 'over') this.matchOver = true;
  }

  private onOverMsg(msg: Extract<ServerMsg, { t: 'over' }>): void {
    this.matchOver = true;
    this.resultsOpen = true;
    this.input.exitLock();
    const won = msg.winner === this.you;
    const draw = msg.draw || msg.winner === null;
    const title = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
    const eyebrow = msg.forfeited !== null ? 'OPPONENT FORFEITED' : draw ? 'PERFECT STALEMATE' : won ? 'DUEL WON' : 'DUEL LOST';
    const note = msg.forfeited !== null
      ? 'THE SEAT WENT COLD. POINT AWARDED.'
      : draw
        ? 'BOTH DIED ON THE SAME FRAME. THE VOID KEEPS SCORE.'
        : won
          ? 'THE ROPE REMEMBERS.'
          : 'WATCH THE GLINT. MOVE AFTER EVERY SHOT.';
    const reward = matchReward(this.matchKills, draw ? 'draw' : won ? 'win' : 'loss');
    const payout = this.progress.applyReward(reward);
    this.hud.showResults({
      title,
      eyebrow,
      score: `${msg.scores[this.you]} — ${msg.scores[1 - this.you]}`,
      note,
      win: won && !draw,
    });
    const rewardCoins = document.getElementById('reward-coins');
    const rewardXp = document.getElementById('reward-xp');
    const rewardLevel = document.getElementById('reward-level');
    const rewardLevelNote = document.getElementById('reward-level-note');
    if (rewardCoins) rewardCoins.textContent = `+${reward.coins + payout.bonus}`;
    if (rewardXp) rewardXp.textContent = `+${reward.xp}`;
    if (rewardLevel) rewardLevel.textContent = `LV ${payout.after.level}`;
    if (rewardLevelNote) {
      rewardLevelNote.textContent = payout.after.level > payout.before.level ? `LEVEL UP +${payout.bonus}` : 'LEVEL';
    }
    if (payout.after.level > payout.before.level) {
      this.hud.bannerText(`LEVEL ${payout.after.level}`, 'me', 2600);
      // The level fanfare lands a beat after the match stinger, not on top of it.
      window.setTimeout(() => this.sfx.ui('level'), 420);
    } else if (reward.coins > 0) {
      window.setTimeout(() => this.sfx.ui('reward'), 260);
    }
    this.refreshProfile();
    // The match stinger replaces the hitmarker: the result deserves its own
    // music instead of a louder version of a shot landing.
    this.sfx.matchEnd(won, draw);
    if (won) this.hud.bannerText('VICTORY', 'me', 2400);
    else if (!draw) this.hud.bannerText('DEFEAT', 'them', 2400);
    this.inMatch = false;
    this.hud.showGame(false);
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  private frame(nowMs: number): void {
    const now = nowMs / 1000;
    const dt = this.lastFrame === 0 ? 0 : clamp(now - this.lastFrame, 0, 0.1);
    this.lastFrame = now;
    if (dt > 0) this.frameDt = dt;
    const state = this.net.state;
    const playing = this.inMatch && this.started && !this.paused && !this.resultsOpen;

    if (playing) {
      this.updateLook();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= DT && steps < 6) {
        this.tick(DT);
        this.accumulator -= DT;
        steps++;
      }
      if (this.accumulator > DT * 6) this.accumulator = 0;
      this.updateRemote();
      const gr = this.local.grapple;
      // Reel speed drives the grapnel whirr: a zip screams, a slow payout ticks.
      const reel = this.local.hook.active ? 0.85 : gr.active ? (gr.mode === 'zip' ? 1 : 0.4) : 0;
      this.sfx.mix(this.local.speed, gr.active, this.local.alive, {
        grounded: this.local.grounded,
        reel,
        sliding: this.local.sliding,
        dt,
      });
      if (this.killcam) {
        this.killcam.t += dt;
        if (!this.local.alive && this.killcam.t > 5) this.killcam = null;
      }
      this.drawHud();
      const frac = clamp(this.accumulator / DT, 0, 1);
      // Hitstop freezes the picture, never the simulation.
      const visDt = this.hitstop > 0 ? 0 : dt;
      if (this.hitstop > 0) this.hitstop -= dt;
      this.updateGrappleAim();
      this.renderer.update(visDt, {
        local: this.local,
        eye: {
          x: lerp(this.prevEye.x, this.local.eye.x, frac),
          y: lerp(this.prevEye.y, this.local.eye.y, frac),
          z: lerp(this.prevEye.z, this.local.eye.z, frac),
        },
        localRope: this.ropeOf(this.local),
        remote: this.remoteView,
        remoteRope: this.remoteView.hook.active
          ? { active: true, anchor: this.remoteView.hook.pos, length: 0, mode: 'none', inFlight: true }
          : this.remoteView.grapple.active
            ? {
                active: true,
                anchor: this.remoteView.grapple.anchor,
                length: this.remoteView.grapple.length,
                mode: this.remoteView.grapple.mode,
              }
            : { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' },
        ringRadius: this.ringRadius(),
        ringActive: this.ringActive(),
        scoped: this.local.scopeT,
        glintVisible: this.glintVisible(),
        glintIntensity: this.remoteView.glint,
        killcam: this.killcam,
        reducedFx: false,
        groundLocal: this.groundUnder(this.local.pos, this.local.id),
        groundRemote: this.remoteView.alive ? this.groundUnder(this.remoteView.pos, 1 - this.you) : null,
      });
      this.renderer.setRingColor(this.insideRing());
    } else if (this.menuOpen || this.resultsOpen || !this.started || state === 'idle') {
      this.renderer.orbit(dt);
    } else {
      // Paused: keep the last frame alive but frozen.
      this.renderer.update(0, {
        local: this.local,
        localRope: this.ropeOf(this.local),
        remote: this.remoteView,
        remoteRope: { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' },
        ringRadius: this.ringRadius(),
        ringActive: this.ringActive(),
        scoped: this.local.scopeT,
        glintVisible: false,
        glintIntensity: 0,
        killcam: null,
        reducedFx: true,
        groundLocal: this.groundUnder(this.local.pos, this.local.id),
        groundRemote: null,
      });
    }
    this.renderer.render();
    this.guardFrameRate(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Keeps the frame budget honest on slower GPUs. Resolution changes cost a
   * render-target reallocation, so they happen rarely, never drop below 0.75
   * (soft is worse than 55 fps), and pause while the picture is frozen.
   */
  private guardFrameRate(dt: number): void {
    if (dt <= 0 || this.hitstop > 0) return;
    this.frameTimeEma += (dt - this.frameTimeEma) * 0.05;
    this.qualityTimer += dt;
    if (this.qualityTimer < 2.5) return;
    this.qualityTimer = 0;
    const slow = this.frameTimeEma > 1 / 50;
    const fast = this.frameTimeEma < 1 / 58;
    if (slow && this.quality > 0.75) {
      this.quality = Math.max(0.75, this.quality - 0.1);
      this.renderer.setQuality(this.quality);
    } else if (fast && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.05);
      this.renderer.setQuality(this.quality);
    }
  }

  private updateLook(): void {
    const sens = this.input.sensitivity * lerp(1, this.input.scopedSensitivity, smoothstep(0.5, 1, this.local.scopeT));
    if (this.input.look.dx !== 0 || this.input.look.dy !== 0) {
      this.lookYaw -= this.input.look.dx * sens;
      this.lookPitch -= this.input.look.dy * sens;
      this.lookPitch = clamp(this.lookPitch, -1.45, 1.45);
      this.input.look.dx = 0;
      this.input.look.dy = 0;
    }
    this.local.yaw = this.lookYaw;
    this.local.pitch = this.lookPitch;
    this.local.look = lookDir(this.lookYaw, this.lookPitch);
    updateEye(this.local);
    // Scope in/out click, once per transition.
    if (Math.abs(this.local.scopeT - this.lastScopeAt) > 0.5) {
      this.lastScopeAt = this.local.scopeT;
      this.sfx.scope(this.local.scopeT > 0.5);
    }
  }

  private tick(dt: number): void {
    if (!this.started) return;
    this.seq++;
    const frame: InputFrame = { seq: this.seq, keys: this.input.keys, yaw: this.lookYaw, pitch: this.lookPitch };
    this.history.push({ seq: this.seq, frame, before: clonePlayerState(this.local) });
    if (this.history.length > 90) this.history.shift();
    this.events.length = 0;
    this.prevEye = { ...this.local.eye };
    stepPlayer(this.local, frame, dt, this.phys, ARENA, this.remoteSim, this.events);
    this.handleEvents();
    this.net.sendInput(frame);
    this.tryFire(this.input.takePressed(), dt);
    // Local respawn clock (the server owns the real one).
    if (!this.local.alive) this.local.respawnIn = Math.max(0, this.local.respawnIn - dt);
    if (this.chainAt > 0 && performance.now() > this.chainAt) {
      this.chainAt = 0;
      this.hud.setHint(false);
    }
  }

  private tryFire(pressed: number, dt: number): void {
    if (this.local.slot !== 0) return;
    // One click, one bullet: the trigger is edge-triggered, never held. A press
    // is buffered for a moment so clicking just before the bolt closes still
    // fires, which is what the shot after a fast reload should feel like.
    if ((pressed & KEY.fire) !== 0) this.fireBuffer = 0.16;
    else this.fireBuffer = Math.max(0, this.fireBuffer - dt);
    if (this.fireBuffer <= 0) return;
    if (!this.local.alive || this.local.fireCooldown > 0 || this.local.protect > 0) return;
    this.fireBuffer = 0;

    const scoped = this.local.scopeT > 0.985;
    const view = lookOf(this.local);
    const dir = spreadShotDir(view, scoped, Math.random(), Math.random());
    const origin = this.local.eye;
    const shot: ShotMessage = {
      seq: this.seq,
      origin: { ...origin },
      dir,
      scoped,
      aimTime: this.net.serverNow() - this.interpDelay,
    };
    markFired(this.local);
    this.local.scopeT = Math.max(0, this.local.scopeT - 0.35); // recoil breaks the scope
    this.local.scoped = this.local.scopeT > 0.985;
    this.net.sendShot(shot);
    this.renderer.recoil();
    this.renderer.punch(0.012 + (scoped ? 0 : 0.008), (Math.random() - 0.5) * 0.006);
    this.renderer.shake(scoped ? 0.008 : 0.013);
    this.sfx.shot(true);
    // Cosmetic prediction: a tracer from the muzzle and an impact spark.
    const end = resolveShot(this.phys, origin, dir, { pos: this.remoteSim.pos, alive: this.remoteSim.alive }, this.local.id);
    this.renderer.tracer(muzzleOffset(origin, dir), end.end, SKINS[this.you].color);
    if (!end.hit) this.renderer.spark(end.end, 0x9df9ff, 4, end.normal);
  }

  private handleEvents(): void {
    for (const e of this.events) {
      switch (e.type) {
        case 'jump':
          this.sfx.jump();
          break;
        case 'land': {
          this.sfx.land(e.strength);
          this.renderer.shake(0.004 + e.strength * 0.01);
          // The rifle takes the impact a beat after the legs do.
          this.renderer.landKick(e.strength);
          // Dust at the feet: a landing has to move the world, not just the lens.
          const g = this.groundUnder(this.local.pos, this.local.id);
          if (typeof g === 'number') this.renderer.landDust({ x: this.local.pos.x, y: g + 0.05, z: this.local.pos.z }, e.strength);
          break;
        }
        case 'dash':
          this.sfx.dash();
          this.renderer.shake(0.01);
          break;
        case 'attach': {
          const sp = this.sfx.spatial(this.local.grapple.anchor, this.local.eye, this.lookYaw);
          this.sfx.attach(sp.distance, sp.pan * 0.4);
          this.renderer.shake(0.014);
          this.renderer.punch(-0.01, 0);
          this.renderer.fovPulse(e.strength > 0.6 ? 5 : 3);
          if (this.local.grapple.target === 1) this.hud.bannerText('HOOKED THE OPPONENT', 'me', 900);
          break;
        }
        case 'zip':
          this.sfx.zip();
          break;
        case 'release':
          this.sfx.release(0.3);
          break;
        case 'boost':
          this.sfx.release(e.strength);
          this.renderer.shake(0.02 * e.strength);
          this.renderer.fovPulse(7 * e.strength);
          this.renderer.punch(-0.018 * e.strength, 0);
          break;
        case 'chain':
          this.sfx.chain(this.local.grapple.chain);
          this.hud.bannerText(`CHAIN ×${this.local.grapple.chain}`, 'me', 700);
          break;
        case 'grappleMiss':
          this.sfx.release(0);
          break;
        case 'grappleBreak':
          this.sfx.release(0.15);
          break;
        case 'equip':
          this.sfx.equip(e.strength > 0.5);
          break;
        case 'hookFire':
          this.sfx.hookFire();
          this.renderer.hookFire();
          break;
        case 'hookHit':
          this.sfx.attach(0, 0);
          this.renderer.hookHit(this.local.hook.pos);
          this.renderer.shake(0.01);
          break;
        case 'hookMiss':
          this.sfx.hookMiss();
          // Reel the empty claw back to the hand rather than blinking it out.
          this.renderer.retractHook(0, this.local.hook.pos);
          break;
      }
    }
  }

  /**
   * Feeds the world-space grapnel reticle. Recomputed every frame because the
   * answer changes with a single degree of aim, which is exactly the feedback
   * the player needs before committing a throw.
   */
  private updateGrappleAim(): void {
    if (!this.local.alive || this.local.slot !== 1 || this.local.hook.active) {
      this.renderer.setGrappleAim(null);
      this.hookAim = 0;
      return;
    }
    const target = findGrappleTarget(this.phys, this.local.eye, lookOf(this.local), this.remoteSim, ARENA, this.local.id);
    this.hookAim = target ? (target.target === 1 ? 2 : 1) : 0;
    this.renderer.setGrappleAim(target ? target.point : null, target?.target === 1);
  }

  private updateRemote(): void {
    const buf = this.snapBuf;
    if (buf.length < 2) return;
    // ── Playback clock ──────────────────────────────────────────────────────
    // Advancing the playhead by the frame time and gently steering it toward
    // "server now minus the buffer" is what removes the last source of visible
    // stutter: rebasing straight onto each arriving snapshot smuggles every bit
    // of network jitter into the remote player's motion.
    const want = this.net.serverNow() - this.interpDelay;
    if (!this.playheadValid) {
      this.playhead = want;
      this.playheadValid = true;
    } else {
      this.playhead += this.frameDt;
      const err = want - this.playhead;
      if (Math.abs(err) > 0.5) {
        // Tab was suspended, or we reconnected: jump instead of gliding.
        this.playhead = want;
      } else {
        this.playhead += err * 0.12;
      }
    }
    const target = this.playhead;
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].time <= target && buf[i + 1].time >= target) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
      if (buf[i].time > target) {
        a = buf[i];
        b = buf[i];
        break;
      }
    }
    const span = b.time - a.time;
    const f = span > 0.0001 ? clamp((target - a.time) / span, 0, 1) : 1;
    const pa = a.snap.players[1 - this.you];
    const pb = b.snap.players[1 - this.you];
    if (!pa || !pb) return;
    const pos = {
      x: lerp(pa.pos.x, pb.pos.x, f),
      y: lerp(pa.pos.y, pb.pos.y, f),
      z: lerp(pa.pos.z, pb.pos.z, f),
    };
    const yaw = lerpAngle(pa.yaw, pb.yaw, f);
    const pitch = lerp(pa.pitch, pb.pitch, f);
    const view = this.remoteView;
    view.pos = pos;
    view.yaw = yaw;
    view.pitch = pitch;
    view.alive = pb.alive;
    view.sliding = pb.sliding;
    view.scoped = pb.scoped;
    view.glint = pb.glint;
    view.speed = pb.speed;
    view.scopeT = pb.scopeT;
    // Grounded if either sample says so: a snapshot that lands mid-hop must not
    // flicker the skeleton into an air pose for a single frame.
    view.grounded = pa.grounded || pb.grounded;
    view.vel = {
      x: lerp(pa.vel.x, pb.vel.x, f),
      y: lerp(pa.vel.y, pb.vel.y, f),
      z: lerp(pa.vel.z, pb.vel.z, f),
    };
    view.grapple = {
      active: pb.grapple.active,
      mode: pb.grapple.mode,
      anchor: pb.grapple.anchor,
      length: pb.grapple.length,
      target: pb.grapple.target,
    };
    view.slot = pb.slot;
    view.hook = { active: pb.hook.active, pos: { ...pb.hook.pos } };
    this.remotePrev.pos = { ...pos };
    this.remotePrev.yaw = yaw;
    this.remotePrev.pitch = pitch;
    this.remotePrev.alive = pb.alive;
    updateEye(this.remotePrev);
    this.remoteSim.pos = { ...pos };
    this.remoteSim.alive = pb.alive;
    this.remoteSim.yaw = yaw;
    this.remoteSim.pitch = pitch;
  }

  private drawHud(): void {
    const scoped = this.local.scopeT > 0.5;
    const hipSpread = scoped ? 0 : WEAPON.hipSpreadDeg;
    this.hud.frame({
      speed: this.local.speed,
      scopeT: this.local.scopeT,
      hipSpread,
      fireCooldown: this.local.fireCooldown,
      chain: this.local.grapple.chain,
      alive: this.local.alive,
      respawnIn: this.respawnIn,
      protect: this.protect > 0,
      slot: this.local.slot,
      hookFlying: this.local.hook.active,
      hooked: this.local.grapple.active,
      hookAim: this.hookAim,
    });
    this.hud.setWeaponLabel(this.local.slot === 1 ? 'GRAPNEL' : SKINS[this.you].weapon === 'lance' ? 'LANCE' : 'NEEDLE');
    this.hud.setRing(this.ringActive(), this.ringRadius(), this.insideRing(), this.serverMatchTime);
    this.hud.setTimer(this.serverMatchTime);
    this.hud.setNet(
      this.net.latency,
      this.net.state === 'open' ? (this.net.offline ? 'LOCAL' : 'ONLINE') : 'OFFLINE',
      this.net.state === 'open' ? 'ok' : 'bad',
    );
    this.hud.setHint(performance.now() < this.hintUntil);
    if (this.ringActive() && !this.insideRing() && performance.now() - this.ringWarnSound > 1200) {
      this.ringWarnSound = performance.now();
      this.sfx.ringWarn();
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────
  private ringRadius(): number {
    const s = this.snapBuf[this.snapBuf.length - 1];
    return s ? s.snap.match.ringRadius : MATCH.ringRadiusStart;
  }

  private ringActive(): boolean {
    const s = this.snapBuf[this.snapBuf.length - 1];
    return s ? s.snap.match.ringActive : false;
  }

  private insideRing(): boolean {
    return Math.hypot(this.local.pos.x - MATCH.ringCenter.x, this.local.pos.z - MATCH.ringCenter.z) <= this.ringRadius();
  }

  /** Ground height under a player, for their contact shadow. */
  private groundUnder(pos: Vec3, id: number): number | null {
    const hit = this.phys.raycast({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 }, 40, id);
    return hit ? hit.point.y : null;
  }

  private glintVisible(): boolean {
    if (!this.remoteView.alive) return false;
    return glintVisibility(
      this.remoteView.pos,
      lookDir(this.remoteView.yaw, this.remoteView.pitch),
      this.local.eye,
    ) > 0.02;
  }

  private ropeOf(p: PlayerState): RopeView {
    // The claw pays out a live cable while it flies, so the throw has a line.
    if (p.hook.active) {
      return { active: true, anchor: p.hook.pos, length: 0, mode: 'none', inFlight: true };
    }
    return {
      active: p.grapple.active && p.grapple.mode !== 'none',
      anchor: p.grapple.anchor,
      length: p.grapple.length,
      mode: p.grapple.mode,
    };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Boots the game into the already-rendered shell.
 *
 * React mounts the DOM first (see `main.tsx`), then this runs: everything below
 * looks its elements up by id on the first line, so the order matters.
 */
export async function bootGame(): Promise<void> {
  const status = document.getElementById('menu-status');
  try {
    await initRapier();
  } catch {
    if (status) {
      status.textContent = 'PHYSICS FAILED TO INITIALISE';
      status.className = 'bad';
    }
    return;
  }
  try {
    new Game();
  } catch (err) {
    // No WebGL: say so on the menu instead of showing a black screen.
    if (status) {
      status.textContent = 'WEBGL UNAVAILABLE — ENABLE HARDWARE ACCELERATION';
      status.className = 'bad';
    }
    console.error(err);
  }
}
