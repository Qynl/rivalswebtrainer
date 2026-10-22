/**
 * The rifle. Identical for both players, resolved by one code path.
 *
 * Fairness contract:
 * - Scoped shots are a pure raycast along the shooter's authoritative view
 *   direction. Any deviation a client tries to send is discarded, so there is
 *   no way to get spread, bloom or a lucky offset while scoped.
 * - Hipfire is the gamble: a 2.4° cone, applied to the direction the client
 *   reports, then clamped server-side to that same cone around the
 *   authoritative view. Visible in the HUD because the crosshair blooms.
 * - The server owns the kill: hits are ray-vs-capsule against a rewound target
 *   pose (lag compensation), with static geometry occluding the ray.
 * - Cosmetics (skin, weapon mesh, colour, sound pitch) never enter this file.
 */

import { MAX_REWIND, PLAYER, WEAPON } from './constants.ts';
import { coneDir, dot, len, norm, rayCapsule, sub, v3, type Vec3 } from './mathx.ts';
import type { Physics } from './physics.ts';
import { lookOf, type PlayerState } from './sim.ts';

export interface ShotMessage {
  seq: number;
  /** Client's reported ray origin and direction (already spread-adjusted). */
  origin: Vec3;
  dir: Vec3;
  scoped: boolean;
  /** Client estimate of the server time of the frame it aimed with. */
  aimTime: number;
}

export interface ShotOutcome {
  hit: boolean;
  killed: boolean;
  /** End of the tracer: the impact point, or the far end of the ray. */
  end: Vec3;
  distance: number;
  /** Surface normal at the impact, when the shot ended on geometry. Cosmetic
   *  only: the scorch decal and the spark fan are oriented by it. */
  normal: Vec3 | null;
}

export function hipSpreadRad(): number {
  return (WEAPON.hipSpreadDeg * Math.PI) / 180;
}

export function canFire(p: PlayerState): boolean {
  return p.alive && p.fireCooldown <= 0 && p.protect <= 0;
}

export function markFired(p: PlayerState): void {
  p.fireCooldown = WEAPON.cycleTime;
}

/** The scoped state that matters for spread: fully scoped only. */
export function isScopedShot(p: PlayerState): boolean {
  return p.scoped;
}

/** Applies hipfire spread on the client for the visual tracer. */
export function spreadShotDir(view: Vec3, scoped: boolean, r1: number, r2: number): Vec3 {
  return scoped ? view : coneDir(view, hipSpreadRad(), r1, r2);
}

/**
 * Server-side direction resolution. Scoped: always the authoritative view.
 * Hipfire: accept the client's cone but only inside the legal spread; a
 * direction outside it is a broken/hostile client, so fall back to centre.
 */
export function resolveShotDir(p: PlayerState, msg: ShotMessage): Vec3 {
  const view = lookOf(p);
  // Fully scoped is deterministic: the client's number cannot change the ray.
  if (isScopedShot(p)) return view;
  const d = norm(msg.dir);
  const limit = Math.cos(hipSpreadRad() + 0.02);
  if (dot(view, d) >= limit) return d;
  return view;
}

/** Rewind buffer: one pose per tick, linearly sampled. */
export class PoseHistory {
  private times: number[] = [];
  private poses: Vec3[] = [];
  private alive: boolean[] = [];
  private maxSamples: number;

  constructor(maxSamples = 48) {
    this.maxSamples = maxSamples;
  }

  record(time: number, pos: Vec3, isAlive: boolean): void {
    this.times.push(time);
    this.poses.push({ ...pos });
    this.alive.push(isAlive);
    if (this.times.length > this.maxSamples) {
      this.times.shift();
      this.poses.shift();
      this.alive.shift();
    }
  }

  sample(time: number): { pos: Vec3; alive: boolean } | null {
    const n = this.times.length;
    if (n === 0) return null;
    if (time >= this.times[n - 1]) return { pos: { ...this.poses[n - 1] }, alive: this.alive[n - 1] };
    if (time <= this.times[0]) return { pos: { ...this.poses[0] }, alive: this.alive[0] };
    for (let i = n - 2; i >= 0; i--) {
      const t1 = this.times[i + 1];
      if (time >= this.times[i]) {
        const t0 = this.times[i];
        const f = t1 === t0 ? 1 : (time - t0) / (t1 - t0);
        const a = this.poses[i];
        const b = this.poses[i + 1];
        return {
          pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f },
          alive: this.alive[i] && this.alive[i + 1],
        };
      }
    }
    return { pos: { ...this.poses[0] }, alive: this.alive[0] };
  }

  clear(): void {
    this.times.length = 0;
    this.poses.length = 0;
    this.alive.length = 0;
  }
}

export function clampRewindTime(aimTime: number, now: number): number {
  return Math.max(now - MAX_REWIND, Math.min(now, aimTime));
}

export interface HitTarget {
  pos: Vec3;
  alive: boolean;
}

/** Fires the authoritative ray. Static geometry occludes the target. */
export function resolveShot(
  phys: Physics,
  origin: Vec3,
  dir: Vec3,
  target: HitTarget | null,
  shooterId: number,
  maxDistance = 320,
): ShotOutcome {
  const wall = phys.raycast(origin, dir, maxDistance, shooterId);
  const wallDist = wall ? wall.toi : maxDistance;
  let hitDist: number | null = null;
  if (target && target.alive) {
    const base = { x: target.pos.x, y: target.pos.y + PLAYER.hitYOffset, z: target.pos.z };
    const a = { x: base.x, y: base.y - PLAYER.hitHalfHeight, z: base.z };
    const b = { x: base.x, y: base.y + PLAYER.hitHalfHeight, z: base.z };
    hitDist = rayCapsule(origin, dir, a, b, PLAYER.hitRadius);
  }
  if (hitDist !== null && hitDist <= wallDist) {
    return {
      hit: true,
      killed: true,
      end: { x: origin.x + dir.x * hitDist, y: origin.y + dir.y * hitDist, z: origin.z + dir.z * hitDist },
      distance: hitDist,
      normal: null,
    };
  }
  const d = Math.min(wallDist, maxDistance);
  return {
    hit: false,
    killed: false,
    end: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
    distance: d,
    normal: wall ? wall.normal : null,
  };
}

/**
 * Scope glint visibility from a viewer's point of view.
 * 0 when the viewer is behind the shooter (the lens faces forward), 1 when
 * the shooter is looking across the viewer's line of sight.
 */
export function glintVisibility(shooterPos: Vec3, shooterLook: Vec3, viewerPos: Vec3): number {
  const toViewer = norm(sub(viewerPos, shooterPos));
  const facing = dot(shooterLook, toViewer);
  const behind = WEAPON.glintBehindCut;
  const t = Math.max(0, Math.min(1, (facing - behind) / (0.35 - behind)));
  return t * t * (3 - 2 * t);
}

/** Distance from a client-claimed origin to the authoritative eye. */
export function shotOriginError(origin: Vec3, eye: Vec3): number {
  return len(sub(origin, eye));
}

/** Predicts where the client tracer should start (muzzle) for cosmetics. */
export function muzzleOffset(eye: Vec3, dir: Vec3): Vec3 {
  return v3(eye.x + dir.x * 0.6, eye.y + dir.y * 0.6 - 0.12, eye.z + dir.z * 0.6);
}
