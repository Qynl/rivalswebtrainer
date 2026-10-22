/**
 * Server-side duelist used for practice and for solo playtesting.
 *
 * It is deliberately NOT a special entity: it produces normal InputFrames and
 * fires normal ShotMessages through the same validation path as a human, so
 * anything it can do, a player can do. Its weaknesses are human weaknesses:
 * a reaction delay, imperfect aim that has to settle, and a love of zip-lines
 * that a patient rifle can punish mid-flight.
 *
 * Footwork is the hard part. The bot probes the deck before every step, jumps
 * only across gaps it can actually clear, retreats to the ring, and zip-lines
 * instead of swinging: a swing needs a fall to load it, a zip just pulls.
 */

import type { Arena } from '../shared/arena.ts';
import type { Physics } from '../shared/physics.ts';
import type { InputFrame, PlayerState } from '../shared/sim.ts';
import { KEY, updateEye } from '../shared/sim.ts';
import type { ShotMessage } from '../shared/combat.ts';
import { clamp, lookDir, norm, sub, type Vec3 } from '../shared/mathx.ts';
import { GRAPPLE } from '../shared/constants.ts';

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface BotOutput {
  frame: InputFrame;
  fire: boolean;
}

/** The shrinking zone, so the bot retreats instead of dying to the ring. */
export interface BotZone {
  cx: number;
  cz: number;
  radius: number;
  active: boolean;
}

export class Bot {
  yaw = 0;
  pitch = 0;
  keys = 0;
  private seq = 0;
  private think = 0;
  /** A rope attempt: turn toward the pinion, press, then let go into a zip. */
  private rope: { anchor: Vec3; phase: 'aim' | 'press' | 'fly'; t: number; tries: number } | null = null;
  private lastEye: Vec3 = { x: 0, y: 0, z: 0 };
  private reaction = 0;
  private aimNoise = 0;
  private strafe = 1;
  private jumpTimer = 0;
  private travelCooldown = 0;
  /** Seconds spent wedged against geometry with nowhere to walk. */
  private stuck = 0;
  private netAnchor: Vec3 = { x: 0, y: 0, z: 0 };
  private netTimer = 0;
  /** Back-off timer and direction for when the wedging is real. */
  private panic = 0;
  private panicDir: Vec3 = { x: 0, y: 0, z: 0 };
  private fireWanted = false;
  /** 0..1: 1 is a machine, lower is a tired human. */
  readonly skill = 0.62;

