import * as THREE from "three";
import { Game } from "../src/game.js";
import { WEAPONS } from "../src/data.js";
import { MAX_HEALTH, ROUND_COUNTDOWN } from "../src/combat-rules.js";
import { createServerWorld } from "./world.js";
import { KEYS } from "../src/net/protocol.js";
const noop = () => {};
const timers = [
  "deflectTime",
  "deflectCooldown",
  "dashTime",
  "swingTime",
  "backstabTime",
  "inspectTime",
  "throwTime",
  "guardFlash",
  "switchTime",
  "quickMeleeTime",
];
export class Match {
  constructor(room) {
    this.room = room;
    this.matchId = room.matchId || 1;
    this.world = createServerWorld(room.map);
    this.scene = new THREE.Scene();
    this.contexts = new Map();
    this.entities = [];
    this.time = 0;
    this.round = 0;
    this.score = [0, 0];
    this.phase = "countdown";
    this.events = [];
    this.eventId = 0;
    this.projectileId = 0;
    this.zoneId = 0;
    this.sentEventId = 0;
    this.history = [];
    this.rewinding = false;
    let networkIndex = 1;
    for (const m of room.members.values()) m.netIndex = networkIndex++;
    this.newRound();
  }
  emit(event) {
    this.events.push({ id: ++this.eventId, ...event });
    if (this.events.length > 64) this.events.shift();
  }
  context(member, index) {
    const g = Object.create(Game.prototype),
      team = member.team,
      spawn = this.world.spawns[team][index];
    Object.assign(g, {
      headless: true,
      world: this.world,
      scene: this.scene,
      entities: this.entities,
      weaponScene: new THREE.Scene(),
      ray: new THREE.Raycaster(),
      settings: { shake: false },
      audio: { play: noop, noiseHit: noop, clearSpatial: noop },
      events: {
        update: noop,
        hit: noop,
        confirmKill: noop,
        hurt: noop,
        kill: noop,
        banner: noop,
        toast: noop,
      },
      loadout: [...member.loadout],
      slot: 0,
      ammunition: member.loadout.map((id) => ({
        mag: WEAPONS[id].mag,
        reserve: WEAPONS[id].reserve,
      })),
      projectiles: [],
      effects: [],
      fires: [],
      smokes: [],
      config: { mode: 3 },
      range: false,
      state: "playing",
      clock: this.time,
      keys: new Set(),
      yaw: team === 0 ? 0 : Math.PI,
      pitch: 0,
      walkPhase: 0,
      stepDistance: 0,
      stepOffset: 0,
      landingDip: 0,
      jumpBuffer: 0,
      coyoteTime: 0,
      slideBuffer: 0,
      slideTime: 0,
      slideCooldown: 0,
      bowCharge: 0,
      bowRelease: false,
      spinTime: 0,
      healTime: 0,
      blindTime: 0,
      paintTintTime: 0,
      kick: 0,
      flash: 0,
      burstCount: 0,
      burstTimer: 0,
      cooldown: 0,
      reloadTime: 0,
      mouseDown: false,
      trigger: false,
      aiming: false,
      matchStats: member.stats,
      lastAction: member.lastAction || 0,
      lastSeq: -1,
      lastInputAt: this.time,
    });
    for (const key of timers) g[key] = 0;
    const actor = g.createEntity(team, spawn, index, true);
    Object.assign(actor, {
      id: member.id,
      netIndex: member.netIndex,
      name: member.name,
      context: g,
    });
    g.player = actor;
    g.bullet = (shooter, ...args) => {
      if (shooter.context && shooter.context !== g)
        return shooter.context.bullet(shooter, ...args);
      const run = () => Game.prototype.bullet.call(g, shooter, ...args);
      return this.rewinding || args[3] ? run() : this.rewind(g, run);
    };
    g.damage = (
      e,
      amount,
      source,
      head = false,
      origin = source,
      backstab = false,
    ) => this.damage(e, amount, source, head, origin, backstab);
    g.particles = noop;
    g.tracer = (a, b, team, color) =>
      this.emit({
        type: "trace",
        owner: g.player.id,
        a: a.toArray(),
        b: b.toArray(),
        team,
        color,
      });
    g.paintSplat = noop;
    g.eye = (e) =>
      new THREE.Vector3(
        e.x,
        e.y + Math.min(1.66, (e.height || 1.9) - 0.17),
        e.z,
      );
    g.hasLOS = (a, b, includeSmoke = true) => {
      const delta = b.clone().sub(a),
        distance = delta.length();
      if (distance < 0.1) return true;
      g.ray.set(a, delta.normalize());
      g.ray.far = distance;
      const hit = g.ray.intersectObjects(this.world.solidMeshes, false)[0];
      if (hit && hit.distance < distance - 0.1) return false;
      if (includeSmoke) {
        for (const c of this.contexts.values())
          for (const s of c.smokes) {
            const p = new THREE.Line3(a, b).closestPointToPoint(
              s.pos,
              true,
              new THREE.Vector3(),
            );
            if (p.distanceTo(s.pos) < s.radius) return false;
          }
      }
      return true;
    };
    g.equip = (slot) => {
      if (!Number.isInteger(slot) || slot < 0 || slot > 3 || slot === g.slot)
        return;
      Game.prototype.equip.call(g, slot);
    };
    g.showQuickMelee = (id, duration) => {
      g.quickMeleeTime = duration;
      g.quickModelId = id;
    };
    g.clearQuickMelee = () => {
      g.quickMeleeTime = 0;
      g.quickModelId = null;
    };
    const spawnProjectile = Game.prototype.spawnProjectile;
    g.spawnProjectile = (...args) => {
      if (g.projectiles.length >= 32) return;
      spawnProjectile.apply(g, args);
      g.projectiles.at(-1).netId = ++this.projectileId;
    };
    const explode = Game.prototype.explosion;
    g.explosion = (pos, owner, id) => {
      this.emit({
        type: "explosion",
        position: pos.toArray(),
        owner: owner.id,
        weapon: id,
      });
      if (id === "flashbang") {
        for (const e of this.entities) {
          if (!e.alive || e.team === owner.team) continue;
          const distance = g.eye(e).distanceTo(pos);
          if (distance > 18 || !g.hasLOS(pos, g.eye(e), false)) continue;
          const toward = pos.clone().sub(g.eye(e)).normalize(),
            look = new THREE.Vector3(
              -Math.sin(e.context.yaw),
              0,
              -Math.cos(e.context.yaw),
            );
          e.context.blindTime = Math.max(
            e.context.blindTime,
            Math.max(0.25, 1 - distance / 20) *
              (look.dot(toward) > 0.2 ? 3 : 1),
          );
        }
        return;
      }
      const velocityBefore = [owner.vx, owner.vy, owner.vz];
      explode.call(g, pos, owner, id);
      const velocity = [owner.vx, owner.vy, owner.vz];
      if (velocity.some((n, i) => n !== velocityBefore[i]))
        this.emit({
          type: "impulse",
          player: owner.id,
          round: this.round,
          time: this.time,
          velocity,
        });
      for (const zone of [...g.fires, ...g.smokes])
        if (!zone.netId) zone.netId = ++this.zoneId;
    };
    return g;
  }
  newRound() {
    for (const g of this.contexts.values()) {
      for (const p of g.projectiles) {
        this.scene.remove(p.mesh);
        g.disposeVisual(p.mesh);
      }
      for (const e of g.effects) {
        this.scene.remove(e.mesh);
        g.disposeVisual(e.mesh);
      }
    }
    this.contexts.clear();
    this.entities.length = 0;
    this.history.length = 0;
    this.round++;
    this.countdown = ROUND_COUNTDOWN;
    this.roundTime = 90;
    this.phase = "countdown";
    const indexes = [0, 0];
    for (const m of this.room.members.values()) {
      const g = this.context(m, indexes[m.team]++);
      this.contexts.set(m.id, g);
    }
    this.emit({ type: "round", round: this.round });
  }
  input(id, input) {
    const g = this.contexts.get(id);
    if (!g || input.seq <= g.lastSeq) return;
    if (g.selectingLoadout) input = { ...input, paused: true };
    g.lastSeq = input.seq;
    g.lastInputAt = this.time;
    g.yaw = input.yaw;
    g.pitch = input.pitch;
    g.player.yaw = input.yaw;
    g.keys.clear();
    if (!input.paused)
      KEYS.forEach((key, i) => {
        if (input.keys & (1 << i)) g.keys.add(key);
      });
    const fire = !input.paused && input.fire,
      old = g.mouseDown;
    g.mouseDown = fire;
    if (fire && !old) g.trigger = true;
    if (old && !fire && WEAPONS[g.loadout[g.slot]].type === "bow")
      g.bowRelease = true;
    const w = WEAPONS[g.loadout[g.slot]];
    g.aiming = !input.paused && input.aim && w.slot < 2 && g.deflectTime <= 0;
    for (const action of input.actions.sort((a, b) => a.id - b.id)) {
      if (action.id <= g.lastAction) continue;
      g.lastAction = action.id;
      this.room.members.get(id).lastAction = action.id;
      if (this.phase !== "playing" || !g.player.alive || input.paused) continue;
      const currentWeapon = WEAPONS[g.loadout[g.slot]];
      if (action.type === "fire") {
        g.firePulse = true;
        g.trigger = true;
      }
      if (action.type === "release" && currentWeapon.type === "bow")
        g.bowRelease = true;
      if (action.type === "jump") g.jump();
      if (action.type === "slide") g.slide();
      if (action.type === "ability") g.meleeAbility(true);
      if (action.type === "reload") g.reload();
      if (action.type === "secondary") {
        if (currentWeapon.type === "heal") g.beginHeal(true);
        else g.meleeAbility(false);
      }
      if (action.type.startsWith("slot")) g.equip(+action.type.at(-1));
    }
    Object.assign(g.player, {
      deflectTime: g.deflectTime,
      dashTime: g.dashTime,
      quickMeleeTime: g.quickMeleeTime,
    });
  }
  rewind(g, run) {
    if (!this.history.length) return run();
    const target =
      this.time - Math.min(0.18, Math.max(0, g.latency || 0) / 2 + 0.075);
    let a = this.history[0],
      b = this.history.at(-1);
    for (let i = 1; i < this.history.length; i++)
      if (this.history[i].time >= target) {
        a = this.history[i - 1];
        b = this.history[i];
        break;
      }
    const t = Math.max(
        0,
        Math.min(1, (target - a.time) / Math.max(0.001, b.time - a.time)),
      ),
      saved = [];
    for (const e of this.entities) {
      if (e === g.player || !e.alive) continue;
      const old = a.players.find((p) => p.id === e.id),
        next = b.players.find((p) => p.id === e.id);
      if (!old?.alive || !next?.alive) continue;
      saved.push({ entity: e, x: e.x, y: e.y, z: e.z, height: e.height });
      for (const key of ["x", "y", "z", "height"])
        e[key] = old[key] + (next[key] - old[key]) * t;
    }
    this.rewinding = true;
    try {
      return run();
    } finally {
      for (const s of saved)
        Object.assign(s.entity, { x: s.x, y: s.y, z: s.z, height: s.height });
      this.rewinding = false;
    }
  }
  damage(e, amount, source, head = false, origin = source, backstab = false) {
    if (
      this.phase !== "playing" ||
      !e.alive ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      return;
    if (source && source.team === e.team && source !== e) return;
    const applied = Math.min(e.health, amount);
    e.health = Math.max(0, e.health - amount);
    e.context.healTime = 0;
    this.emit({
      type: "damage",
      victim: e.id,
      source: source?.id,
      amount: Math.round(applied * 100) / 100,
      head,
      backstab,
      position: [e.x, e.y, e.z],
    });
    if (e.health <= 0) {
      e.alive = false;
      e.context.mouseDown = e.context.trigger = false;
      e.context.cancelThrow(false);
      e.context.matchStats.deaths++;
      if (source && source !== e && source.team !== e.team) {
        source.context.matchStats.kills++;
      }
      this.emit({
        type: "kill",
        victim: e.name,
        killer: source?.name || "ARENA",
        head,
      });
    }
  }
  step(dt) {
    this.time += dt;
    if (this.phase === "finished") return;
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = "playing";
        this.emit({ type: "fight" });
      }
      return;
    }
    if (this.phase === "roundend") {
      this.endTime -= dt;
      if (this.endTime <= 0) {
        if (Math.max(...this.score) >= 5) {
          this.phase = "finished";
          this.emit({ type: "finished", score: this.score });
        } else this.newRound();
      }
      return;
    }
    for (const g of this.contexts.values()) {
      g.clock = this.time;
      g.state = "playing";
      if (this.time - g.lastInputAt > 0.2) {
        g.keys.clear();
        g.mouseDown = g.trigger = g.aiming = false;
        g.bowRelease = false;
      }
      for (const key of timers) g[key] = Math.max(0, (g[key] || 0) - dt);
      g.updateSupport(dt);
      g.kick = Math.max(0, g.kick - dt * 0.3);
      g.flash = Math.max(0, g.flash - dt);
      const e = g.player;
      if (e.alive) {
        if (e.burnUntil > this.time && (e.burnTick || 0) < this.time) {
          e.burnTick = this.time + 0.25;
          this.damage(e, 2, e.burnOwner);
        }
        if (e.alive) {
          const held = g.mouseDown;
          if (g.firePulse) g.mouseDown = true;
          g.firePulse = false;
          g.updatePlayer(dt);
          g.mouseDown = held;
        }
      }
      g.updateProjectiles(dt);
      g.updateEffects(dt);
      Object.assign(e, {
        deflectTime: g.deflectTime,
        quickMeleeTime: g.quickMeleeTime,
        dashTime: g.dashTime,
        swingTime: g.swingTime,
      });
    }
    this.history.push({
      time: this.time,
      players: this.entities.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        z: e.z,
        height: e.height,
        alive: e.alive,
      })),
    });
    if (this.history.length > 48) this.history.shift();
    this.roundTime -= dt;
    const alive = [0, 1].map(
      (team) => this.entities.filter((e) => e.team === team && e.alive).length,
    );
    if (!alive[0] || !alive[1] || this.roundTime <= 0) {
      const hp = [0, 1].map((team) =>
        this.entities
          .filter((e) => e.team === team)
          .reduce((n, e) => n + e.health, 0),
      );
      const winner = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1;
      if (winner >= 0) this.score[winner]++;
      this.phase = "roundend";
      this.endTime = 3.1;
      this.emit({ type: "roundend", winner, score: [...this.score] });
    }
  }
  snapshot() {
    return {
      matchId: this.matchId,
      time: this.time,
      round: this.round,
      phase: this.phase,
      score: [...this.score],
      countdown: Math.max(0, this.countdown),
      roundTime: Math.max(0, this.roundTime),
      players: this.entities.map((e) => {
        const g = e.context;
        return {
          id: e.id,
          index: e.netIndex,
          name: e.name,
          team: e.team,
          x: e.x,
          y: e.y,
          z: e.z,
          vx: e.vx,
          vy: e.vy,
          vz: e.vz,
          yaw: g.yaw,
          pitch: g.pitch,
          height: e.height,
          grounded: e.grounded,
          health: e.health,
          alive: e.alive,
          weapon: g.loadout[g.slot],
          slot: g.slot,
          loadout: g.loadout,
          ammo: g.ammunition.map((a) => ({
            mag: Number.isFinite(a.mag) ? a.mag : null,
            reserve: Number.isFinite(a.reserve) ? a.reserve : null,
          })),
          lastSeq: g.lastSeq,
          lastAction: g.lastAction,
          slide: g.slideTime,
          dash: g.dashTime,
          deflect: g.deflectTime,
          swing: g.swingTime,
          throw: g.throwTime,
          heal: g.healTime,
          reload: g.reloadTime,
          blind: g.blindTime,
          paint: g.paintTintTime,
          quickMelee: g.quickMeleeTime,
          shot: g.lastShotAt ?? -1,
          dashCooldown: g.dashCooldown,
          deflectCooldown: g.deflectCooldown,
          stats: { ...g.matchStats },
        };
      }),
      projectiles: [...this.contexts.values()].flatMap((g) =>
        g.projectiles.map((p) => ({
          id: p.netId,
          owner: p.owner.id,
          weapon: p.id,
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          rx: p.mesh.rotation.x,
          ry: p.mesh.rotation.y,
          rz: p.mesh.rotation.z,
        })),
      ),
      zones: [...this.contexts.values()].flatMap((g) => [
        ...g.fires.map((f) => ({
          id: f.netId,
          type: "fire",
          x: f.pos.x,
          y: f.pos.y,
          z: f.pos.z,
          life: f.effect.life,
        })),
        ...g.smokes.map((f) => ({
          id: f.netId,
          type: "smoke",
          x: f.pos.x,
          y: f.pos.y,
          z: f.pos.z,
          life: f.effect.life,
        })),
      ]),
      events: this.events.slice(-32),
    };
  }
  remove(id) {
    const g = this.contexts.get(id);
    if (!g) return;
    g.player.alive = false;
    g.player.health = 0;
    this.contexts.delete(id);
    this.entities.splice(this.entities.indexOf(g.player), 1);
    for (const p of g.projectiles) {
      this.scene.remove(p.mesh);
      g.disposeVisual(p.mesh);
    }
    for (const e of g.effects) {
      this.scene.remove(e.mesh);
      g.disposeVisual(e.mesh);
    }
    const remaining = [0, 1].map((team) =>
      [...this.room.members.values()].some((m) => m.team === team),
    );
    if (remaining[0] !== remaining[1] && this.phase !== "finished") {
      const winner = remaining[0] ? 0 : 1;
      this.score[winner] = 5;
      this.phase = "finished";
      this.emit({ type: "forfeit", winner });
    }
  }
  dispose() {
    for (const id of [...this.contexts.keys()]) this.remove(id);
    this.world.dispose();
  }
}
