import { clamp } from "./physics.js";

export const MOVEMENT = Object.freeze({
  runSpeed: 11.5,
  meleeSpeed: 13.5,
  groundAcceleration: 105,
  groundBraking: 110,
  airAcceleration: 75,
  airSpeedCap: 32,
  airTurnRate: 20,
  jumpSpeed: 12.3,
  doubleJumpSpeed: 12.6,
  coyoteTime: 0.1,
  jumpBuffer: 0.14,
  slideDuration: 0.4,
  slideCooldown: 0.55,
  slideBoost: 4,
  slideMinSpeed: 17,
  slideMaxSpeed: 23,
  slideDrag: 1.6,
});

// Ground movement brakes promptly; air movement can turn in every direction.
// A slide/dash keeps its speed, but is never locked into its launch direction.
export function accelerate(body, wish, speed, dt) {
  const input = Math.hypot(wish.x, wish.z);
  if (body.grounded) {
    const dx = wish.x * speed - body.vx,
      dz = wish.z * speed - body.vz;
    const distance = Math.hypot(dx, dz);
    const amount = Math.min(
      distance,
      (input ? MOVEMENT.groundAcceleration : MOVEMENT.groundBraking) * dt,
    );
    if (distance > 1e-8) {
      body.vx += (dx / distance) * amount;
      body.vz += (dz / distance) * amount;
    }
  } else if (input > 0) {
    const length = Math.hypot(body.vx, body.vz);
    const current =
      length > 0.01 ? Math.atan2(body.vz, body.vx) : Math.atan2(wish.z, wish.x);
    const target = Math.atan2(wish.z, wish.x);
    const delta = Math.atan2(
      Math.sin(target - current),
      Math.cos(target - current),
    );
    const heading =
      current +
      clamp(delta, -MOVEMENT.airTurnRate * dt, MOVEMENT.airTurnRate * dt);
    const nextSpeed = Math.min(
      MOVEMENT.airSpeedCap,
      length < speed
        ? Math.min(speed, length + MOVEMENT.airAcceleration * dt)
        : length,
    );
    body.vx = Math.cos(heading) * nextSpeed;
    body.vz = Math.sin(heading) * nextSpeed;
  }
}

export function steerSlide(body, wish, dt) {
  const speed =
    Math.hypot(body.vx, body.vz) * Math.exp(-MOVEMENT.slideDrag * dt);
  let x = body.vx,
    z = body.vz;
  if (Math.hypot(wish.x, wish.z) > 0) {
    const blend = 1 - Math.exp(-5.5 * dt);
    x += (wish.x * speed - x) * blend;
    z += (wish.z * speed - z) * blend;
  }
  const length = Math.hypot(x, z);
  if (length > 1e-8) {
    body.vx = (x / length) * speed;
    body.vz = (z / length) * speed;
  }
}
