import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { MATCH } from '../src/shared/constants.ts';
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
    const room = new Room('practice', new Physics(ARENA));
    const spawn = ARENA.spawns[1].pos;
    let minY = Infinity;
    let maxY = -Infinity;
    let travelled = 0;
    let grappled = false;
    let died = 0;
    let wasAlive = true;
    let t = 0;
    for (let i = 0; i < 60 * 20; i++) {
      t += 1000 / 60;
      room.update(t);
      const bot = room.inspect().players[1];
      minY = Math.min(minY, bot.pos.y);
      maxY = Math.max(maxY, bot.pos.y);
      travelled = Math.max(travelled, Math.hypot(bot.pos.x - spawn.x, bot.pos.z - spawn.z));
      if (bot.grapple.active) grappled = true;
      if (wasAlive && !bot.alive) died++;
      wasAlive = bot.alive;
    }
    // The ring has not closed yet, so any death here is a fall.
    expect(died).toBe(0);
    expect(minY).toBeGreaterThan(MATCH.voidY + 10);
    expect(travelled).toBeGreaterThan(20);
    expect(grappled).toBe(true);
    expect(maxY).toBeGreaterThan(50);
  }, 30000);

  it('trades shots with a stationary opponent', async () => {
    const room = new Room('practice', new Physics(ARENA));
    let t = 0;
    let kills = 0;
    for (let i = 0; i < 60 * 45 && kills === 0; i++) {
      t += 1000 / 60;
      room.update(t);
      const s = room.inspect().match.scores;
      kills = s[1];
    }
    // 45 s is several full repositions: a bot that never fires cannot score.
    expect(kills).toBeGreaterThan(0);
  }, 60000);
});
