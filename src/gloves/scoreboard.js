// Local match tallies are separate from profile currency and wire snapshots.
const fresh = () => ({
  shots: 0,
  hits: 0,
  slaps: 0,
  kills: 0,
  deaths: 0,
  damage: 0,
});
export function rosterStats(g, team, index, player) {
  if (g.headless || g.config?.online) return null;
  g.actorStats ||= new Map();
  const key = player ? "self" : `${team}:${index}`;
  if (!g.actorStats.has(key)) g.actorStats.set(key, fresh());
  return g.actorStats.get(key);
}
export function recordRosterSlap(g, source, earned) {
  if (g.headless || g.network || !source.arenaStats) return;
  source.arenaStats.hits++;
  source.arenaStats.slaps += earned;
}
export function recordRosterDamage(g, target, source, damage, killed) {
  if (g.headless || g.network) return;
  if (
    source &&
    source !== target &&
    source.team !== target.team &&
    source.arenaStats
  ) {
    source.arenaStats.damage += damage;
    if (killed) source.arenaStats.kills++;
  }
  if (killed && target.arenaStats) target.arenaStats.deaths++;
}
export function matchRoster(g) {
  const self = g.player;
  if (!self) return [];
  const net = g.network;
  const actors = net?.latest?.players || g.entities || [];
  return actors
    .map((actor) => {
      const own = net ? actor.id === net.id : actor === self;
      const friendly = actor.team === self.team;
      const stats = net ? actor.stats : actor.arenaStats;
      return {
        id: actor.netId || actor.id,
        name: actor.name || "PLAYER",
        team: actor.team,
        self: own,
        alive: !!actor.alive,
        // Do not expose enemy HP/status, Ghost position, coordinates or hidden IDs.
        health: friendly ? Math.ceil(Math.max(0, actor.health || 0)) : null,
        glove: net ? actor.weapon : own ? g.loadout[0] : actor.activeWeapon,
        kills: stats?.kills || 0,
        deaths: stats?.deaths || 0,
        slaps: stats?.slaps || 0,
      };
    })
    .sort(
      (a, b) =>
        a.team - b.team ||
        b.kills - a.kills ||
        b.slaps - a.slaps ||
        a.name.localeCompare(b.name),
    );
}
