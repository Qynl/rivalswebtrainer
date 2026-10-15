import { Vector3 } from "three";
// Bounded confirmed-hit feedback; no enemy scan or network state. Pellets merge.
export class DamageNumbers {
  constructor() {
    this.items = [];
    this.nextId = 1;
    this.point = new Vector3();
  }
  clear() {
    this.items.length = 0;
  }
  add(entity, amount, head, time, backstab = false) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.items = this.items.filter((n) => time - n.time < 0.85);
    const old = this.items.find(
      (n) =>
        n.entity === entity && time - n.time < 0.12 && n.backstab === backstab,
    );
    if (old) {
      old.amount += amount;
      old.head ||= head;
      return;
    }
    this.items.push({
      id: this.nextId++,
      entity,
      amount,
      head,
      backstab,
      time,
      x: entity.x,
      y: entity.y + (entity.height || 1.9) + 0.25,
      z: entity.z,
    });
    if (this.items.length > 24) this.items.shift();
  }
  project(camera, width, height, time, world, hasLOS, eye) {
    this.items = this.items.filter((n) => time - n.time < 0.85);
    camera.updateMatrixWorld();
    return this.items.flatMap((n) => {
      const age = Math.max(0, time - n.time),
        e = n.entity;
      const target = this.point.set(
        e.alive ? e.x : n.x,
        (e.alive ? e.y + (e.height || 1.9) + 0.25 : n.y) + age * 0.65,
        e.alive ? e.z : n.z,
      );
      if (hasLOS && eye && !hasLOS(eye, target)) return [];
      target.project(camera);
      if (
        target.z < -1 ||
        target.z > 1 ||
        Math.abs(target.x) > 1.05 ||
        Math.abs(target.y) > 1.05
      )
        return [];
      return [
        {
          id: n.id,
          amount: Math.round(n.amount),
          head: n.head,
          backstab: n.backstab,
          x: (target.x * 0.5 + 0.5) * width,
          y: (0.5 - target.y * 0.5) * height,
          opacity: Math.min(1, (0.85 - age) / 0.25),
          scale: 1 + 0.18 * Math.exp(-age * 18),
        },
      ];
    });
  }
}
