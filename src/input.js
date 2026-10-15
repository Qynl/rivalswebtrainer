// Pointer-lock transitions and some trackpads emit a single bogus recenter delta.
// Filter those packets, not ordinary mouse motion; normal look remains immediate.
export class MouseLook {
  constructor() {
    this.reset(-Infinity);
  }
  reset(now) {
    this.capturedAt = now;
    this.lastAt = now;
  }
  accept(x, y, now) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const capturePacket =
      now - this.capturedAt < 500 && Math.max(Math.abs(x), Math.abs(y)) > 80;
    const impossiblePacket = Math.max(Math.abs(x), Math.abs(y)) > 600;
    const verticalSpike = Math.abs(y) > 240 && Math.abs(y) > Math.abs(x) * 5;
    this.lastAt = now;
    if (capturePacket || impossiblePacket || verticalSpike) return null;
    return { x, y };
  }
}
