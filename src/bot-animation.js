// Visual-only, velocity-driven lower-body pose. Never changes actor/physics state.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export class BotLocomotion {
  constructor() {
    this.leftX = this.rightX = this.leftZ = this.rightZ = 0;
    this.leftKnee = this.rightKnee = -0.05;
    this.hipY = 0.73;
    this.bodyY = 1;
    this.bob = this.landing = 0;
    this.previousGrounded = null;
    this.previousVy = 0;
  }
  update(actor, phase, dt, yaw = actor.yaw || 0) {
    dt = clamp(dt, 0, 0.1);
    const grounded = !!actor.grounded,
      crouch = actor.height < 1.4;
    const speed = Math.hypot(actor.vx, actor.vz);
    const forward =
      speed > 0.15
        ? (-actor.vx * Math.sin(yaw) - actor.vz * Math.cos(yaw)) / speed
        : 0;
    const side =
      speed > 0.15
        ? (actor.vx * Math.cos(yaw) - actor.vz * Math.sin(yaw)) / speed
        : 0;
    const wave = Math.sin(phase),
      stride = wave * Math.min(0.65, speed * 0.06);
    if (dt > 0 && this.previousGrounded === false && grounded)
      this.landing = clamp(-this.previousVy / 18, 0, 1) * 0.045;
    const ease = (key, target, rate = 24) => {
      this[key] += (target - this[key]) * (1 - Math.exp(-rate * dt));
    };
    ease("leftX", crouch ? 1.2 : !grounded ? 0.55 : stride * forward);
    ease("rightX", crouch ? 0.35 : !grounded ? 0.3 : -stride * forward);
    ease("leftZ", crouch || !grounded ? 0 : stride * side * 0.45);
    ease("rightZ", crouch || !grounded ? 0 : -stride * side * 0.45);
    const cycle = wave * (forward < -0.3 ? -1 : 1) * Math.min(1, speed / 9);
    ease(
      "leftKnee",
      crouch ? -0.25 : !grounded ? -0.95 : -Math.max(0.05, -cycle * 0.85),
    );
    ease(
      "rightKnee",
      crouch ? -1.3 : !grounded ? -1.15 : -Math.max(0.05, cycle * 0.85),
    );
    ease("hipY", (crouch ? 0.58 : 0.73) - this.landing * 0.25, 22);
    ease("bodyY", (crouch ? 0.3 : 1) - this.landing, 20);
    this.bob = grounded ? Math.abs(wave) * 0.018 * Math.min(1, speed / 6) : 0;
    this.landing *= Math.exp(-18 * dt);
    if (dt > 0) {
      this.previousGrounded = grounded;
      this.previousVy = actor.vy || 0;
    }
    return this;
  }
}
