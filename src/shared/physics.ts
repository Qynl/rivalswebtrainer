/**
 * Thin deterministic wrapper around Rapier.
 *
 * The arena is static and the players are kinematic capsules moved by Rapier's
 * character controller (slide + auto-step + snap-to-ground). We never call
 * world.step() in the hot loop: nothing is dynamic, so colliders are inserted
 * once, the query pipeline is warmed once, and every tick is a pure
 * "move this capsule by delta" query. That makes client prediction and server
 * simulation bit-comparable for identical inputs.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { Arena } from './arena.ts';
import { PLAYER } from './constants.ts';
import type { Vec3 } from './mathx.ts';

export interface MoveResult {
  pos: Vec3;
  grounded: boolean;
  /** Contact normals of every obstacle touched this step. */
  normals: Vec3[];
}

export interface RayHit {
  toi: number;
  point: Vec3;
  normal: Vec3;
}

export class Physics {
  readonly world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  /** Parentless colliders: the controller only needs a shape to sweep, and a
   *  parentless collider's transform is authoritative immediately (a kinematic
   *  body's collider transform is only propagated during world.step()). */
  private colliders = new Map<number, RAPIER.Collider>();
  private playerHandles = new Set<number>();
  private ready = false;

  constructor(arena: Arena) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = 1 / 60;
    for (const b of arena.blocks) {
      // Frictionless static geometry: the character controller owns all the
      // momentum maths, so Rapier must not add its own friction on top.
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setFriction(0),
      );
    }
    this.world.step();
    this.ready = true;
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.55, 0.22, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setSlideEnabled(true);
  }

  /** Creates (or reuses) the swept capsule for a player. */
  private colliderFor(id: number): RAPIER.Collider {
    let collider = this.colliders.get(id);
    if (!collider) {
      collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius));
      this.colliders.set(id, collider);
      this.playerHandles.add(collider.handle);
    }
    return collider;
  }

  /** Player capsules are pass-through for movement and bullets: hits against
   *  players are resolved analytically so client and server agree exactly. */
  private isWorldCollider = (c: RAPIER.Collider): boolean => !this.playerHandles.has(c.handle);

  setPosition(id: number, pos: Vec3): void {
    this.colliderFor(id).setTranslation({ x: pos.x, y: pos.y, z: pos.z });
  }

  /** Sweeps a capsule by `delta` and returns the resolved position. */
  move(id: number, pos: Vec3, delta: Vec3): MoveResult {
    const collider = this.colliderFor(id);
    collider.setTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.controller.computeColliderMovement(
      collider,
      { x: delta.x, y: delta.y, z: delta.z },
      undefined,
      undefined,
      this.isWorldCollider,
    );
    const m = this.controller.computedMovement();
    const out = { x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z };
    collider.setTranslation(out);
    const normals: Vec3[] = [];
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      const n = c.normal1;
      normals.push({ x: n.x, y: n.y, z: n.z });
    }
    return { pos: out, grounded: this.controller.computedGrounded(), normals };
  }

  raycast(origin: Vec3, dir: Vec3, maxToi: number, excludeId?: number): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      excludeId !== undefined ? this.colliders.get(excludeId) : undefined,
      undefined,
      this.isWorldCollider,
    );
    if (!hit) return null;
    const n = hit.normal;
    return {
      toi: hit.timeOfImpact,
      point: { x: origin.x + dir.x * hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact, z: origin.z + dir.z * hit.timeOfImpact },
      normal: { x: n.x, y: n.y, z: n.z },
    };
  }

  get initialised(): boolean {
    return this.ready;
  }
}

let initPromise: Promise<void> | null = null;
/** Rapier's compat build inlines wasm as base64, so this is the only setup. */
export function initRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export { RAPIER };
