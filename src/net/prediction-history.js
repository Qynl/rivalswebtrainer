// Match authority to the input's local simulation timeline, NOT today's player
// position. Both host and guest use this same bounded history; RTT is irrelevant.
export class PredictionHistory {
  constructor() {
    this.frames = [];
    this.inputs = new Map();
    this.offset = { x: 0, y: 0, z: 0 };
  }
  clear() {
    this.frames.length = 0;
    this.inputs.clear();
    this.offset.x = this.offset.y = this.offset.z = 0;
  }
  record(time, player) {
    const frame = {
      time,
      x: player.x - this.offset.x,
      y: player.y - this.offset.y,
      z: player.z - this.offset.z,
    };
    if (this.frames.at(-1)?.time === time)
      this.frames[this.frames.length - 1] = frame;
    else this.frames.push(frame);
    while (this.frames.length > 256) this.frames.shift();
  }
  sent(seq, time, player) {
    this.record(time, player);
    this.inputs.set(seq, time);
    while (this.inputs.size > 192)
      this.inputs.delete(this.inputs.keys().next().value);
  }
  applied(x, y, z) {
    this.offset.x += x;
    this.offset.y += y;
    this.offset.z += z;
  }
  error(self, serverTime) {
    if (![serverTime, self.x, self.y, self.z].every(Number.isFinite))
      return null;
    const sent = this.inputs.get(self.lastSeq);
    if (sent === undefined || !Number.isFinite(self.inputTime)) return null;
    const age = serverTime - self.inputTime;
    if (age < -0.001 || age > 0.25) return null;
    const target = sent + Math.max(0, age),
      first = this.frames[0],
      last = this.frames.at(-1);
    if (!first || target < first.time - 0.001 || target > last.time + 0.018)
      return null;
    let a = first,
      b = last;
    for (let i = 1; i < this.frames.length; i++)
      if (this.frames[i].time >= target) {
        a = this.frames[i - 1];
        b = this.frames[i];
        break;
      }
    const t =
      a === b
        ? 0
        : Math.max(0, Math.min(1, (target - a.time) / (b.time - a.time || 1)));
    const error = {};
    for (const key of ["x", "y", "z"])
      error[key] =
        self[key] - (a[key] + (b[key] - a[key]) * t + this.offset[key]);
    // Small quantisation/tick noise must not move the camera.
    if (Math.hypot(error.x, error.z) < 0.025) error.x = error.z = 0;
    if (Math.abs(error.y) < 0.035) error.y = 0;
    return error;
  }
}
