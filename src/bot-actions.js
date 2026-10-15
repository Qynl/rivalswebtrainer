import { WEAPONS } from "./data.js";
import { MOVEMENT, accelerate, steerSlide } from "./movement.js";
import { canOccupy, moveBody, verticalStep, clamp } from "./physics.js";

export const BOT_MELEES = Object.freeze(["scythe", "katana", "fists", "knife"]);
const timers = [
  "dashCooldown",
  "dashTime",
  "deflectCooldown",
  "deflectTime",
  "quickMeleeTime",
  "meleeCooldown",
  "swingTime",
  "botEquipTime",
  "slideCooldown",
  "slideTime",
  "mobilityCooldown",
  "actionThinkTime",
  "guardFlash",
];
export function initBotActions(e, meleeId = "scythe") {
  if (WEAPONS[e.meleeId]?.slot !== 2) e.meleeId = meleeId;
  e.activeWeapon ||= "rifle";
  for (const key of timers) e[key] ||= 0;
  e.actionCounts ||= {};
}
function count(e, key) {
  e.actionCounts[key] = (e.actionCounts[key] || 0) + 1;
}
export function tickBotActions(e, dt) {
  initBotActions(e);
  for (const key of timers) e[key] = Math.max(0, e[key] - dt);
  const wasReloading = e.reload > 0;
  e.reload = Math.max(0, (e.reload || 0) - dt);
  if (wasReloading && e.reload === 0 && e.activeWeapon === "rifle")
    e.ammo = WEAPONS.rifle.mag;
  e.slideAge = (e.slideAge || 0) + dt;
  e.jumpAge = e.grounded ? 0 : (e.jumpAge || 0) + dt;
  if (e.meleePending) {
    e.meleePending.remaining -= dt;
    if (e.meleePending.remaining <= 0) {
      const hit = e.meleePending;
      e.meleePending = null;
      return hit;
    }
  }
  return null;
}
export function botCanShoot(e) {
  return (
    e.alive &&
    e.activeWeapon === "rifle" &&
    e.botEquipTime <= 0 &&
    e.quickMeleeTime <= 0 &&
    e.deflectTime <= 0 &&
    e.swingTime <= 0 &&
    e.reload <= 0
  );
}
export function equipBotWeapon(e, id) {
  if (
    id !== e.activeWeapon &&
    !e.quickMeleeTime &&
    !e.deflectTime &&
    !e.swingTime
  ) {
    e.activeWeapon = id;
    e.reload = 0; // Switching weapons cancels, rather than completing, a rifle reload.
    e.botEquipTime = 0.18;
    count(e, "switches");
    return true;
  }
  return false;
}

