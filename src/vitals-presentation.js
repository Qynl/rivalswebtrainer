const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
// Display-only damage chip: immediate HP, short hold, then a bounded exponential
// catch-up. No timers, healing, combat state or per-update allocations.
export class HealthTrail {
  constructor() {
    this.value = 150;
    this.health = 150;
    this.time = -Infinity;
    this.holdUntil = 0;
  }
  sample(health, maximum = 150, now = 0, reset = false) {
    maximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 150;
    health = clamp(Number.isFinite(health) ? health : 0, 0, maximum);
    if (!Number.isFinite(now)) now = Number.isFinite(this.time) ? this.time : 0;
    if (
      reset ||
      !Number.isFinite(this.time) ||
      now < this.time ||
      health > this.health
    ) {
      this.value = health;
      this.holdUntil = now;
    } else if (health < this.health) this.holdUntil = now + 0.22;
    const dt = Math.max(0, now - Math.max(this.time, this.holdUntil));
    if (dt > 0) this.value = health + (this.value - health) * Math.exp(-8 * dt);
    this.value = clamp(this.value, health, maximum);
    this.health = health;
    this.time = now;
    return this.value;
  }
}
export function magazineFraction(ammo, capacity, slot) {
  return slot < 2 &&
    Number.isFinite(ammo) &&
    Number.isFinite(capacity) &&
    capacity > 0
    ? clamp(ammo / capacity, 0, 1)
    : null;
}
