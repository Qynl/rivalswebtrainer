import { performance } from "node:perf_hooks";
import { LobbyService } from "../server/lobbies.js";
import { canOccupy } from "../src/physics.js";
import { cleanInput } from "../src/net/protocol.js";
import { encodeSnapshot } from "../src/net/snapshot-codec.js";
const arsenal = [
  ["flame", "pistol", "knife", "molotov"],
  ["rifle", "pistol", "scythe", "grenade"],
  ["paintball", "uzi", "katana", "smoke"],
  ["launcher", "shorty", "fists", "flashbang"],
  ["bow", "pistol", "knife", "grenade"],
  ["minigun", "pistol", "scythe", "molotov"],
];
const reports = [];
let randomState = 20261015;
Math.random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
};
for (const map of ["blockout", "foundry", "courtyard"]) {
  const service = new LobbyService(),
    ids = Array.from({ length: 6 }, () => service.connect(() => {})),
    durations = [];
  let invalid = 0,
    maxPacket = 0,
    frames = 0;
  const invalidDetails = [],
    previous = new Map();
  service.receive(ids[0], { type: "create", map, loadout: arsenal[0] });
  const room = service.rooms.get(service.clients.get(ids[0]).room);
  for (let i = 1; i < 6; i++) {
    service.receive(ids[i], {
      type: "join",
      code: room.code,
      loadout: arsenal[i],
    });
    service.receive(ids[i], { type: "ready", ready: true });
  }
  service.receive(ids[0], { type: "start" });
  const started = performance.now();
  try {
    for (let tick = 0; tick < 7200; tick++) {
      const match = room.match;
      if (tick % 4 === 0)
        for (let i = 0; i < ids.length; i++) {
          const g = match.contexts.get(ids[i]);
          if (!g) continue;
          const opponent = match.entities
              .filter((e) => e.team !== g.player.team && e.alive)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - g.player.x, a.z - g.player.z) -
                  Math.hypot(b.x - g.player.x, b.z - g.player.z),
              )[0],
            dx = (opponent?.x || 0) - g.player.x,
            dz = (opponent?.z || 0) - g.player.z,
            distance = Math.hypot(dx, dz),
            actions = [];
          if (tick % 240 === 0)
            actions.push({ id: tick * 2 + 1, type: "jump" });
          if (tick % 480 === 0)
            actions.push({
              id: tick * 2 + 2,
              type: `slot${distance < 3 ? 2 : tick % 1920 === 0 ? 3 : 0}`,
            });
          match.input(
            ids[i],
            cleanInput({
              seq: tick,
              yaw: Math.atan2(-dx, -dz),
              pitch: 0,
              keys: distance > 3 ? 1 : tick % 240 < 120 ? 2 : 8,
              fire: tick % 240 < 160,
              aim: false,
              paused: !g.player.alive,
              actions,
            }),
          );
        }
      const t = performance.now();
      service.step(1 / 120);
      durations.push(performance.now() - t);
      for (const e of match.entities)
        if (
          ![e.x, e.y, e.z, e.health].every(Number.isFinite) ||
          (e.alive && !canOccupy(e, e.x, e.y, e.z, match.world.boxes))
        ) {
          invalid++;
          if (invalidDetails.length < 5)
            invalidDetails.push({
              tick,
              id: e.id,
              x: e.x,
              y: e.y,
              z: e.z,
              height: e.height,
              vx: e.vx,
              vy: e.vy,
              vz: e.vz,
              grounded: e.grounded,
              previous: previous.get(e.id),
              blockers: match.world.boxes.filter(
                (b) => !canOccupy(e, e.x, e.y, e.z, [b]),
              ),
            });
        }
      for (const e of match.entities)
        previous.set(e.id, {
          x: e.x,
          y: e.y,
          z: e.z,
          height: e.height,
          vx: e.vx,
          vy: e.vy,
          vz: e.vz,
        });
      if (tick % 6 === 0) {
        maxPacket = Math.max(
          maxPacket,
          encodeSnapshot(match.snapshot()).byteLength,
        );
        frames++;
      }
    }
    durations.sort((a, b) => a - b);
    reports.push({
      map,
      simulatedSeconds: 60,
      wallMs: Math.round(performance.now() - started),
      meanTickMs: +(
        durations.reduce((a, b) => a + b, 0) / durations.length
      ).toFixed(3),
      p99TickMs: +durations[Math.floor(durations.length * 0.99)].toFixed(3),
      invalid,
      invalidDetails,
      maxPacketBytes: maxPacket,
      frames,
      round: room.match.round,
      score: room.match.score,
      events: room.match.eventId,
    });
  } finally {
    service.dispose();
  }
}
console.log(JSON.stringify({ authoritative3v3Audit: reports }, null, 2));
if (reports.some((r) => r.invalid)) process.exitCode = 1;