  update(p: PlayerState, opp: PlayerState, phys: Physics, arena: Arena, dt: number, zone?: BotZone): BotOutput {
    this.seq++;
    if (!p.alive) {
      this.rope = null;
      this.reaction = 0;
      return { frame: { seq: this.seq, keys: 0, yaw: this.yaw, pitch: this.pitch }, fire: false };
    }
    this.think -= dt;
    this.jumpTimer -= dt;
    this.travelCooldown = Math.max(0, this.travelCooldown - dt);
    this.aimNoise += dt;
    this.fireWanted = false;
    const eye = p.eye;
    this.lastEye = { x: eye.x, y: eye.y, z: eye.z };
    const oppEye = {
      x: opp.pos.x,
      y: opp.pos.y + (opp.sliding ? 0.3 : 0.55),
      z: opp.pos.z,
    };
    const toOpp = sub(oppEye, eye);
    const dist = Math.hypot(toOpp.x, toOpp.y, toOpp.z);
    const dir = norm(toOpp);

    const visible = opp.alive
      ? (() => {
          const wall = phys.raycast(eye, dir, dist - 0.6, p.id);
          return !wall;
        })()
      : false;

    if (this.think <= 0) {
      this.think = 0.12 + Math.random() * 0.16;
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      // Falling into the basement: get out before anything else. A zip pulls
      // up hard where a swing would just orbit an anchor underneath the map.
      // Recover early: a long fall is survivable but it puts the bot under the
      // map, where every pinion is out of reach.
      if (!p.grounded && p.vel.y < -10 && p.pos.y < 48) this.escape(p, arena);
      else if (!p.grounded && p.pos.y < 34 && p.vel.y < -8) this.escape(p, arena);
      else if (p.pos.y < 26) this.escape(p, arena);
      else if (!this.rope && !p.grapple.active && p.grapple.cooldown <= 0 && p.grapple.chainTimer <= 0) {
        // Travel from a standing start: a zip launched mid-fall is a coin flip
        // between a deck and the void, and the void is not a shortcut.
        if (p.grounded && Math.random() < 0.12) this.planTravel(p, opp, arena, phys);
      }
    }

    // ── Aim ────────────────────────────────────────────────────────────────
    const aimingRope = this.rope !== null;
    const aimTarget: Vec3 = aimingRope ? this.rope!.anchor : oppEye;
    const aimDelta = sub(aimTarget, eye);
    const desiredYaw = Math.atan2(-aimDelta.x, -aimDelta.z);
    const desiredPitch = Math.atan2(aimDelta.y, Math.hypot(aimDelta.x, aimDelta.z));
    // Snapping to a pinion is allowed: the rope is a tool, not a duel.
    const turnRate = aimingRope ? 12 : 5.5 + this.skill * 4;
    this.yaw += clamp(wrapAngle(desiredYaw - this.yaw), -turnRate * dt, turnRate * dt);
    // A steady hand wobble: this is what makes the bot beatable at range.
    const wobble = (1 - this.skill) * 0.02;
    const noiseYaw = Math.sin(this.aimNoise * 2.1) * wobble;
    const noisePitch = Math.cos(this.aimNoise * 1.7) * wobble * 0.8;
    this.pitch = clamp(
      this.pitch + clamp(wrapAngle(desiredPitch - this.pitch), -turnRate * dt, turnRate * dt) + noisePitch * dt * 6,
      -1.2,
      1.2,
    );
    const viewYaw = this.yaw + noiseYaw;
    updateEye(p);

    // ── Fire ───────────────────────────────────────────────────────────────
    const aimError = Math.abs(wrapAngle(desiredYaw - viewYaw)) + Math.abs(desiredPitch - this.pitch) * 0.7;
    if (visible && dist < 150) {
      this.reaction += dt;
      if (this.reaction > 0.22 + (1 - this.skill) * 0.4 && aimError < 0.035 && p.fireCooldown <= 0 && p.protect <= 0) {
        this.fireWanted = true;
      }
    } else {
      this.reaction = 0;
    }

    // ── Rope ───────────────────────────────────────────────────────────────
    // Equip the grapnel, look at the pinion, tap the trigger. The tap is the
    // whole travel move: letting go before the claw lands tells the simulation
    // to zip instead of swing, and a zip needs no timing from the bot at all.
    let grappleHeld = false;
    let ropeFire = false;
    if (this.rope) {
      const r = this.rope;
      r.t -= dt;
      if (r.phase === 'aim') {
        grappleHeld = true;
        if (r.t <= 0) {
          r.phase = 'press';
          r.t = 0.08;
        }
      } else if (r.phase === 'press') {
        grappleHeld = true;
        // Falling fast is an emergency: no aiming gate, no line-of-sight
        // veto. A claw in any wall above is a rope, and a rope is a save.
        const falling = !p.grounded && p.vel.y < -6 && p.pos.y < 48;
        const aiming = Math.abs(wrapAngle(desiredYaw - this.yaw)) + Math.abs(desiredPitch - this.pitch) < (falling ? 0.6 : 0.07);
        const blocked = !falling && phys.raycast(p.eye, lookDir(this.yaw, this.pitch), 5, p.id) !== null;
        if (blocked) {
          r.tries++;
          if (r.tries >= 4) this.rope = null;
          else {
            r.phase = 'aim';
            r.t = 0.16;
          }
        } else if (aiming) {
          // Keep the trigger down until the claw actually leaves the hand: a
          // rope that never fired is worse than a rope that missed.
          ropeFire = !p.hook.active && !p.grapple.active;
          if (p.hook.active || p.grapple.active) {
            r.phase = 'fly';
            r.t = 1.2;
          } else if (p.grapple.cooldown > 0) {
            r.t = Math.max(r.t, 0.1);
          } else if (r.t <= 0) {
            r.tries++;
            if (r.tries >= 10) this.rope = null;
            else r.t = 0.08;
          }
        } else {
          r.t = Math.max(r.t, 0.08);
        }
      } else {
        // Ride it out. Swapping back to the rifle mid-zip would cut the rope.
        grappleHeld = true;
        if (p.grapple.active) r.t = Math.max(r.t, 0.35);
        else if (r.t <= 0) this.rope = null;
      }
    }

    // ── Footwork ───────────────────────────────────────────────────────────
    // Direction first, keys second. A bot that holds W into the void is a free
    // kill, so every step is checked against the deck before it is taken, and
    // the ring always wins the argument about where to stand.
    let want: Vec3;
    const ringDist = zone && zone.active ? Math.hypot(p.pos.x - zone.cx, p.pos.z - zone.cz) : 0;
    if (zone && zone.active && ringDist > zone.radius - 7) {
      want = norm({ x: zone.cx - p.pos.x, y: 0, z: zone.cz - p.pos.z });
    } else if (visible && dist < 110) {
      // Strafe across the opponent's line while the bolt cycles.
      const side = norm({ x: -(oppEye.z - eye.z) || 1, y: 0, z: oppEye.x - eye.x });
      want = { x: side.x * this.strafe, y: 0, z: side.z * this.strafe };
    } else {
      want = norm({ x: opp.pos.x - p.pos.x, y: 0, z: opp.pos.z - p.pos.z });
    }
    let keys = 0;
    // Wedged against a corner is a dead bot: after a moment of no horizontal
    // speed, stop sightseeing and throw a rope at the nearest deck.
    // Velocity is not progress: a bot pressed into a wall still carries full
    // speed. Measure where it actually ended up since the last tick.
    // Per-tick speed lies: a bot shuffling in a 1 m circle reads as moving at
    // full sprint every single tick. Compare net displacement over a window.
    this.netTimer += dt;
    if (this.netTimer >= 1) {
      const net = Math.hypot(p.pos.x - this.netAnchor.x, p.pos.z - this.netAnchor.z);
      this.netTimer = 0;
      this.netAnchor = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      if (p.grounded && net < 1.4) this.stuck += 1;
      else this.stuck = 0;
    }
    if (this.stuck > 0.5) {
      this.stuck = 0;
      this.travelCooldown = 0;
      this.rope = null;
      // First choice: a rope to a pinion over a deck. Second: walk back the
      // way we came, which is always a direction that was walkable.
      this.escape(p, arena);
      // Walk out of it regardless of whether a rope looked promising: rope
      // attempts can fail three times over while the bot stands still.
      const home = this.deckCentre(p, arena);
      if (home) this.panicDir = norm({ x: home.x - p.pos.x, y: 0, z: home.z - p.pos.z });
      else {
        const a = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
        const c = Math.cos(a);
        const sn = Math.sin(a);
        this.panicDir = { x: want.x * c - want.z * sn, y: 0, z: want.x * sn + want.z * c };
      }
      this.panic = 1.2;
    }
    const panicking = this.panic > 0;
    if (panicking) this.panic -= dt;

    if (panicking) {
      // Point the body at the escape direction and walk. No strafe logic, no
      // safe-step negotiation: this is the way out of a corner.
      keys = this.keysFor(p, this.panicDir, 0.1);
      if (keys === 0) {
        this.yaw = Math.atan2(-this.panicDir.x, -this.panicDir.z);
        keys = KEY.forward;
      }
    } else if (p.grounded) {
      const near = this.floorAt(p, phys, want, 1.9);
      const far = this.floorAt(p, phys, want, 4.4);
      if (!near && far && this.jumpTimer <= 0) {
        // A gap with deck beyond it is the only thing worth jumping for.
        keys = this.keysFor(p, want) | KEY.jump;
        this.jumpTimer = 1.1;
      } else {
        const step = this.safeStep(p, phys, want);
        keys = this.keysFor(p, step);
        // Wedged against a drop with somewhere to go: zip there.
        if (keys === 0 && !this.rope && !p.grapple.active && p.grapple.cooldown <= 0 && (want.x !== 0 || want.z !== 0)) {
          this.planTravel(p, opp, arena, phys);
        }
      }
    } else {
      // Airborne: steer the fall over deck instead of adding forward speed.
      const land = this.landingGoal(p, arena);
      keys = this.keysFor(p, norm({ x: land.x - p.pos.x, y: 0, z: land.z - p.pos.z }));
    }
    if (grappleHeld) {
      keys |= KEY.grapple;
      if (ropeFire) keys |= KEY.fire;
    }
    // Back to the rifle the moment the rope is done with.
    else if (p.slot !== 0) keys |= KEY.slotRifle;
    if (visible && dist > 55 && dist < 160 && p.fireCooldown <= 0.15) keys |= KEY.scope;

    const frame: InputFrame = { seq: this.seq, keys, yaw: viewYaw, pitch: this.pitch };
    return { frame, fire: this.fireWanted || ropeFire };
  }

