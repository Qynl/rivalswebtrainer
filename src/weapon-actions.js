const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};

// The drive peaks at the real 105ms hit check, not after the damage lands.
// Reverse grip rotates about the hand, not the camera or the model origin.
export function knifeStabPose(remaining, duration = 0.36) {
  if (!(remaining > 0)) return { lift: 0, drive: 0, grip: 0, settle: 0 };
  const age = Math.max(0, duration - remaining);
  const recover = 1 - smooth((age - 0.15) / (duration - 0.15));
  return {
    lift: smooth(age / 0.045) * recover,
    drive: smooth((age - 0.045) / 0.06) * recover,
    grip: smooth(age / 0.045) * recover,
    settle: Math.sin(clamp((age - 0.105) / 0.045) * Math.PI) * recover,
  };
}

// Lift, pull, push, lock. A deliberate bolt-action cycle rather than the
// 85ms reciprocating slide used by automatic guns. Never changes shot timing.
export function sniperBoltPose(age = Infinity) {
  if (!Number.isFinite(age) || age < 0.09 || age >= 0.78)
    return { lift: 0, pull: 0 };
  return {
    lift: smooth((age - 0.09) / 0.1) * (1 - smooth((age - 0.64) / 0.14)),
    pull: smooth((age - 0.19) / 0.18) * (1 - smooth((age - 0.45) / 0.19)),
  };
}
