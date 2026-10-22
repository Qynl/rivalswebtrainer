/** Minimal vector maths used by both the authoritative sim and the client.
 *  Kept allocation-light: every hot-path function takes and returns plain
 *  {x,y,z} objects, and callers reuse their scratch vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3): number => len(sub(b, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
export const approach = (current: number, target: number, maxDelta: number): number => {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
};

/** Direction from yaw/pitch. Yaw 0 looks down -Z (Three.js convention). */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Horizontal forward/right basis for movement. */
export function flatBasis(yaw: number): { fwd: Vec3; right: Vec3 } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fwd: { x: -s, y: 0, z: -c }, right: { x: c, y: 0, z: -s } };
}

/** Rotates `dir` inside a cone of half-angle `angle` using two uniform randoms. */
export function coneDir(dir: Vec3, angle: number, r1: number, r2: number): Vec3 {
  if (angle <= 0) return dir;
  const up = Math.abs(dir.y) > 0.95 ? v3(1, 0, 0) : v3(0, 1, 0);
  const t1 = norm(cross(up, dir));
  const t2 = cross(dir, t1);
  const r = Math.sqrt(r1) * Math.tan(angle);
  const th = r2 * Math.PI * 2;
  return norm(add(dir, add(mul(t1, r * Math.cos(th)), mul(t2, r * Math.sin(th)))));
}

export function raySphere(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  if (t >= 0) return t;
  const t2 = -b + sq;
  return t2 >= 0 ? 0 : null;
}

/** Ray vs vertical capsule (segment a→b, radius r). Returns hit distance. */
export function rayCapsule(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, radius: number): number | null {
  let best: number | null = null;
  const capA = raySphere(origin, dir, a, radius);
  const capB = raySphere(origin, dir, b, radius);
  if (capA !== null) best = capA;
  if (capB !== null && (best === null || capB < best)) best = capB;
  const ab = sub(b, a);
  const abLen2 = dot(ab, ab);
  if (abLen2 > 1e-9) {
    const ao = sub(origin, a);
    const abd = dot(ab, dir);
    // Ray/cylinder in the plane perpendicular to the capsule axis.
    const radialDir = sub(dir, mul(ab, abd / abLen2));
    const radialOrigin = sub(ao, mul(ab, dot(ab, ao) / abLen2));
    const qa = dot(radialDir, radialDir);
    if (qa > 1e-8) {
      const qb = dot(radialOrigin, radialDir);
      const qc = dot(radialOrigin, radialOrigin) - radius * radius;
      const disc = qb * qb - qa * qc;
      if (disc >= 0) {
        const t = (-qb - Math.sqrt(disc)) / qa;
        if (t >= 0) {
          const along = dot(sub(add(origin, mul(dir, t)), a), ab) / abLen2;
          if (along >= 0 && along <= 1 && (best === null || t < best)) best = t;
        }
      }
    }
  }
  return best;
}
