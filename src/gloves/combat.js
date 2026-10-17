import { presentBoomerangReturn } from "./boomerang-return.js";
import { recordDiceOutcome } from "./dice-outcome.js";
import { gloveBotWish, recordGloveBotTravel } from "./bot-navigation.js";
import { recordIncomingImpact } from "./impact-history.js";
import { recordRosterSlap } from "./scoreboard.js";
import {
  recordPracticeImpact,
  recordPracticeImpulse,
  resetPracticeTarget,
} from "./practice.js";
import { duelBotIntent } from "./bot-dueling.js";
import { denyGloveAbility } from "./readability.js";
import { GloveFX, presentGloveAbility } from "./fx.js";
import {
  playGloveAbilityAudio,
  playGloveImpactAudio,
  playGloveSwingAudio,
} from "./audio.js";
import { gloveMoveScale, committedWish, lowGravity } from "./states.js";
import { createBrickModel, brickPlacement, alignBrickModel } from "./brick.js";
import * as THREE from "three";
import { GLOVES, GLOVE_ROSTER, DEFAULT_GLOVE, isGlove } from "./catalog.js";
import { MOVEMENT, accelerate } from "../movement.js";
import { moveBody, verticalStep, canOccupy, clamp } from "../physics.js";
import {
  selectGloveOpponent,
  gloveEnemyVisible,
  glovePerceivedTarget,
} from "./bot-awareness.js";
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
    "ghostTime",
    "goldTime",
    "reverseTime",
    "spaceTime",
    "markTime",
  ])
    body[key] = Math.max(0, (body[key] || 0) - dt);
}
export function tickGloves(g, dt) {
  if (!gloveMatch(g)) return;
  tickBody(g.player, dt);
  tickSpecial(g, g.player);
  // Multiplayer contexts each own exactly one body. Offline owns all of them.
  if (!g.headless && !g.network)
    for (const e of g.entities)
      if (e !== g.player) {
        tickBody(e, dt);
        tickSpecial(g, e);
      }
  if (!g.network) tickBricks(g, dt);
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
  lowGravity(body, dt);
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
  body.ghostTime = 0;
  body.gloveCooldown = glove.interval;
  body.slapPending = g.network ? null : { id, remaining: glove.windup };
  body.lastSlapAt = g.clock;
  body.slapSequence = (body.slapSequence || 0) + 1;
  if (body === g.player) {
    g.shotSequence = (g.shotSequence || 0) + 1;
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
    if (!g.headless && body.arenaStats) body.arenaStats.shots++;
  }
  playGloveSwingAudio(g, body);
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
        e.goldTime > 0 ||
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
  for (const target of slapTargets(
    g,
    source,
    glove,
    glove.range,
    glove.key === "dual" ? 0.28 : 0.48,
  ).slice(0, glove.key === "bull" ? 3 : glove.key === "dual" ? 2 : 1)) {
    if (applyImpact(g, source, target, glove, true)) count++;
  }
  return count;
}
export function applyImpact(
  g,
  source,
  target,
  glove,
  earn = false,
  reflected = false,
) {
  if (
    g.network ||
    !target.alive ||
    source.team === target.team ||
    target.stoneTime > 0 ||
    target.goldTime > 0 ||
    target.slapGrace > 0
  )
    return false;
  if (earn && target.reverseTime > 0 && !reflected) {
    if (source.reverseTime > 0) return false;
    const reverseId =
      target.context?.loadout?.[0] || target.activeWeapon || "glove_reverse";
    return applyImpact(
      g,
      target,
      source,
      { ...glove, id: reverseId, key: "reverse" },
      true,
      true,
    );
  }
  const roll =
    glove.key === "dice"
      ? 1 +
        Math.floor(
          Math.min(0.999999, Math.max(0, (g.gloveRandom || Math.random)())) * 6,
        )
      : 0;
  const power =
    (roll ? 7 + roll * 3.1 : glove.power) * (source.goldTime > 0 ? 1.3 : 1);
  const damage =
    (roll ? 12 + roll * 4 : glove.damage) * (source.goldTime > 0 ? 1.25 : 1);
  const anchor =
    glove.key === "anchor" && source.markTime > 0 ? source.gloveMark : null;
  const dx = anchor ? anchor.x - target.x : target.x - source.x,
    dz = anchor ? anchor.z - target.z : target.z - source.z,
    length = Math.hypot(dx, dz) || 1;
  const sign = glove.key === "pull" ? -1 : 1;
  const velocity = [
    (dx / length) * power * sign,
    glove.lift ?? (glove.key === "bull" ? 7.3 : 5.1),
    (dz / length) * power * sign,
  ];
  [target.vx, target.vy, target.vz] = velocity;
  target.grounded = false;
  target.jumps = 1;
  target.height = 1.15;
  target.ragdollTime = glove.ragdoll;
  target.slapGrace = glove.grace ?? glove.ragdoll + 0.12;
  if (glove.key === "boomerang") {
    target.boomerangAt = g.clock + 0.28;
    target.boomerangOwner = source;
  } else {
    target.boomerangAt = null;
    target.boomerangOwner = null;
  }
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
  const healthBefore = target.health;
  g.damage(target, earn ? damage : (glove.effectDamage ?? 0), source);
  recordPracticeImpact(g, source, healthBefore, target, velocity, earn);
  const rewardAllowed = !(g.testDrive && source === g.player);
  if (earn) {
    const stats =
      source.context?.matchStats || (source.isPlayer ? g.matchStats : null);
    const reward = glove.key === "dual" ? 2 : 1;
    recordRosterSlap(g, source, rewardAllowed ? reward : 0);
    if (stats) {
      const earned = stats.slaps ?? stats.hits ?? 0;
      stats.hits++;
      stats.slaps = earned + (rewardAllowed ? reward : 0);
    }
    if (source === g.player && !g.headless && rewardAllowed)
      for (let i = 0; i < reward; i++) g.events.slap?.(g);
  }
  const event = {
    type: "gloveHit",
    damage: Math.max(0, healthBefore - target.health),
    healthAfter: target.health,
    source: source.id,
    victim: target.id,
    glove: glove.id,
    velocity,
    ragdoll: glove.ragdoll,
    chill: glove.key === "snow" ? 5 : 0,
    position: [target.x, target.y + 1.1, target.z],
    round: g.round,
    time: g.clock,
    earned: earn && rewardAllowed,
    direct: earn,
    roll,
    reflected,
  };
  if (g.emitGlove) g.emitGlove(event);
  else presentImpact(g, event, source, target);
  return true;
}
export function presentImpact(g, event, source, target) {
  recordIncomingImpact(g, event, source, target);
  const glove = GLOVES[event.glove];
  if (!glove) return;
  const diceOutcome = recordDiceOutcome(g, event, source);
  const position = v(...event.position),
    color = new THREE.Color(glove.color).getHex();
  g.combatFX?.burst(position, color, glove.key === "bull" ? 16 : 10);
  playGloveImpactAudio(g, event, source, target);
  if (g.scene?.add && !g.headless) {
    g.gloveFX ||= new GloveFX(g.scene);
    g.gloveFX.hit(position, color, glove.key === "bull", glove.key);
    if (["pull", "boomerang", "anchor"].includes(glove.key))
      g.gloveFX.link(
        source,
        target,
        color,
        glove.key === "boomerang" ? 0.5 : 0.3,
      );
  }
  if (source === g.player && (event.direct ?? event.earned)) {
    g.lastDiceRoll = diceOutcome ? event.roll : 0;
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
    !body?.alive ||
    g.state !== "playing" ||
    g.selectingLoadout ||
    g.network
  )
    return false;
  const deny = (reason) => denyGloveAbility(g, body, reason);
  if (glove.activation !== "active")
    return deny("PASSIVE GLOVE · NO ABILITY KEY NEEDED");
  if (blocked(body))
    return deny(
      body.stoneTime > 0 ? "STONE FORM ACTIVE" : "RECOVERING · WAIT TO CAST",
    );
  if (body.abilityCooldown > 0)
    return deny(`READY IN ${Math.ceil(body.abilityCooldown)}s`);
  const origin = [body.x, body.y + 0.6, body.z];
  let target,
    destination,
    affected = 0;
  const yaw = body.context?.yaw ?? (body === g.player ? g.yaw : body.yaw);
  if (glove.key === "brick") {
    if (!body.grounded) return deny("LAND TO PLACE A TRAP");
    const position = brickPlacement(body, yaw, g.world.boxes);
    if (!position) return deny("PLACE ON A CLEAR, SUPPORTED SURFACE");
    const bounds = g.world.bounds;
    if (
      bounds &&
      (position.x < bounds.minX ||
        position.x > bounds.maxX ||
        position.z < bounds.minZ ||
        position.z > bounds.maxZ)
    )
      return deny("NO CLEAR SPACE FOR TRAP");
    g.gloveBricks ||= [];
    const owned = g.gloveBricks.filter((b) => b.owner === body && b.life > 0);
    if (owned.length >= 4) {
      owned[0].life = 0;
      if (owned[0].mesh) owned[0].mesh.visible = false;
    }
    g.gloveBricks = g.gloveBricks.filter((b) => b.life > 0);
    const brick = { ...position, owner: body, life: 9, armedAt: g.clock + 0.4 };
    g.gloveBricks.push(brick);
    if (!g.headless && g.scene) {
      brick.mesh = createBrickModel();
      brick.mesh.position.set(position.x, position.y, position.z);
      alignBrickModel(brick.mesh, g.world.boxes, position);
      g.scene.add(brick.mesh);
      g.effects.push({ mesh: brick.mesh, life: 9, max: 9, brick });
    }
  } else if (glove.key === "ghost") {
    body.ghostTime = 3.2;
  } else if (glove.key === "golden") {
    body.goldTime = 3;
  } else if (glove.key === "reverse") {
    body.reverseTime = 2;
  } else if (glove.key === "space") {
    body.spaceTime = 2.6;
    body.vy = Math.max(7, body.vy);
    body.grounded = false;
    body.jumps = 1;
  } else if (glove.key === "anchor") {
    body.gloveMark = { x: body.x, y: body.y, z: body.z };
    body.markTime = 10;
  } else if (glove.key === "thanos") {
    if (body.markTime > 0 && body.gloveMark) {
      const m = body.gloveMark;
      if (!canOccupy(body, m.x, m.y, m.z, g.world.boxes, body.height))
        return deny("RETURN POINT BLOCKED");
      Object.assign(body, m);
      body.vx = body.vy = body.vz = 0;
      destination = [body.x, body.y, body.z];
      body.gloveMark = null;
      body.markTime = 0;
    } else {
      body.gloveMark = { x: body.x, y: body.y, z: body.z };
      body.markTime = 12;
    }
  } else if (glove.key === "acrobat") {
    body.boostTime = 0.5;
    body.vx = -Math.sin(yaw) * 18;
    body.vz = -Math.cos(yaw) * 18;
    body.vy = Math.max(0, body.vy);
  } else if (glove.key === "magnet") {
    target = nearbyEnemies(g, body, 14).find(
      (e) => !(e.ragdollTime > 0) && !(e.ghostTime > 0),
    );
    if (!target) return deny("NO VISIBLE TARGET · 14 m");
    const dx = target.x - body.x,
      dz = target.z - body.z,
      d = Math.hypot(dx, dz);
    if (d < 0.1) return deny("TARGET TOO CLOSE");
    body.vx = (dx / d) * 22;
    body.vz = (dz / d) * 22;
    body.boostTime = 0.55;
  } else if (glove.key === "stun" || glove.key === "za_hando") {
    for (const enemy of nearbyEnemies(
      g,
      body,
      glove.key === "stun" ? 5.8 : 9,
    )) {
      if (glove.key === "stun" && !enemy.grounded) continue;
      if (
        applyImpact(
          g,
          body,
          enemy,
          {
            ...glove,
            key: glove.key === "za_hando" ? "pull" : "stun",
            power: glove.key === "stun" ? 0 : 13,
            lift: glove.key === "stun" ? 1.4 : 3.5,
            ragdoll: glove.key === "stun" ? 1.1 : 0.5,
            grace: 0,
          },
          false,
        )
      )
        affected++;
    }
  } else if (glove.key === "diamond") {
    body.stoneTime = 2.5;
    body.slapPending = null;
    body.vx = body.vz = body.vy = 0;
  } else if (glove.key === "default") {
    body.boostTime = 1.35;
    body.chillTime = 0;
    body.vx = -Math.sin(yaw) * 14;
    body.vz = -Math.cos(yaw) * 14;
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
    if (Math.hypot(body.x - start.x, body.z - start.z) < 0.25) {
      body.x = start.x;
      body.z = start.z;
      return deny("BLINK PATH BLOCKED");
    }
    destination = [body.x, body.y, body.z];
  } else if (glove.key === "swapper") {
    target = slapTargets(g, body, glove, 20, 0.93).find(
      (e) =>
        canOccupy(body, e.x, e.y, e.z, g.world.boxes, body.height) &&
        canOccupy(e, body.x, body.y, body.z, g.world.boxes, e.height),
    );
    if (!target) return deny("AIM AT A CLEAR TARGET · 20 m");
    const a = { x: body.x, y: body.y, z: body.z };
    Object.assign(body, { x: target.x, y: target.y, z: target.z });
    Object.assign(target, a);
    body.vx = body.vy = body.vz = target.vx = target.vy = target.vz = 0;
    destination = [body.x, body.y, body.z];
  }
  body.abilityCooldown =
    glove.key === "thanos" && body.markTime > 0 ? 0.4 : glove.abilityCooldown;
  const event = {
    type: "gloveAbility",
    player: body.id,
    target: target?.id,
    glove: id,
    position: [body.x, body.y + 0.6, body.z],
    origin,
    yaw,
    affected,
    destination,
    targetDestination: target ? [target.x, target.y, target.z] : null,
    velocity: [body.vx, body.vy, body.vz],
    boost: body.boostTime || 0,
    mark: body.markTime > 0 ? body.gloveMark : null,
    round: g.round,
    time: g.clock,
  };
  if (g.emitGlove) g.emitGlove(event);
  else {
    playGloveAbilityAudio(g, event);
    g.combatFX?.burst(
      v(...event.position),
      new THREE.Color(glove.color).getHex(),
      16,
    );
  }
  presentGloveAbility(g, event);
  g.events.update?.(g);
  return true;
}
export function updateGloveBot(g, e, dt) {
  if (!e.alive) {
    ragdollStep(g, e, dt);
    g.animateBot(e, dt);
    if (g.range && g.clock >= e.respawnAt) {
      if (!e.practiceSpawn) {
        e.x = clamp(e.x, -12, 12);
        e.z = -10;
      }
      resetPracticeTarget(e);
    }
    return;
  }
  const glove = GLOVES[e.activeWeapon] || GLOVES[DEFAULT_GLOVE];
  if (blocked(e)) {
    if (e.gloveDuel) e.gloveDuel.seenAt = g.clock;
    e.slapPending = null;
    ragdollStep(g, e, dt);
    g.animateBot(e, dt);
    return;
  }
  e.height = 1.9;
  advanceSlap(g, e, dt);
  if (e.target) {
    e.vx =
      e.practiceMode === "stationary"
        ? 0
        : Math.sin(g.clock * 1.1 + e.seed) * 2.2;
    e.vz = 0;
    const startX = e.x,
      startZ = e.z,
      requested = Math.abs(e.vx) * dt;
    moveBody(e, e.vx * dt, 0, g.world.boxes);
    verticalStep(e, dt, g.world.boxes);
    recordGloveBotTravel(g, e, startX, startZ, requested, dt, glove);
    g.animateBot(e, dt);
    return;
  }
  const enemies = g.entities.filter(
    (other) => other.alive && other.team !== e.team,
  );
  if (
    g.clock >= (e.gloveRetargetAt || 0) ||
    !enemies.includes(e.targetEntity)
  ) {
    e.gloveRetargetAt = g.clock + 0.25;
    e.targetEntity = selectGloveOpponent(g, e, enemies);
  }
  const target = e.targetEntity;
  if (!target) {
    e.visible = false;
    g.animateBot(e, dt);
    return;
  }
  e.targetEntity = target;
  const los = gloveEnemyVisible(g, e, target);
  e.visible = los;
  const perceived = glovePerceivedTarget(g, e, target, los);
  const distance = Math.hypot(perceived.x - e.x, perceived.z - e.z) || 1;
  const intent = duelBotIntent(e, perceived, glove, {
    now: g.clock,
    dt,
    difficulty: g.config.difficulty,
    visible: los,
    entities: g.entities,
  });
  e.yaw = intent.yaw;
  e.gloveTactic = intent.tactic;
  let wish = gloveBotWish(
    g,
    e,
    target,
    intent,
    los,
    distance,
    glove.range,
    dt,
    perceived,
  );
  const speed = MOVEMENT.runSpeed * intent.speed * gloveMoveScale(e, glove);
  wish = committedWish(e, glove, wish);
  accelerate(e, wish, speed, dt);
  const startX = e.x,
    startZ = e.z,
    requested = Math.hypot(e.vx, e.vz) * dt;
  moveBody(e, e.vx * dt, e.vz * dt, g.world.boxes);
  recordGloveBotTravel(g, e, startX, startZ, requested, dt, glove);
  lowGravity(e, dt);
  verticalStep(e, dt, g.world.boxes);
  if (perceived.y > e.y + 0.65 && e.grounded && distance < 7) {
    e.vy = glove.key === "spring" ? 13.4 : MOVEMENT.jumpSpeed;
    e.grounded = false;
    e.jumps = 1;
  }
  if (intent.attack) beginSlap(g, e, glove.id);
  if (
    glove.activation === "active" &&
    !(e.abilityCooldown > 0) &&
    intent.reacted &&
    intent.facing
  ) {
    if (
      (glove.key === "default" && distance > 4 && distance < 13) ||
      (glove.key === "flash" && distance > 6 && distance < 15) ||
      (glove.key === "diamond" && perceived.slapPending && distance < 4) ||
      (glove.key === "swapper" && distance > 9 && distance < 19) ||
      (glove.key === "brick" && distance < 7 && e.grounded) ||
      (glove.key === "ghost" && distance > 4 && distance < 12) ||
      (["golden", "reverse", "stun"].includes(glove.key) && distance < 5) ||
      (glove.key === "za_hando" && distance > 4 && distance < 9) ||
      (glove.key === "magnet" &&
        distance > glove.range + 0.4 &&
        distance < 14) ||
      (glove.key === "anchor" && !(e.markTime > 0)) ||
      (glove.key === "space" && (perceived.y > e.y + 0.5 || distance < 6)) ||
      (glove.key === "acrobat" && distance > 4 && distance < 10) ||
      (glove.key === "thanos" &&
        (!(e.markTime > 0) || (e.health < 60 && distance < 4)))
    )
      useGloveAbility(g, e, glove.id);
  }
  g.animateBot(e, dt);
}

