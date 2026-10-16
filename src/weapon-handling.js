// Cosmetic handling only: all ammunition and readiness stay in Game/authority.
const smooth = (v) => {
  v = Math.max(0, Math.min(1, v));
  return v * v * (3 - 2 * v);
};
export function reloadHandling(id, progress = 0) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const active = smooth(p / 0.12) * (1 - smooth((p - 0.82) / 0.18));
  const out = smooth((p - 0.14) / 0.18) * (1 - smooth((p - 0.55) / 0.22));
  const seat = Math.sin(Math.max(0, Math.min(1, (p - 0.65) / 0.16)) * Math.PI);
  const tube = id === "shotgun" || id === "shorty";
  const heavy = ["rpg", "launcher", "minigun", "flame"].includes(id);
  const wheel = id === "revolver";
  return {
    cant: active
      ? active * (heavy ? -0.12 : wheel ? 0.16 : tube ? -0.07 : -0.1)
      : 0,
    reach: out * (heavy ? 0.12 : tube ? 0.025 : 0.075),
    wrist: out * (wheel ? 0.5 : heavy ? -0.25 : 0.32),
    seat: seat * (tube ? 0.012 : 0.025),
    shell: tube ? Math.sin(p * Math.PI * 6) * active * 0.025 : 0,
    stage:
      p === 0 || p === 1
        ? ""
        : p < 0.18
          ? "RELEASE"
          : p < 0.55
            ? tube
              ? "LOAD SHELLS"
              : wheel
                ? "LOAD CYLINDER"
                : "REPLACE"
            : p < 0.8
              ? "SEAT"
              : "READY",
  };
}

const flash = (width, length, duration, color) =>
  Object.freeze({ width, length, duration, color });
const DEFAULT = flash(1.15, 1, 0.055, 0xffda99);
export const MUZZLE_PROFILES = Object.freeze({
  rifle: flash(1.2, 1.35, 0.055, 0xffd5a0),
  burst: flash(1.1, 1.5, 0.05, 0xffe0ab),
  smg: flash(0.88, 0.8, 0.042, 0xffd799),
  uzi: flash(0.82, 0.76, 0.04, 0xffd799),
  pistol: flash(0.95, 0.8, 0.05, 0xffe2b9),
  burstpistol: flash(0.85, 0.85, 0.045, 0xffe8bc),
  dualpistols: flash(0.9, 0.8, 0.045, 0xffe1a5),
  revolver: flash(1.5, 1.7, 0.065, 0xffca80),
  sniper: flash(1.65, 2.35, 0.065, 0xffe5bb),
  shotgun: flash(1.9, 1.15, 0.065, 0xffc57b),
  shorty: flash(1.7, 1.05, 0.06, 0xffca8a),
  minigun: flash(0.95, 1.55, 0.038, 0xffd99c),
  paintball: flash(0.65, 0.65, 0.035, 0x99eeeb),
  rpg: flash(1.55, 1.85, 0.065, 0xffc47c),
  launcher: flash(1.4, 1.35, 0.065, 0xffd08e),
});
export function animateMuzzle(mesh, id, age, sequence = 0, enabled = true) {
  if (!mesh) return;
  const profile = MUZZLE_PROFILES[id] || DEFAULT;
  mesh.visible =
    !!enabled && Number.isFinite(age) && age >= 0 && age < profile.duration;
  if (!mesh.visible) return;
  // Shot-seeded variation rather than random per-frame flicker. No extra lights,
  // geometry, timers, allocations or writes to the camera/projectile socket.
  const variation = 1 + Math.sin(sequence * 12.9898) * 0.09;
  const decay = 1 - (0.38 * age) / profile.duration;
  mesh.scale.set(
    profile.width * variation * decay,
    profile.width * variation * decay,
    profile.length * decay,
  );
  mesh.rotation.z = sequence * 2.399963;
  mesh.material.color?.setHex(profile.color);
}

// Crossings, not setTimeout: cancelling/switching cannot leave late reload sounds.
export class ReloadCues {
  constructor() {
    this.id = null;
    this.progress = 0;
    this.clock = -Infinity;
  }
  sample(id, remaining, total, clock) {
    if (!(remaining > 0 && total > 0) || !Number.isFinite(clock)) {
      this.id = null;
      this.progress = 0;
      return null;
    }
    const p = Math.max(0, Math.min(1, 1 - remaining / total));
    if (id !== this.id || clock < this.clock || p < this.progress - 0.25) {
      this.id = id;
      this.progress = p;
      this.clock = clock;
      return null;
    }
    const before = this.progress;
    this.progress = Math.max(before, p);
    this.clock = clock;
    // At most one short cue after a long frame, never a burst of missed sounds.
    if (before < 0.84 && p >= 0.84) return "reload-ready";
    if (before < 0.64 && p >= 0.64) return "reload-seat";
    if (before < 0.16 && p >= 0.16) return "reload-release";
    return null;
  }
}
