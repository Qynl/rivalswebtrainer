// Analytic presentation curves: contact is precisely the authoritative windup.
// No body position, camera angle, input timing or combat value is written here.
const sat = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  x = sat(x);
  return x * x * (3 - 2 * x);
};
export function slapPose(age, windup = 0.095) {
  if (!Number.isFinite(age) || age < 0 || age > windup + 0.44)
    return { wind: 0, strike: 0, recover: 0, follow: 0, settle: 0 };
  const anticipation = windup * 0.66;
  const wind =
    smooth(age / anticipation) *
    (1 - smooth((age - anticipation) / (windup - anticipation)));
  const attack = smooth((age - anticipation) / (windup - anticipation));
  const recover = smooth((age - windup - 0.055) / 0.35);
  const follow = Math.sin(sat((age - windup) / 0.16) * Math.PI) * (1 - recover);
  const settle =
    Math.sin(sat((age - windup - 0.12) / 0.3) * Math.PI * 2) * (1 - recover);
  return { wind, strike: attack * (1 - recover), recover, follow, settle };
}
export function gloveMotion(key, age, windup, sequence = 0) {
  const p = slapPose(age, windup),
    heavy = key === "bull",
    backhand = sequence % 2 === 0 && key !== "dual";
  const side = backhand ? -0.8 : 1,
    weight = heavy ? 1.16 : 1;
  return {
    ...p,
    side,
    x: (p.wind * 0.22 - p.strike * 0.68 - p.follow * 0.14) * weight,
    y: p.wind * 0.12 + p.strike * 0.17 - p.follow * 0.09 + p.settle * 0.018,
    z: p.wind * 0.19 - p.strike * 0.31 + p.follow * 0.1,
    rx: p.wind * 0.35 - p.strike * 0.23 + p.follow * 0.16,
    ry: side * (p.wind * 0.7 - p.strike * 1.05 - p.follow * 0.24),
    rz:
      side * (p.wind * 0.5 - p.strike * 1.08 - p.follow * 0.35) +
      p.settle * 0.035,
    curl: 0.16 + p.wind * 0.42 - p.strike * 0.19,
    trail:
      p.strike > 0.05 && age <= windup + 0.2
        ? Math.sin(sat((age - windup * 0.66) / (0.2 + windup * 0.34)) * Math.PI)
        : 0,
  };
}
