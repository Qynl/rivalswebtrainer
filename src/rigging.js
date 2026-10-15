import * as THREE from "three";

// Analytic two-bone IK. Targets are clamped to reach, never stretched; the pole
// chooses a stable elbow side even when a target crosses the character's chest.
export function solveTwoBone(
  shoulder,
  target,
  pole,
  upper = 0.34,
  lower = 0.4,
) {
  const direction = target.clone().sub(shoulder),
    rawDistance = direction.length();
  if (rawDistance < 1e-6) direction.set(0, -1, 0);
  else direction.multiplyScalar(1 / rawDistance);
  const distance = THREE.MathUtils.clamp(
    rawDistance,
    Math.abs(upper - lower) + 1e-5,
    upper + lower - 1e-5,
  );
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
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
  return {
    elbow: shoulder
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(bend, height),
    end: shoulder.clone().addScaledVector(direction, distance),
  };
}
export function aimArm(arm, elbow, target, side = 1) {
  const result = solveTwoBone(
    arm.position,
    target,
    new THREE.Vector3(side * 0.6, -0.4, 0.35),
  );
  const down = new THREE.Vector3(0, -1, 0);
  arm.quaternion.setFromUnitVectors(
    down,
    result.elbow.clone().sub(arm.position).normalize(),
  );
  const lowerDirection = result.end
    .clone()
    .sub(result.elbow)
    .normalize()
    .applyQuaternion(arm.quaternion.clone().invert());
  elbow.quaternion.setFromUnitVectors(down, lowerDirection);
  return result;
}
