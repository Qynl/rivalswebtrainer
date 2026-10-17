import {
  isGlove,
  gloveLoadout,
  canUseGlove,
  sanitizeSlaps,
} from "../src/gloves/catalog.js";
import { COMBAT_ITEMS as WEAPONS } from "../src/data.js";
// Web Crypto works in Node and secure browsers. The same validated match/lobby
// simulation can therefore run in a player's browser without a game backend.
const randomHex = (length) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const randomUUID = () => crypto.randomUUID();
import {
  cleanInput,
  cleanLoadout,
  cleanName,
  DEFAULT_LOADOUT,
  ONLINE_MAPS,
  MAX_PLAYERS,
  PROTOCOL,
} from "../src/net/protocol.js";
import { Match } from "./match.js";
const code = () => randomHex(4).slice(0, 6).toUpperCase();
export class LobbyService {
  constructor({
    maxClients = 128,
    maxRooms = 32,
    now = () => performance.now(),
    MatchClass = Match,
    roomCode = code,
  } = {}) {
    this.roomCode = roomCode;
    this.clients = new Map();
    this.rooms = new Map();
    this.maxClients = maxClients;
    this.maxRooms = maxRooms;
    this.now = now;
    this.MatchClass = MatchClass;
    this.lastSnapshot = 0;
  }
  connect(send, transport = "websocket", close = null) {
    if (this.clients.size >= this.maxClients) return null;
    const id = randomUUID(),
      c = {
        id,
        send,
        transport,
        close,
        room: null,
        epoch: 0,
        name: "PLAYER",
        lastAt: this.now(),
        tokens: 80,
        lastBudget: this.now(),
        controls: 12,
        lastControl: this.now(),
      };
    this.clients.set(id, c);
    send({ type: "hello", id, protocol: PROTOCOL, transport });
    return id;
  }
  send(id, packet) {
    try {
      this.clients.get(id)?.send(packet);
    } catch {
      this.disconnect(id);
    }
  }
  error(id, message) {
    this.send(id, { type: "error", message });
  }
  roomView(room) {
    return {
      revision: room.revision || 0,
      code: room.code,
      name: room.name,
      map: room.map,
      private: room.private,
      gloves: !!room.gloves,
      host: room.host,
      phase: room.match?.phase || "lobby",
      players: [...room.members.values()].map(
        ({ id, name, team, ready, loadout }) => ({
          id,
          name,
          team,
          ready,
          loadout,
        }),
      ),
      capacity: MAX_PLAYERS,
    };
  }
  publish(room) {
    room.revision = (room.revision || 0) + 1;
    const view = this.roomView(room);
    for (const id of room.members.keys())
      this.send(id, {
        type: "room",
        room: view,
        membership: this.clients.get(id)?.epoch,
      });
  }
  leave(id) {
    const c = this.clients.get(id),
      room = this.rooms.get(c?.room);
    if (!room) return;
    c.room = null;
    c.epoch++;
    room.members.delete(id);
    room.match?.remove(id);
    this.send(id, { type: "left", membership: c.epoch });
    if (!room.members.size) {
      room.match?.dispose();
      this.rooms.delete(room.code);
      return;
    }
    if (room.host === id) room.host = room.members.keys().next().value;
    this.publish(room);
  }
  disconnect(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.leave(id);
    this.clients.delete(id);
    try {
      c.close?.();
    } catch {}
  }
  receive(id, message) {
    const c = this.clients.get(id);
    if (!c || !message || typeof message !== "object") return;
    const now = this.now(),
      elapsed = Math.max(0, (now - c.lastBudget) / 1000);
    c.tokens = Math.min(160, c.tokens + elapsed * 120);
    c.lastBudget = now;
    if (c.tokens < 1) return;
    c.tokens--;
    c.lastAt = now;
    if (message.type === "probeReply") {
      if (message.token === c.probeToken && c.probeToken) {
        c.rtt = Math.min(0.36, Math.max(0, (now - c.probeAt) / 1000));
        c.probeToken = null;
        const g = this.rooms.get(c.room)?.match?.contexts.get(id);
        if (g) g.latency = c.rtt;
      }
      return;
    }
    if (message.type === "ping") {
      this.send(id, {
        type: "pong",
        sent: Number.isFinite(message.sent) ? message.sent : 0,
        time: now,
      });
      if (!c.probeToken || now - c.probeAt > 3000) {
        c.probeToken = randomHex(8);
        c.probeAt = now;
        this.send(id, { type: "probe", token: c.probeToken });
      }
      return;
    }
    const room = this.rooms.get(c.room);
    if (message.type === "input") {
      if (room?.match) {
        const input = cleanInput(message.input);
        if (input) room.match.input(id, input);
      }
      return;
    }
    c.controls = Math.min(
      12,
      c.controls + Math.max(0, (now - c.lastControl) / 1000) * 3,
    );
    c.lastControl = now;
    if (c.controls < 1) return;
    c.controls--;
    if (message.type === "list") {
      this.send(id, {
        type: "list",
        rooms: [...this.rooms.values()]
          .filter((r) => !r.private && !r.match)
          .map((r) => ({
            code: r.code,
            name: r.name,
            map: r.map,
            players: r.members.size,
            capacity: MAX_PLAYERS,
          })),
      });
      return;
    }
    if (message.type === "leave") {
      this.leave(id);
      return;
    }
    if (message.type === "create") {
      if (room) return this.error(id, "Leave your current lobby first.");
      if (this.rooms.size >= this.maxRooms)
        return this.error(id, "Server is full. Try again later.");
      const slaps = sanitizeSlaps(message.slaps),
        gloves = message.gloves === true;
      const requested = cleanLoadout(message.loadout);
      const loadout = gloves
        ? gloveLoadout(
            canUseGlove(requested?.[0], slaps) ? requested[0] : undefined,
          )
        : requested || [...DEFAULT_LOADOUT];
      let roomCode = this.roomCode();
      while (this.rooms.has(roomCode)) roomCode = code();
      const r = {
        code: roomCode,
        gloves,
        name: cleanName(message.name) + "’S LOBBY",
        map: ONLINE_MAPS.includes(message.map) ? message.map : "blockout",
        private: message.private === true,
        host: id,
        members: new Map(),
        created: now,
        match: null,
      };
      this.rooms.set(roomCode, r);
      c.name = cleanName(message.name);
      c.room = roomCode;
      c.epoch++;
      r.members.set(id, {
        id,
        name: c.name,
        team: 0,
        ready: true,
        loadout,
        slaps,
      });
      this.publish(r);
      return;
    }
    if (message.type === "join") {
      if (room) return this.error(id, "Leave your current lobby first.");
      const r = this.rooms.get(
        String(message.code || "")
          .trim()
          .toUpperCase(),
      );
      if (!r) return this.error(id, "Lobby not found.");
      if (r.match) return this.error(id, "This lobby is already in a match.");
      if (r.members.size >= MAX_PLAYERS)
        return this.error(id, "This lobby is full.");
      const counts = [0, 1].map(
          (t) => [...r.members.values()].filter((m) => m.team === t).length,
        ),
        team = counts[0] <= counts[1] ? 0 : 1;
      c.name = cleanName(message.name);
      c.room = r.code;
      c.epoch++;
      r.members.set(id, {
        id,
        name: c.name,
        team,
        ready: false,
        slaps: sanitizeSlaps(message.slaps),
        loadout: r.gloves
          ? gloveLoadout(
              canUseGlove(message.loadout?.[0], sanitizeSlaps(message.slaps))
                ? message.loadout[0]
                : undefined,
            )
          : cleanLoadout(message.loadout) || [...DEFAULT_LOADOUT],
      });
      this.publish(r);
      return;
    }
    if (!room) return this.error(id, "Join or create a lobby first.");
    const member = room.members.get(id);
    if (
      message.type === "return" &&
      id === room.host &&
      room.match?.phase === "finished"
    ) {
      room.match.dispose();
      room.match = null;
      for (const m of room.members.values()) m.ready = m.id === room.host;
      this.publish(room);
      return;
    }
    if (room.match && message.type === "selection") {
      const g = room.match.contexts.get(id);
      if (g && g.player.alive) {
        if (message.selecting === true && room.match.phase === "countdown") {
          g.selectingLoadout = true;
          g.keys.clear();
          g.mouseDown = g.trigger = g.aiming = false;
        } else if (message.selecting === false) g.selectingLoadout = false;
      }
      return;
    }
    if (room.match && message.type === "loadout") {
      const g = room.match.contexts.get(id),
        next = cleanLoadout(message.loadout);
      if (
        !next ||
        (room.gloves &&
          !canUseGlove(
            next[0],
            (member.slaps || 0) + (member.stats?.hits || 0),
          )) ||
        !g?.player.alive ||
        !(g.selectingLoadout || room.match.phase === "countdown")
      )
        return this.error(
          id,
          "Loadouts can only change during countdown or an unfinished countdown selection.",
        );
      g.cancelThrow();
      g.playerMeleePending = null;
      g.ammunition = next.map((weapon, slot) =>
        weapon === g.loadout[slot]
          ? g.ammunition[slot]
          : { mag: WEAPONS[weapon].mag, reserve: WEAPONS[weapon].reserve },
      );
      g.loadout = [...next];
      member.loadout = [...next];
      g.slot = -1;
      g.equip(0);
      g.selectingLoadout = false;
      this.publish(room);
      return;
    }
    if (room.match)
      return this.error(id, "This action is only available in the lobby.");
    if (message.type === "ready") {
      member.ready = message.ready === true;
      this.publish(room);
      return;
    }
    if (message.type === "loadout") {
      const loadout = cleanLoadout(message.loadout);
      if (
        !loadout ||
        (room.gloves &&
          !canUseGlove(
            loadout[0],
            (member.slaps || 0) + (member.stats?.hits || 0),
          ))
      )
        return this.error(id, "Glove is locked or invalid.");
      member.loadout = loadout;
      this.publish(room);
      return;
    }
    if (message.type === "team") {
      const team = message.team;
      if (
        (team !== 0 && team !== 1) ||
        [...room.members.values()].filter((m) => m.team === team && m.id !== id)
          .length >= 3
      )
        return this.error(id, "That team is full.");
      member.team = team;
      member.ready = id === room.host;
      this.publish(room);
      return;
    }
    if (message.type === "map" && id === room.host) {
      if (!ONLINE_MAPS.includes(message.map))
        return this.error(id, "Unsupported online map.");
      room.map = message.map;
      for (const m of room.members.values()) m.ready = m.id === id;
      this.publish(room);
      return;
    }
    if (message.type === "start" && id === room.host) {
      const members = [...room.members.values()],
        counts = [0, 1].map((t) => members.filter((m) => m.team === t).length);
      if (!counts[0] || counts[0] !== counts[1])
        return this.error(id, "Use equal teams: 1v1, 2v2 or 3v3.");
      if (members.some((m) => !m.ready))
        return this.error(id, "Every player must be ready.");
      for (const m of members) {
        if (room.gloves)
          m.slaps = sanitizeSlaps((m.slaps || 0) + (m.stats?.hits || 0));
        m.stats = { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 };
        m.lastAction = 0;
      }
      room.matchId = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      room.match = new this.MatchClass(room);
      for (const id of room.members.keys())
        this.send(id, {
          type: "start",
          map: room.map,
          matchId: room.matchId,
          membership: this.clients.get(id)?.epoch,
          roomRevision: (room.revision || 0) + 1,
          snapshot: room.match.snapshot(),
        });
      this.publish(room);
      return;
    }
  }
  step(dt) {
    for (const room of this.rooms.values())
      if (room.match) {
        const before = room.match.phase;
        room.match.step(dt);
        if (before !== room.match.phase) this.publish(room);
      }
    this.lastSnapshot += dt;
    if (this.lastSnapshot >= 1 / 30) {
      this.lastSnapshot %= 1 / 30;
      for (const room of this.rooms.values())
        if (room.match) {
          const packet = { type: "snapshot", snapshot: room.match.snapshot() },
            events = room.match.events.filter(
              (e) => e.id > room.match.sentEventId,
            );
          for (const id of room.members.keys()) {
            this.send(id, packet);
            if (events.length)
              this.send(id, { type: "events", matchId: room.matchId, events });
          }
          if (events.length) room.match.sentEventId = events.at(-1).id;
        }
    }
  }
  sweep() {
    const now = this.now();
    for (const c of this.clients.values())
      if (now - c.lastAt > 20000) this.disconnect(c.id);
  }
  dispose() {
    for (const id of [...this.clients.keys()]) this.disconnect(id);
    for (const r of this.rooms.values()) r.match?.dispose();
    this.rooms.clear();
    this.clients.clear();
  }
}
