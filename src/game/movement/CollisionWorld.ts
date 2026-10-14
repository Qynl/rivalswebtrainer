import type { Vec3 } from './MovementTypes';

export interface AabbSolid {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Used by the debug overlay and map diagnostics. */
  tag?: string;
}

export interface SurfaceDefinition {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  heightAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number) => Vec3;
  tag?: string;
}

export interface SurfaceHit {
  id: string;
  height: number;
  normal: Vec3;
  tag?: string;
}

export interface HorizontalMoveResult {
  position: Vec3;
  collided: boolean;
  normal: Vec3;
  colliderId?: string;
}

export interface VerticalMoveResult {
  y: number;
  velocityY: number;
  hitCeiling: boolean;
  hitFloor: boolean;
  colliderId?: string;
}

export interface RaycastHit {
  colliderId: string;
  distance: number;
  point: Vec3;
  normal: Vec3;
  tag?: string;
}

const EPSILON = 1e-5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function circleOverlapsRect(
  x: number,
  z: number,
  radius: number,
  solid: AabbSolid,
): boolean {
  const closestX = clamp(x, solid.minX, solid.maxX);
  const closestZ = clamp(z, solid.minZ, solid.maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz < radius * radius - EPSILON;
}

function horizontalBoundsOverlap(
  x: number,
  z: number,
  radius: number,
  solid: AabbSolid,
): boolean {
  return (
    x + radius > solid.minX + EPSILON &&
    x - radius < solid.maxX - EPSILON &&
    z + radius > solid.minZ + EPSILON &&
    z - radius < solid.maxZ - EPSILON
  );
}

function verticalOverlap(
  feetY: number,
  height: number,
  solid: AabbSolid,
): boolean {
  // Standing exactly on a top face is not a side collision. This is what lets
  // the same box act as both a platform and a wall around its perimeter.
  return (
    feetY < solid.maxY - EPSILON &&
    feetY + height > solid.minY + EPSILON
  );
}

function normalize(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function rayBoxIntersection(
  origin: Vec3,
  direction: Vec3,
  solid: AabbSolid,
  maxDistance: number,
): { distance: number; normal: Vec3 } | null {
  let near = 0;
  let far = maxDistance;
  let nearNormal: Vec3 = { x: 0, y: 0, z: 0 };
  const axes: Array<{
    origin: number;
    direction: number;
    min: number;
    max: number;
    negativeNormal: Vec3;
    positiveNormal: Vec3;
  }> = [
    {
      origin: origin.x,
      direction: direction.x,
      min: solid.minX,
      max: solid.maxX,
      negativeNormal: { x: -1, y: 0, z: 0 },
      positiveNormal: { x: 1, y: 0, z: 0 },
    },
    {
      origin: origin.y,
      direction: direction.y,
      min: solid.minY,
      max: solid.maxY,
      negativeNormal: { x: 0, y: -1, z: 0 },
      positiveNormal: { x: 0, y: 1, z: 0 },
    },
    {
      origin: origin.z,
      direction: direction.z,
      min: solid.minZ,
      max: solid.maxZ,
      negativeNormal: { x: 0, y: 0, z: -1 },
      positiveNormal: { x: 0, y: 0, z: 1 },
    },
  ];

  for (const axis of axes) {
    if (Math.abs(axis.direction) < EPSILON) {
      if (axis.origin < axis.min || axis.origin > axis.max) return null;
      continue;
    }
    const inverse = 1 / axis.direction;
    let entry = (axis.min - axis.origin) * inverse;
    let exit = (axis.max - axis.origin) * inverse;
    let entryNormal = axis.negativeNormal;
    if (entry > exit) {
      [entry, exit] = [exit, entry];
      entryNormal = axis.positiveNormal;
    }
    if (entry > near) {
      near = entry;
      nearNormal = entryNormal;
    }
    far = Math.min(far, exit);
    if (near > far || far < 0) return null;
  }

  const distance = near >= 0 ? near : far;
  if (distance < 0 || distance > maxDistance) return null;
  return { distance, normal: nearNormal };
}

/**
 * Small deterministic collision world tailored to a fast FPS controller.
 *
 * It deliberately uses analytic AABBs and height surfaces instead of a mesh
 * physics engine. The player only needs a capsule-like footprint against the
 * arena's modular boxes and ramps; keeping this math explicit makes movement
 * tests deterministic and makes ramp tuning inspectable.
 */
export class CollisionWorld {
  readonly solids: AabbSolid[] = [];
  readonly surfaces: SurfaceDefinition[] = [];

  addBox(
    id: string,
    center: Vec3,
    size: Vec3,
    tag?: string,
    support = true,
  ): AabbSolid {
    const solid: AabbSolid = {
      id,
      minX: center.x - size.x / 2,
      maxX: center.x + size.x / 2,
      minY: center.y - size.y / 2,
      maxY: center.y + size.y / 2,
      minZ: center.z - size.z / 2,
      maxZ: center.z + size.z / 2,
      tag,
    };
    this.solids.push(solid);

    if (support) {
      this.addSurface({
        id: `${id}:top`,
        minX: solid.minX,
        maxX: solid.maxX,
        minZ: solid.minZ,
        maxZ: solid.maxZ,
        heightAt: () => solid.maxY,
        normalAt: () => ({ x: 0, y: 1, z: 0 }),
        tag: tag ?? 'platform',
      });
    }

    return solid;
  }

  addFloor(
    id: string,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    height = 0,
    tag = 'floor',
  ): void {
    this.addSurface({
      id,
      ...bounds,
      heightAt: () => height,
      normalAt: () => ({ x: 0, y: 1, z: 0 }),
      tag,
    });
  }

  addSurface(surface: SurfaceDefinition): void {
    this.surfaces.push(surface);
  }

  addRamp(options: {
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    lowHeight: number;
    highHeight: number;
    highToward: 'min' | 'max';
    tag?: string;
  }): void {
    const {
      id,
      minX,
      maxX,
      minZ,
      maxZ,
      lowHeight,
      highHeight,
      highToward,
      tag = 'ramp',
    } = options;
    const alongZ = maxZ - minZ >= maxX - minX;
    const length = alongZ ? maxZ - minZ : maxX - minX;
    const direction = highToward === 'max' ? 1 : -1;
    const slope = (highHeight - lowHeight) / Math.max(length, EPSILON);

    this.addSurface({
      id,
      minX,
      maxX,
      minZ,
      maxZ,
      heightAt: (x, z) => {
        const coordinate = alongZ ? z : x;
        const start = alongZ ? minZ : minX;
        const t = direction === 1
          ? (coordinate - start) / Math.max(length, EPSILON)
          : ((alongZ ? maxZ : maxX) - coordinate) / Math.max(length, EPSILON);
        return lowHeight + clamp(t, 0, 1) * (highHeight - lowHeight);
      },
      normalAt: () => alongZ
        ? normalize(0, 1, -slope * direction)
        : normalize(-slope * direction, 1, 0),
      tag,
    });
  }

  surfaceAt(x: number, z: number): SurfaceHit | null {
    let best: SurfaceHit | null = null;
    for (const surface of this.surfaces) {
      if (
        x < surface.minX - EPSILON ||
        x > surface.maxX + EPSILON ||
        z < surface.minZ - EPSILON ||
        z > surface.maxZ + EPSILON
      ) {
        continue;
      }
      const height = surface.heightAt(x, z);
      if (!best || height > best.height) {
        best = {
          id: surface.id,
          height,
          normal: surface.normalAt(x, z),
          tag: surface.tag,
        };
      }
    }
    return best;
  }

  canOccupy(
    position: Vec3,
    radius: number,
    height: number,
  ): boolean {
    return !this.solids.some(
      (solid) =>
        verticalOverlap(position.y, height, solid) &&
        circleOverlapsRect(position.x, position.z, radius, solid),
    );
  }

  moveHorizontal(
    position: Vec3,
    delta: Vec3,
    radius: number,
    height: number,
  ): HorizontalMoveResult {
    const next: Vec3 = { x: position.x, y: position.y, z: position.z };
    let collided = false;
    let normal: Vec3 = { x: 0, y: 0, z: 0 };
    let colliderId: string | undefined;

    // Axis-separated resolution is stable for the square, modular cover used
    // by Arena and prevents tunnelling at the controller's fixed 120 Hz step.
    if (Math.abs(delta.x) > EPSILON) {
      const previous = next.x;
      next.x += delta.x;
      for (const solid of this.solids) {
        if (!verticalOverlap(next.y, height, solid)) continue;
        if (
          next.z + radius <= solid.minZ + EPSILON ||
          next.z - radius >= solid.maxZ - EPSILON
        ) continue;
        if (!circleOverlapsRect(next.x, next.z, radius, solid)) continue;

        collided = true;
        colliderId = solid.id;
        if (delta.x > 0 && previous <= solid.minX - radius + EPSILON) {
          next.x = solid.minX - radius;
          normal = { x: -1, y: 0, z: 0 };
        } else if (delta.x < 0 && previous >= solid.maxX + radius - EPSILON) {
          next.x = solid.maxX + radius;
          normal = { x: 1, y: 0, z: 0 };
        } else {
          const pushLeft = Math.abs(next.x - (solid.minX - radius));
          const pushRight = Math.abs(next.x - (solid.maxX + radius));
          if (pushLeft < pushRight) {
            next.x = solid.minX - radius;
            normal = { x: -1, y: 0, z: 0 };
          } else {
            next.x = solid.maxX + radius;
            normal = { x: 1, y: 0, z: 0 };
          }
        }
      }
    }

    if (Math.abs(delta.z) > EPSILON) {
      const previous = next.z;
      next.z += delta.z;
      for (const solid of this.solids) {
        if (!verticalOverlap(next.y, height, solid)) continue;
        if (
          next.x + radius <= solid.minX + EPSILON ||
          next.x - radius >= solid.maxX - EPSILON
        ) continue;
        if (!circleOverlapsRect(next.x, next.z, radius, solid)) continue;

        collided = true;
        colliderId = solid.id;
        if (delta.z > 0 && previous <= solid.minZ - radius + EPSILON) {
          next.z = solid.minZ - radius;
          normal = { x: 0, y: 0, z: -1 };
        } else if (delta.z < 0 && previous >= solid.maxZ + radius - EPSILON) {
          next.z = solid.maxZ + radius;
          normal = { x: 0, y: 0, z: 1 };
        } else {
          const pushBack = Math.abs(next.z - (solid.minZ - radius));
          const pushForward = Math.abs(next.z - (solid.maxZ + radius));
          if (pushBack < pushForward) {
            next.z = solid.minZ - radius;
            normal = { x: 0, y: 0, z: -1 };
          } else {
            next.z = solid.maxZ + radius;
            normal = { x: 0, y: 0, z: 1 };
          }
        }
      }
    }

    return { position: next, collided, normal, colliderId };
  }

  /**
   * Raycast against gameplay solids only. Height surfaces are intentionally
   * excluded: a weapon ray should be blocked by cover and walls, not by the
   * infinite mathematical floor beneath the target.
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RaycastHit | null {
    const unit = normalize(direction.x, direction.y, direction.z);
    let closest: RaycastHit | null = null;
    for (const solid of this.solids) {
      const intersection = rayBoxIntersection(origin, unit, solid, maxDistance);
      if (!intersection || (closest && intersection.distance >= closest.distance)) continue;
      closest = {
        colliderId: solid.id,
        distance: intersection.distance,
        point: {
          x: origin.x + unit.x * intersection.distance,
          y: origin.y + unit.y * intersection.distance,
          z: origin.z + unit.z * intersection.distance,
        },
        normal: intersection.normal,
        tag: solid.tag,
      };
    }
    return closest;
  }

  resolveVertical(
    previousY: number,
    nextY: number,
    velocityY: number,
    position: Vec3,
    radius: number,
    height: number,
  ): VerticalMoveResult {
    let y = nextY;
    let nextVelocity = velocityY;
    let hitCeiling = false;
    let hitFloor = false;
    let colliderId: string | undefined;

    for (const solid of this.solids) {
      if (
        position.x + radius <= solid.minX + EPSILON ||
        position.x - radius >= solid.maxX - EPSILON ||
        position.z + radius <= solid.minZ + EPSILON ||
        position.z - radius >= solid.maxZ - EPSILON
      ) continue;

      if (
        velocityY > 0 &&
        previousY + height <= solid.minY + EPSILON &&
        nextY + height >= solid.minY - EPSILON
      ) {
        y = solid.minY - height;
        nextVelocity = 0;
        hitCeiling = true;
        colliderId = solid.id;
      } else if (
        velocityY <= 0 &&
        previousY >= solid.maxY - EPSILON &&
        nextY <= solid.maxY + EPSILON
      ) {
        y = solid.maxY;
        nextVelocity = 0;
        hitFloor = true;
        colliderId = solid.id;
      }
    }

    return { y, velocityY: nextVelocity, hitCeiling, hitFloor, colliderId };
  }
}