// Probe the same swept collision/support solver as real movement. This is not
// a teleport or a ray that ignores the actor's width, rotated slabs or ramps.
export function botTravelClear(
  e,
  wish,
  world,
  distance = 3,
  { low = false, allowDrop = false } = {},
) {
  const length = Math.hypot(wish.x, wish.z);
  if (length < 0.01) return false;
  const dx = wish.x / length,
    dz = wish.z / length,
    probe = { ...e, height: low ? 1.15 : e.height, vy: 0 };
  const steps = Math.ceil(distance / 0.3),
    step = distance / steps;
  for (let i = 0; i < steps; i++) {
    const x = probe.x,
      z = probe.z;
    moveBody(probe, dx * step, dz * step, world.boxes);
    if ((probe.x - x) * dx + (probe.z - z) * dz < step * 0.7) return false;
    verticalStep(probe, step / 28, world.boxes);
    if (e.grounded && !probe.grounded && !allowDrop) return false;
    if (
      world.bounds &&
      (probe.x < world.bounds.minX ||
        probe.x > world.bounds.maxX ||
        probe.z < world.bounds.minZ ||
        probe.z > world.bounds.maxZ)
    )
      return false;
  }
  return true;
}
export function botDash(e, wish, world, quick = e.activeWeapon !== e.meleeId) {
  if (
    !e.alive ||
    !WEAPONS[e.meleeId]?.dash ||
    e.dashCooldown > 0 ||
    e.deflectTime > 0 ||
    e.quickMeleeTime > 0 ||
    e.botEquipTime > 0 ||
    e.swingTime > 0
  )
    return false;
  const length = Math.hypot(wish.x, wish.z);
  if (
    length < 0.01 ||
    !botTravelClear(e, wish, world, 6.8, { allowDrop: true })
  )
    return false;
  e.vx = (wish.x / length) * 28;
  e.vz = (wish.z / length) * 28;
  e.vy = Math.max(e.vy, 3);
  e.grounded = false;
  e.jumps = Math.max(1, e.jumps || 0);
  e.airCarrySpeed = 28;
  e.dashTime = 0.24;
  e.dashCooldown = 3;
  e.mobilityCooldown = 0.85;
  e.slideTime = 0;
  e.sliding = 0;
  e.slideJumpQueued = false;
  if (quick) {
    e.quickMeleeTime = 0.36;
    count(e, "quickAbilities");
  }
  count(e, "dashes");
  return true;
}
export function botGuard(e, quick = e.activeWeapon !== e.meleeId) {
  const w = WEAPONS[e.meleeId];
  if (
    !e.alive ||
    !w?.deflect ||
    e.deflectCooldown > 0 ||
    e.quickMeleeTime > 0 ||
    e.botEquipTime > 0 ||
    e.swingTime > 0
  )
    return false;
  e.deflectTime = w.abilityDuration;
  e.deflectCooldown = w.abilityCooldown;
  if (quick) {
    e.quickMeleeTime = w.abilityDuration;
    count(e, "quickAbilities");
  }
  count(e, "guards");
  return true;
}
export function botSlide(e, wish, world, combo = false) {
  const speed = Math.hypot(e.vx, e.vz);
  if (
    !e.alive ||
    !e.grounded ||
    e.slideCooldown > 0 ||
    e.slideTime > 0 ||
    e.dashTime > 0 ||
    speed < 2 ||
    !botTravelClear(e, { x: e.vx, z: e.vz }, world, 4.8, { low: true })
  )
    return false;
  const boost = clamp(
    speed + MOVEMENT.slideBoost,
    MOVEMENT.slideMinSpeed,
    MOVEMENT.slideMaxSpeed,
  );
  e.vx = (e.vx / speed) * boost;
  e.vz = (e.vz / speed) * boost;
  e.slideTime = MOVEMENT.slideDuration;
  e.sliding = e.slideTime;
  e.slideCooldown = MOVEMENT.slideCooldown;
  e.slideAge = 0;
  e.slideJumpQueued = combo;
  e.slideJumpAt = 0.1 + ((e.seed || 0) % 1) * 0.04;
  e.height = 1.15;
  e.mobilityCooldown = 1.35 + ((e.seed || 0) % 1) * 0.7;
  count(e, "slides");
  return true;
}
export function botJump(e, world, extra = false) {
  if (!e.alive) return false;
  if (extra) {
    if (
      e.grounded ||
      e.activeWeapon !== "fists" ||
      e.jumps >= 2 ||
      e.jumpAge < 0.18
    )
      return false;
    e.vy = MOVEMENT.doubleJumpSpeed;
    e.jumps = 2;
    count(e, "doubleJumps");
  } else {
    if (!e.grounded || (e.jumpCooldown || 0) > 0) return false;
    const slope = e.groundSlope,
      boost = slope ? clamp((e.vx * slope.x + e.vz * slope.z) * 0.35, 0, 4) : 0;
    e.vy = MOVEMENT.jumpSpeed + boost;
    e.jumps = 1;
    e.jumpAge = 0;
    e.jumpCooldown = 0.85;
    if (e.slideTime > 0) {
      e.airCarrySpeed = Math.hypot(e.vx, e.vz);
      e.slideJumpCombo = true;
      count(e, "slideJumps");
    } else count(e, "jumps");
  }
  e.slideTime = 0;
  e.sliding = 0;
  e.slideJumpQueued = false;
  e.grounded = false;
  e.height = canOccupy(e, e.x, e.y, e.z, world.boxes, 1.9) ? 1.9 : 1.15;
  return true;
}
export function botSwing(e) {
  if (
    !e.alive ||
    e.activeWeapon !== e.meleeId ||
    e.meleeCooldown > 0 ||
    e.botEquipTime > 0 ||
    e.quickMeleeTime > 0 ||
    e.deflectTime > 0
  )
    return false;
  e.meleeCooldown = WEAPONS[e.meleeId].interval;
  e.swingTime = 0.28;
  e.meleePending = { id: e.meleeId, yaw: e.yaw, remaining: 0.12 };
  count(e, "meleeSwings");
  return true;
}

