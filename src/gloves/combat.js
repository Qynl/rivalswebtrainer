import * as THREE from "three";
import { GLOVES, DEFAULT_GLOVE, isGlove } from "./catalog.js";
import { MOVEMENT, accelerate } from "../movement.js";
import { moveBody, verticalStep, canOccupy, clamp } from "../physics.js";
import { followRoute } from "../bot-tactics.js";
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const gloveMatch = (g) => isGlove(g.loadout?.[0]);
export function blocked(body) {
  return !body?.alive || body.ragdollTime > 0 || body.stoneTime > 0;
}
export function tickBody(body, dt) {
  for (const key of [
    "ragdollTime",
    "slapGrace",
    "stoneTime",
    "chillTime",
    "gloveCooldown",
    "abilityCooldown",
    "boostTime",
  ])
    body[key] = Math.max(0, (body[key] || 0) - dt);
}
export function tickGloves(g, dt) {
  if (!gloveMatch(g)) return;
  tickBody(g.player, dt);
  // Multiplayer contexts each own exactly one body. Offline owns all of them.
  if (!g.headless && !g.network)
    for (const e of g.entities) if (e !== g.player) tickBody(e, dt);
  g.slapImpact = Math.max(0, (g.slapImpact || 0) - dt);
}
export function ragdollStep(g, body, dt) {
  if (body.stoneTime > 0) {
    body.vx = body.vz = 0;
    body.vy = Math.min(0, body.vy);
    verticalStep(body, dt, g.world.boxes);
    return;
  }
  body.height = 1.15;
  const oldX = body.x,
    oldZ = body.z,
    dx = body.vx * dt,
    dz = body.vz * dt;
  moveBody(body, dx, dz, g.world.boxes);
  if (Math.abs(body.x - oldX) < Math.abs(dx) * 0.35) body.vx *= -0.28;
  if (Math.abs(body.z - oldZ) < Math.abs(dz) * 0.35) body.vz *= -0.28;
  verticalStep(body, dt, g.world.boxes);
  const drag = Math.exp(-(body.grounded ? 5 : 0.3) * dt);
  body.vx *= drag;
  body.vz *= drag;
  const b = g.world.bounds;
  if (b) {
    body.x = clamp(body.x, b.minX, b.maxX);
    body.z = clamp(body.z, b.minZ, b.maxZ);
  }
}
export function beginSlap(g, body = g.player, id = g.loadout?.[0]) {
  const glove = GLOVES[id];
  if (
    !glove ||
    blocked(body) ||
    g.state !== "playing" ||
    body.gloveCooldown > 0 ||
    body.slapPending
  )
    return false;
  body.gloveCooldown = glove.interval;
  body.slapPending = g.network ? null : { id, remaining: glove.windup };
  body.lastSlapAt = g.clock;
  if (body === g.player) {
    g.lastSlapAt = g.clock;
    g.lastShotAt = g.clock;
    g.swingTime = glove.windup + 0.44;
    g.fireBufferedUntil = 0;
    g.trigger = false;
  } else body.swingTime = glove.windup + 0.44;
  if (!g.network) {
    const stats =
      body.context?.matchStats || (body.isPlayer ? g.matchStats : null);
    if (stats) stats.shots++;
  }
  g.audio?.play("slapSwing", body === g.player ? 0.85 : 0.4);
  return true;
}
export function advanceSlap(g, body, dt) {
  const pending = body.slapPending;
  if (!pending) return;
  if (blocked(body)) {
    body.slapPending = null;
    return;
  }
  pending.remaining -= dt;
  if (pending.remaining > 1e-8) return;
  body.slapPending = null;
  if (g.network) return;
  const resolve = () => resolveSlap(g, body, pending.id);
  if (g.rewindMelee) g.rewindMelee(resolve);
  else resolve();
}
export function slapTargets(
  g,
  source,
  glove,
  range = glove.range,
  cone = 0.48,
) {
  const yaw = source.isPlayer ? (source.context?.yaw ?? g.yaw) : source.yaw;
  const pitch = source.isPlayer ? (source.context?.pitch ?? g.pitch ?? 0) : 0;
  const forward = v(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  const origin = g.eye(source);
  return g.entities
    .filter((e) => {
      if (
        e === source ||
        !e.alive ||
        e.team === source.team ||
        e.stoneTime > 0 ||
        e.slapGrace > 0
      )
        return false;
      const delta = g.eye(e).sub(origin),
        distance = delta.length();
      return (
        distance < range + e.radius &&
        distance > 0.001 &&
        delta.normalize().dot(forward) > cone &&
        g.hasLOS(origin, g.eye(e))
      );
    })
    .sort(
      (a, b) =>
        Math.hypot(a.x - source.x, a.z - source.z) -
        Math.hypot(b.x - source.x, b.z - source.z),
    );
}
export function resolveSlap(g, source, id) {
  const glove = GLOVES[id];
  if (!glove || blocked(source) || g.state !== "playing") return 0;
  let count = 0;
  for (const target of slapTargets(g, source, glove).slice(
    0,
    glove.key === "bull" ? 3 : 1,
  )) {
    if (applyImpact(g, source, target, glove, true)) count++;
  }
  return count;
}
export function applyImpact(g, source, target, glove, earn = false) {
  if (
    g.network ||
    !target.alive ||
    source.team === target.team ||
    target.stoneTime > 0 ||
    target.slapGrace > 0
  )
    return false;
  const dx = target.x - source.x,
    dz = target.z - source.z,
    length = Math.hypot(dx, dz) || 1;
  const sign = glove.key === "pull" ? -1 : 1;
  const velocity = [
    (dx / length) * glove.power * sign,
    glove.key === "bull" ? 7.3 : 5.1,
    (dz / length) * glove.power * sign,
  ];
  [target.vx, target.vy, target.vz] = velocity;
  target.grounded = false;
  target.jumps = 1;
  target.height = 1.15;
  target.ragdollTime = glove.ragdoll;
  target.slapGrace = glove.ragdoll + 0.12;
  target.ragdollGeneration = (target.ragdollGeneration || 0) + 1;
  target.slapPending = null;
  if (glove.key === "snow") target.chillTime = 5;
  const context = target.context || (target.isPlayer ? g : null);
  if (context) {
    context.slideTime =
      context.jumpBuffer =
      context.slideBuffer =
      context.dashTime =
        0;
    context.playerMeleePending = null;
    context.aiming = false;
  }
  // The health/round engine remains the sole authority for elimination.
  g.damage(target, earn ? glove.damage : 8, source);
  if (earn) {
    const stats =
      source.context?.matchStats || (source.isPlayer ? g.matchStats : null);
    if (stats) stats.hits++;
    if (source === g.player && !g.headless) g.events.slap?.(g);
  }
  const event = {
    type: "gloveHit",
    source: source.id,
    victim: target.id,
    glove: glove.id,
    velocity,
    ragdoll: glove.ragdoll,
    chill: glove.key === "snow" ? 5 : 0,
    position: [target.x, target.y + 0.8, target.z],
    round: g.round,
    time: g.clock,
    earned: earn,
  };
  if (g.emitGlove) g.emitGlove(event);
  else presentImpact(g, event, source, target);
  return true;
}
export function presentImpact(g, event, source, target) {
  const glove = GLOVES[event.glove];
  if (!glove) return;
  const position = v(...event.position),
    color = new THREE.Color(glove.color).getHex();
  g.combatFX?.burst(position, color, glove.key === "bull" ? 16 : 10);
  g.audio?.play("slapImpact", source === g.player ? 1 : 0.6);
  if (g.scene && g.effects && g.effects.length < 40) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.23, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.position.copy(position);
    if (g.camera) ring.lookAt(g.camera.position);
    g.scene.add(ring);
    g.effects.push({ mesh: ring, life: 0.2, max: 0.2, expand: true });
  }
  if (source === g.player) {
    g.slapImpact = 0.15;
    g.events.hit?.(false);
  }
  if (target) {
    target.ragdollTime = Math.max(target.ragdollTime || 0, event.ragdoll);
    target.chillTime = Math.max(target.chillTime || 0, event.chill);
    target.ragdollGeneration = (target.ragdollGeneration || 0) + 1;
  }
}
export function useGloveAbility(g, body = g.player, id = g.loadout?.[0]) {
  const glove = GLOVES[id];
  if (
    !glove ||
    glove.activation !== "active" ||
    blocked(body) ||
    body.abilityCooldown > 0 ||
    g.state !== "playing" ||
    g.selectingLoadout
  )
    return false;
  // Clients request abilities, but never move other players or invent effects locally.
  if (g.network) return false;
  let target, destination;
  const yaw = body.context?.yaw ?? (body === g.player ? g.yaw : body.yaw);
  if (glove.key === "diamond") {
    body.stoneTime = 2.5;
    body.slapPending = null;
    body.vx = body.vz = body.vy = 0;
  } else if (glove.key === "default") {
    body.boostTime = 1.35;
    body.chillTime = 0;
    body.vx += -Math.sin(yaw) * 7;
    body.vz += -Math.cos(yaw) * 7;
  } else if (glove.key === "flash") {
    const start = { x: body.x, y: body.y, z: body.z },
      dx = -Math.sin(yaw),
      dz = -Math.cos(yaw);
    // Swept occupancy, not a destination-only teleport through walls.
    for (let d = 0.15; d <= 7; d += 0.15) {
      const x = start.x + dx * d,
        z = start.z + dz * d;
      if (!canOccupy(body, x, body.y, z, g.world.boxes, body.height)) break;
      const b = g.world.bounds;
      if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) break;
      body.x = x;
      body.z = z;
    }
    if (Math.hypot(body.x - start.x, body.z - start.z) < 0.25) return false;
    destination = [body.x, body.y, body.z];
  } else if (glove.key === "swapper") {
    target = slapTargets(g, body, glove, 20, 0.93).find(
      (e) =>
        canOccupy(body, e.x, e.y, e.z, g.world.boxes, body.height) &&
        canOccupy(e, body.x, body.y, body.z, g.world.boxes, e.height),
    );
    if (!target) return false;
    const a = { x: body.x, y: body.y, z: body.z };
    Object.assign(body, { x: target.x, y: target.y, z: target.z });
    Object.assign(target, a);
    body.vx = body.vy = body.vz = target.vx = target.vy = target.vz = 0;
    destination = [body.x, body.y, body.z];
  }
  body.abilityCooldown = glove.abilityCooldown;
  const event = {
    type: "gloveAbility",
    player: body.id,
    target: target?.id,
    glove: id,
    position: [body.x, body.y + 0.6, body.z],
    destination,
    targetDestination: target ? [target.x, target.y, target.z] : null,
    velocity: glove.key === "default" ? [body.vx, body.vy, body.vz] : null,
    round: g.round,
    time: g.clock,
  };
  if (g.emitGlove) g.emitGlove(event);
  else {
    g.audio?.play(glove.key === "default" ? "slapBlast" : "slapAbility");
    g.combatFX?.burst(
      v(...event.position),
      new THREE.Color(glove.color).getHex(),
      16,
    );
  }
  g.events.update?.(g);
  return true;
}
export function updateGloveBot(g, e, dt) {
  if (!e.alive) {
    ragdollStep(g, e, dt);
    g.animateBot(e, dt);
    if (g.range && g.clock >= e.respawnAt) {
      e.alive = true;
      e.health = e.maxHealth;
      e.ragdollTime = e.slapGrace = 0;
      e.y = 0;
      e.vy = 0;
      e.grounded = true;
      e.x = clamp(e.x, -12, 12);
      e.z = -10;
    }
    return;
  }
  const glove = GLOVES[e.activeWeapon] || GLOVES[DEFAULT_GLOVE];
  if (blocked(e)) {
    e.slapPending = null;
    ragdollStep(g, e, dt);
    g.animateBot(e, dt);
    return;
  }
  e.height = 1.9;
  advanceSlap(g, e, dt);
  if (e.target) {
    e.vx = Math.sin(g.clock * 1.1 + e.seed) * 2.2;
    e.vz = 0;
    moveBody(e, e.vx * dt, 0, g.world.boxes);
    verticalStep(e, dt, g.world.boxes);
    g.animateBot(e, dt);
    return;
  }
  const enemies = g.entities.filter(
    (other) => other.alive && other.team !== e.team,
  );
  const target = enemies.sort(
    (a, b) =>
      Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z),
  )[0];
  if (!target) {
    g.animateBot(e, dt);
    return;
  }
  e.targetEntity = target;
  const dx = target.x - e.x,
    dz = target.z - e.z,
    distance = Math.hypot(dx, dz) || 1;
  e.yaw = Math.atan2(-dx, -dz);
  const los = g.hasLOS(g.eye(e), g.eye(target));
  let wish = { x: dx / distance, z: dz / distance };
  if (!los) {
    e.pathTimer = (e.pathTimer || 0) - dt;
    if (e.pathTimer <= 0) {
      e.pathTimer = 0.6;
      e.path = g.world.nav.path(e, target);
    }
    wish = followRoute(e, e.path || []);
  }
  const difficulty =
    g.config.difficulty === "elite"
      ? 1.05
      : g.config.difficulty === "easy"
        ? 0.72
        : 0.9;
  let speed =
    MOVEMENT.runSpeed *
    difficulty *
    (e.chillTime > 0 ? 0.55 : 1) *
    (e.boostTime > 0 ? 1.65 : 1);
  const preferred = glove.range * 0.72;
  if (distance < preferred * 0.65) {
    wish = { x: -dx / distance, z: -dz / distance };
    speed *= 0.7;
  } else if (distance < preferred && los) {
    wish = { x: (-dz / distance) * e.strafe, z: (dx / distance) * e.strafe };
    speed *= 0.55;
  }
  accelerate(e, wish, speed, dt);
  moveBody(e, e.vx * dt, e.vz * dt, g.world.boxes);
  verticalStep(e, dt, g.world.boxes);
  if (target.y > e.y + 0.65 && e.grounded && distance < 7) {
    e.vy = glove.key === "spring" ? 13.4 : MOVEMENT.jumpSpeed;
    e.grounded = false;
    e.jumps = 1;
  }
  if (los && distance < glove.range + 0.1 && Math.abs(target.y - e.y) < 2.2)
    beginSlap(g, e, glove.id);
  if (glove.activation === "active" && !(e.abilityCooldown > 0)) {
    if (
      (glove.key === "default" && distance > 4 && distance < 13) ||
      (glove.key === "flash" && distance > 6 && distance < 15) ||
      (glove.key === "diamond" && target.slapPending && distance < 4) ||
      (glove.key === "swapper" && distance > 9 && distance < 19)
    )
      useGloveAbility(g, e, glove.id);
  }
  g.animateBot(e, dt);
}
