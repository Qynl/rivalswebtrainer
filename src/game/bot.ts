import { BOT_DIFFICULTY, PLAYER, SCYTHE, type Difficulty } from './config';
import { castRay, type Target } from './combat';
import { findPath, type NavGrid } from './nav';
import type { Aabb, MoveInput, Vec3 } from './movement';

export interface BotCommand {
  move: MoveInput;
  yaw: number;
  pitch: number;
  wantFire: boolean; // trigger held this frame
  fireEdge: boolean; // trigger newly pressed (semi-auto)
  wantMelee: boolean;
  wantDash: boolean;
  wantReload: boolean;
}

export interface BotPerception {
  self: Vec3; // bot feet
  selfVelocity: Vec3;
  playerFeet: Vec3;
  playerVelocity: Vec3;
  playerSliding: boolean;
  playerHeight: number;
  solids: readonly Aabb[];
  targets: readonly Target[]; // the player's hitboxes for LOS (id 'player')
  nav: NavGrid;
  rangePreference: number; // ideal engagement distance
  ammo: number;
  reloading: boolean;
  scytheReady: boolean;
  dashReady: boolean;
}

export class Bot {
  private reactionTimer = 0;
  private sawPlayer = false;
  private lastKnown: Vec3 | null = null;
  private path: Vec3[] = [];
  private repathTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private aimErrorYaw = 0;
  private aimErrorPitch = 0;
  private aimErrorTimer = 0;
  private wasFiring = false;
  private meleeCooldown = 0;
  private dashIntent = 0;
  private jumpCooldown = 0;
  private lastFire = 0;

  constructor(private readonly diff: Difficulty, private readonly rng: () => number = Math.random) {}

  update(p: BotPerception, dt: number): BotCommand {
    const cfg = BOT_DIFFICULTY[this.diff];
    this.repathTimer -= dt;
    this.strafeTimer -= dt;
    this.aimErrorTimer -= dt;
    this.meleeCooldown -= dt;
    this.dashIntent -= dt;
    this.jumpCooldown -= dt;
    this.lastFire -= dt;

    const eye = { x: p.self.x, y: p.self.y + PLAYER.eyeStand, z: p.self.z };
    const pEye = { x: p.playerFeet.x, y: p.playerFeet.y + p.playerHeight * 0.85, z: p.playerFeet.z };
    const dx = pEye.x - eye.x;
    const dy = pEye.y - eye.y;
    const dz = pEye.z - eye.z;
    const dist = Math.hypot(dx, dz);
    const trueYaw = Math.atan2(-dx, -dz);
    const truePitch = Math.atan2(dy, Math.max(dist, 1e-6));

    // Line of sight: the first solid must not be before the player.
    const toPlayer = Math.hypot(dx, dy, dz);
    const dir = { x: dx / toPlayer, y: dy / toPlayer, z: dz / toPlayer };
    const hit = castRay(eye, dir, p.solids, p.targets, toPlayer + 0.5);
    const seesPlayer = hit.targetId === 'player';

    if (seesPlayer) {
      if (!this.sawPlayer) {
        this.sawPlayer = true;
        this.reactionTimer = cfg.reaction;
      }
      this.lastKnown = { ...p.playerFeet };
    } else {
      this.sawPlayer = false;
    }
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);

    // Aim error drifts slowly so the bot is not perfectly locked on.
    if (this.aimErrorTimer <= 0) {
      this.aimErrorTimer = 0.25;
      this.aimErrorYaw = (this.rng() * 2 - 1) * cfg.aimError;
      this.aimErrorPitch = (this.rng() * 2 - 1) * cfg.aimError * 0.6;
    }
    const aimYaw = trueYaw + this.aimErrorYaw;
    const aimPitch = truePitch + this.aimErrorPitch;

    // Movement: path toward last known position when blind, otherwise hold range and strafe.
    const move: MoveInput = { forward: 0, strafe: 0, yaw: trueYaw, jumpPressed: false, jumpHeld: false, crouchHeld: false, crouchPressed: false };
    let wantDash = false;
    let wantMelee = false;

