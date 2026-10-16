import * as THREE from "three";

export function createArmWorkspace() {
  return {
    direction: new THREE.Vector3(),
    bend: new THREE.Vector3(),
    elbow: new THREE.Vector3(),
    end: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    down: new THREE.Vector3(0, -1, 0),
    upperDirection: new THREE.Vector3(),
    lowerDirection: new THREE.Vector3(),
    inverse: new THREE.Quaternion(),
  };
}
const workspaces = new WeakMap();

// Analytic two-bone IK. Targets are clamped to reach, never stretched; the pole
// chooses a stable elbow side even when a target crosses the character's chest.
export function solveTwoBone(
  shoulder,
  target,
  pole,
  upper = 0.34,
  lower = 0.4,
  out = createArmWorkspace(),
) {
  const direction = out.direction.copy(target).sub(shoulder),
    rawDistance = direction.length();
  if (rawDistance < 1e-6) direction.set(0, -1, 0);
  else direction.multiplyScalar(1 / rawDistance);
  const distance = THREE.MathUtils.clamp(
    rawDistance,
    Math.abs(upper - lower) + 1e-5,
    upper + lower - 1e-5,
  );
  const bend = out.bend
    .copy(pole)
    .addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.set(
      Math.abs(direction.y) < 0.9 ? 0 : 1,
      Math.abs(direction.y) < 0.9 ? 1 : 0,
      0,
    );
    bend.addScaledVector(direction, -bend.dot(direction));
  }
  bend.normalize();
  const along =
      (upper * upper - lower * lower + distance * distance) / (2 * distance),
    height = Math.sqrt(Math.max(0, upper * upper - along * along));
  out.elbow
    .copy(shoulder)
    .addScaledVector(direction, along)
    .addScaledVector(bend, height);
  out.end.copy(shoulder).addScaledVector(direction, distance);
  return out;
}
// Warmed arm solvers reuse all vectors/quaternions; a weak owner keeps disposed
// characters collectible. The returned workspace is borrowed until the next pose.
export function aimArm(arm, elbow, target, side = 1) {
  let work = workspaces.get(arm);
  if (!work) {
    work = createArmWorkspace();
    workspaces.set(arm, work);
  }
  work.pole.set(side * 0.6, -0.4, 0.35);
  const result = solveTwoBone(arm.position, target, work.pole, 0.34, 0.4, work);
  arm.quaternion.setFromUnitVectors(
    work.down,
    work.upperDirection.copy(result.elbow).sub(arm.position).normalize(),
  );
  work.inverse.copy(arm.quaternion).invert();
  work.lowerDirection
    .copy(result.end)
    .sub(result.elbow)
    .normalize()
    .applyQuaternion(work.inverse);
  elbow.quaternion.setFromUnitVectors(work.down, work.lowerDirection);
  return result;
}
