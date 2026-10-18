import { CHILL_MOVE_SCALE } from "./balance.js";
import { GRAVITY } from "../physics.js";
// Glove-only timer meanings. Legacy firearm snapshot semantics are unchanged.
export function gloveState(body) {
  return {
    reload: body.ghostTime || 0,
    blind: body.goldTime || 0,
    paint: body.reverseTime || 0,
    quickMelee: body.spaceTime || 0,
    deflectCooldown: body.markTime || 0,
    gloveMark: body.markTime > 0 ? body.gloveMark : null,
  };
}
export function receiveGloveState(body, state) {
  Object.assign(body, {
    boostTime: state.throw || 0,
    ghostTime: state.reload || 0,
    goldTime: state.blind || 0,
    reverseTime: state.paint || 0,
    spaceTime: state.quickMelee || 0,
    markTime: state.deflectCooldown || 0,
    gloveMark: state.gloveMark || null,
  });
}
export function gloveMoveScale(body, glove) {
  if (body.gloveAbilityPending && glove.key === "za_hando") return 0;
  const chill =
    body.chillTime > 0
      ? glove.key === "speedrun"
        ? 0.85
        : CHILL_MOVE_SCALE
      : 1;
  const passive = glove.key === "speedrun" ? 1.4 : 1;
  const gold = body.goldTime > 0 ? 1.15 : 1;
  const boost =
    body.boostTime > 0
      ? glove.key === "magnet"
        ? 2.05
        : 1 + 0.65 * Math.min(1, body.boostTime / 0.35)
      : 1;
  return chill * passive * gold * boost;
}
export function committedWish(body, glove, wish) {
  if (
    body.boostTime > 0 &&
    (["magnet", "acrobat"].includes(glove.key) ||
      (glove.key === "default" && body.boostTime > 1))
  ) {
    const length = Math.hypot(body.vx, body.vz);
    if (length > 0.01) return { x: body.vx / length, z: body.vz / length };
  }
  return wish;
}
export function lowGravity(body, dt) {
  if (body.spaceTime > 0 && !body.grounded) body.vy += GRAVITY * 0.72 * dt;
}
