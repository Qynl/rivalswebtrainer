import { GLOVES } from "./catalog.js";
// Accepted impacts only. No client damage prediction, live source coordinates,
// health scouting or profile rewards. Eight primitive records bound the history.
export function recordIncomingImpact(g, event, source, target) {
  if (
    g.headless ||
    !g.player ||
    target !== g.player ||
    !GLOVES[event.glove] ||
    !Number.isFinite(event.damage) ||
    event.damage < 0 ||
    event.damage > 150
  )
    return;
  if (event.round !== undefined && event.round !== g.round) return;
  const history = (g.incomingImpacts ||= []);
  const velocity = event.velocity;
  const impact = {
    source: source?.name || "RIVAL",
    glove: event.glove,
    damage: event.damage,
    reflected: !!event.reflected,
    launch:
      Array.isArray(velocity) &&
      velocity.length === 3 &&
      velocity.every(Number.isFinite)
        ? Math.hypot(...velocity)
        : 0,
  };
  history.push(impact);
  if (history.length > 8) history.shift();
  if (event.healthAfter === 0 && event.damage > 0)
    g.deathRecap = {
      ...impact,
      hits: history.filter((e) => e.damage > 0).length,
      total: history.reduce((n, e) => n + e.damage, 0),
    };
}
