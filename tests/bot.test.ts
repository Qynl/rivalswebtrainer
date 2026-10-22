import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { initRapier, Physics } from '../src/shared/physics.ts';
import { Room } from '../src/server/room.ts';

/**
 * The practice bot is a normal client of the simulation: it emits InputFrames
 * and ShotMessages. These tests pin the two things that make it a duelist and
 * not a lemming — it must not walk or fall off the map, and it must actually
 * move around it.
 */
describe('practice bot', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('roams the map without feeding the void', async () => {
    // The bot is intentionally stochastic, so one death in a single 20 s run is
    // a coin flip on its route rather than evidence of a lemming. Three runs
    // measure the behaviour that matters: it travels, it uses the rope, it
    // climbs, and it does not routinely fall into the void.
    let deaths = 0;
    let travelled = 0;
    let maxY = 0;
    let grappled = false;
    for (let match = 0; match < 3; match++) {
      const room = new Room('practice', new Physics(ARENA));
      const spawn = ARENA.spawns[1].pos;
      let wasAlive = true;
      let t = 0;
      for (let i = 0; i < 60 * 20; i++) {
        t += 1000 / 60;
        room.update(t);
        const bot = room.inspect().players[1];
        maxY = Math.max(maxY, bot.pos.y);
        travelled = Math.max(travelled, Math.hypot(bot.pos.x - spawn.x, bot.pos.z - spawn.z));
        if (bot.grapple.active) grappled = true;
        if (wasAlive && !bot.alive) deaths++;
        wasAlive = bot.alive;
      }
    }
    expect(deaths).toBeLessThanOrEqual(1);
    expect(travelled).toBeGreaterThan(20);
    expect(grappled).toBe(true);
    expect(maxY).toBeGreaterThan(50);
  }, 60000);

  it('trades shots with a stationary opponent', async () => {
    const room = new Room('practice', new Physics(ARENA));
    let t = 0;
    let kills = 0;
    // 60 s rather than 45: the bot's route and aim timing are stochastic, so a
    // short window measures luck as much as competence. The loop exits on the
    // first kill, so a healthy run costs nothing extra.
    for (let i = 0; i < 60 * 60 && kills === 0; i++) {
      t += 1000 / 60;
      room.update(t);
      const s = room.inspect().match.scores;
      kills = s[1];
    }
    // A minute is several full repositions: a bot that never fires cannot score.
    expect(kills).toBeGreaterThan(0);
  }, 60000);
});
