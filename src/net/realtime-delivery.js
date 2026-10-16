// Only these effects may be sacrificed under congestion. Never put damage,
// impulses, eliminations, round transitions or inventory on the disposable lane.
export const isDisposableEffect = (event) =>
  event?.type === "trace" || event?.type === "impact";
export const EFFECT_PACKET_BYTES = 1000;
const encoder = new TextEncoder();
const vector = (a) =>
  Array.isArray(a) &&
  a.length === 3 &&
  a.every((n) => Number.isFinite(n) && Math.abs(n) <= 10000);
export const validDisposableEffect = (event) =>
  isDisposableEffect(event) &&
  Number.isSafeInteger(event.id) &&
  event.id > 0 &&
  (event.type === "trace"
    ? vector(event.a) && vector(event.b)
    : vector(event.position) && vector(event.normal));
export function splitCombatEvents(packet) {
  const critical = [],
    effects = [];
  for (const event of packet.events || [])
    (isDisposableEffect(event) ? effects : critical).push(event);
  const selected = [];
  let data = JSON.stringify({
    type: "effects",
    matchId: packet.matchId,
    events: selected,
  });
  // Prefer the freshest visual effects and keep a datagram-sized, bounded batch.
  for (
    let i = effects.length - 1;
    i >= Math.max(0, effects.length - 96) && selected.length < 12;
    i--
  ) {
    const candidate = [effects[i], ...selected];
    const next = JSON.stringify({
      type: "effects",
      matchId: packet.matchId,
      events: candidate,
    });
    if (encoder.encode(next).byteLength > EFFECT_PACKET_BYTES) continue;
    selected.unshift(effects[i]);
    data = next;
  }
  return {
    critical,
    data: selected.length ? data : null,
    bytes: selected.length ? encoder.encode(data).byteLength : 0,
    dropped: effects.length - selected.length,
  };
}

// One expensive state application per task turn, instead of replaying a backlog
// after rendering/GC stalls. Critical messages can flush the newest state first.
export class SnapshotInbox {
  constructor(
    apply,
    schedule = (fn) => setTimeout(fn, 0),
    cancel = (id) => clearTimeout(id),
  ) {
    this.apply = apply;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pending = null;
    this.timer = null;
    this.coalesced = 0;
  }
  push(packet) {
    if (this.pending) {
      if (packet.snapshot.time <= this.pending.snapshot.time) return;
      this.coalesced++;
    }
    this.pending = packet;
    if (this.timer === null)
      this.timer = this.schedule(() => {
        this.timer = null;
        this.flush();
      });
  }
  flush() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    const packet = this.pending;
    this.pending = null;
    if (packet) this.apply(packet);
  }
  clear() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
