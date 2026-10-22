/**
 * The authoritative player simulation.
 *
 * This module is run verbatim by the server (authority) and by the client
 * (prediction), at a fixed 1/60 s step. It contains NO randomness and reads no
 * wall clock, so the same inputs always produce the same player. Weapons live
 * in combat.ts; scoring and the ring live in match.ts.
 *
 * Design notes worth knowing before touching the numbers:
 *
 * - The rope is a hard tether with a soft spring on top. Outward radial
 *   velocity is projected away at the taut point (92%), so a swing converts
 *   drop height into tangential speed instead of rubber-banding. Gravity then
 *   does the rest: a pendulum is nothing but gravity + a constraint.
 * - Pumping is real: W in a swing accelerates along the tangent. The player is
 *   the engine, the rope is just a lever.
 * - Release boost scales with speed, so the fastest part of the arc (the
 *   bottom) gives the biggest launch. That is the skill window.
 * - Chaining: for 0.55 s after a release the rope can re-attach instantly and
 *   grants +4.5% speed per stack. Missing the window costs 0.3 s of cooldown.
 */

import type { Arena } from './arena.ts';
import { GRAPPLE, MOVE, PLAYER, WEAPON } from './constants.ts';
import {
  clamp,
  dot,
  flatBasis,
  len,
  lookDir,
  mul,
  norm,
  rayCapsule,
  raySphere,
  sub,
  v3,
  type Vec3,
} from './mathx.ts';
import type { Physics } from './physics.ts';

export const KEY = {
  forward: 1,
  back: 2,
  left: 4,
  right: 8,
  jump: 16,
  crouch: 32,
  grapple: 64,
  fire: 128,
  scope: 256,
  dash: 512,
} as const;

export interface InputFrame {
  seq: number;
  keys: number;
  yaw: number;
  pitch: number;
}

export interface GrappleState {
  active: boolean;
  mode: 'none' | 'swing' | 'zip';
  anchor: Vec3;
  /** 0 = static pinion/geometry, 1 = hooked onto the opponent's body. */
  target: 0 | 1;
  length: number;
  hold: number;
  cooldown: number;
  chainTimer: number;
  chain: number;
  /** Seconds with the rope taut below the minimum swing speed. */
  stall: number;
  /** Small bounce applied on the frame the rope catches. */
  snap: number;
}

export interface PlayerState {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  eye: Vec3;
  look: Vec3;
  prevLook: Vec3;
  angularSpeed: number;
  keys: number;
  prevKeys: number;
  grounded: boolean;
  wasGrounded: boolean;
  coyote: number;
  jumpBuffer: number;
  jumpLock: number;
  sliding: boolean;
  slideTime: number;
  dashTime: number;
  dashCooldown: number;
  dashDir: Vec3;
  grapple: GrappleState;
  fireCooldown: number;
  fireHeld: boolean;
  scopeT: number;
  scoped: boolean;
  glint: number;
  alive: boolean;
  /** Seconds until the next spawn; consumed by the server match loop. */
  respawnIn: number;
  pendingRespawn: boolean;
  protect: number;
  exposure: number;
  speed: number;
  /** Cosmetic only, never read by the server's simulation. */
  skin: 0 | 1;
  spawnIndex: 0 | 1;
}

export type SimEventType =
  | 'jump'
  | 'land'
  | 'dash'
  | 'attach'
  | 'zip'
  | 'release'
  | 'boost'
  | 'chain'
  | 'grappleMiss'
  | 'grappleBreak';

export interface SimEvent {
  type: SimEventType;
  /** 0..1-ish strength used by the client for shake/audio volume. */
  strength: number;
}

