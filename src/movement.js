import { clamp, GRAVITY } from "./physics.js";

export const SIMULATION_STEP = 1 / 120;

export const MOVEMENT = Object.freeze({
  runSpeed: 10.6,
  meleeSpeed: 12,
  groundAcceleration: 105,
  groundBraking: 135,
  counterAcceleration: 155,
  airAcceleration: 34,
  airSpeedCap: 28,
  airTurnRate: 7.5,
  airReverseAcceleration: 75,
  jumpSpeed: 9.7,
  doubleJumpSpeed: 9.4,
  coyoteTime: 0.1,
  jumpBuffer: 0.14,
  landingGrace: 0.05,
  slideBuffer: 0.12,
  slideBrakeDrag: 10,
  rampJumpFactor: 0.18,
  rampJumpMax: 1.5,
  slideDuration: 1.5,
  slideCooldown: 0,
  slideBoost: 2.4,
  slideMinSpeed: 10.4,
  slideMaxSpeed: 16.5,
  slideDrag: 1.2,
  slideCruiseSpeed: 8.2,
  slideTurnRate: 3.8,
});

// Shared by local prediction, authority and bots. A tap has an immediate entry
// velocity even at rest; velocity wins once moving, so slides keep momentum.
export function startSlide(body, wish, yaw = 0) {
  const speed = Math.hypot(body.vx, body.vz),
    input = Math.hypot(wish.x, wish.z),
    moving = speed > 1,
    dx = moving ? body.vx / speed : input > 0 ? wish.x / input : -Math.sin(yaw),
    dz = moving ? body.vz / speed : input > 0 ? wish.z / input : -Math.cos(yaw),
    entry = clamp(
      speed + MOVEMENT.slideBoost,
      MOVEMENT.slideMinSpeed,
      MOVEMENT.slideMaxSpeed,
    );
  body.vx = dx * entry;
  body.vz = dz * entry;
}

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
  const input = Math.hypot(wish.x, wish.z),
    length = Math.hypot(body.vx, body.vz),
    opposed =
      input > 0 &&
      length > 1e-8 &&
      (body.vx * wish.x + body.vz * wish.z) / (length * input) < -0.25;
  // Letting go means coast, not slam on the brakes. Counter-input is the
  // deliberate brake; do not rotate it into a sideways orbit while stopping.
  const drag = opposed ? MOVEMENT.slideBrakeDrag : MOVEMENT.slideDrag,
    cruise =
      input > 0 && !opposed && length >= MOVEMENT.slideCruiseSpeed
        ? MOVEMENT.slideCruiseSpeed
        : 0;
  // Forward/side steering preserves a modest cruise without adding energy to
  // a slide already slowed below cruise by an uphill ramp or collision.
  let speed = cruise + (length - cruise) * Math.exp(-drag * dt);
  speed = Math.min(MOVEMENT.airSpeedCap, speed);
  if (speed < 1e-8) return;
  const current = Math.atan2(body.vz, body.vx),
    delta =
      input && !opposed ? angleDelta(current, Math.atan2(wish.z, wish.x)) : 0,
    heading =
      current +
      clamp(delta, -MOVEMENT.slideTurnRate * dt, MOVEMENT.slideTurnRate * dt);
  body.vx = Math.cos(heading) * speed;
  body.vz = Math.sin(heading) * speed;
}