    if (seesPlayer && this.reactionTimer <= 0) {
      const ideal = p.rangePreference;
      if (dist > ideal + 1.5) move.forward = 1;
      else if (dist < ideal - 2) move.forward = -1;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.5 + this.rng() * 0.8;
        if (this.rng() < cfg.strafeChance) this.strafeDir = -this.strafeDir;
      }
      if (this.rng() < cfg.strafeChance * dt * 2) this.strafeDir = -this.strafeDir;
      move.strafe = this.strafeDir;

      // Dash when the enemy is close and the scythe is ready.
      if (dist < SCYTHE.dashHitRange + 1.5 && p.dashReady && this.dashIntent <= 0 && this.rng() < cfg.dashChance * dt * 3) {
        wantDash = true;
        this.dashIntent = 1.2;
      }
      if (dist < SCYTHE.range - 0.3 && p.scytheReady && this.meleeCooldown <= 0 && this.rng() < cfg.meleeChance * dt * 2.5) {
        wantMelee = true;
        this.meleeCooldown = 1.1;
      }
      if (this.jumpCooldown <= 0 && this.rng() < 0.18 * dt * cfg.speedMult * 3) {
        move.jumpPressed = true;
        this.jumpCooldown = 0.9;
      }
      if (p.playerSliding || (this.rng() < cfg.slideChance * dt * 0.5 && dist > 4)) {
        // Slide when moving with speed toward/around the target.
        const spd = Math.hypot(p.selfVelocity.x, p.selfVelocity.z);
        if (spd > 6.5 && this.rng() < cfg.slideChance) {
          move.crouchPressed = true;
          move.crouchHeld = true;
        }
      }
      this.path = [];
    } else {
      // Blind: follow the path to the last known position, or wander.
      const goal = this.lastKnown ?? this.randomGoal(p);
      if (this.repathTimer <= 0 || this.path.length === 0) {
        this.repathTimer = 0.6;
        this.path = findPath(p.nav, p.self, goal);
      }
      while (this.path.length > 0 && Math.hypot(this.path[0].x - p.self.x, this.path[0].z - p.self.z) < 0.8) {
        this.path.shift();
      }
      if (this.path.length === 0) {
        if (this.lastKnown && Math.hypot(this.lastKnown.x - p.self.x, this.lastKnown.z - p.self.z) < 2) this.lastKnown = null;
        this.repathTimer = 0;
      }
      const next = this.path[0];
      if (next) {
        const mx = next.x - p.self.x;
        const mz = next.z - p.self.z;
        // Move in world space by converting to the bot's yaw (so input keys match travel).
        const yaw = Math.atan2(-mx, -mz);
        move.yaw = yaw;
        move.forward = 1;
        move.strafe = 0;
        // Ledge/stairs: jump if the next waypoint is up and we are grounded.
        if (this.jumpCooldown <= 0 && this.rng() < 0.05) {
          move.jumpPressed = true;
          this.jumpCooldown = 0.7;
        }
      }
    }

    // Shooting: only after the reaction delay, with ammo, and only when the line is clear.
    const canShoot = seesPlayer && this.reactionTimer <= 0 && p.ammo > 0 && !p.reloading;
    const wantFire = canShoot && this.rng() < cfg.accuracy + 0.25;
    const fireEdge = wantFire && !this.wasFiring;
    this.wasFiring = wantFire;
    if (wantFire) this.lastFire = 0.2;
    const wantReload = !seesPlayer && p.ammo <= 0 && !p.reloading;

    if (wantDash) move.forward = 1;

    return {
      move,
      yaw: aimYaw,
      pitch: aimPitch,
      wantFire,
      fireEdge,
      wantMelee,
      wantDash,
      wantReload,
    };
  }

  /** Picks a random walkable goal when nothing is known. */
  private randomGoal(p: BotPerception): Vec3 {
    const half = p.nav.origin + p.nav.size * p.nav.cell * 0.5;
    for (let tries = 0; tries < 20; tries++) {
      const x = (this.rng() * 2 - 1) * (half - 3);
      const z = (this.rng() * 2 - 1) * (half - 3);
      const [i, j] = [Math.floor((x - p.nav.origin) / p.nav.cell), Math.floor((z - p.nav.origin) / p.nav.cell)];
      if (i >= 0 && j >= 0 && i < p.nav.size && j < p.nav.size && p.nav.walkable[j * p.nav.size + i]) {
        return { x, y: 0, z };
      }
    }
    return { x: p.self.x, y: 0, z: p.self.z };
  }
}
