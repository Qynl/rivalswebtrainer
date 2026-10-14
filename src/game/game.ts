import { PLAYER, SCYTHE, WEAPONS, type Difficulty, type WeaponId } from './config';
import { addHorizontalImpulse, createMoveState, stepMovement, type Aabb, type MoveEvents, type MoveInput, type MoveState, type Vec3 } from './movement';
import { buildArena, SPAWN_CANDIDATES, ARENA_HALF, type ArenaBox } from './map';
import {
  castRay, createScytheState, createWeaponState, inScytheArc, startDash, startReload, startSwing,
  swingActive, tickScythe, tickWeapon, tryFire, type ScytheState, type Target, type WeaponState,
} from './combat';
import { Bot, type BotCommand, type BotPerception } from './bot';
import { buildNavGrid, type NavGrid } from './nav';
import { createMatch, endRound, tickMatch, timeoutResult, type MatchState } from './match';

/** Unified per-frame intent. The human fills it from input; the bot fills it from its brain. */
export interface Command {
  move: MoveInput;
  yaw: number;
  pitch: number;
  fire: boolean;
  fireEdge: boolean;
  melee: boolean;
  dash: boolean;
  reload: boolean;
  slot: 1 | 2 | 3 | null;
}

export type ActorId = 'player' | 'bot';

export interface Actor {
  id: ActorId;
  move: MoveState;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  pistol: WeaponState;
  primary: WeaponState;
  slot: 1 | 2 | 3;
  scythe: ScytheState;
  dashDir: Vec3;
  dashHit: boolean;
  flash: number;
}

export type GameEvent =
  | { type: 'shot'; by: ActorId; from: Vec3; to: Vec3; hit: boolean; head: boolean }
  | { type: 'hit'; by: ActorId; target: ActorId; amount: number; head: boolean; at: Vec3 }
  | { type: 'swing'; by: ActorId }
  | { type: 'dash'; by: ActorId }
  | { type: 'reload'; by: ActorId }
  | { type: 'move'; by: ActorId; ev: MoveEvents }
  | { type: 'death'; target: ActorId }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; result: 'player' | 'bot' | 'draw' }
  | { type: 'matchEnd'; winner: 'player' | 'bot' | 'draw' };

/** Primary (slot 2) and secondary (slot 1) gun, plus the difficulty of the bot opponent. */
export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
  difficulty: Difficulty;
}

export class Game {
  readonly solids: ArenaBox[];
  readonly nav: NavGrid;
  match: MatchState;
  player!: Actor;
  bot!: Actor;
  private brain!: Bot;
  private events: GameEvent[] = [];
  private lastRound = 0;

  constructor(public loadout: Loadout, private rng: () => number = Math.random) {
    this.solids = buildArena();
    this.nav = buildNavGrid(this.solids, ARENA_HALF, 1);
    this.match = createMatch();
    this.resetMatch();
  }

