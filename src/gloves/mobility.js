import { verticalStep } from "../physics.js";
// Only ability activation uses these helpers; baseline WASD/slide/jump is intact.
export function rollDirection(g, body, yaw) {
  const context = body.context || (body === g.player ? g : null),
    keys = context?.keys;
  const side = (keys?.has("KeyD") ? 1 : 0) - (keys?.has("KeyA") ? 1 : 0),
    forward = (keys?.has("KeyW") ? 1 : 0) - (keys?.has("KeyS") ? 1 : 0),
    length = Math.hypot(side, forward);
  if (!length) return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  return {
    x: (Math.cos(yaw) * side - Math.sin(yaw) * forward) / length,
    z: (-Math.sin(yaw) * side - Math.cos(yaw) * forward) / length,
  };
}
export function settleGloveTeleport(body, boxes, context = body.context) {
  body.vx = body.vy = body.vz = 0;
  body.grounded = false;
  body.jumps = 1;
  body.airCarrySpeed = 0;
  body.groundSlope = null;
  // A zero-duration support query cannot advance time or snap a floating body.
  verticalStep(body, 0, boxes);
  if (context) {
    context.slideTime =
      context.slideBuffer =
      context.jumpBuffer =
      context.coyoteTime =
        0;
  }
}
