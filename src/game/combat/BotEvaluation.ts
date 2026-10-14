import { ARENA_SPAWN, BOT_SPAWN } from '../arena/ArenaConfig';
import { CollisionWorld } from '../movement/CollisionWorld';
import type { MovementInput } from '../movement/MovementTypes';
import { CombatSimulation } from './CombatSimulation';
import type { BotDifficulty, CombatAim } from './CombatTypes';

export type EvaluationScenario =
  | 'stationary'
  | 'straight-line'
  | 'strafing'
  | 'jumping'
  | 'sliding'
  | 'slide-jumping'
  | 'direction-changes'
  | 'break-line-of-sight'
  | 'elevation';

export interface BotEvaluationResult {
  scenario: EvaluationScenario;
  difficulty: BotDifficulty;
  duration: number;
  botShots: number;
  botHits: number;
  playerShots: number;
  playerHits: number;
  visibilitySamples: number;
  visibleSamples: number;
  movementCollisions: number;
  botSlideTicks: number;
  botJumpTicks: number;
  finalPlayerHealth: number;
  finalBotHealth: number;
  phase: string;
}

const dt = 1 / 120;

function makeWorld(scenario: EvaluationScenario): CollisionWorld {
  const world = new CollisionWorld();
  world.addFloor('evaluation-floor', { minX: -40, maxX: 40, minZ: -40, maxZ: 40 });
  if (scenario === 'break-line-of-sight' || scenario === 'elevation') {
    world.addBox('evaluation-cover', { x: 0, y: 1.4, z: 0 }, { x: 4.8, y: 2.8, z: 0.8 }, 'evaluation cover');
  }
  return world;
}

function scenarioInput(scenario: EvaluationScenario, time: number): MovementInput {
  const oscillation = Math.sin(time * 2.3) > 0 ? 1 : -1;
  const direction = Math.floor(time * 1.7) % 2 === 0 ? 1 : -1;
  const base: MovementInput = {
    forward: 0,
    strafe: 0,
    sprint: false,
    autoSprint: false,
    slidePressed: false,
    jumpPressed: false,
  };
  switch (scenario) {
    case 'stationary':
      return base;
    case 'straight-line':
      return { ...base, forward: 1, sprint: true };
    case 'strafing':
      return { ...base, strafe: oscillation, sprint: true };
    case 'jumping':
      return { ...base, forward: 0.65, sprint: true, jumpPressed: Math.floor(time * 1.1) % 2 === 0 && time % 0.12 < dt };
    case 'sliding':
      return { ...base, forward: 1, sprint: true, slidePressed: time % 1.15 < dt };
    case 'slide-jumping':
      return {
        ...base,
        forward: 1,
        sprint: true,
        slidePressed: time % 1.35 < dt,
        jumpPressed: time % 1.35 > 0.22 && time % 1.35 < 0.22 + dt,
      };
    case 'direction-changes':
      return { ...base, strafe: direction, sprint: true };
    case 'break-line-of-sight':
      return { ...base, strafe: oscillation, forward: 0.7, sprint: true };
    case 'elevation':
      return { ...base, forward: 1, sprint: true, jumpPressed: time % 1.6 < dt };
  }
}

function aimAt(simulation: CombatSimulation): CombatAim {
  const origin = simulation.getPlayerEye();
  const target = simulation.getBotEye();
  return {
    yaw: Math.atan2(target.x - origin.x, -(target.z - origin.z)),
    pitch: Math.atan2(target.y - origin.y, Math.max(Math.hypot(target.x - origin.x, target.z - origin.z), 1e-5)),
  };
}

/**
 * Repeatable headless evaluation harness. It measures behavior quality signals,
 * not a claim that a bot has human-level skill. Scenarios deliberately use the
 * same fixed-step match path as the browser game.
 */
export function runBotEvaluation(
  scenario: EvaluationScenario,
  difficulty: BotDifficulty = 'expert',
  seconds = 6,
): BotEvaluationResult {
  const simulation = new CombatSimulation(makeWorld(scenario), ARENA_SPAWN, BOT_SPAWN, difficulty);
  simulation.beginMatch();
  let botShots = 0;
  let botHits = 0;
  let playerShots = 0;
  let playerHits = 0;
  let visibilitySamples = 0;
  let visibleSamples = 0;
  let movementCollisions = 0;
  let botSlideTicks = 0;
  let botJumpTicks = 0;
  const steps = Math.round(seconds / dt);

  for (let index = 0; index < steps; index += 1) {
    const time = index * dt;
    const result = simulation.step(
      dt,
      scenarioInput(scenario, time),
      aimAt(simulation),
      { fireHeld: true, aimHeld: false, reloadPressed: false, weaponSlot: null },
    );
    if (result.botShot?.fired) {
      botShots += 1;
      if (result.botShot.hit) botHits += 1;
    }
    if (result.playerShot?.fired) {
      playerShots += 1;
      if (result.playerShot.hit) playerHits += 1;
    }
    const snapshot = simulation.getSnapshot();
    visibilitySamples += 1;
    if (snapshot.botVisible) visibleSamples += 1;
    if (simulation.bot.movement.lastCollision) movementCollisions += 1;
    if (simulation.bot.movement.sliding) botSlideTicks += 1;
    if (!simulation.bot.movement.grounded) botJumpTicks += 1;
    if (snapshot.phase === 'matchSummary') break;
  }

  const final = simulation.getSnapshot();
  return {
    scenario,
    difficulty,
    duration: seconds,
    botShots,
    botHits,
    playerShots,
    playerHits,
    visibilitySamples,
    visibleSamples,
    movementCollisions,
    botSlideTicks,
    botJumpTicks,
    finalPlayerHealth: final.playerHealth,
    finalBotHealth: final.botHealth,
    phase: final.phase,
  };
}

export function runBotEvaluationSuite(
  difficulty: BotDifficulty = 'expert',
): BotEvaluationResult[] {
  const scenarios: EvaluationScenario[] = [
    'stationary',
    'straight-line',
    'strafing',
    'jumping',
    'sliding',
    'slide-jumping',
    'direction-changes',
    'break-line-of-sight',
    'elevation',
  ];
  return scenarios.map((scenario) => runBotEvaluation(scenario, difficulty));
}