  /** World direction → WASD bits in the bot's current aim frame. */
  private keysFor(p: PlayerState, dir: Vec3, threshold = 0.35): number {
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    const f = dir.x * -s + dir.z * -c;
    const r = dir.x * c + dir.z * -s;
    let keys = 0;
    if (f > threshold) keys |= KEY.forward;
    else if (f < -threshold) keys |= KEY.back;
    if (r > threshold) keys |= KEY.right;
    else if (r < -threshold) keys |= KEY.left;
    return keys;
  }

  /** Is there deck within reach `ahead` metres along `dir`? */
  private floorAt(p: PlayerState, phys: Physics, dir: Vec3, ahead: number): boolean {
    const probe = { x: p.pos.x + dir.x * ahead, y: p.pos.y + 0.5, z: p.pos.z + dir.z * ahead };
    return !!phys.raycast(probe, { x: 0, y: -1, z: 0 }, 2.2, p.id);
  }

  /** Refuses to walk off a ledge: sidesteps along the edge instead. */
  private safeStep(p: PlayerState, phys: Physics, dir: Vec3): Vec3 {
    if (dir.x === 0 && dir.z === 0) return dir;
    if (this.floorAt(p, phys, dir, 1.9)) return dir;
    for (const a of [0.9, -0.9, 1.9, -1.9]) {
      const alt = { x: dir.x * Math.cos(a) - dir.z * Math.sin(a), y: 0, z: dir.x * Math.sin(a) + dir.z * Math.cos(a) };
      if (this.floorAt(p, phys, alt, 1.9)) return alt;
    }
    return { x: 0, y: 0, z: 0 };
  }

