export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Covers may be rotated in the reference-style arena. Resolve them in local
// space so diagonal slabs have real collision, not an invisible axis-aligned box.
function localPoint(x, z, b) {
  if (!b.angle) return { x, z };
  const dx = x - b.cx,
    dz = z - b.cz,
    c = Math.cos(b.angle),
    s = Math.sin(b.angle);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
function limits(b) {
  return b.angle
    ? { minX: -b.halfX, maxX: b.halfX, minZ: -b.halfZ, maxZ: b.halfZ }
    : b;
}
export function circleBox(x, z, r, b) {
  const p = localPoint(x, z, b),
    bounds = limits(b);
  const dx = p.x - clamp(p.x, bounds.minX, bounds.maxX),
    dz = p.z - clamp(p.z, bounds.minZ, bounds.maxZ);
  return dx * dx + dz * dz < r * r;
}
const EPSILON = 1e-5;
// Shared by mesh collision, head clearance, support and slide-jump launch.
export function surfaceHeight(b, x, z) {
  if (!b.ramp) return b.maxY;
  const p = localPoint(x, z, b),
    bounds = limits(b),
    axis = b.ramp.axis || "z";
  const low = axis === "x" ? bounds.minX : bounds.minZ,
    high = axis === "x" ? bounds.maxX : bounds.maxZ;
  let t = clamp((p[axis] - low) / (high - low), 0, 1);
  if (b.ramp.direction < 0) t = 1 - t;
  return b.minY + b.ramp.rise * t;
}
export function rampGradient(b) {
  if (!b.ramp) return { x: 0, z: 0 };
  const bounds = limits(b),
    axis = b.ramp.axis || "z";
  const slope =
    (b.ramp.rise /
      (axis === "x" ? bounds.maxX - bounds.minX : bounds.maxZ - bounds.minZ)) *
    (b.ramp.direction || 1);
  const c = Math.cos(b.angle || 0),
    s = Math.sin(b.angle || 0);
  return axis === "x"
    ? { x: slope * c, z: -slope * s }
    : { x: slope * s, z: slope * c };
}
export function canOccupy(body, x, y, z, boxes, height = body.height) {
  return !boxes.some(
    (b) =>
      y < surfaceHeight(b, x, z) - EPSILON &&
      y + height > b.minY + EPSILON &&
      circleBox(x, z, body.radius, b),
  );
}
function tryStep(body, x, z, b, boxes) {
  const top = surfaceHeight(b, x, z);
  if (!body.grounded || top - body.y > 0.4 + EPSILON || top <= body.y)
    return false;
  if (!canOccupy(body, x, top, z, boxes)) return false;
  body.y = top;
  return true;
}
function resolveCircle(body, b) {
  const p = localPoint(body.x, body.z, b),
    bounds = limits(b);
  const closestX = clamp(p.x, bounds.minX, bounds.maxX),
    closestZ = clamp(p.z, bounds.minZ, bounds.maxZ);
  let nx = p.x - closestX,
    nz = p.z - closestZ,
    length = Math.hypot(nx, nz),
    penetration;
  if (length >= body.radius) return;
  if (length > 1e-7) {
    nx /= length;
    nz /= length;
    penetration = body.radius - length;
  } else {
    const edges = [
      { d: p.x - bounds.minX, x: -1, z: 0 },
      { d: bounds.maxX - p.x, x: 1, z: 0 },
      { d: p.z - bounds.minZ, x: 0, z: -1 },
      { d: bounds.maxZ - p.z, x: 0, z: 1 },
    ];
    const edge = edges.reduce((a, b) => (a.d < b.d ? a : b));
    nx = edge.x;
    nz = edge.z;
    penetration = body.radius + edge.d;
  }
  if (b.angle) {
    const c = Math.cos(b.angle),
      s = Math.sin(b.angle);
    const x = nx * c + nz * s;
    nz = -nx * s + nz * c;
    nx = x;
  }
  body.x += nx * (penetration + EPSILON);
  body.z += nz * (penetration + EPSILON);
  if (Number.isFinite(body.vx) && Number.isFinite(body.vz)) {
    const into = body.vx * nx + body.vz * nz;
    if (into < 0) {
      body.vx -= into * nx;
      body.vz -= into * nz;
    }
  }
}
export function moveBody(body, dx, dz, boxes) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.16));
  for (let i = 0; i < steps; i++) {
    body.x += dx / steps;
    body.z += dz / steps;
    // Ground adhesion on continuous slopes prevents downhill micro-falls/jitter.
    if (body.grounded)
      for (const b of boxes)
        if (b.ramp && circleBox(body.x, body.z, body.radius, b)) {
          const top = surfaceHeight(b, body.x, body.z);
          if (
            Math.abs(top - body.y) <= 0.4 + EPSILON &&
            canOccupy(body, body.x, top, body.z, boxes)
          )
            body.y = top;
        }
    // Two passes keep intersecting cover corners stable at high slide/dash speeds.
    for (let pass = 0; pass < 2; pass++)
      for (const b of boxes) {
        if (
          body.y < surfaceHeight(b, body.x, body.z) - 0.04 &&
          body.y + body.height > b.minY + 0.02 &&
          circleBox(body.x, body.z, body.radius, b)
        ) {
          if (!tryStep(body, body.x, body.z, b, boxes)) resolveCircle(body, b);
        }
      }
  }
}
export const GRAVITY = 30;
export function verticalStep(body, dt, boxes) {
  const old = body.y;
  body.y += body.vy * dt - GRAVITY * 0.5 * dt * dt;
  body.vy -= GRAVITY * dt;
  body.grounded = false;
  let floor = 0,
    support = null;
  for (const b of boxes) {
    if (circleBox(body.x, body.z, body.radius, b)) {
      const top = surfaceHeight(b, body.x, body.z);
      if (body.vy <= 0 && old >= top - 0.06 && body.y <= top && top >= floor) {
        floor = top;
        support = b;
      }
      if (
        body.vy > 0 &&
        old + body.height <= b.minY + 0.05 &&
        body.y + body.height >= b.minY
      ) {
        body.y = b.minY - body.height;
        body.vy = 0;
      }
    }
  }
  if (body.y <= floor) {
    body.y = floor;
    body.vy = 0;
    body.grounded = true;
    body.jumps = 0;
    body.groundSlope = support ? rampGradient(support) : null;
  } else body.groundSlope = null;
}
// Deterministic A* on a ground grid, shared by all AI combatants.
export class NavGrid {
  constructor(boxes, size = 48, cell = 1.5, sizeZ = size) {
    this.size = size;
    this.sizeZ = sizeZ;
    this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.nz = Math.ceil(sizeZ / cell);
    this.blocked = new Uint8Array(this.n * this.nz);
    this.heights = new Float32Array(this.n * this.nz);
    this.slopes = new Uint8Array(this.n * this.nz);
    for (let z = 0; z < this.nz; z++)
      for (let x = 0; x < this.n; x++) {
        const i = z * this.n + x,
          p = this.point(i);
        for (const b of boxes)
          if (b.ramp && circleBox(p.x, p.z, 0.01, b)) {
            this.heights[i] = Math.max(
              this.heights[i],
              surfaceHeight(b, p.x, p.z),
            );
            this.slopes[i] = 1;
          }
        this.blocked[z * this.n + x] = boxes.some(
          (b) =>
            !b.ramp &&
            b.maxY > 0.5 &&
            b.minY < 1.9 &&
            circleBox(p.x, p.z, 0.5, b),
        )
          ? 1
          : 0;
      }
  }
  index(x, z) {
    return (
      clamp(Math.floor((z + this.sizeZ / 2) / this.cell), 0, this.nz - 1) *
        this.n +
      clamp(Math.floor((x + this.size / 2) / this.cell), 0, this.n - 1)
    );
  }
  point(i) {
    return {
      x: ((i % this.n) + 0.5) * this.cell - this.size / 2,
      z: (Math.floor(i / this.n) + 0.5) * this.cell - this.sizeZ / 2,
      y: this.heights?.[i] || 0,
    };
  }
  nearest(i) {
    if (!this.blocked[i]) return i;
    const p = this.point(i);
    for (let r = 1; r < 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const j = this.index(p.x + dx * this.cell, p.z + dz * this.cell);
          if (!this.blocked[j]) return j;
        }
    return i;
  }
  path(start, end) {
    const s = this.nearest(this.index(start.x, start.z)),
      e = this.nearest(this.index(end.x, end.z));
    if (s === e) return [this.point(e)];
    const open = [s],
      cost = new Map([[s, 0]]),
      prev = new Map(),
      closed = new Set();
    const ep = this.point(e);
    const h = (i) => {
      const p = this.point(i);
      return Math.hypot(p.x - ep.x, p.z - ep.z) / this.cell;
    };
    let count = 0;
    while (open.length && count++ < this.n * this.nz) {
      open.sort((a, b) => cost.get(a) + h(a) - (cost.get(b) + h(b)));
      const cur = open.shift();
      if (cur === e) {
        const route = [];
        let c = e;
        while (c !== s) {
          route.unshift(this.point(c));
          c = prev.get(c);
        }
        return route;
      }
      closed.add(cur);
      const cx = cur % this.n,
        cz = Math.floor(cur / this.n);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const nx = cx + dx,
          nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.n || nz >= this.nz) continue;
        const n = nz * this.n + nx;
        if (this.blocked[n] || closed.has(n)) continue;
        const rise = this.heights[n] - this.heights[cur];
        const slopeConnection = this.slopes[n] && this.slopes[cur];
        if (
          rise > (slopeConnection ? this.cell * 1.1 : 0.4) ||
          rise < -(slopeConnection ? this.cell * 1.1 : 1.2)
        )
          continue;
        if (
          dx &&
          dz &&
          (this.blocked[cz * this.n + nx] || this.blocked[nz * this.n + cx])
        )
          continue;
        const nc = cost.get(cur) + (dx && dz ? 1.414 : 1);
        if (!cost.has(n) || nc < cost.get(n)) {
          cost.set(n, nc);
          prev.set(n, cur);
          if (!open.includes(n)) open.push(n);
        }
      }
    }
    return [];
  }
}
