// Presentation only; actor positions, hitboxes and view direction are untouched.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function operatorPose(actor, clock = 0, turn = 0) {
  const speed = Math.hypot(actor.vx || 0, actor.vz || 0);
  const phase = actor.animationPhase ?? clock * 10 + (actor.seed || 0);
  const stride = Math.min(1, speed / 10);
  const t = (clock + ((actor.seed || 0) % 19) * 0.17) % 4.1;
  const reaction = Math.sin(
    clamp((actor.hitReact || 0) / 0.22, 0, 1) * Math.PI,
  );
  return {
    breath:
      Math.sin(clock * 2.4 + (actor.seed || 0)) * 0.006 * (1 - stride * 0.7),
    torsoYaw: clamp(turn * 0.3 + Math.sin(phase) * stride * 0.045, -0.16, 0.16),
    headRoll: clamp(-turn * 0.08, -0.06, 0.06),
    blink: t < 0.13 ? Math.sin((t / 0.13) * Math.PI) : 0,
    leftFoot: actor.grounded
      ? clamp(Math.sin(phase) * stride * 0.2, -0.2, 0.2)
      : -0.18,
    rightFoot: actor.grounded
      ? clamp(-Math.sin(phase) * stride * 0.2, -0.2, 0.2)
      : -0.22,
    impact: reaction * 0.65,
  };
}