export function nearbyEnemies(g, body, range) {
  return g.entities
    .filter(
      (e) =>
        e !== body &&
        e.alive &&
        e.team !== body.team &&
        !(e.stoneTime > 0) &&
        !(e.goldTime > 0) &&
        g.eye(body).distanceTo(g.eye(e)) <= range &&
        g.hasLOS(g.eye(body), g.eye(e)),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - body.x, a.z - body.z) -
        Math.hypot(b.x - body.x, b.z - body.z),
    );
}
function tickSpecial(g, e) {
  if (!g.network && e.boomerangAt != null && g.clock >= e.boomerangAt) {
    const owner = e.boomerangOwner;
    e.boomerangAt = null;
    e.boomerangOwner = null;
    if (e.alive && owner && !(e.stoneTime > 0) && !(e.goldTime > 0)) {
      const dx = owner.x - e.x,
        dz = owner.z - e.z,
        d = Math.hypot(dx, dz) || 1;
      e.vx = (dx / d) * 24;
      e.vz = (dz / d) * 24;
      e.vy = Math.max(3, e.vy);
      e.grounded = false;
      const event = {
        type: "impulse",
        player: e.id,
        source: owner.id,
        glove: "glove_boomerang",
        phase: "return",
        position: [e.x, e.y + 0.9, e.z],
        velocity: [e.vx, e.vy, e.vz],
        round: g.round,
        time: g.clock,
      };
      recordPracticeImpulse(g, owner, event.velocity);
      if (g.emitGlove) g.emitGlove(event);
      else presentBoomerangReturn(g, event, owner, e);
    }
  }
  if (!(e.markTime > 0) && e.gloveMark) {
    if (
      !g.network &&
      (e.context?.loadout?.[0] || e.activeWeapon || g.loadout?.[0]) ===
        "glove_thanos"
    )
      e.abilityCooldown = GLOVES.glove_thanos.abilityCooldown;
    e.gloveMark = null;
  }
}
function tickBricks(g, dt) {
  if (!g.gloveBricks) return;
  for (const brick of g.gloveBricks) {
    brick.life -= dt;
    if (brick.life <= 0 || g.clock < brick.armedAt) continue;
    for (const e of g.entities) {
      if (
        !e.alive ||
        !e.grounded ||
        e.team === brick.owner.team ||
        Math.abs(e.y - brick.y) > 0.45 ||
        Math.hypot(e.x - brick.x, e.z - brick.z) > 0.75 ||
        e.ragdollTime > 0
      )
        continue;
      if (
        applyImpact(
          g,
          brick.owner,
          e,
          {
            ...GLOVES.glove_brick,
            power: 2,
            lift: 2.5,
            ragdoll: 0.8,
            grace: 0,
          },
          false,
        )
      ) {
        brick.life = 0;
        if (brick.mesh) brick.mesh.visible = false;
        break;
      }
    }
  }
  g.gloveBricks = g.gloveBricks.filter((b) => b.life > 0);
}
