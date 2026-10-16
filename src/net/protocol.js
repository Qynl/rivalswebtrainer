import { WEAPONS } from "../data.js";
export const PROTOCOL = 3,
  MAX_PLAYERS = 6,
  ONLINE_MAPS = ["blockout", "foundry", "courtyard"];
export const DEFAULT_LOADOUT = ["rifle", "pistol", "fists", "grenade"];
export const KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "Space"];
export const ACTIONS = new Set([
  "fire",
  "release",
  "jump",
  "slide",
  "ability",
  "utility",
  "reload",
  "secondary",
  "slot0",
  "slot1",
  "slot2",
  "slot3",
]);
export function cleanName(value) {
  return typeof value === "string"
    ? value
        .replace(/[\p{Cc}\p{Cf}<>]/gu, "")
        .trim()
        .slice(0, 20) || "PLAYER"
    : "PLAYER";
}
export function cleanLoadout(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  return value.every(
    (id, i) => typeof id === "string" && WEAPONS[id]?.slot === i,
  )
    ? [...value]
    : null;
}
export function cleanInput(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    value.seq > 2 ** 31 - 1 ||
    !Number.isFinite(value.yaw) ||
    !Number.isFinite(value.pitch)
  )
    return null;
  const actions = Array.isArray(value.actions)
    ? value.actions
        .slice(-12)
        .filter(
          (a) =>
            a &&
            Number.isSafeInteger(a.id) &&
            a.id >= 0 &&
            a.id < 2 ** 31 &&
            ACTIONS.has(a.type),
        )
        .map((a) => ({ id: a.id, type: a.type }))
    : [];
  return {
    seq: value.seq,
    yaw: Math.atan2(Math.sin(value.yaw), Math.cos(value.yaw)),
    pitch: Math.max(-1.48, Math.min(1.48, value.pitch)),
    keys: (Number.isInteger(value.keys) ? value.keys : 0) & 31,
    fire: value.fire === true,
    aim: value.aim === true,
    paused: value.paused === true,
    actions,
  };
}
export function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}
// A short bounded timeline hides arrival jitter; extrapolation is capped at 50ms.
export class SnapshotBuffer {
  constructor(delay = 0.075, { adaptive = false } = {}) {
    this.delay = delay;
    this.adaptive = adaptive;
    this.jitter = 0;
    this.clockOffset = null;
    this.frames = [];
  }
  push(snapshot, received) {
    if (!snapshot || !Number.isFinite(snapshot.time)) return;
    if (this.frames.at(-1)?.time >= snapshot.time) return;
    const previous = this.frames.at(-1);
    if (this.adaptive) {
      const offset = received - snapshot.time;
      this.clockOffset =
        this.clockOffset === null || Math.abs(offset - this.clockOffset) > 0.5
          ? offset
          : this.clockOffset + (offset - this.clockOffset) * 0.08;
      if (previous) {
        const variation = Math.min(
          0.1,
          Math.abs(
            received - previous.received - (snapshot.time - previous.time),
          ),
        );
        this.jitter += (variation - this.jitter) * 0.1;
        const targetDelay = Math.max(
          0.055,
          Math.min(0.12, 0.055 + this.jitter * 3),
        );
        this.delay += (targetDelay - this.delay) * 0.15;
      }
    }
    this.frames.push({ ...snapshot, received });
    if (this.frames.length > 32) this.frames.shift();
  }
  sample(now) {
    if (!this.frames.length) return null;
    const last = this.frames.at(-1),
      target = this.adaptive
        ? now - this.clockOffset - this.delay
        : last.time +
          Math.min(0.125, Math.max(0, now - last.received)) -
          this.delay;
    let a = this.frames[0],
      b = last;
    for (let i = 1; i < this.frames.length; i++) {
      if (this.frames[i].time >= target) {
        b = this.frames[i];
        a = this.frames[i - 1];
        break;
      }
    }
    if (target > last.time) {
      const extra = Math.min(0.05, target - last.time);
      return last.players.map((p) => ({
        ...p,
        x: p.x + (p.alive ? (p.vx || 0) * extra : 0),
        y: p.y + (p.alive && !p.grounded ? (p.vy || 0) * extra : 0),
        z: p.z + (p.alive ? (p.vz || 0) * extra : 0),
      }));
    }
    const t = Math.max(
      0,
      Math.min(1, (target - a.time) / Math.max(0.001, b.time - a.time)),
    );
    return b.players.map((p) => {
      const old = a.players.find((o) => o.id === p.id);
      if (!old || old.alive !== p.alive) return { ...p };
      return {
        ...p,
        x: old.x + (p.x - old.x) * t,
        y: old.y + (p.y - old.y) * t,
        z: old.z + (p.z - old.z) * t,
        yaw: lerpAngle(old.yaw, p.yaw, t),
      };
    });
  }
  clear() {
    this.frames.length = 0;
    this.clockOffset = null;
    this.jitter = 0;
  }
}
