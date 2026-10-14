import { describe, expect, it } from 'vitest';
import { runBotEvaluation, runBotEvaluationSuite } from './BotEvaluation';

describe('bot evaluation harness', () => {
  it('runs representative movement scenarios through the fixed-step match path', () => {
    const results = runBotEvaluationSuite('skilled');
    expect(results).toHaveLength(9);
    expect(results.map((result) => result.scenario)).toContain('slide-jumping');
    expect(results.every((result) => Number.isFinite(result.finalPlayerHealth))).toBe(true);
    expect(results.every((result) => result.botShots >= 0 && result.playerShots >= 0)).toBe(true);
  });

  it('reports measurable perception and firing signals rather than declaring skill implicitly', () => {
    const result = runBotEvaluation('strafing', 'expert', 4);
    expect(result.visibilitySamples).toBeGreaterThan(0);
    expect(result.botShots).toBeGreaterThan(0);
    expect(result.movementCollisions).toBeGreaterThanOrEqual(0);
    expect(result.finalPlayerHealth).toBeGreaterThanOrEqual(0);
    expect(result.finalBotHealth).toBeGreaterThanOrEqual(0);
  });
});
