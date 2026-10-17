import test from "node:test";
import assert from "node:assert/strict";
import {
  rosterStats,
  recordRosterSlap,
  recordRosterDamage,
  matchRoster,
} from "../src/gloves/scoreboard.js";
test("offline tallies persist across recreated round entities but never change profile currency", () => {
  const g = {};
  const a = rosterStats(g, 0, 0, true),
    b = rosterStats(g, 1, 0, false);
  assert.equal(rosterStats(g, 0, 0, true), a);
  assert.notEqual(a, b);
  const p = { team: 0, arenaStats: a },
    enemy = { team: 1, arenaStats: b };
  recordRosterSlap(g, p, 2);
  recordRosterDamage(g, enemy, p, 12, true);
  assert.deepEqual(a, {
    shots: 0,
    hits: 1,
    slaps: 2,
    kills: 1,
    deaths: 0,
    damage: 12,
  });
  assert.equal(b.deaths, 1);
  assert.equal(g.profile, undefined);
});
test("headless authority and network presentations do not double-count local scoreboard rewards", () => {
  assert.equal(rosterStats({ headless: true }, 0, 0, true), null);
  for (const patch of [{ headless: true }, { network: {} }]) {
    const p = {
        team: 0,
        arenaStats: { hits: 0, slaps: 0, damage: 0, kills: 0 },
      },
      e = { team: 1, arenaStats: { deaths: 0 } };
    recordRosterSlap(patch, p, 1);
    recordRosterDamage(patch, e, p, 20, true);
    assert.equal(p.arenaStats.hits, 0);
    assert.equal(e.arenaStats.deaths, 0);
  }
});
test("roster exposes public status and ally health but not enemy health, Ghost state or coordinates", () => {
  const p = { id: "p", team: 0, name: "YOU", alive: true, health: 118 };
  const e = {
    id: "e",
    team: 1,
    name: "RIVAL",
    alive: true,
    health: 37,
    ghostTime: 3,
    x: 14,
    z: 18,
    activeWeapon: "glove_ghost",
  };
  const rows = matchRoster({
    player: p,
    entities: [p, e],
    loadout: ["glove_default"],
  });
  assert.equal(rows[0].health, 118);
  assert.equal(rows[1].health, null);
  assert.equal(rows[1].glove, "glove_ghost");
  for (const key of ["ghostTime", "x", "z", "ragdollTime"])
    assert.equal(rows[1][key], undefined);
});
test("online roster uses received authority stats rather than interpolated or client-authored tallies", () => {
  const g = {
    player: { team: 1 },
    network: {
      id: "self",
      latest: {
        players: [
          {
            id: "self",
            team: 1,
            name: "YOU",
            alive: true,
            health: 125,
            weapon: "glove_dual",
            stats: { slaps: 8, kills: 2, deaths: 1 },
          },
          {
            id: "enemy",
            team: 0,
            name: "RIVAL",
            alive: true,
            health: 36,
            weapon: "glove_snow",
            stats: { slaps: 3, kills: 1, deaths: 2 },
          },
        ],
      },
    },
    entities: [],
  };
  const rows = matchRoster(g),
    self = rows.find((p) => p.self),
    enemy = rows.find((p) => !p.self);
  assert.equal(self.glove, "glove_dual");
  assert.equal(self.slaps, 8);
  assert.equal(self.kills, 2);
  assert.equal(self.health, 125);
  assert.equal(enemy.health, null);
});
