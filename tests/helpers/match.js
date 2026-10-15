import { Match } from "../../server/match.js";
import { cleanInput } from "../../src/net/protocol.js";
export function setup(utility = "grenade") {
  const members = new Map(
    [0, 1].map((team) => [
      "p" + team,
      {
        id: "p" + team,
        team,
        name: "PLAYER " + team,
        lastAction: 0,
        loadout: ["rifle", "revolver", "knife", utility],
        stats: { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 },
      },
    ]),
  );
  const m = new Match({ map: "blockout", members });
  m.phase = "playing";
  const g = m.contexts.get("p0");
  Object.assign(g.player, { x: 0, y: 0, z: 12, vx: 0, vy: 0, vz: 0 });
  return { m, g, other: m.contexts.get("p1") };
}
export const packet = (seq, actions, extra = {}) =>
  cleanInput({
    seq,
    yaw: 0,
    pitch: 0,
    fire: false,
    aim: false,
    keys: 0,
    actions,
    ...extra,
  });
