import * as THREE from "three";
import { createViewModel } from "./world.js";
import { COMBAT_ITEMS as WEAPONS } from "./data.js";

// Invisible muzzle flashes and the glint billboard are not part of a gun's
// physical silhouette. Counting the 1x1 glint quad made Sniper cards shrink.
export function weaponDisplayBounds(root, target = new THREE.Box3()) {
  root.updateWorldMatrix(true, true);
  target.makeEmpty();
  const box = new THREE.Box3();
  root.traverseVisible((object) => {
    if (
      !object.geometry ||
      ["volumetric-muzzle-crown", "sniper-scope-glint"].includes(object.name)
    )
      return;
    object.geometry.computeBoundingBox();
    target.union(
      box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld),
    );
  });
  return target;
}

export class WeaponPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe5efff, 0x8a96a1, 3));
    for (const [color, intensity, x, y, z] of [
      [0xffffff, 4, 3, 4, 4],
      [0x8fcedf, 3, -3, 1, -3],
    ]) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(x, y, z);
      this.scene.add(light);
    }
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  }
  show(id) {
    if (this.model) {
      this.scene.remove(this.model);
      const materials = new Set();
      this.model.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) materials.add(o.material);
      });
      for (const m of materials) m.dispose();
    }
    const model = createViewModel(id, WEAPONS[id], { hands: false });
    // Legacy melee hands are marked too; fists themselves stay in the preview.
    if (id !== "fists") {
      const hands = [];
      model.traverse((o) => {
        if (o.userData.hand) hands.push(o);
      });
      for (const h of hands) h.removeFromParent();
    }
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const bounds = weaponDisplayBounds(model),
      center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.rotation.y = WEAPONS[id]?.glove ? -.32 : 1.25;
    this.model = pivot;
    this.scene.add(pivot);
    pivot.updateMatrixWorld(true);
    const width = this.canvas.clientWidth || 250,
      height = this.canvas.clientHeight || 180;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const displayBounds = weaponDisplayBounds(pivot);
    const extent = displayBounds.getSize(new THREE.Vector3());
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let distance =
      Math.max(
        extent.y / (2 * halfFov),
        extent.x / (2 * halfFov * this.camera.aspect),
      ) *
        1.15 +
      extent.z * 0.5;
    this.camera.position.set(distance * 0.14, distance * 0.12, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    // The slightly elevated three-quarter camera needs a real projected fit.
    // An axis-only estimate cropped the outside of the paired pistols.
    const point = new THREE.Vector3();
    for (let pass = 0; pass < 3; pass++) {
      this.camera.updateMatrixWorld(true);
      let fill = 0;
      for (const x of [displayBounds.min.x, displayBounds.max.x])
        for (const y of [displayBounds.min.y, displayBounds.max.y])
          for (const z of [displayBounds.min.z, displayBounds.max.z]) {
            point.set(x, y, z).project(this.camera);
            fill = Math.max(fill, Math.abs(point.x), Math.abs(point.y));
          }
      if (fill <= 0.94) break;
      distance *= fill / 0.94;
      this.camera.position.set(distance * 0.14, distance * 0.12, distance);
      this.camera.lookAt(0, 0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
