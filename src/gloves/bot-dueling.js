// Offline decision-making only. No damage/range bonuses, instant turns or camera
// changes: bots still use the exact same glove windups and collision rules.
export const DUEL_BOT_SKILLS = Object.freeze({
  easy: Object.freeze({ reaction: 0.3, turn: 4.6, speed: 0.72, footwork: 0.3 }),
  regular: Object.freeze({
    reaction: 0.17,
    turn: 7.8,
    speed: 0.9,
    footwork: 0.65,
  }),
  veteran: Object.freeze({ reaction: 0.1, turn: 10, speed: 1, footwork: 0.85 }),
  elite: Object.freeze({ reaction: 0.065, turn: 12, speed: 1.05, footwork: 1 }),
});
export function duelBotSkill(difficulty) {
  return DUEL_BOT_SKILLS[difficulty] || DUEL_BOT_SKILLS.regular;
}
export function turnBotYaw(yaw, target, limit) {
  const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  return yaw + Math.max(-limit, Math.min(limit, delta));
}
export function duelBotIntent(
  bot,
  target,
  glove,
  { now, dt, difficulty, visible, entities = [] },
) {
  const skill = duelBotSkill(difficulty);
  let brain = bot.gloveDuel;
  if (!brain || brain.target !== target) {
    brain = bot.gloveDuel = { target, seenAt: now, guardAt: null };
  }
  if (!visible) brain.seenAt = now;
  const reacted = visible && now - brain.seenAt >= skill.reaction;
  const dx = target.x - bot.x,
    dz = target.z - bot.z;
  const distance = Math.max(0.001, Math.hypot(dx, dz));
  const toward = { x: dx / distance, z: dz / distance };
  const guarded =
    visible &&
    (target.goldTime > 0 || target.stoneTime > 0 || target.reverseTime > 0);
  if (guarded && brain.guardAt === null) brain.guardAt = now;
  if (!guarded) brain.guardAt = null;
  const respectGuard = guarded && now - brain.guardAt >= skill.reaction;
  // Small bounded lead at melee distance, not perfect aim at hidden positions.
  const leadTime = reacted ? Math.min(0.11, distance / 100) : 0;
  const leadX = Math.max(-0.65, Math.min(0.65, (target.vx || 0) * leadTime));
  const leadZ = Math.max(-0.65, Math.min(0.65, (target.vz || 0) * leadTime));
  const desiredYaw = Math.atan2(-(dx + leadX), -(dz + leadZ));
  const yaw = turnBotYaw(
    bot.yaw || 0,
    desiredYaw,
    skill.turn * Math.max(0, dt),
  );
  const facing = Math.cos(desiredYaw - yaw) > 0.8;
  const ownRecovery = bot.gloveCooldown > glove.interval * 0.35;
  const threatened = reacted && !!target.slapPending && ownRecovery;
  const reach = glove.range * 0.78;
  let wish = { ...toward },
    speed = 1,
    tactic = "approach";
  if (
    reacted &&
    (respectGuard || threatened) &&
    distance < Math.max(4.2, reach + 0.7)
  ) {
    wish = { x: -toward.x, z: -toward.z };
    speed = 0.75;
    tactic = "disengage";
  } else if (visible && distance < reach * 0.66) {
    wish = { x: -toward.x, z: -toward.z };
    speed = 0.7;
    tactic = "space";
  } else if (visible && distance < reach && ownRecovery) {
    const side =
      (bot.strafe || 1) *
      (Math.sin(now * 1.4 + (bot.seed || 0)) > -0.7 ? 1 : -1);
    wish = { x: -toward.z * side, z: toward.x * side };
    speed = 0.62;
    tactic = "circle";
  }
  // Soft separation keeps teams from collapsing into one overlapping opponent.
  // It never moves an entity directly or bypasses world collision.
  for (const ally of entities) {
    if (ally === bot || !ally.alive || ally.team !== bot.team) continue;
    const ax = bot.x - ally.x,
      az = bot.z - ally.z,
      d = Math.hypot(ax, az);
    if (d > 0.01 && d < 1.35) {
      const force = (1 - d / 1.35) * skill.footwork;
      wish.x += (ax / d) * force;
      wish.z += (az / d) * force;
    }
  }
  const length = Math.hypot(wish.x, wish.z);
  if (length > 1) {
    wish.x /= length;
    wish.z /= length;
  }
  return {
    yaw,
    wish,
    speed: speed * skill.speed * (facing ? 1 : 0.45),
    reacted,
    facing,
    respectGuard,
    tactic,
    attack:
      reacted &&
      facing &&
      !respectGuard &&
      distance < glove.range + 0.1 &&
      Math.abs(target.y - bot.y) < 2.2,
  };
}
