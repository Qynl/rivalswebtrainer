// Reject recenter/stale/outlier packets, not normal motion. No aim smoothing,
// no delayed replay of discarded deltas, and a bounded five-packet history.
export class MouseLook {
  constructor() {
    this.reset(-Infinity);
  }
  reset(now) {
    this.capturedAt = now;
    this.lastAt = now;
    this.samples = [];
    this.suspect = null;
  }
  accept(x, y, now, eventTime = now) {
    if (![x, y, now].every(Number.isFinite)) return null;
    const magnitude = Math.hypot(x, y),
      largest = Math.max(Math.abs(x), Math.abs(y)),
      gap = now - this.lastAt;
    this.lastAt = now;
    if (
      (now - this.capturedAt < 500 && largest > 80) ||
      largest > 600 ||
      (Math.abs(y) > 180 && Math.abs(y) > Math.abs(x) * 4) ||
      (Number.isFinite(eventTime) && now - eventTime > 100 && magnitude > 24)
    ) {
      this.suspect = null;
      return null;
    }
    const history = this.samples.filter((s) => now - s.time < 160),
      ordered = history.map((s) => s.magnitude).sort((a, b) => a - b);
    const typical = ordered.length
      ? ordered[Math.floor(ordered.length / 2)]
      : 0;
    const outlier =
      (history.length >= 3 && magnitude > Math.max(96, typical * 7)) ||
      (this.samples.length >= 3 && gap > 250 && magnitude > 120);
    if (outlier) {
      const p = this.suspect,
        coherent =
          p &&
          now - p.time < 50 &&
          magnitude > p.magnitude * 0.4 &&
          magnitude < p.magnitude * 2.5 &&
          (x * p.x + y * p.y) / (magnitude * p.magnitude) > 0.8;
      if (!coherent) {
        this.suspect = { x, y, time: now, magnitude };
        return null;
      }
    }
    this.suspect = null;
    this.samples.push({ time: now, magnitude });
    if (this.samples.length > 5) this.samples.shift();
    return { x, y };
  }
}
