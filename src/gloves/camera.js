import * as THREE from "three";
export const MAX_CAMERA_ZOOM = 12;
export function wheelZoom(current, delta) {
  if (!Number.isFinite(delta) || !delta) return current || 0;
  return Math.max(
    0,
    Math.min(
      MAX_CAMERA_ZOOM,
      (current || 0) +
        Math.sign(delta) *
          Math.min(1.25, Math.max(0.25, Math.abs(delta) * 0.012)),
    ),
  );
}
// Swept camera boom against expanded gameplay solids. The near plane cannot
// tunnel through a wall when scrolling quickly or turning a corner.
export function cameraBoomFraction(origin, destination, boxes, padding = 0.22) {
  let nearest = 1;
  for (const box of boxes || []) {
    let enter = 0,
      exit = 1,
      start = origin,
      end = destination,
      bounds = box;
    if (box.angle) {
      const c = Math.cos(box.angle),
        s = Math.sin(box.angle);
      const local = (p) => ({
        x: (p.x - box.cx) * c - (p.z - box.cz) * s,
        y: p.y,
        z: (p.x - box.cx) * s + (p.z - box.cz) * c,
      });
      start = local(origin);
      end = local(destination);
      bounds = {
        minX: -box.halfX,
        maxX: box.halfX,
        minZ: -box.halfZ,
        maxZ: box.halfZ,
        minY: box.minY,
        maxY: box.maxY,
      };
    }
    for (const [axis, min, max] of [
      ["x", "minX", "maxX"],
      ["y", "minY", "maxY"],
      ["z", "minZ", "maxZ"],
    ]) {
      const lo = bounds[min] - padding,
        hi = bounds[max] + padding,
        d = end[axis] - start[axis];
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        enter = 2;
        break;
      }
      if (Math.abs(d) < 1e-8) {
        if (start[axis] < lo || start[axis] > hi) {
          enter = 2;
          break;
        }
      } else {
        let a = (lo - start[axis]) / d,
          b = (hi - start[axis]) / d;
        if (a > b) [a, b] = [b, a];
        enter = Math.max(enter, a);
        exit = Math.min(exit, b);
      }
    }
    if (enter <= exit && exit >= 0 && enter >= 0 && enter < nearest)
      nearest = Math.max(0, enter - 0.015);
  }
  return nearest;
}
export function updateOrbitCamera(g, eye, dt) {
  const target = Math.max(0, Math.min(MAX_CAMERA_ZOOM, g.cameraZoom || 0));
  g.cameraZoomSmoothed = THREE.MathUtils.lerp(
    g.cameraZoomSmoothed ?? target,
    target,
    1 - Math.exp(-14 * Math.max(0, dt)),
  );
  const distance = g.cameraZoomSmoothed;
  if (distance < 0.01 && target === 0) {
    g.cameraZoomSmoothed = 0;
    g.thirdPerson = false;
    g.camera.position.copy(eye);
    return;
  }
  const forward = new THREE.Vector3(
    -Math.sin(g.yaw) * Math.cos(g.pitch),
    Math.sin(g.pitch),
    -Math.cos(g.yaw) * Math.cos(g.pitch),
  );
  const desired = eye.clone().addScaledVector(forward, -distance);
  desired.x += Math.cos(g.yaw) * Math.min(0.5, distance * 0.15);
  desired.z -= Math.sin(g.yaw) * Math.min(0.5, distance * 0.15);
  const fraction = cameraBoomFraction(eye, desired, g.world.boxes),
    actual = distance * fraction;
  g.thirdPerson = actual > 0.65;
  g.camera.position.copy(eye).lerp(desired, fraction);
}