// Deliberate, difficulty-paced decisions. Visibility/reaction is supplied by
// perception; no bullet-contact parries and no reading hidden player inputs.
export function decideBotAction(e, c) {
  if (e.actionThinkTime > 0) return null;
  e.actionThinkTime = 0.16 + c.reaction * 0.35;
  const { visible, distance, world, wish, skill, underFire } = c;
  if (e.quickMeleeTime > 0 || e.deflectTime > 0 || e.swingTime > 0) return null;
  if (
    !e.grounded &&
    e.activeWeapon === "fists" &&
    e.vy < 5 &&
    (underFire || e.slideJumpCombo || (visible && c.target.y > e.y + 1)) &&
    botJump(e, world, true)
  )
    return "doubleJump";
  if (visible && c.reacted) {
    if (e.meleeId === "katana" && underFire && distance < 26 && botGuard(e))
      return "guard";
    if (
      e.meleeId === "scythe" &&
      !c.positioning &&
      distance > 9 &&
      distance < 28 &&
      (skill > 0 || underFire)
    ) {
      const direction = c.defensive
        ? wish
        : {
            x: (c.target.x - e.x) / distance,
            z: (c.target.z - e.z) / distance,
          };
      if (botDash(e, direction, world)) return "dash";
    }
    if (distance < 3.9 && Math.abs(c.target.y - e.y) < 1.8) {
      if (equipBotWeapon(e, e.meleeId)) return "equip";
      if (distance < WEAPONS[e.meleeId].range * 0.94 && botSwing(e))
        return "swing";
    } else if (distance > 5.2 && equipBotWeapon(e, "rifle")) return "equip";
  } else if (
    !visible &&
    !c.defensive &&
    e.meleeId === "fists" &&
    (e.path?.length || 0) > 3
  ) {
    if (equipBotWeapon(e, "fists")) return "equip";
  }
  // A close-range dodge is useful between swings, not a random jump flag.
  if (
    visible &&
    c.reacted &&
    underFire &&
    skill > 0 &&
    distance < 9 &&
    e.grounded &&
    (e.jumpCooldown || 0) <= 0 &&
    canOccupy(e, e.x, e.y, e.z, world.boxes, 1.9) &&
    botTravelClear(e, wish, world, 1.8, { allowDrop: true }) &&
    botJump(e, world)
  )
    return "jump";
  if (
    !visible &&
    !c.defensive &&
    e.meleeId === "scythe" &&
    !c.positioning &&
    (e.path?.length || 0) > 4 &&
    e.mobilityCooldown <= 0 &&
    botDash(e, wish, world)
  )
    return "dash";
  if (
    e.grounded &&
    !c.positioning &&
    e.mobilityCooldown <= 0 &&
    Math.hypot(e.vx, e.vz) > c.speed * 0.65 &&
    (visible ? distance > 6 : Math.hypot(wish.x, wish.z) > 0.5)
  ) {
    if (
      botSlide(
        e,
        wish,
        world,
        skill > 0 && (distance > 10 || !visible || underFire),
      )
    )
      return "slide";
  }
  return null;
}
export function moveBotVelocity(e, wish, speed, dt, world) {
  if (
    e.slideJumpQueued &&
    e.slideTime > 0 &&
    e.slideAge >= e.slideJumpAt &&
    canOccupy(e, e.x, e.y, e.z, world.boxes, 1.9) &&
    botTravelClear(e, wish, world, 1.8, { allowDrop: true })
  )
    botJump(e, world);
  if (e.dashTime > 0) {
    /* Preserve the dash impulse; collision removes blocked speed. */
  } else if (e.slideTime > 0) steerSlide(e, wish, dt);
  else accelerate(e, wish, speed, dt);
  e.sliding = e.slideTime;
  e.height =
    e.slideTime > 0 || !canOccupy(e, e.x, e.y, e.z, world.boxes, 1.9)
      ? 1.15
      : 1.9;
}
