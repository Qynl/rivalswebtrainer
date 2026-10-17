import * as THREE from "three";
const UP = new THREE.Vector3(0, 1, 0);
export const LINK_LIMIT = 8,
  LINK_SEGMENTS = 8;
// A few curved, pulsing tethers, never physics joints or target locks.
export class GloveLinks {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 5),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      LINK_LIMIT * LINK_SEGMENTS,
    );
    this.mesh.name = "glove-tether-pool";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.states = Array.from({ length: LINK_LIMIT }, () => ({
      life: 0,
      max: 1,
      source: null,
      target: null,
    }));
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this.color = new THREE.Color();
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color);
    }
    scene.add(this.mesh);
  }
  emit(source, target, color, life = 0.35) {
    if (!source || !target || !Number.isFinite(life) || life <= 0) return;
    const index = this.cursor++ % LINK_LIMIT;
    life = Math.min(life, 0.65);
    Object.assign(this.states[index], { source, target, life, max: life });
    this.color.set(color);
    for (let i = 0; i < LINK_SEGMENTS; i++)
      this.mesh.setColorAt(index * LINK_SEGMENTS + i, this.color);
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (let i = 0; i < LINK_LIMIT; i++) {
      const s = this.states[i];
      s.life = Math.max(0, s.life - dt);
      // Never turn a brief ability effect into a tracker for an invisible body.
      // Drop malformed/removed endpoint state before it reaches a GPU matrix.
      if (
        s.source &&
        s.target &&
        (s.source.ghostTime > 0 ||
          s.target.ghostTime > 0 ||
          ![
            s.source.x,
            s.source.y,
            s.source.z,
            s.target.x,
            s.target.y,
            s.target.z,
          ].every(Number.isFinite))
      )
        s.life = 0;
      const age = 1 - s.life / s.max;
      for (let j = 0; j < LINK_SEGMENTS; j++) {
        if (s.life > 0 && s.source && s.target) {
          const point = (v, t) =>
            v.set(
              s.source.x + (s.target.x - s.source.x) * t,
              s.source.y +
                0.9 +
                (s.target.y - s.source.y) * t +
                Math.sin(t * Math.PI) * 0.35,
              s.source.z + (s.target.z - s.source.z) * t,
            );
          point(this.a, j / LINK_SEGMENTS);
          point(this.b, (j + 1) / LINK_SEGMENTS);
          this.delta.copy(this.b).sub(this.a);
          const len = this.delta.length();
          this.dummy.position.copy(this.a).add(this.b).multiplyScalar(0.5);
          this.dummy.quaternion.setFromUnitVectors(UP, this.delta.normalize());
          const thickness =
            (0.018 + Math.sin(age * Math.PI) * 0.018) * (1 - age * 0.6);
          this.dummy.scale.set(thickness, len * 0.84, thickness);
        } else this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i * LINK_SEGMENTS + j, this.dummy.matrix);
      }
      if (!s.life) s.source = s.target = null;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    for (const s of this.states) s.life = 0;
    this.update(0);
  }
  dispose() {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
