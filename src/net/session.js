import { updateProjectileTrail } from "../projectile-feedback.js";
import { moveBody, canOccupy, GRAVITY } from "../physics.js";
import * as THREE from "three";
import { createProjectileModel } from "../projectile-model.js";
import { WEAPONS } from "../data.js";
import { SnapshotBuffer, KEYS } from "./protocol.js";
import { createSmokeCloud, animateSmoke } from "../smoke-fx.js";
import { createFirePatch, animateFire, animateThrown } from "../throwables.js";
const v = (a) => new THREE.Vector3().fromArray(a);
export class MultiplayerSession {
  constructor(game, client, map, snapshot) {
    this.game = game;
    this.client = client;
    this.id = client.state.id;
    this.buffer = new SnapshotBuffer();
    this.seq = 0;
    this.actionId = 0;
    this.actions = [];
    this.sendTime = 0;
    this.lastEvent = 0;
    this.round = 0;
    this.lastReceived = performance.now() / 1000;
    this.projectiles = new Map();
    this.zones = new Map();
    this.correction = new THREE.Vector3();
    this.latest = snapshot;
    this.game.network = null;
    const self = snapshot.players.find((p) => p.id === this.id);
    game.start({
      mode: 3,
      capture: false,
      map,
      difficulty: "hard",
      botArsenal: "mixed",
      loadout: self.loadout,
    });
    this.game.network = this;
    client.session = this;
    this.receive(snapshot);
    // Server messages are not user gestures. Capture explicitly with Resume.
    if (document.pointerLockElement !== game.canvas) game.pause();
  }
  build(snapshot) {
    const g = this.game;
    if (this.round) {
      this.clearVisuals();
      g.startRound();
    }
    for (const e of g.entities)
      if (e.model) {
        g.scene.remove(e.model.group);
        g.disposeVisual(e.model.group);
      }
    g.entities = [g.player];
    this.entities = new Map();
    this.round = snapshot.round;
    g.round = snapshot.round;
    g.roundCountdownPrevious = Math.ceil(snapshot.countdown);
    for (const state of snapshot.players) {
      let e;
      if (state.id === this.id) {
        e = g.player;
        g.loadout = [...state.loadout];
        g.ammunition = state.ammo.map((a, i) => ({
          mag: a.mag ?? Infinity,
          reserve: a.reserve ?? Infinity,
        }));
        g.slot = state.slot;
        g.equip(0);
        g.yaw = state.yaw;
        g.pitch = state.pitch;
      } else
        e = g.createEntity(
          state.team,
          { x: state.x, z: state.z },
          0,
          false,
          false,
          state.name,
        );
      Object.assign(e, {
        netId: state.id,
        name: state.name,
        team: state.team,
        x: state.x,
        y: state.y,
        z: state.z,
        vx: state.vx,
        vy: state.vy,
        vz: state.vz,
        yaw: state.yaw,
        health: state.health,
        alive: state.alive,
      });
      if (e.model) {
        e.model.group.position.set(e.x, e.y, e.z);
        e.model.group.rotation.y = e.yaw;
      }
      this.entities.set(state.id, e);
    }
    this.correction.set(0, 0, 0);
    this.buffer.clear();
  }
  receive(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return;
    this.lastReceived = performance.now() / 1000;
    const paused = this.game.state === "paused";
    this.applying = true;
    if (snapshot.round !== this.round) {
      this.build(snapshot);
      if (paused) this.game.state = "paused";
    }
    this.latest = snapshot;
    this.buffer.push(snapshot, this.lastReceived);
    const g = this.game,
      self = snapshot.players.find((p) => p.id === this.id);
    if (!self) {
      this.applying = false;
      return;
    }
    if (
      this.pendingLoadout &&
      self.loadout.every((id, i) => this.pendingLoadout[i] === id)
    )
      this.pendingLoadout = null;
    if (
      !this.pendingLoadout &&
      self.loadout.some((id, i) => g.loadout[i] !== id)
    ) {
      g.loadout = [...self.loadout];
      g.config.loadout = [...self.loadout];
      g.slot = -1;
      g.equip(self.slot);
    }
    const oldPhase = g.state;
    g.score = [...snapshot.score];
    g.roundTime = snapshot.roundTime;
    g.countdown = snapshot.countdown;
    g.roundCountdown = snapshot.countdown;
    for (const [id, e] of this.entities)
      if (!snapshot.players.some((p) => p.id === id)) {
        e.alive = false;
        e.health = 0;
        e.disconnected = true;
      }
    if (snapshot.phase === "finished") {
      if (g.state !== "results") g.finish();
      this.applying = false;
      return;
    }
    if (g.state === "paused") g.previousState = snapshot.phase;
    else g.state = snapshot.phase;
    if (snapshot.phase === "countdown") {
      g.player.x = self.x;
      g.player.y = self.y;
      g.player.z = self.z;
      g.player.vx = g.player.vy = g.player.vz = 0;
      const count = Math.ceil(snapshot.countdown);
      if (count !== g.roundCountdownPrevious) {
        g.roundCountdownPrevious = count;
        if (count > 0) {
          g.audio.play("select");
          g.events.banner(
            "ROUND " + snapshot.round,
            String(count),
            "M to change weapons · First to 5.",
            0,
          );
        }
      }
    }
    if (oldPhase === "countdown" && g.state === "playing") {
      g.events.banner("ROUND " + snapshot.round, "FIGHT.", "", 0.65);
      g.audio.play("start");
    }
    const wasAlive = g.player.alive;
    g.player.health = self.health;
    g.player.alive = self.alive;
    g.matchStats = { ...self.stats };
    g.blindTime = self.blind;
    g.paintTintTime = self.paint || 0;
    g.dashCooldown = self.dashCooldown;
    g.deflectCooldown = self.deflectCooldown;
    // Ammo follows acknowledged actions; prediction never grants damage or inventory.
    if (
      !this.pendingLoadout &&
      this.actions.every((a) => a.id <= self.lastAction)
    ) {
      g.ammunition = self.ammo.map((a) => ({
        mag: a.mag ?? Infinity,
        reserve: a.reserve ?? Infinity,
      }));
      if (g.slot !== self.slot) {
        g.equip(self.slot);
      }
      g.reloadTime = self.reload;
      g.reloadTotal = WEAPONS[g.loadout[g.slot]].reload;
      g.healTime = self.heal;
      if (self.alive && self.quickUtility > 0) {
        if (g.quickModelId !== g.loadout[3] && g.slot !== 3)
          g.showQuickAction(g.loadout[3], self.quickUtility, true);
        g.quickUtilityTime = self.quickUtility;
        g.throwTime = self.throw;
        g.throwReleased = self.throw > 0 && self.throw <= 0.32;
      } else if (
        g.quickUtilityTime > 0 ||
        WEAPONS[g.quickModelId]?.slot === 3
      ) {
        g.cancelThrow(false);
        g.clearQuickMelee();
      }
      g.deflectTime = self.deflect;
    }
    this.actions = this.actions.filter((a) => a.id > self.lastAction);
    if (!self.alive && wasAlive) {
      g.mouseDown = g.trigger = false;
      g.clearQuickMelee();
      g.cancelThrow(false);
      g.playerMeleePending = null;
      g.killer = g.entities.find((e) => e.alive && e.team !== g.player.team);
      g.audio.play("death");
    }
    if (snapshot.phase === "playing" && self.alive) {
      const lead = Math.min(0.08, this.client.rtt / 2000 + 0.015),
        target = new THREE.Vector3(
          self.x + self.vx * lead,
          self.y,
          self.z + self.vz * lead,
        );
      if (!self.grounded) target.y += self.vy * lead;
      this.correction
        .copy(target)
        .sub(new THREE.Vector3(g.player.x, g.player.y, g.player.z));
      if (this.correction.length() > 4) {
        Object.assign(g.player, {
          x: self.x,
          y: self.y,
          z: self.z,
          vx: self.vx,
          vy: self.vy,
          vz: self.vz,
          grounded: self.grounded,
        });
        this.correction.set(0, 0, 0);
      }
    }
    for (const state of snapshot.players) {
      if (state.id === this.id) continue;
      const e = this.entities.get(state.id);
      if (!e) continue;
      const before = e.health;
      Object.assign(e, {
        health: state.health,
        alive: state.alive,
        activeWeapon: state.weapon,
        shotSide: state.shotSide || 0,
        deflectTime: state.deflect,
        quickMeleeTime: state.quickMelee || 0,
        quickUtilityTime: state.quickUtility || 0,
        utilityId: state.loadout[3],
        utilityAmmo: state.ammo[3].mag ?? Infinity,
        throwTime: state.throw,
        healTime: state.heal,
        dashTime: state.dash,
        swingTime: state.swing,
        aiming: !!state.aiming,
        reload: state.reload,
        knifeStab: !!state.knifeStab,
      });
      if (state.shot > 0 && state.shot !== (e.netShot || 0)) {
        e.netShot = state.shot;
        e.netShotAge = Math.max(0, snapshot.time - state.shot);
        e.fireFlash = 0.065;
        const w = WEAPONS[state.weapon];
        g.audio.playAt(
          w.sound,
          g.eye(e),
          g.eye(g.player),
          g.yaw,
          w.type === "flame" ? 0.25 : 0.55,
          !g.hasLOS(g.eye(e), g.eye(g.player), false),
        );
        if (w.type === "flame") {
          const dir = new THREE.Vector3(
            -Math.sin(state.yaw) * Math.cos(state.pitch),
            Math.sin(state.pitch),
            -Math.cos(state.yaw) * Math.cos(state.pitch),
          );
          g.flameFX?.emit(
            new THREE.Vector3(state.x, state.y + 1.3, state.z).addScaledVector(
              dir,
              0.65,
            ),
            dir,
            g.world.solidMeshes,
            10,
            e.netId,
          );
        }
      }
      if (before > 0 && !e.alive) {
        e.deathTime = 0;
        e.deathDir = {
          x: (e.x - g.player.x) * 0.1,
          z: (e.z - g.player.z) * 0.1,
        };
      }
    }
    this.processEvents(snapshot.events || []);
    this.syncProjectiles(snapshot.projectiles);
    this.syncZones(snapshot.zones);
    this.applying = false;
  }
  processEvents(events) {
    const g = this.game;
    for (const event of events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === "trace" && event.owner !== this.id)
        g.tracer(v(event.a), v(event.b), event.team, event.color);
      if (event.type === "damage") {
        const victim = this.entities.get(event.victim);
        if (event.source === this.id && victim) {
          g.events.hit(event.head);
          g.audio.play(event.head ? "head" : "hit");
          if (event.backstab) g.backstabTime = 0.26;
          g.damageNumbers?.add(
            victim,
            event.amount,
            event.head,
            g.clock,
            event.backstab,
          );
          if (!victim.alive) g.events.confirmKill?.();
        }
        if (event.victim === this.id) {
          g.hurtTime = 0.25;
          g.events.hurt(
            this.entities.get(event.source) || {
              x: g.player.x,
              y: g.player.y,
              z: g.player.z - 1,
            },
            event.amount,
          );
        }
      }
      if (
        event.type === "impulse" &&
        event.player === this.id &&
        event.round === this.round &&
        g.player.alive
      ) {
        const age = Math.min(
          0.2,
          Math.max(
            0,
            (this.latest?.time ?? event.time) -
              event.time +
              (this.client.rtt || 0) / 2000,
          ),
        );
        [g.player.vx, g.player.vy, g.player.vz] = event.velocity;
        g.player.vy -= GRAVITY * age;
        g.player.grounded = false;
      }
      if (event.type === "forfeit")
        g.events.toast("Opponent disconnected. Match won by forfeit.");
      if (event.type === "kill") {
        g.events.kill(event.killer, event.victim, event.head);
        if (event.killer === g.player.name) g.events.confirmKill(event.head);
      }
      if (event.type === "roundend") {
        const win = event.winner === g.player.team;
        g.events.banner(
          event.winner < 0 ? "DRAW" : win ? "ROUND WON" : "ROUND LOST",
          event.winner < 0 ? "NO POINTS." : win ? "NICE WORK." : "GO AGAIN.",
          `FIRST TO 5 · ${g.score[0]} — ${g.score[1]}`,
          0,
        );
      }
      if (event.type === "bounce") {
        g.audio.playAt(
          "bounce",
          v(event.position),
          g.eye(g.player),
          g.yaw,
          0.45,
        );
      }
      if (event.type === "explosion") {
        const w = event.weapon;
        if (w !== "molotov" && w !== "smoke") {
          g.particles(
            v(event.position),
            w === "flashbang" ? 0xf3f6e9 : 0xffaf5b,
            22,
          );
        }
        g.audio.playAt(
          w === "flashbang" ? "flash" : "explosion",
          v(event.position),
          g.eye(g.player),
          g.yaw,
          0.65,
        );
      }
    }
  }
  action(type) {
    if (this.game.state === "results") return;
    this.actions.push({ id: ++this.actionId, type });
    if (this.actions.length > 12) this.actions.shift();
    this.sendInput();
  }
  beginSelection() {
    this.client.send({ type: "selection", selecting: true });
  }
  finishSelection(loadout) {
    if (loadout) {
      this.pendingLoadout = [...loadout];
      this.client.send({ type: "loadout", loadout });
    } else this.client.send({ type: "selection", selecting: false });
  }
  keyAction(key) {
    const action = {
      Space: "jump",
      ShiftLeft: "slide",
      ShiftRight: "slide",
      KeyC: "slide",
      KeyF: "ability",
      KeyG: "utility",
      KeyR: "reload",
    }[key];
    if (action) this.action(action);
  }
  secondary() {
    this.action("secondary");
  }
  sendInput() {
    const g = this.game;
    if (!g.player) return;
    const keys = KEYS.reduce(
      (bits, key, i) => bits | (g.keys.has(key) ? 1 << i : 0),
      0,
    );
    this.client.send({
      type: "input",
      input: {
        seq: ++this.seq,
        yaw: g.yaw,
        pitch: g.pitch,
        keys,
        fire: g.mouseDown,
        aim: g.aiming,
        paused:
          g.state === "paused" ||
          document.pointerLockElement !== g.canvas ||
          !g.player.alive ||
          g.selectingLoadout,
        actions: this.actions,
      },
    });
  }
  step(dt) {
    const g = this.game;
    g.updateSupport(dt);
    for (const key of [
      "deflectTime",
      "deflectCooldown",
      "swingTime",
      "backstabTime",
      "dashTime",
      "inspectTime",
      "throwTime",
      "guardFlash",
      "switchTime",
    ])
      g[key] = Math.max(0, (g[key] || 0) - dt);
    if (g.quickMeleeTime > 0) {
      g.quickMeleeTime -= dt;
      if (g.quickMeleeTime <= 0) g.clearQuickMelee();
    }
    g.kick = Math.max(0, g.kick - dt * 0.3);
    g.flash = Math.max(0, g.flash - dt);
    this.sendTime += dt;
    if (this.sendTime >= 1 / 30) {
      this.sendTime %= 1 / 30;
      this.sendInput();
    }
    if (g.state === "playing" && g.player.alive && !g.selectingLoadout) {
      g.updatePlayer(dt);
      const factor = 1 - Math.exp(-dt * 9);
      const cx = this.correction.x * factor,
        cz = this.correction.z * factor;
      moveBody(g.player, cx, cz, g.world.boxes);
      this.correction.x -= cx;
      this.correction.z -= cz;
      if (Math.abs(this.correction.y) > 0.015 && !g.player.jumps) {
        const dy = this.correction.y * factor;
        if (
          canOccupy(
            g.player,
            g.player.x,
            g.player.y + dy,
            g.player.z,
            g.world.boxes,
          )
        ) {
          g.player.y += dy;
          this.correction.y -= dy;
        }
      }
    }
    if (g.state === "roundend" && g.player.alive) g.player.vx = g.player.vz = 0;
    const remote = this.buffer.sample(performance.now() / 1000);
    for (const state of remote || []) {
      if (state.id === this.id) continue;
      const e = this.entities.get(state.id);
      if (!e) continue;
      Object.assign(e, {
        x: state.x,
        y: state.y,
        z: state.z,
        yaw: state.yaw,
        pitch: state.pitch,
        vx: state.vx,
        vy: state.vy,
        vz: state.vz,
        height: state.height,
      });
      if (e.alive) {
        const model = e.model.group;
        model.position.set(e.x, e.y, e.z);
        model.rotation.y = e.yaw;
        e.fireFlash = Math.max(0, (e.fireFlash || 0) - dt);
        e.netShotAge = (e.netShotAge ?? 10) + dt;
        e.grounded = state.grounded;
        e.sliding = state.slide;
        e.meleeId = state.loadout[2];
        e.lastShotAt = e.fireFlash > 0 ? g.clock : e.lastShotAt;
        g.animateBot(e, dt);
        if (e.activeWeapon === "flame") {
          const dir = new THREE.Vector3(
            -Math.sin(e.yaw) * Math.cos(e.pitch),
            Math.sin(e.pitch),
            -Math.cos(e.yaw) * Math.cos(e.pitch),
          );
          const eye = g.eye(e);
          g.flameFX?.track(
            e.netId,
            eye.clone().addScaledVector(dir, 0.65),
            dir,
            g.world.solidMeshes,
            eye,
          );
        }
      } else g.animateDeath(e, dt);
    }
    for (const p of this.projectiles.values()) {
      const t = 1 - Math.exp(-dt * 28);
      p.mesh.position.lerp(p.target, t);
      p.mesh.rotation.set(p.rx, p.ry, p.rz);
      animateThrown(p, dt, g.clock);
      updateProjectileTrail(p, g.combatFX, dt);
      if (p.mesh.userData.exhaust)
        p.mesh.userData.exhaust.scale.set(
          1 + Math.sin(g.clock * 90) * 0.12,
          1,
          1 + Math.cos(g.clock * 90) * 0.12,
        );
    }
    for (const zone of this.zones.values()) {
      if (zone.type === "fire") animateFire(zone.mesh, g.clock, zone.life);
      else
        animateSmoke(zone.mesh, g.clock, zone.life, 7, g.settings.performance);
    }
    g.updateEffects(dt);
    g.combatFX?.update(dt, g.world.boxes);
    g.flameFX?.update(dt);
  }
  syncProjectiles(items = []) {
    const seen = new Set();
    for (const p of items) {
      seen.add(p.id);
      let entry = this.projectiles.get(p.id);
      if (!entry) {
        const mesh = createProjectileModel(p.weapon);
        mesh.position.set(p.x, p.y, p.z);
        gAdd(this.game, mesh);
        entry = {
          mesh,
          target: new THREE.Vector3(),
          weapon: p.weapon,
          trailFrom: mesh.position.clone(),
          trailTime: 0,
          rx: p.rx,
          ry: p.ry,
          rz: p.rz,
        };
        this.projectiles.set(p.id, entry);
      }
      entry.target.set(p.x, p.y, p.z);
      Object.assign(entry, { rx: p.rx, ry: p.ry, rz: p.rz });
    }
    for (const [id, p] of this.projectiles)
      if (!seen.has(id)) {
        p.mesh.removeFromParent();
        this.game.disposeVisual(p.mesh);
        this.projectiles.delete(id);
      }
  }
  syncZones(items = []) {
    const seen = new Set();
    for (const state of items) {
      seen.add(state.id);
      let zone = this.zones.get(state.id);
      if (!zone) {
        const mesh =
          state.type === "fire" ? createFirePatch() : createSmokeCloud();
        mesh.position.set(state.x, state.y, state.z);
        gAdd(this.game, mesh);
        zone = { mesh, type: state.type, life: state.life };
        this.zones.set(state.id, zone);
      }
      zone.life = state.life;
    }
    for (const [id, zone] of this.zones)
      if (!seen.has(id)) {
        zone.mesh.removeFromParent();
        this.game.disposeVisual(zone.mesh);
        this.zones.delete(id);
      }
    this.game.smokes = [...this.zones.values()]
      .filter((z) => z.type === "smoke")
      .map((z) => ({
        pos: z.mesh.position,
        radius: 4.5,
        effect: { life: z.life },
      }));
  }
  clearVisuals() {
    for (const p of [...this.projectiles.values(), ...this.zones.values()]) {
      p.mesh.removeFromParent();
      this.game.disposeVisual(p.mesh);
    }
    this.projectiles.clear();
    this.zones.clear();
  }
  returnToLobby() {
    if (this.client.state.room?.host === this.id)
      this.client.send({ type: "return" });
    this.client.stopSession(true);
  }
  leave() {
    this.client.send({ type: "leave" });
    this.dispose();
    this.client.session = null;
  }
  dispose() {
    this.clearVisuals();
    this.game.network = null;
    this.game.mouseDown = this.game.trigger = false;
    this.game.keys.clear();
    this.actions.length = 0;
  }
}
function gAdd(game, mesh) {
  game.scene.add(mesh);
}