  /** Where a falling bot should aim its air control: the closest deck below. */
  private landingGoal(p: PlayerState, arena: Arena): Vec3 {
    let best: { x: number; z: number; d: number } | null = null;
    for (const b of arena.blocks) {
      if (b.kind === 'strut' || b.kind === 'beacon') continue;
      if (b.y > p.pos.y + 2) continue;
      const cx = Math.max(b.x - b.hx, Math.min(b.x + b.hx, p.pos.x));
      const cz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, p.pos.z));
      const d = Math.hypot(cx - p.pos.x, cz - p.pos.z) + Math.abs(p.pos.y - (b.y + b.hy)) * 0.35;
      if (!best || d < best.d) best = { x: cx, z: cz, d };
    }
    return best ? { x: best.x, y: 0, z: best.z } : { x: 0, y: 0, z: 0 };
  }

  /** Recovery: zip to a pinion that hangs over a deck, so the fall lands. */
  private escape(p: PlayerState, arena: Arena): void {
    if (this.rope || p.grapple.active) return;
    let best: { a: Vec3; score: number } | null = null;
    for (const a of arena.anchors) {
      if (a.y < p.pos.y + 5) continue;
      const d = Math.hypot(a.x - p.pos.x, a.y - p.pos.y, a.z - p.pos.z);
      if (d > 60) continue;
      // A pinion over a deck is worth far more than a taller one over nothing:
      // a zip that ends in open air just buys another fall.
      const score = (this.deckBelow(arena, a) ? 60 : 0) - d * 0.4 + (a.y - p.pos.y) * 0.1;
      if (!best || score > best.score) best = { a, score };
    }
    if (best) this.startZip(best.a);
  }

  /** Centre of the deck the bot is standing on, if any. */
  private deckCentre(p: PlayerState, arena: Arena): Vec3 | null {
    let best: { c: Vec3; d: number } | null = null;
    for (const b of arena.blocks) {
      if (b.kind !== 'deck') continue;
      if (Math.abs(p.pos.x - b.x) > b.hx + 2 || Math.abs(p.pos.z - b.z) > b.hz + 2) continue;
      if (Math.abs(p.pos.y - (b.y + b.hy)) > 3) continue;
      const d = Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      if (!best || d < best.d) best = { c: { x: b.x, y: b.y + b.hy, z: b.z }, d };
    }
    return best ? best.c : null;
  }

  /** Is there a standable deck directly under this point? */
  private deckBelow(arena: Arena, at: Vec3): boolean {
    for (const b of arena.blocks) {
      if (b.kind !== 'deck') continue;
      if (Math.abs(at.x - b.x) > b.hx + 3 || Math.abs(at.z - b.z) > b.hz + 3) continue;
      if (b.y + b.hy < at.y - 1) return true;
    }
    return false;
  }

  /** Getting across the map: zip to a pinion in the direction of the fight. */
  private planTravel(p: PlayerState, opp: PlayerState, arena: Arena, phys: Physics): void {
    if (this.rope || this.travelCooldown > 0) return;
    // Close range is a rifle fight, not a commute: walking and strafing wins.
    if (Math.hypot(opp.pos.x - p.pos.x, opp.pos.z - p.pos.z) < 30) return;
    const toward = norm({ x: opp.pos.x - p.pos.x, y: 0, z: opp.pos.z - p.pos.z });
    let best: { a: Vec3; score: number } | null = null;
    for (const a of arena.anchors) {
      const d = Math.hypot(a.x - p.pos.x, a.y - p.pos.y, a.z - p.pos.z);
      if (d > 58 || d < 10) continue;
      if (a.y < p.pos.y - 4) continue;
      // A destination over open air is not a destination: the zip ends and the
      // fall starts, and a bot that falls does not win duels.
      if (!this.deckBelow(arena, a)) continue;
      const along = (a.x - p.pos.x) * toward.x + (a.z - p.pos.z) * toward.z;
      if (along < 6) continue; // never a sideways detour
      // The claw flies a straight line, so an anchor behind a slab is not a
      // destination: it is a wall with a pinion painted on it.
      const ex = a.x - p.eye.x;
      const ey = a.y - p.eye.y;
      const ez = a.z - p.eye.z;
      const ed = Math.hypot(ex, ey, ez);
      if (ed > GRAPPLE.range - 2) continue;
      const clear = phys.raycast(p.eye, { x: ex / ed, y: ey / ed, z: ez / ed }, ed - 1.4, p.id);
      if (clear) continue;
      const score = along * 0.7 + (a.y - p.pos.y) * 0.5 - d * 0.1;
      if (!best || score > best.score) best = { a, score };
    }
    if (best) this.startZip(best.a);
  }

  private startZip(anchor: Vec3): void {
    this.rope = { anchor, phase: 'aim', t: this.timeToTurn(anchor), tries: 0 };
    // Zipping is a reposition, not a hover: one trip, then fight.
    this.travelCooldown = 2.4;
  }

  /** Rough seconds needed to put the crosshair on a point. */
  private timeToTurn(target: Vec3): number {
    const dx = target.x - this.lastEye.x;
    const dy = target.y - this.lastEye.y;
    const dz = target.z - this.lastEye.z;
    const yawErr = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - this.yaw));
    const pitchErr = Math.abs(Math.atan2(dy, Math.hypot(dx, dz)) - this.pitch);
    return Math.min(0.25, 0.06 + (yawErr + pitchErr) / 9);
  }

  /** Builds the shot message from the bot's own view; the server validates it. */
  shot(p: PlayerState): ShotMessage {
    const dir = lookDir(this.yaw, this.pitch);
    return {
      seq: this.seq,
      origin: { ...p.eye },
      dir,
      scoped: p.scoped,
      aimTime: 0,
    };
  }
}
