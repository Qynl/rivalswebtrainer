import { SCYTHE, WEAPONS, type WeaponDef, type WeaponId } from './config';
import type { Aabb, Vec3 } from './movement';

export interface WeaponState {
  id: WeaponId;
  ammo: number;
  fireCooldown: number;
  reloadTimer: number; // >0 while reloading
  burstLeft: number;
}

export function createWeaponState(id: WeaponId): WeaponState {
  return { id, ammo: WEAPONS[id].magSize, fireCooldown: 0, reloadTimer: 0, burstLeft: 0 };
}

export function startReload(w: WeaponState): void {
  const def = WEAPONS[w.id];
  if (w.reloadTimer > 0 || w.ammo === def.magSize) return;
  w.reloadTimer = def.reloadTime;
  w.burstLeft = 0;
}

/** Ticks cooldowns and reload. Returns true when a reload just completed. */
export function tickWeapon(w: WeaponState, dt: number): boolean {
  w.fireCooldown = Math.max(0, w.fireCooldown - dt);
  if (w.reloadTimer > 0) {
    w.reloadTimer -= dt;
    if (w.reloadTimer <= 0) {
      w.reloadTimer = 0;
      w.ammo = WEAPONS[w.id].magSize;
      return true;
    }
  }
  return false;
}

/**
 * Attempts to fire this frame. `triggerPressed` is the held state for auto guns, or the edge
 * for semi guns. Returns the number of rounds to shoot this frame (0 or 1 for normal weapons).
 */
export function tryFire(w: WeaponState, triggerPressed: boolean, triggerEdge: boolean): number {
  const def: WeaponDef = WEAPONS[w.id];
  if (w.reloadTimer > 0) return 0;
  if (w.burstLeft > 0 && w.fireCooldown <= 0) {
    w.burstLeft--;
    w.fireCooldown = def.fireInterval;
    if (w.ammo <= 0) return 0;
    w.ammo--;
    return 1;
  }
  const wantsFire = def.auto ? triggerPressed : triggerEdge;
  if (!wantsFire || w.fireCooldown > 0) return 0;
  if (w.ammo <= 0) {
    startReload(w);
    return 0;
  }
  w.ammo--;
  w.fireCooldown = def.fireInterval;
  if (def.burst > 1) w.burstLeft = def.burst - 1;
  return 1;
}

/** Ray vs AABB slab test. Returns distance along the ray or null. */
export function rayAabb(origin: Vec3, dir: Vec3, box: Aabb, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    let t1 = (mn[i] - o[i]) / d[i];
    let t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export interface Target {
  id: string;
  /** hitbox: body box, optional head box checked first */
  body: Aabb;
  head: Aabb;
}

export interface RayHit {
  targetId: string | null;
  isHead: boolean;
  distance: number;
  point: Vec3;
}

/**
 * Casts a ray against world solids and targets. The closest surface wins, so solids block shots.
 * Returns the first target hit (if any) before the first solid.
 */
export function castRay(origin: Vec3, dir: Vec3, solids: readonly Aabb[], targets: readonly Target[], maxDist: number, ignoreId?: string): RayHit {
  let worldT = maxDist;
  for (const s of solids) {
    const t = rayAabb(origin, dir, s, worldT);
    if (t !== null && t < worldT) worldT = t;
  }
  let best: RayHit | null = null;
  for (const tg of targets) {
    if (tg.id === ignoreId) continue;
    const th = rayAabb(origin, dir, tg.head, worldT);
    const tb = rayAabb(origin, dir, tg.body, worldT);
    if (th === null && tb === null) continue;
    // The head box sits inside the body box, so any ray that reaches the head
    // is a headshot. Using the head entry distance keeps the hit point on the head.
    const isHead = th !== null;
    const d = isHead ? th! : tb!;
    if (best === null || d < best.distance) {
      best = {
        targetId: tg.id,
        isHead,
        distance: d,
        point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      };
    }
  }
  if (best) return best;
  return {
    targetId: null,
    isHead: false,
    distance: worldT,
    point: { x: origin.x + dir.x * worldT, y: origin.y + dir.y * worldT, z: origin.z + dir.z * worldT },
  };
}

/** Scythe arc: true if the point is within range and inside the forward arc (flat, XZ plane). */
export function inScytheArc(from: Vec3, yaw: number, target: Vec3): boolean {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SCYTHE.range) return false;
  if (dist < 1e-6) return true;
  const cos = (dx * fx + dz * fz) / dist;
  return cos >= Math.cos((SCYTHE.arcDeg * Math.PI) / 360);
}

export interface ScytheState {
  swingTimer: number; // time since swing started, -1 when idle
  cooldown: number;
  dashTimer: number; // >0 while dashing
  dashCooldown: number;
  hasHit: boolean; // this swing already damaged someone
}

export function createScytheState(): ScytheState {
  return { swingTimer: -1, cooldown: 0, dashTimer: 0, dashCooldown: 0, hasHit: false };
}

export function tickScythe(s: ScytheState, dt: number): void {
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  s.dashTimer = Math.max(0, s.dashTimer - dt);
  if (s.swingTimer >= 0) {
    s.swingTimer += dt;
    if (s.swingTimer >= SCYTHE.swingTime) s.swingTimer = -1;
  }
}

export function startSwing(s: ScytheState): boolean {
  if (s.swingTimer >= 0 || s.cooldown > 0) return false;
  s.swingTimer = 0;
  s.cooldown = SCYTHE.swingCooldown + SCYTHE.swingTime;
  s.hasHit = false;
  return true;
}

/** True while the blade is in its damaging part of the swing. */
export function swingActive(s: ScytheState): boolean {
  return s.swingTimer >= SCYTHE.hitWindowStart && s.swingTimer <= SCYTHE.hitWindowEnd;
}

export function startDash(s: ScytheState): boolean {
  if (s.dashCooldown > 0) return false;
  s.dashTimer = SCYTHE.dashTime;
  s.dashCooldown = SCYTHE.dashCooldown;
  return true;
}