export function createPlayer(id: number, skin: 0 | 1 = 0): PlayerState {
  return {
    id,
    pos: v3(0, 10, 0),
    vel: v3(),
    yaw: 0,
    pitch: 0,
    eye: v3(),
    look: v3(0, 0, -1),
    prevLook: v3(0, 0, -1),
    angularSpeed: 0,
    keys: 0,
    prevKeys: 0,
    grounded: false,
    wasGrounded: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpLock: 0,
    sliding: false,
    slideTime: 0,
    dashTime: 0,
    dashCooldown: 0,
    dashDir: v3(0, 0, -1),
    grapple: {
      active: false,
      mode: 'none',
      anchor: v3(),
      target: 0,
      length: 0,
      hold: 0,
      cooldown: 0,
      chainTimer: 0,
      chain: 0,
      stall: 0,
      snap: 0,
    },
    fireCooldown: 0,
    fireHeld: false,
    scopeT: 0,
    scoped: false,
    glint: 0,
    alive: true,
    respawnIn: 0,
    pendingRespawn: false,
    protect: 0,
    exposure: 0,
    speed: 0,
    skin,
    spawnIndex: 0,
  };
}

/** Places a player on a spawn deck, feet on the surface. */
export function respawnPlayer(p: PlayerState, arena: Arena, spawnIndex: 0 | 1): void {
  const s = arena.spawns[spawnIndex];
  p.spawnIndex = spawnIndex;
  p.pos = v3(s.pos.x, s.pos.y + PLAYER.halfHeight + PLAYER.radius + 0.03, s.pos.z);
  p.vel = v3();
  p.yaw = s.yaw;
  p.pitch = 0;
  p.grounded = false;
  p.wasGrounded = false;
  p.coyote = 0;
  p.jumpBuffer = 0;
  p.jumpLock = 0;
  p.sliding = false;
  p.slideTime = 0;
  p.dashTime = 0;
  p.dashCooldown = 0;
  p.grapple.active = false;
  p.grapple.mode = 'none';
  p.grapple.cooldown = 0;
  p.grapple.chainTimer = 0;
  p.grapple.chain = 0;
  p.grapple.stall = 0;
  p.fireCooldown = 0;
  p.scopeT = 0;
  p.scoped = false;
  p.glint = 0;
  p.alive = true;
  p.respawnIn = 0;
  p.pendingRespawn = false;
  p.exposure = 0;
  p.protect = 0;
  p.speed = 0;
  p.look = lookDir(p.yaw, 0);
  p.prevLook = p.look;
  updateEye(p);
}

export function updateEye(p: PlayerState): void {
  const crouch = p.sliding ? 0.42 : 0;
  p.eye = { x: p.pos.x, y: p.pos.y - PLAYER.halfHeight - PLAYER.radius + PLAYER.eyeHeight - crouch, z: p.pos.z };
}

export function lookOf(p: PlayerState): Vec3 {
  return lookDir(p.yaw, p.pitch);
}

export function flatSpeed(vel: Vec3): number {
  return Math.hypot(vel.x, vel.z);
}

