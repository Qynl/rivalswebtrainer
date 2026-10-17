// Presentation-only poses. No timing, velocity, camera or damage is modified.
// Vectors: local translation, wrist Euler, finger curl delta, torso lean.
export const ABILITY_GESTURES = Object.freeze(
  Object.fromEntries(
    Object.entries({
      default: [0.02, -0.12, -0.22, 0.4, -0.2, -0.12, 0.65, -0.09],
      diamond: [-0.15, 0.08, 0.12, -0.35, 0.4, 0.3, 0.8, 0.13],
      brick: [-0.08, 0.07, -0.25, 0.5, 0.12, -0.28, 0.25, -0.08],
      acrobat: [0.04, -0.18, 0.1, 0.5, -0.25, -0.55, 0.75, -0.25],
      flash: [0.12, 0.13, -0.18, -0.4, 0.6, 0.48, -0.14, -0.04],
      swapper: [-0.18, 0.1, -0.2, -0.2, -0.65, -0.35, 0.48, -0.04],
      ghost: [0.14, 0.1, 0.06, -0.35, 0.4, 0.2, -0.12, 0.02],
      thanos: [-0.02, 0.2, 0.02, -0.7, 0.35, 0.55, 0.6, 0.03],
      stun: [-0.08, -0.25, -0.25, 0.85, 0.05, -0.2, 0.5, -0.16],
      za_hando: [-0.32, 0.12, -0.18, -0.25, -0.8, -0.6, -0.12, -0.1],
      magnet: [0.08, 0.06, -0.32, -0.2, 0.25, 0.15, -0.1, -0.08],
      anchor: [0.1, -0.18, -0.14, 0.7, -0.2, 0.1, 0.65, -0.1],
      space: [-0.08, 0.27, -0.08, -0.8, -0.12, 0.4, -0.14, 0.06],
      golden: [0.04, 0.22, -0.12, -0.55, 0.4, 0.25, -0.15, 0.06],
      reverse: [-0.06, 0.14, -0.25, -0.25, 1.15, 0.6, -0.15, -0.04],
    }).map(([k, v]) => [k, Object.freeze(v)]),
  ),
);
export function abilityPose(key, age = 10) {
  const v = ABILITY_GESTURES[key];
  const t = Number.isFinite(age) && age >= 0 && age < 0.7 ? age / 0.7 : 0;
  // Fast readable launch, held briefly, then a soft return. Exactly zero at rest.
  const attack = Math.min(1, t / 0.22),
    release = Math.max(0, Math.min(1, (t - 0.3) / 0.7));
  const weight =
    t && v
      ? attack *
        attack *
        (3 - 2 * attack) *
        (1 - release * release * (3 - 2 * release))
      : 0;
  return {
    x: (v?.[0] || 0) * weight,
    y: (v?.[1] || 0) * weight,
    z: (v?.[2] || 0) * weight,
    rx: (v?.[3] || 0) * weight,
    ry: (v?.[4] || 0) * weight,
    rz: (v?.[5] || 0) * weight,
    curl: (v?.[6] || 0) * weight,
    lean: (v?.[7] || 0) * weight,
    weight,
  };
}
