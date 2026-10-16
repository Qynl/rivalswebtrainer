import { clamp, GRAVITY } from "./physics.js";

export const SIMULATION_STEP = 1 / 120;

export const MOVEMENT = Object.freeze({
  runSpeed: 8,
  meleeSpeed: 9.2,
  groundAcceleration: 80,
  groundBraking: 125,
  counterAcceleration: 130,
  airAcceleration: 22,
  airSpeedCap: 28,
  airTurnRate: 4.5,
  airReverseAcceleration: 48,
  jumpSpeed: 7.8,
  doubleJumpSpeed: 7.6,
  coyoteTime: 0.1,
  jumpBuffer: 0.14,
  landingGrace: 0.05,
  slideBuffer: 0.12,
  slideStartSpeed: 4.5,
  slideBrakeDrag: 7.5,
  rampJumpFactor: 0.1,
  rampJumpMax: 0.8,
  slideDuration: 0.19,
  slideCooldown: 1.0,
  slideBoost: 1.4,
  slideMinSpeed: 6.6,
  slideMaxSpeed: 11.8,
  slideDrag: 3.2,
  slideTurnRate: 2.8,
});

// A little ramp assistance, not a second launch on top of a slide jump.
export function rampJumpBoost(body) {
  const slope = body.groundSlope;
  return slope
    ? clamp(
        (body.vx * slope.x + body.vz * slope.z) * MOVEMENT.rampJumpFactor,
        0,
        MOVEMENT.rampJumpMax,
      )
    : 0;
}

const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// A normalized wish vector is also accepted from keyboard/controller adapters.
// Ground counter-strafing brakes harder than acceleration; landing grace allows
// a deliberate hop chain without a one-tick speed tax. Releasing input still stops.
export function accelerate(body, wish, speed, dt) {
  const input = Math.hypot(wish.x, wish.z),
    scale = input > 1 ? 1 / input : 1,
    wx = wish.x * scale,
    wz = wish.z * scale,
    length = Math.hypot(body.vx, body.vz);
  if (body.grounded) {
    body.airCarrySpeed = 0;
    const targetSpeed =
      input && body.landingGrace > 0 ? Math.max(length, speed) : speed;
    const dx = wx * targetSpeed - body.vx,
      dz = wz * targetSpeed - body.vz,
      distance = Math.hypot(dx, dz),
      opposed = body.vx * wx + body.vz * wz < -0.01,
      rate = !input
        ? MOVEMENT.groundBraking
        : opposed
          ? MOVEMENT.counterAcceleration
          : MOVEMENT.groundAcceleration,
      amount = Math.min(distance, rate * dt);
    if (distance > 1e-8) {
      body.vx += (dx / distance) * amount;
      body.vz += (dz / distance) * amount;
    } else {
      body.vx = wx * targetSpeed;
      body.vz = wz * targetSpeed;
    }
  } else if (input > 0) {
    const cruise = Math.min(
      MOVEMENT.airSpeedCap,
      Math.max(speed, body.airCarrySpeed || length),
    );
    body.airCarrySpeed = Math.max(cruise, length);
    const current =
        length > 0.01 ? Math.atan2(body.vz, body.vx) : Math.atan2(wz, wx),
      target = Math.atan2(wz, wx),
      delta = angleDelta(current, target);
    // Direct reverse input is a brake, not an arbitrary left/right orbit.
    if (Math.abs(delta) > 2.65 && length > 1e-5) {
      const dx = wx * cruise - body.vx,
        dz = wz * cruise - body.vz,
        distance = Math.hypot(dx, dz),
        amount = Math.min(distance, MOVEMENT.airReverseAcceleration * dt);
      body.vx += (dx / distance) * amount;
      body.vz += (dz / distance) * amount;
      return;
    }
    const heading =
      current +
      clamp(delta, -MOVEMENT.airTurnRate * dt, MOVEMENT.airTurnRate * dt);
    // Explosions may exceed the normal cap. Ease that excess; never chop a dash.
    const nextSpeed =
      length > MOVEMENT.airSpeedCap
        ? MOVEMENT.airSpeedCap +
          (length - MOVEMENT.airSpeedCap) * Math.exp(-0.8 * dt)
        : Math.min(
            MOVEMENT.airSpeedCap,
            length < cruise
              ? Math.min(cruise, length + MOVEMENT.airAcceleration * dt)
              : length,
          );
    body.vx = Math.cos(heading) * nextSpeed;
    body.vz = Math.sin(heading) * nextSpeed;
  }
}

export function steerSlide(body, wish, dt) {
  // Project gravity onto a ramp: downhill slides gain speed, uphill slides lose it.
  const slope = body.groundSlope;
  if (slope) {
    const scale = GRAVITY / (1 + slope.x * slope.x + slope.z * slope.z);
    body.vx -= slope.x * scale * dt;
    body.vz -= slope.z * scale * dt;
  }
  const input = Math.hypot(wish.x, wish.z);
  const drag = input > 0 ? MOVEMENT.slideDrag : MOVEMENT.slideBrakeDrag;
  let speed = Math.hypot(body.vx, body.vz) * Math.exp(-drag * dt);
  speed = Math.min(MOVEMENT.airSpeedCap, speed);
  if (speed < 1e-8) return;
  const current = Math.atan2(body.vz, body.vx),
    delta = input ? angleDelta(current, Math.atan2(wish.z, wish.x)) : 0,
    heading =
      current +
      clamp(delta, -MOVEMENT.slideTurnRate * dt, MOVEMENT.slideTurnRate * dt);
  body.vx = Math.cos(heading) * speed;
  body.vz = Math.sin(heading) * speed;
}
