// Original synthesized contact timbres. Applied only after accepted impacts;
// descriptors contain no RNG, game-state mutation, score or reward operations.
const tone = (frequency, duration, type, level, end) =>
  Object.freeze({ frequency, duration, type, level, end });
const profile = (duration, noise, tones) =>
  Object.freeze({
    duration,
    noise: Object.freeze(noise),
    tones: Object.freeze(tones),
  });
export const GLOVE_IMPACT_PROFILES = Object.freeze({
  slapHeavy: profile(0.24, { duration: 0.085, level: 0.4, cutoff: 1050 }, [
    tone(92, 0.24, "triangle", 0.37, 38),
    tone(920, 0.035, "sine", 0.07, 420),
  ]),
  slapStone: profile(0.19, { duration: 0.075, level: 0.4, cutoff: 2900 }, [
    tone(210, 0.19, "triangle", 0.28, 62),
    tone(690, 0.08, "sine", 0.1, 460),
  ]),
  slapFrost: profile(0.17, { duration: 0.075, level: 0.29, cutoff: 6500 }, [
    tone(155, 0.1, "triangle", 0.22, 60),
    tone(2100, 0.17, "sine", 0.12, 1300),
    tone(3200, 0.065, "sine", 0.07, 2600),
  ]),
  slapWarp: profile(0.22, { duration: 0.09, level: 0.36, cutoff: 1500 }, [
    tone(480, 0.22, "sine", 0.25, 55),
    tone(125, 0.12, "triangle", 0.2, 65),
  ]),
  slapPhase: profile(0.16, { duration: 0.065, level: 0.31, cutoff: 3300 }, [
    tone(135, 0.11, "triangle", 0.26, 54),
    tone(640, 0.16, "sine", 0.15, 1450),
  ]),
  slapSpark: profile(0.16, { duration: 0.05, level: 0.34, cutoff: 4100 }, [
    tone(230, 0.16, "triangle", 0.27, 70),
    tone(1600, 0.085, "sine", 0.12, 600),
  ]),
  slapDice: profile(0.14, { duration: 0.045, level: 0.34, cutoff: 3600 }, [
    tone(165, 0.14, "triangle", 0.28, 65),
    tone(780, 0.065, "triangle", 0.1, 380),
  ]),
  slapDiceHigh: profile(0.21, { duration: 0.045, level: 0.33, cutoff: 3600 }, [
    tone(165, 0.14, "triangle", 0.28, 65),
    tone(1320, 0.21, "sine", 0.11, 990),
    tone(2190, 0.095, "sine", 0.065, 1640),
  ]),
});
export function gloveImpactSound(key, roll = 0) {
  if (key === "bull") return "slapHeavy";
  if (["diamond", "brick", "anchor"].includes(key)) return "slapStone";
  if (key === "snow") return "slapFrost";
  if (["pull", "magnet", "za_hando", "space", "boomerang"].includes(key))
    return "slapWarp";
  if (["flash", "swapper", "thanos", "ghost"].includes(key)) return "slapPhase";
  if (["golden", "reverse", "stun"].includes(key)) return "slapSpark";
  if (key === "dice") return roll === 6 ? "slapDiceHigh" : "slapDice";
  return "slapImpact";
}
