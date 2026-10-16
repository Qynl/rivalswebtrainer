import { WEAPONS } from "../data.js";
const WEAPON_IDS = Object.keys(WEAPONS),
  PHASES = ["countdown", "playing", "roundend", "finished"];
const TIMERS = [
  "slide",
  "dash",
  "deflect",
  "swing",
  "throw",
  "heal",
  "reload",
  "blind",
  "dashCooldown",
  "deflectCooldown",
];
const STATS = ["shots", "hits", "kills", "deaths", "headshots"];
const HEADER = 23,
  PLAYER = 98,
  PROJECTILE = 24,
  ZONE = 19,
  MAGIC = 0x5256;
const finite = (value, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value)));
// 611 bytes for an ordinary 3v3 frame, without JSON's repeated names/keys or
// double-precision decimal strings. Control and combat events remain reliable.
export function encodeSnapshot(snapshot) {
  const players = snapshot.players.slice(0, 6),
    projectiles = (snapshot.projectiles || []).slice(0, 192),
    zones = (snapshot.zones || []).slice(0, 48);
  const bytes = new Uint8Array(
      HEADER +
        PLAYER * players.length +
        PROJECTILE * projectiles.length +
        ZONE * zones.length,
    ),
    view = new DataView(bytes.buffer);
  let offset = 0;
  const u8 = (n) => {
      view.setUint8(offset, clamp(n, 0, 255));
      offset++;
    },
    u16 = (n) => {
      view.setUint16(offset, clamp(Math.round(n), 0, 65535), true);
      offset += 2;
    },
    u32 = (n) => {
      view.setUint32(
        offset,
        n < 0 ? 0xffffffff : clamp(n, 0, 0xffffffff),
        true,
      );
      offset += 4;
    },
    i16 = (n) => {
      view.setInt16(offset, clamp(Math.round(n), -32768, 32767), true);
      offset += 2;
    },
    f32 = (n) => {
      view.setFloat32(offset, finite(n), true);
      offset += 4;
    };
  u16(MAGIC);
  u8(2);
  u32(snapshot.matchId || 1);
  u16(snapshot.round);
  f32(snapshot.time);
  u8(PHASES.indexOf(snapshot.phase));
  u8(snapshot.score[0]);
  u8(snapshot.score[1]);
  u16(snapshot.countdown * 1000);
  u16(snapshot.roundTime * 100);
  u8(players.length);
  u8(projectiles.length);
  u8(zones.length);
  for (const p of players) {
    u8(p.index);
    u8(
      (p.alive ? 1 : 0) |
        (p.grounded ? 2 : 0) |
        (p.shotSide ? 4 : 0) |
        (p.quickUtility > 0 ? 8 : 0) |
        (p.aiming ? 16 : 0) |
        (p.knifeStab ? 32 : 0),
    );
    u8(p.height * 100);
    u16(p.health * 100);
    for (const key of ["x", "y", "z"]) f32(p[key]);
    for (const key of ["vx", "vy", "vz"]) i16(p[key] * 100);
    i16(p.yaw * 10000);
    i16(p.pitch * 10000);
    u8(p.slot);
    for (const id of p.loadout) u8(WEAPON_IDS.indexOf(id));
    u32(p.lastSeq);
    f32(p.inputTime);
    u32(p.lastAction);
    for (const ammo of p.ammo) {
      u16(ammo.mag == null ? 65535 : ammo.mag);
      u16(ammo.reserve == null ? 65535 : ammo.reserve);
    }
    for (const key of TIMERS) u16(p[key] * 1000);
    f32(p.shot);
    for (const key of STATS) u16(p.stats?.[key] || 0);
    u16((p.quickMelee || 0) * 1000);
    u16((p.paint || 0) * 1000);
  }
  for (const p of projectiles) {
    u32(p.id);
    u8(players.find((e) => e.id === p.owner)?.index || 0);
    u8(WEAPON_IDS.indexOf(p.weapon));
    for (const key of ["x", "y", "z"]) f32(p[key]);
    for (const key of ["rx", "ry", "rz"])
      i16(Math.atan2(Math.sin(p[key]), Math.cos(p[key])) * 10000);
  }
  for (const zone of zones) {
    u32(zone.id);
    u8(zone.type === "fire" ? 1 : 2);
    for (const key of ["x", "y", "z"]) f32(zone[key]);
    u16(zone.life * 1000);
  }
  if (offset !== bytes.length) throw Error("Snapshot encoder size mismatch");
  return bytes;
}
export function decodeSnapshot(data, metadata) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u8 = () => view.getUint8(offset++),
    u16 = () => {
      const n = view.getUint16(offset, true);
      offset += 2;
      return n;
    },
    u32 = () => {
      const n = view.getUint32(offset, true);
      offset += 4;
      return n;
    },
    i16 = () => {
      const n = view.getInt16(offset, true);
      offset += 2;
      return n;
    },
    f32 = () => {
      const n = view.getFloat32(offset, true);
      offset += 4;
      if (!Number.isFinite(n)) throw Error("Nonfinite snapshot");
      return n;
    };
  if (bytes.length < HEADER || u16() !== MAGIC || u8() !== 2)
    throw Error("Invalid snapshot version");
  const matchId = u32(),
    round = u16(),
    time = f32(),
    phase = PHASES[u8()],
    score = [u8(), u8()],
    countdown = u16() / 1000,
    roundTime = u16() / 100,
    playerCount = u8(),
    projectileCount = u8(),
    zoneCount = u8();
  if (
    !phase ||
    playerCount > 6 ||
    projectileCount > 192 ||
    zoneCount > 48 ||
    bytes.length !==
      HEADER +
        playerCount * PLAYER +
        projectileCount * PROJECTILE +
        zoneCount * ZONE
  )
    throw Error("Invalid snapshot length");
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const index = u8(),
      meta = metadata.get(index);
    if (!meta) throw Error("Unknown player index");
    const flags = u8(),
      p = {
        index,
        id: meta.id,
        name: meta.name,
        team: meta.team,
        alive: !!(flags & 1),
        grounded: !!(flags & 2),
        aiming: !!(flags & 16),
        knifeStab: !!(flags & 32),
        shotSide: flags & 4 ? 1 : 0,
        height: u8() / 100,
        health: u16() / 100,
      };
    for (const key of ["x", "y", "z"]) p[key] = f32();
    for (const key of ["vx", "vy", "vz"]) p[key] = i16() / 100;
    p.yaw = i16() / 10000;
    p.pitch = i16() / 10000;
    p.slot = u8();
    p.loadout = Array.from({ length: 4 }, () => WEAPON_IDS[u8()]);
    if (p.slot > 3 || p.loadout.some((id, slot) => WEAPONS[id]?.slot !== slot))
      throw Error("Invalid snapshot loadout");
    p.weapon = p.loadout[p.slot];
    p.lastSeq = u32();
    if (p.lastSeq === 0xffffffff) p.lastSeq = -1;
    p.inputTime = f32();
    p.lastAction = u32();
    p.ammo = Array.from({ length: 4 }, () => {
      let mag = u16(),
        reserve = u16();
      return {
        mag: mag === 65535 ? null : mag,
        reserve: reserve === 65535 ? null : reserve,
      };
    });
    for (const key of TIMERS) p[key] = u16() / 1000;
    p.shot = f32();
    p.stats = {};
    for (const key of STATS) p.stats[key] = u16();
    // Quick utility reuses the existing throw/heal timer; no larger packets or new weapon IDs.
    p.quickUtility = flags & 8 ? Math.max(p.throw, p.heal) : 0;
    p.quickMelee = u16() / 1000;
    p.paint = u16() / 1000;
    players.push(p);
  }
  const projectiles = [];
  for (let i = 0; i < projectileCount; i++) {
    const p = {
      id: u32(),
      owner: metadata.get(u8())?.id,
      weapon: WEAPON_IDS[u8()],
    };
    for (const key of ["x", "y", "z"]) p[key] = f32();
    for (const key of ["rx", "ry", "rz"]) p[key] = i16() / 10000;
    projectiles.push(p);
  }
  const zones = [];
  for (let i = 0; i < zoneCount; i++) {
    const zone = { id: u32(), type: u8() === 1 ? "fire" : "smoke" };
    for (const key of ["x", "y", "z"]) zone[key] = f32();
    zone.life = u16() / 1000;
    zones.push(zone);
  }
  return {
    matchId,
    time,
    round,
    phase,
    score,
    countdown,
    roundTime,
    players,
    projectiles,
    zones,
    events: [],
  };
}