  resetMatch(): void {
    this.match = createMatch();
    this.lastRound = 0;
    this.player = this.makeActor('player');
    this.bot = this.makeActor('bot');
    this.brain = new Bot(this.loadout.difficulty, this.rng);
    this.beginRound();
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private makeActor(id: ActorId): Actor {
    return {
      id,
      move: createMoveState({ x: 0, y: 0, z: 0 }),
      yaw: 0,
      pitch: 0,
      hp: PLAYER.maxHp,
      alive: true,
      pistol: createWeaponState(this.loadout.secondary),
      primary: createWeaponState(this.loadout.primary),
      slot: 2,
      scythe: createScytheState(),
      dashDir: { x: 0, y: 0, z: -1 },
      dashHit: false,
      flash: 0,
    };
  }

  /** Spawns both actors for the current round. Sides swap each round for fairness. */
  private beginRound(): void {
    const swap = this.match.round % 2 === 0;
    const a = SPAWN_CANDIDATES[swap ? 1 : 0];
    const b = SPAWN_CANDIDATES[swap ? 0 : 1];
    this.placeActor(this.player, a, Math.atan2(-(b.x - a.x), -(b.z - a.z)));
    this.placeActor(this.bot, b, Math.atan2(-(a.x - b.x), -(a.z - b.z)));
    this.player.hp = PLAYER.maxHp;
    this.bot.hp = PLAYER.maxHp;
    this.player.pistol = createWeaponState(this.loadout.secondary);
    this.player.primary = createWeaponState(this.loadout.primary);
    this.bot.pistol = createWeaponState(this.loadout.secondary);
    this.bot.primary = createWeaponState(this.loadout.primary);
    this.brain = new Bot(this.loadout.difficulty, this.rng);
    this.lastRound = this.match.round;
    this.events.push({ type: 'roundStart', round: this.match.round });
  }

  private placeActor(a: Actor, pos: Vec3, yaw: number): void {
    a.move = createMoveState(pos);
    a.yaw = yaw;
    a.pitch = 0;
    a.alive = true;
    a.slot = 2;
    a.scythe = createScytheState();
    a.dashHit = false;
    a.flash = 0;
  }

  private hitboxOf(a: Actor): Target {
    const r = PLAYER.radius;
    const f = a.move.pos;
    const h = a.move.height;
    const body: Aabb = { min: { x: f.x - r, y: f.y, z: f.z - r }, max: { x: f.x + r, y: f.y + h, z: f.z + r } };
    const head: Aabb = { min: { x: f.x - r * 0.8, y: f.y + h - 0.4, z: f.z - r * 0.8 }, max: { x: f.x + r * 0.8, y: f.y + h + 0.05, z: f.z + r * 0.8 } };
    return { id: a.id, body, head };
  }

  private eyeOf(a: Actor): Vec3 {
    const eye = a.move.height === PLAYER.slideHeight ? PLAYER.eyeSlide : PLAYER.eyeStand;
    return { x: a.move.pos.x, y: a.move.pos.y + eye, z: a.move.pos.z };
  }

  private weaponOf(a: Actor): WeaponState | null {
    if (a.slot === 1) return a.pistol;
    if (a.slot === 2) return a.primary;
    return null;
  }

  private perceptionFor(): BotPerception {
    const b = this.bot;
    const p = this.player;
    return {
      self: b.move.pos,
      selfVelocity: b.move.vel,
      playerFeet: p.move.pos,
      playerVelocity: p.move.vel,
      playerSliding: p.move.sliding,
      playerHeight: p.move.height,
      solids: this.solids,
      targets: [this.hitboxOf(p)],
      nav: this.nav,
      rangePreference: WEAPONS[b.primary.id].rangePref,
      ammo: (b.slot === 1 ? b.pistol : b.primary).ammo,
      reloading: (b.slot === 1 ? b.pistol : b.primary).reloadTimer > 0,
      scytheReady: b.scythe.cooldown <= 0,
      dashReady: b.scythe.dashCooldown <= 0,
    };
  }

  /** Advances the simulation by dt with the human's command. */
  step(dt: number, playerCmd: Command): void {
    if (this.match.phase === 'over') return;

    const timeUp = tickMatch(this.match, dt);
    if (this.match.round !== this.lastRound && this.match.phase === 'live') {
      this.beginRound();
    }
    if (this.match.phase !== 'live') return;
    if (timeUp) {
      const result = timeoutResult(this.player.hp, this.bot.hp);
      this.finish(result);
      return;
    }

    const botCmd: BotCommand = this.brain.update(this.perceptionFor(), dt);
    const botIntent: Command = {
      move: botCmd.move,
      yaw: botCmd.yaw,
      pitch: botCmd.pitch,
      fire: botCmd.wantFire,
      fireEdge: botCmd.fireEdge,
      melee: botCmd.wantMelee,
      dash: botCmd.wantDash,
      reload: botCmd.wantReload,
      slot: null,
    };

    this.applyCommand(this.player, playerCmd, dt, this.bot);
    if (this.match.phase === 'live') this.applyCommand(this.bot, botIntent, dt, this.player);

    this.player.flash = Math.max(0, this.player.flash - dt);
    this.bot.flash = Math.max(0, this.bot.flash - dt);
  }

  private finish(result: 'player' | 'bot' | 'draw'): void {
    endRound(this.match, result);
    this.events.push({ type: 'roundEnd', result });
    if (this.match.phase === 'over') {
      this.events.push({ type: 'matchEnd', winner: this.match.winner ?? 'draw' });
    }
  }

  private applyCommand(a: Actor, cmd: Command, dt: number, enemy: Actor): void {
    if (!a.alive) return;
    tickWeapon(a.pistol, dt);
    tickWeapon(a.primary, dt);
    tickScythe(a.scythe, dt);
    a.yaw = cmd.yaw;
    a.pitch = cmd.pitch;

    if (cmd.slot !== null) a.slot = cmd.slot;

    if (cmd.reload) {
      const w = this.weaponOf(a);
      if (w) {
        startReload(w);
        this.events.push({ type: 'reload', by: a.id });
      }
    }

    if (a.slot === 3) {
      if (cmd.melee && startSwing(a.scythe)) this.events.push({ type: 'swing', by: a.id });
      if (cmd.dash && startDash(a.scythe)) {
        a.dashHit = false;
        const m = cmd.move;
        const fx = -Math.sin(cmd.yaw);
        const fz = -Math.cos(cmd.yaw);
        const rx = Math.cos(cmd.yaw);
        const rz = -Math.sin(cmd.yaw);
        let dx = fx * m.forward + rx * m.strafe;
        let dz = fz * m.forward + rz * m.strafe;
        if (Math.hypot(dx, dz) < 1e-4) {
          dx = fx;
          dz = fz;
        }
        a.dashDir = { x: dx, y: 0, z: dz };
        this.events.push({ type: 'dash', by: a.id });
      }
    } else {
      const w = this.weaponOf(a);
      if (w) {
        const shots = tryFire(w, cmd.fire, cmd.fireEdge);
        for (let i = 0; i < shots; i++) this.fireShot(a, w, enemy);
      }
    }

    // Movement; the dash overrides horizontal speed for its duration.
    const ev = stepMovement(a.move, cmd.move, dt, this.solids);
    if (a.scythe.dashTimer > 0) addHorizontalImpulse(a.move, a.dashDir.x, a.dashDir.z, SCYTHE.dashSpeed);
    if (ev.jumped || ev.landed || ev.slideStarted || ev.slideEnded || ev.slideJumped) {
      this.events.push({ type: 'move', by: a.id, ev });
    }

    // Scythe slash
    if (a.slot === 3 && swingActive(a.scythe) && !a.scythe.hasHit && enemy.alive) {
      const dy = Math.abs(enemy.move.pos.y - a.move.pos.y);
      if (dy < 2 && inScytheArc(a.move.pos, a.yaw, enemy.move.pos)) {
        a.scythe.hasHit = true;
        this.damage(enemy, SCYTHE.damage, a.id, false, enemy.move.pos);
      }
    }

    // Dash strike (once per dash)
    if (a.scythe.dashTimer > 0 && !a.dashHit && enemy.alive) {
      const d = Math.hypot(enemy.move.pos.x - a.move.pos.x, enemy.move.pos.z - a.move.pos.z);
      if (d <= SCYTHE.dashHitRange && Math.abs(enemy.move.pos.y - a.move.pos.y) < 2) {
        a.dashHit = true;
        this.damage(enemy, SCYTHE.dashDamage, a.id, false, enemy.move.pos);
      }
    }
  }

  private fireShot(a: Actor, w: WeaponState, enemy: Actor): void {
    const def = WEAPONS[w.id];
    const origin = this.eyeOf(a);
    const yaw = a.yaw + gauss(this.rng) * def.spread;
    const pitch = a.pitch + gauss(this.rng) * def.spread;
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const targets: Target[] = enemy.alive ? [this.hitboxOf(enemy)] : [];
    const hit = castRay(origin, dir, this.solids, targets, def.range);
    const to = hit.point;
    const landed = hit.targetId !== null;
    this.events.push({ type: 'shot', by: a.id, from: origin, to, hit: landed, head: hit.isHead });
    if (landed) {
      this.damage(enemy, def.damage * (hit.isHead ? def.headMult : 1), a.id, hit.isHead, to);
    }
  }

  private damage(target: Actor, amount: number, by: ActorId, head: boolean, at: Vec3): void {
    if (!target.alive) return;
    const dealt = Math.round(amount);
    target.hp = Math.max(0, target.hp - dealt);
    target.flash = 0.18;
    this.events.push({ type: 'hit', by, target: target.id, amount: dealt, head, at: { ...at } });
    if (target.hp <= 0) {
      target.alive = false;
      this.events.push({ type: 'death', target: target.id });
      this.finish(by === 'player' ? 'player' : 'bot');
    }
  }
}

/** Approximate gaussian from two uniforms (Box-Muller, one sample). */
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.5;
}

export function weaponName(id: WeaponId): string {
  return WEAPONS[id].name;
}