function angleDelta(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

export interface GrappleTarget {
  point: Vec3;
  target: 0 | 1;
  distance: number;
}

/**
 * Finds what the rope would bite. Anchor pinions get a generous 2.6 m sphere
 * (swinging should be about where you want to go, not pixel-perfect aim);
 * the opponent is hittable with the same capsule used for bullets.
 */
export function findGrappleTarget(
  phys: Physics,
  origin: Vec3,
  dir: Vec3,
  opponent: PlayerState | null,
  arena: Arena,
  shooterId: number,
): GrappleTarget | null {
  const wall = phys.raycast(origin, dir, GRAPPLE.range, shooterId);
  let best: GrappleTarget | null = null;
  if (wall) best = { point: wall.point, target: 0, distance: wall.toi };
  const limit = wall ? wall.toi : GRAPPLE.range;

  for (const a of arena.anchors) {
    const t = raySphere(origin, dir, a, GRAPPLE.anchorRadius);
    if (t !== null && t <= limit && (!best || t < best.distance)) {
      best = { point: { x: a.x, y: a.y, z: a.z }, target: 0, distance: t };
    }
  }

  if (opponent && opponent.alive) {
    const base = { x: opponent.pos.x, y: opponent.pos.y + PLAYER.hitYOffset, z: opponent.pos.z };
    const a = { x: base.x, y: base.y - PLAYER.hitHalfHeight, z: base.z };
    const b = { x: base.x, y: base.y + PLAYER.hitHalfHeight, z: base.z };
    const t = rayCapsule(origin, dir, a, b, PLAYER.hitRadius + 0.15);
    if (t !== null && t <= limit && (!best || t < best.distance)) {
      best = { point: base, target: 1, distance: t };
    }
  }
  return best;
}

function beginGrapple(
  p: PlayerState,
  target: GrappleTarget,
  events: SimEvent[],
): void {
  const g = p.grapple;
  const chaining = g.chainTimer > 0;
  if (g.cooldown > 0 && !chaining) return;
  const dist = len(sub(target.point, p.pos));
  g.active = true;
  g.mode = 'swing';
  g.anchor = { ...target.point };
  g.target = target.target;
  g.length = clamp(dist, GRAPPLE.minRopeLength, GRAPPLE.range);
  g.hold = 0;
  g.stall = 0;
  g.snap = 1;
  g.cooldown = 0;
  if (chaining) {
    g.chain = Math.min(GRAPPLE.chainMaxStacks, g.chain + 1);
    // Chaining rewards momentum instead of resetting it.
    const bonus = 1 + GRAPPLE.chainSpeedBonus;
    p.vel.x *= bonus;
    p.vel.z *= bonus;
    p.vel.y *= 1 + GRAPPLE.chainSpeedBonus * 0.5;
    g.chainTimer = 0;
    events.push({ type: 'chain', strength: g.chain / GRAPPLE.chainMaxStacks });
  } else {
    g.chain = 0;
  }
  events.push({ type: 'attach', strength: clamp(dist / GRAPPLE.range, 0.2, 1) });
}

function endGrapple(p: PlayerState, events: SimEvent[], boost: boolean): void {
  const g = p.grapple;
  if (!g.active) return;
  const wasSwing = g.mode === 'swing';
  const speed = len(p.vel);
  const taut = len(sub(g.anchor, p.pos)) >= g.length * 0.9;
  g.active = false;
  g.mode = 'none';
  g.hold = 0;
  g.snap = 0;
  g.cooldown = GRAPPLE.cooldown;
  p.grapple.chainTimer = GRAPPLE.chainWindow;
  if (boost && wasSwing && taut && speed > 7) {
    const hs = Math.hypot(p.vel.x, p.vel.z) || 1;
    const b = clamp(speed * GRAPPLE.releaseBoostSpeed, GRAPPLE.releaseBoostMin, GRAPPLE.releaseBoostMax) *
      (1 + p.grapple.chain * 0.06);
    p.vel.x += (p.vel.x / hs) * b;
    p.vel.z += (p.vel.z / hs) * b;
    // Releasing on the upswing throws you higher: the other half of the skill.
    p.vel.y += GRAPPLE.releaseUp + (p.vel.y > 2 ? 3.6 : 0);
    events.push({ type: 'boost', strength: clamp(b / GRAPPLE.releaseBoostMax, 0.15, 1) });
  } else {
    events.push({ type: 'release', strength: clamp(speed / 40, 0.1, 1) });
  }
}

/** Resolves a rope attached to the opponent, keeping it elastic and breakable. */
function updateOpponentAnchor(p: PlayerState, opponent: PlayerState | null, events: SimEvent[]): void {
  const g = p.grapple;
  if (!g.active || g.target !== 1) return;
  if (!opponent || !opponent.alive) {
    endGrapple(p, events, false);
    events.push({ type: 'grappleBreak', strength: 0.5 });
    return;
  }
  g.anchor = { x: opponent.pos.x, y: opponent.pos.y + PLAYER.hitYOffset, z: opponent.pos.z };
  g.length = Math.max(g.length, len(sub(g.anchor, p.pos)) * GRAPPLE.opponentElastic);
}

export function stepPlayer(
  p: PlayerState,
  input: InputFrame,
  dt: number,
  phys: Physics,
  arena: Arena,
  opponent: PlayerState | null,
  events: SimEvent[],
): void {
  if (!p.alive) {
    p.speed = 0;
    p.glint = 0;
    // Latch the keys so the respawn cannot inherit a stale press.
    p.prevKeys = input.keys;
    p.keys = input.keys;
    return;
  }

  p.prevLook = p.look;
  p.yaw = input.yaw;
  p.pitch = clamp(input.pitch, -1.45, 1.45);
  p.look = lookDir(p.yaw, p.pitch);
  const ang = angleDelta(p.prevLook, p.look) / dt;
  // Ignore the single-frame spike that a respawn/teleport causes.
  p.angularSpeed = ang > 60 ? 0 : ang;

  const held = input.keys;
  const prevKeys = p.prevKeys;
  const pressed = held & ~prevKeys;
  p.keys = held;
  p.prevKeys = held;

  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  updateEye(p);

  // ── Cooldowns and windows ────────────────────────────────────────────────
  const g = p.grapple;
  g.cooldown = Math.max(0, g.cooldown - dt);
  g.chainTimer = Math.max(0, g.chainTimer - dt);
  if (g.chainTimer === 0 && !g.active) g.chain = 0;
  p.jumpLock = Math.max(0, p.jumpLock - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);
  p.grapple.snap = Math.max(0, p.grapple.snap - dt * 5);
  if (p.protect > 0) p.protect = Math.max(0, p.protect - dt);

  const basis = flatBasis(p.yaw);
  let ax = 0;
  let ay = 0;
  if (held & KEY.forward) ax += 1;
  if (held & KEY.back) ax -= 1;
  if (held & KEY.right) ay += 1;
  if (held & KEY.left) ay -= 1;
  const wish = v3(basis.fwd.x * ax + basis.right.x * ay, 0, basis.fwd.z * ax + basis.right.z * ay);
  const wishLen = len(wish);
  if (wishLen > 1e-6) {
    wish.x /= wishLen;
    wish.z /= wishLen;
  }

  // ── Grapple input ────────────────────────────────────────────────────────
  updateOpponentAnchor(p, opponent, events);
  const grappleHeld = (held & KEY.grapple) !== 0;
  const grapplePressed = (pressed & KEY.grapple) !== 0;
  const grappleReleased = (prevKeys & KEY.grapple) !== 0 && !grappleHeld;

  if (grapplePressed && p.alive) {
    if (g.active) {
      // Second tap releases a swing immediately (fast un-hook is a real skill).
      endGrapple(p, events, true);
    } else {
      const target = findGrappleTarget(phys, p.eye, p.look, opponent, arena, p.id);
      if (target) beginGrapple(p, target, events);
      else events.push({ type: 'grappleMiss', strength: 0.4 });
    }
  }
  if (grappleReleased && g.active) {
    if (g.mode === 'swing' && g.hold < GRAPPLE.zipTapTime) {
      // A tap is a zip. The switch happens on release so the rope still fires
      // on the same frame as the input — responsiveness before semantics.
      g.mode = 'zip';
      g.stall = 0;
      events.push({ type: 'zip', strength: 0.6 });
    } else if (g.mode === 'swing') {
      endGrapple(p, events, true);
    }
  }
  if (g.active) g.hold += dt;

  // ── Jump / slide / dash ─────────────────────────────────────────────────
  if ((pressed & KEY.jump) !== 0) p.jumpBuffer = MOVE.jumpBuffer;

  const crouchHeld = (held & KEY.crouch) !== 0;
  if (crouchHeld && p.grounded && !p.sliding && flatSpeed(p.vel) > MOVE.slideEnterSpeed) {
    p.sliding = true;
    p.slideTime = 0;
    const hs = flatSpeed(p.vel);
    if (hs > 1e-3) {
      const k = (hs + MOVE.slideBoost) / hs;
      p.vel.x *= k;
      p.vel.z *= k;
    }
  }
  if (p.sliding) {
    p.slideTime += dt;
    if (!crouchHeld && p.slideTime > 0.28) p.sliding = false;
    if (flatSpeed(p.vel) < MOVE.slideExitSpeed || p.slideTime > MOVE.slideMaxTime || !p.grounded) p.sliding = false;
  }

  if ((pressed & KEY.dash) !== 0 && p.dashCooldown === 0) {
    const dir = wishLen > 0.1 ? wish : v3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const boost = p.sliding ? 0.7 : 1; // dashing out of a slide is already fast
    p.vel.x += dir.x * MOVE.dashImpulse * boost;
    p.vel.z += dir.z * MOVE.dashImpulse * boost;
    if (!p.grounded) p.vel.y += MOVE.dashUp * 0.6;
    p.dashCooldown = MOVE.dashCooldown;
    p.dashTime = MOVE.dashTime;
    p.dashDir = dir;
    events.push({ type: 'dash', strength: 0.7 });
  }

  if (p.jumpBuffer > 0 && p.jumpLock === 0 && (p.grounded || p.coyote > 0)) {
    const slidingJump = p.sliding;
    p.vel.y = MOVE.jumpSpeed * (slidingJump ? 1.02 : 1);
    if (slidingJump) {
      p.vel.x *= MOVE.slideJumpBonus;
      p.vel.z *= MOVE.slideJumpBonus;
      p.sliding = false;
    }
    p.grounded = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpLock = 0.08;
    events.push({ type: 'jump', strength: slidingJump ? 0.85 : 0.55 });
  }

  // ── Rope physics ────────────────────────────────────────────────────────
  const zipping = g.active && g.mode === 'zip';
  if (g.active && g.mode === 'swing') {
    const delta = sub(g.anchor, p.pos);
    const dist = len(delta);
    if (dist > 1e-3) {
      const dhat = { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist };
      const radial = dot(p.vel, dhat);
      if (dist > g.length) {
        if (radial < 0) {
          // Pull outward velocity back to the rope: instant constraint.
          const remove = radial * GRAPPLE.outwardProjection;
          p.vel.x -= dhat.x * remove;
          p.vel.y -= dhat.y * remove;
          p.vel.z -= dhat.z * remove;
        }
        const stretch = dist - g.length;
        const spring = stretch * GRAPPLE.swingSpring - dot(p.vel, dhat) * GRAPPLE.swingDamp;
        p.vel.x += dhat.x * spring * dt;
        p.vel.y += dhat.y * spring * dt;
        p.vel.z += dhat.z * spring * dt;
      }
      // Pump: steer along the tangent plane of the rope.
      if (wishLen > 1e-6) {
        const wd = dot(wish, dhat);
        const tangent = norm(v3(wish.x - dhat.x * wd, wish.y - dhat.y * wd, wish.z - dhat.z * wd));
        p.vel.x += tangent.x * GRAPPLE.swingSteer * dt;
        p.vel.y += tangent.y * GRAPPLE.swingSteer * dt;
        p.vel.z += tangent.z * GRAPPLE.swingSteer * dt;
      }
    }
  } else if (zipping) {
    const delta = sub(g.anchor, p.pos);
    const dist = len(delta);
    if (dist < GRAPPLE.zipArrive) {
      g.active = false;
      g.mode = 'none';
      g.cooldown = GRAPPLE.cooldown;
      g.chainTimer = GRAPPLE.chainWindow;
      p.vel.y = Math.max(p.vel.y, GRAPPLE.zipHop);
      events.push({ type: 'boost', strength: 0.45 });
    } else {
      // Zip is a yank, not a magnet: velocity is critically damped onto the
      // line to the anchor, so tangential speed is bled off fast and you
      // arrive where you clicked instead of orbiting it.
      const dhat = { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist };
      const approachSpeed = Math.min(GRAPPLE.zipSpeed, 10 + dist * 2.2);
      const targetVel = mul(dhat, approachSpeed);
      const k = 1 - Math.exp(-GRAPPLE.zipDamping * dt);
      p.vel.x += (targetVel.x - p.vel.x) * k;
      p.vel.y += (targetVel.y - p.vel.y) * k;
      p.vel.z += (targetVel.z - p.vel.z) * k;
      if (wishLen > 1e-6) {
        p.vel.x += wish.x * 4 * dt;
        p.vel.z += wish.z * 4 * dt;
      }
      g.stall = flatSpeed(p.vel) < 6 ? g.stall + dt : 0;
      if (g.stall > 0.55) {
        g.active = false;
        g.mode = 'none';
        g.cooldown = GRAPPLE.cooldown;
        g.chainTimer = GRAPPLE.chainWindow;
        events.push({ type: 'release', strength: 0.3 });
      }
    }
  }

  // ── Acceleration, gravity ───────────────────────────────────────────────
  // Standing on something means the floor already holds you up. Integrating
  // gravity into a grounded move would press the capsule into the surface and
  // let Rapier's de-penetration kick it back out — that is the stutter and the
  // dead stop you feel when a slide crosses a slab seam.
  const stick = p.grounded && p.vel.y <= 0;
  if (stick) p.vel.y = 0;
  if (!zipping) {
    if (g.active && g.mode === 'swing') {
      // Air control is handled by the tangent pump above; gravity still bites.
      p.vel.y -= MOVE.gravity * dt;
    } else if (p.grounded && !p.sliding) {
      const hs = flatSpeed(p.vel);
      if (hs > MOVE.walkSpeed) {
        const decay = Math.exp(-MOVE.groundFriction * dt);
        p.vel.x *= decay;
        p.vel.z *= decay;
      } else if (wishLen < 1e-6) {
        const decay = Math.exp(-14 * dt);
        p.vel.x *= decay;
        p.vel.z *= decay;
      }
      if (wishLen > 1e-6) {
        const max = p.keys & KEY.crouch ? MOVE.crouchSpeed : MOVE.walkSpeed;
        // Steer at whatever speed you already carry: holding forward turns a
        // fast slide instead of stamping on the brakes.
        const target = mul(wish, Math.max(hs, max));
        const dvx = clamp(target.x - p.vel.x, -MOVE.groundAccel * dt, MOVE.groundAccel * dt);
        const dvz = clamp(target.z - p.vel.z, -MOVE.groundAccel * dt, MOVE.groundAccel * dt);
        p.vel.x += dvx;
        p.vel.z += dvz;
      }
      if (!stick) p.vel.y -= MOVE.gravity * dt;
    } else if (p.grounded && p.sliding) {
      const decay = Math.exp(-MOVE.slideFriction * dt);
      p.vel.x *= decay;
      p.vel.z *= decay;
      // Bend the slide: 22% of normal ground authority, steering only. Pushing
      // along the wish vector added speed every tick and turned a slide into a
      // free rocket, so the target keeps the speed you entered with.
      const hs = flatSpeed(p.vel);
      if (wishLen > 1e-6 && hs > 1e-3) {
        const dvx = clamp(wish.x * hs - p.vel.x, -MOVE.groundAccel * 0.22 * dt, MOVE.groundAccel * 0.22 * dt);
        const dvz = clamp(wish.z * hs - p.vel.z, -MOVE.groundAccel * 0.22 * dt, MOVE.groundAccel * 0.22 * dt);
        p.vel.x += dvx;
        p.vel.z += dvz;
      }
      if (!stick) p.vel.y -= MOVE.gravity * dt;
    } else {
      if (wishLen > 1e-6) {
        const hs = flatSpeed(p.vel);
        const scale = hs < MOVE.airMaxSpeed ? 1 : Math.max(0, 1 - (hs - MOVE.airMaxSpeed) / 18);
        p.vel.x += wish.x * MOVE.airAccel * scale * dt;
        p.vel.z += wish.z * MOVE.airAccel * scale * dt;
      }
      p.vel.y -= MOVE.gravity * dt;
    }
  }

  p.vel.y = Math.max(p.vel.y, -MOVE.maxFallSpeed);
  const sp = len(p.vel);
  if (sp > MOVE.maxSpeed) {
    const s = MOVE.maxSpeed / sp;
    p.vel.x *= s;
    p.vel.y *= s;
    p.vel.z *= s;
  }

  // ── Integrate ───────────────────────────────────────────────────────────
  const delta = mul(p.vel, dt);
  // Standing still needs a flat sweep. Pushing gravity into the sweep presses
  // the capsule into the slab, and the controller's push-back reports a bogus
  // contact normal that launches the player a centimetre into the air — the
  // bounce you could see and hear as a stream of tiny landings.
  if (stick) delta.y = 0;
  const fallSpeed = -p.vel.y;
  const move = phys.move(p.id, p.pos, delta);
  const actual = sub(move.pos, p.pos);
  p.pos = move.pos;
  p.wasGrounded = p.grounded;
  // A grounded player is re-confirmed by a downward probe instead of by the
  // sweep, so standing still is rock solid and stepping off is immediate.
  p.grounded = move.grounded || (stick && phys.groundContact(move.pos));
  p.coyote = p.grounded ? MOVE.coyoteTime : Math.max(0, p.coyote - dt);

  // Kill velocity into whatever we hit; keep the tangential part. Floor and
  // ceiling contacts are ignored here — the controller already resolved them,
  // and their normals (which can arrive tilted while autostep is feeling for a
  // step) would otherwise convert forward speed into lift.
  const preHS = flatSpeed(p.vel);
  const preVY = p.vel.y;
  for (const n of move.normals) {
    if (Math.abs(n.y) > 0.7) continue;
    const into = dot(p.vel, n);
    if (into < 0) {
      p.vel.x -= n.x * into;
      p.vel.y -= n.y * into;
      p.vel.z -= n.z * into;
    }
  }
  // A contact may only take momentum away. Never let one hand it back.
  if (p.vel.y > 0 && preVY <= 0) p.vel.y = 0;
  const postHS = flatSpeed(p.vel);
  if (postHS > preHS && postHS > 1e-6) {
    const k = preHS / postHS;
    p.vel.x *= k;
    p.vel.z *= k;
  }

  if (p.grounded && p.vel.y < 0) p.vel.y = 0;

  // Landing: hard landings auto-slide so momentum is never eaten by the floor.
  if (p.grounded && !p.wasGrounded) {
    const impact = Math.max(0, fallSpeed);
    events.push({ type: 'land', strength: clamp(impact / 45, 0.15, 1) });
    if (flatSpeed(p.vel) > MOVE.slideEnterSpeed * 0.92 && !p.sliding) {
      p.sliding = true;
      p.slideTime = 0;
    }
  }
  if (p.grounded && p.sliding && flatSpeed(p.vel) < MOVE.slideExitSpeed) p.sliding = false;

  // Zip that is being blocked by geometry must let go instead of hanging.
  if (zipping && len(actual) < len(delta) * 0.35 && len(delta) > 1e-4) {
    g.stall += dt;
    if (g.stall > 0.3) {
      g.active = false;
      g.mode = 'none';
      g.cooldown = GRAPPLE.cooldown;
      g.chainTimer = GRAPPLE.chainWindow;
      events.push({ type: 'release', strength: 0.3 });
    }
  }

  // ── Scope / glint ───────────────────────────────────────────────────────
  const wantScope = (held & KEY.scope) !== 0;
  const scopeRate = wantScope ? 1 / WEAPON.scopeTime : -1 / WEAPON.unscopeTime;
  p.scopeT = clamp(p.scopeT + scopeRate * dt, 0, 1);
  p.scoped = p.scopeT > 0.985;

  const still = flatSpeed(p.vel) < WEAPON.glintMoveSpeed && p.angularSpeed < WEAPON.glintAngularSpeed;
  if (p.scoped && still) {
    p.glint = Math.min(1, p.glint + dt / 0.3);
  } else {
    p.glint = Math.max(0, p.glint - dt / 0.085);
  }

  updateEye(p);
  p.speed = len(p.vel);
}

/**
 * Copies every mutable field of a player. Used by client prediction to keep a
 * per-tick history for reconciliation and by the server when cloning poses.
 * Written by hand rather than structuredClone so it allocates nothing hot.
 */
export function copyPlayerState(src: PlayerState, dst: PlayerState): void {
  dst.id = src.id;
  dst.pos.x = src.pos.x; dst.pos.y = src.pos.y; dst.pos.z = src.pos.z;
  dst.vel.x = src.vel.x; dst.vel.y = src.vel.y; dst.vel.z = src.vel.z;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.eye.x = src.eye.x; dst.eye.y = src.eye.y; dst.eye.z = src.eye.z;
  dst.look.x = src.look.x; dst.look.y = src.look.y; dst.look.z = src.look.z;
  dst.prevLook.x = src.prevLook.x; dst.prevLook.y = src.prevLook.y; dst.prevLook.z = src.prevLook.z;
  dst.angularSpeed = src.angularSpeed;
  dst.keys = src.keys;
  dst.prevKeys = src.prevKeys;
  dst.grounded = src.grounded;
  dst.wasGrounded = src.wasGrounded;
  dst.coyote = src.coyote;
  dst.jumpBuffer = src.jumpBuffer;
  dst.jumpLock = src.jumpLock;
  dst.sliding = src.sliding;
  dst.slideTime = src.slideTime;
  dst.dashTime = src.dashTime;
  dst.dashCooldown = src.dashCooldown;
  dst.dashDir.x = src.dashDir.x; dst.dashDir.y = src.dashDir.y; dst.dashDir.z = src.dashDir.z;
  dst.grapple.active = src.grapple.active;
  dst.grapple.mode = src.grapple.mode;
  dst.grapple.anchor.x = src.grapple.anchor.x;
  dst.grapple.anchor.y = src.grapple.anchor.y;
  dst.grapple.anchor.z = src.grapple.anchor.z;
  dst.grapple.target = src.grapple.target;
  dst.grapple.length = src.grapple.length;
  dst.grapple.hold = src.grapple.hold;
  dst.grapple.cooldown = src.grapple.cooldown;
  dst.grapple.chainTimer = src.grapple.chainTimer;
  dst.grapple.chain = src.grapple.chain;
  dst.grapple.stall = src.grapple.stall;
  dst.grapple.snap = src.grapple.snap;
  dst.fireCooldown = src.fireCooldown;
  dst.fireHeld = src.fireHeld;
  dst.scopeT = src.scopeT;
  dst.scoped = src.scoped;
  dst.glint = src.glint;
  dst.alive = src.alive;
  dst.respawnIn = src.respawnIn;
  dst.pendingRespawn = src.pendingRespawn;
  dst.protect = src.protect;
  dst.exposure = src.exposure;
  dst.speed = src.speed;
  dst.skin = src.skin;
  dst.spawnIndex = src.spawnIndex;
}

/** Deep clone, for history snapshots. */
export function clonePlayerState(src: PlayerState): PlayerState {
  const dst = createPlayer(src.id, src.skin);
  copyPlayerState(src, dst);
  return dst;
}
