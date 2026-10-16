import * as THREE from "three";

// Ray queries only affect the held model. Never write player yaw/pitch, shot
// direction, collision, damage or the authoritative muzzle/projectile origin.
export class WeaponClearance {
  constructor() {
    this.ray = new THREE.Raycaster();
    this.ray.near = 0.025;
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.hits = [];
    this.lastTime = -Infinity;
    this.amount = 0;
    this.lastId = null;
    this.lastMeshes = null;
  }
  sample(camera, meshes, time, id, enabled = true) {
    if (!enabled || !Number.isFinite(time)) {
      this.amount = 0;
      this.lastTime = -Infinity;
      return 0;
    }
    // At most forty short collision-only queries/sec, independent of FPS.
    if (
      id === this.lastId &&
      meshes === this.lastMeshes &&
      time >= this.lastTime &&
      time - this.lastTime < 0.05
    )
      return this.amount;
    this.lastId = id;
    this.lastMeshes = meshes;
    this.lastTime = time;
    const compact = [
      "pistol",
      "uzi",
      "revolver",
      "burstpistol",
      "dualpistols",
      "shorty",
    ].includes(id);
    this.ray.far = compact ? 0.78 : 1.1;
    camera.getWorldDirection(this.direction);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    let distance = Infinity;
    for (const side of [0, 0.17]) {
      this.origin.copy(camera.position).addScaledVector(this.right, side);
      if (side) this.origin.y -= 0.12;
      this.ray.set(this.origin, this.direction);
      this.hits.length = 0;
      this.ray.intersectObjects(meshes, false, this.hits);
      if (this.hits.length)
        distance = Math.min(distance, this.hits[0].distance);
    }
    const t = THREE.MathUtils.clamp(
      (this.ray.far - distance) / (this.ray.far - 0.3),
      0,
      1,
    );
    this.amount = t * t * (3 - 2 * t);
    return this.amount;
  }
}
