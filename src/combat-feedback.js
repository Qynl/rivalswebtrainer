// Small, bounded feedback helpers. No DOM, rendering, camera shake or aim changes.
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
export function relativeBearing(listener, source, yaw = 0) {
  const dx = source.x - listener.x,
    dz = source.z - listener.z;
  return Math.atan2(
    dx * Math.cos(yaw) - dz * Math.sin(yaw),
    -dx * Math.sin(yaw) - dz * Math.cos(yaw),
  );
}
export function spatialMix(listener, source, yaw = 0, occluded = false) {
  const dx = source.x - listener.x,
    dz = source.z - listener.z;
  const distance = Math.hypot(dx, dz, (source.y || 0) - (listener.y || 0));
  return {
    pan: clamp(Math.sin(relativeBearing(listener, source, yaw)), -0.95, 0.95),
    gain: Math.min(0.8, 1 / (1 + (distance / 15) ** 2)) * (occluded ? 0.32 : 1),
    cutoff: occluded ? 1000 : 12000,
  };
}
export function reticleGap(weapon, grounded, aiming, viewportHeight, fov) {
  const factor = (aiming ? 0.25 : 1) * (grounded ? 1 : 1.5);
  const focal = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  return 4 + clamp((weapon.spread || 0) * factor * focal, 0, 20);
}
export class DamageCompass {
  constructor() {
    this.slots = Array.from({ length: 4 }, () => ({
      x: 0,
      z: 0,
      life: 0,
      bearing: 0,
      strength: 0,
    }));
  }
  clear() {
    for (const s of this.slots) s.life = 0;
  }
  add(listener, source, amount = 12, yaw = 0) {
    if (
      !source ||
      source === listener ||
      amount <= 0 ||
      ![source.x, source.z, listener.x, listener.z, yaw, amount].every(
        Number.isFinite,
      ) ||
      Math.hypot(source.x - listener.x, source.z - listener.z) < 0.05
    )
      return;
    const bearing = relativeBearing(listener, source, yaw);
    const matching = this.slots.find(
      (s) =>
        s.life > 0 &&
        Math.abs(
          Math.atan2(
            Math.sin(relativeBearing(listener, s, yaw) - bearing),
            Math.cos(relativeBearing(listener, s, yaw) - bearing),
          ),
        ) < 0.5,
    );
    const slot =
      matching ||
      this.slots.find((s) => s.life <= 0) ||
      this.slots.reduce((a, b) => (a.life < b.life ? a : b));
    Object.assign(slot, {
      x: source.x,
      z: source.z,
      life: 0.85,
      bearing,
      strength: clamp(amount / 35, 0.35, 1),
    });
  }
  update(dt, listener, yaw) {
    for (const slot of this.slots) {
      slot.life = Math.max(0, slot.life - Math.max(0, dt));
      if (slot.life > 0) slot.bearing = relativeBearing(listener, slot, yaw);
    }
    return this.slots;
  }
}

// Body/head/elimination priority prevents late shotgun pellets or splash hits
// from erasing a kill confirmation. Uses a caller-supplied monotonic millisecond
// clock so the UI can expire independently of paused simulation time.
export class HitConfirmation {
  constructor() {
    this.clear();
  }
  clear() {
    this.kind = 0;
    this.until = 0;
  }
  sample(now) {
    if (now >= this.until) this.clear();
    return this.kind;
  }
  add(head, elimination, now) {
    const next = elimination ? 3 : head ? 2 : 1;
    if (this.sample(now) > next) return;
    this.kind = next;
    this.until = now + [0, 160, 210, 300][next];
  }
}
