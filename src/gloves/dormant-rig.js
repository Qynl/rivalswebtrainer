import { Object3D } from "three";
function updateVisibleRig(force) {
  // WebGLRenderer skips hidden draw branches, but Object3D normally still walks
  // all their matrices. These presentation-only branches own no authority or
  // target sockets. Keep them attached for normal traversal/disposal ownership.
  if (this.visible && this.parent?.visible !== false)
    Object3D.prototype.updateMatrixWorld.call(this, force);
}
export function gateDormantRig(root) {
  root.updateMatrixWorld = updateVisibleRig;
  return root;
}
