import { receiveGloveState } from "../gloves/states.js";
import { createBrickModel } from "../gloves/brick.js";
import { isGlove } from "../gloves/catalog.js";
import { progression } from "../gloves/progression.js";
import { presentImpact } from "../gloves/combat.js";
import { isDisposableEffect } from "./realtime-delivery.js";
import { PredictionHistory } from "./prediction-history.js";
import { updateProjectileTrail } from "../projectile-feedback.js";
import { moveBody, canOccupy, GRAVITY } from "../physics.js";
import * as THREE from "three";
import { createProjectileModel } from "../projectile-model.js";
import { COMBAT_ITEMS as WEAPONS } from "../data.js";
import { SnapshotBuffer, KEYS } from "./protocol.js";
import { createSmokeCloud, animateSmoke } from "../smoke-fx.js";
import { createFirePatch, animateFire, animateThrown } from "../throwables.js";
const v = (a) => new THREE.Vector3().fromArray(a);
export class MultiplayerSession {
  constructor(game, client, map, snapshot) {
    this.game = game;
    this.client = client;
    this.id = client.state.id;
    this.buffer = new SnapshotBuffer(client.mode === "peer" ? 0.06 : 0.075, {
      adaptive: client.mode === "peer",
    });
    this.prediction = new PredictionHistory();
    this.seq = 0;
    this.actionId = 0;
    this.actions = [];
    this.sendTime = 0;
    this.lastEvent = 0;
    this.effectIds = new Set();
    this.predictedShots = [];
    this.feedbackReadyAt = 0;
    this.feedbackReadyByWeapon = {};
    this.lastSelfShot = -1;
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
      online: true,
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
        this.predictedShots = [];
        this.lastSelfShot = state.shot ?? -1;
        this.lastSelfShotCount = state.stats?.shots;
        this.feedbackReadyAt = 0;
        this.feedbackReadyByWeapon = {};
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
    this.prediction?.clear();
    this.buffer.clear();
  }
  receive(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return;
    if (this.round && snapshot.time <= (this.latest?.time ?? -Infinity)) return;
    const phaseChanged =
      this.authoritativePhase !== snapshot.phase ||
      this.authoritativeRound !== snapshot.round;
    this.authoritativePhase = snapshot.phase;
    this.authoritativeRound = snapshot.round;
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
    this.confirmShot(self, snapshot);
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
    // Settle the final confirmed slap before finish() snapshots match results.
    g.matchStats = { ...self.stats };
    if (isGlove(self.weapon)) {
      const count = Math.max(0, self.stats?.slaps ?? self.stats?.hits ?? 0);
      for (let hit = this.earnedHits || 0; hit < count; hit++)
        progression.award(`online:${snapshot.matchId}:${this.id}:${hit}`);
      this.earnedHits = Math.max(this.earnedHits || 0, count);
      receiveGloveState(g.player, self);
      g.player.ragdollTime = self.dash || 0;
      g.player.stoneTime = self.deflect || 0;
      g.player.chillTime = self.heal || 0;
      g.player.abilityCooldown = self.dashCooldown || 0;
      g.player.boostTime = self.throw || 0;
      // Restore lost impulse state from snapshots as well as the reliable hit event.
      if (self.dash > 0 || self.throw > 0 || self.quickMelee > 0) {
        g.player.vx = self.vx;
        g.player.vy = self.vy;
        g.player.vz = self.vz;
        g.player.grounded = self.grounded;
      }
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
    if (phaseChanged && snapshot.phase === "playing") {
      g.events.banner("ROUND " + snapshot.round, "FIGHT.", "", 0.65);
      g.audio.play("start");
    }
    const wasAlive = g.player.alive;
    g.player.health = self.health;
    g.player.alive = self.alive;
    g.blindTime = isGlove(self.weapon) ? 0 : self.blind;
    g.paintTintTime = isGlove(self.weapon) ? 0 : self.paint || 0;
    g.dashCooldown = self.dashCooldown;
    g.deflectCooldown = isGlove(self.weapon) ? 0 : self.deflectCooldown;
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
      g.reloadTime = isGlove(self.weapon) ? 0 : self.reload;
      g.reloadTotal = WEAPONS[g.loadout[g.slot]].reload;
      g.healTime = isGlove(self.weapon) ? 0 : self.heal;
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
      g.deflectTime = isGlove(self.weapon) ? 0 : self.deflect;
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
      const error = this.prediction?.error(self, snapshot.time);
      if (error) {
        this.correction.set(error.x, error.y, error.z);
        if (this.correction.length() > 3) {
          const x = g.player.x + error.x,
            y = g.player.y + error.y,
            z = g.player.z + error.z;
          if (canOccupy(g.player, x, y, z, g.world.boxes)) {
            g.player.x = x;
            g.player.y = y;
            g.player.z = z;
            this.prediction.applied(error.x, error.y, error.z);
          } else {
            Object.assign(g.player, {
              x: self.x,
              y: self.y,
              z: self.z,
              vx: self.vx,
              vy: self.vy,
              vz: self.vz,
              grounded: self.grounded,
            });
            this.prediction.clear();
          }
          g.renderPrevious = { x: g.player.x, y: g.player.y, z: g.player.z };
          this.correction.set(0, 0, 0);
        }
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
        deflectTime: isGlove(state.weapon) ? 0 : state.deflect,
        ragdollTime: isGlove(state.weapon) ? state.dash : 0,
        stoneTime: isGlove(state.weapon) ? state.deflect : 0,
        chillTime: isGlove(state.weapon) ? state.heal : 0,
        quickMeleeTime: isGlove(state.weapon) ? 0 : state.quickMelee || 0,
        quickUtilityTime: state.quickUtility || 0,
        utilityId: state.loadout[3],
        utilityAmmo: state.ammo[3].mag ?? Infinity,
        throwTime: isGlove(state.weapon) ? 0 : state.throw,
        healTime: isGlove(state.weapon) ? 0 : state.heal,
        dashTime: isGlove(state.weapon) ? 0 : state.dash,
        swingTime: state.swing,
        aiming: !!state.aiming,
        reload: isGlove(state.weapon) ? 0 : state.reload,
        knifeStab: !!state.knifeStab,
      });
      if (isGlove(state.weapon)) receiveGloveState(e, state);
      if (state.shot > 0 && state.shot !== (e.netShot || 0)) {
        e.netShot = state.shot;
        e.netShotAge = Math.max(0, snapshot.time - state.shot);
        e.fireFlash = 0.065;
        const w = WEAPONS[state.weapon];
        g.audio.playAt(
          w.glove ? "slapSwing" : w.sound,
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
    if (g.state === "paused") g.events.update(g);
    this.applying = false;
  }
  processEvents(events) {
    const g = this.game;
    for (const event of events) {
      if (!Number.isSafeInteger(event?.id) || event.id < 1) continue;
      if (isDisposableEffect(event)) {
        // Cosmetic and critical IDs share an authority counter, NOT an arrival
        // order. A fast trace must never suppress a delayed hit or launch.
        this.effectIds ||= new Set();
        if (this.effectIds.has(event.id)) continue;
        this.effectIds.add(event.id);
        if (this.effectIds.size > 256)
          this.effectIds.delete(this.effectIds.values().next().value);
      } else {
        if (event.id <= this.lastEvent) continue;
        this.lastEvent = event.id;
      }
      if (event.type === "gloveHit" && event.round === this.round) {
        presentImpact(
          g,
          event,
          this.entities.get(event.source),
          this.entities.get(event.victim),
        );
      }
      if (event.type === "gloveAbility" && event.round === this.round) {
        g.audio.play(
          event.glove === "glove_default" ? "slapBlast" : "slapAbility",
        );
        if (
          event.player === this.id &&
          ["glove_acrobat", "glove_magnet", "glove_space"].includes(event.glove)
        ) {
          if (event.velocity)
            [g.player.vx, g.player.vy, g.player.vz] = event.velocity;
          g.player.boostTime = event.boost || 0;
          if (event.glove === "glove_space") {
            g.player.spaceTime = 2.6;
            g.player.grounded = false;
          }
        }
        if (event.player === this.id && event.glove === "glove_default") {
          g.player.boostTime = 1.35;
          g.player.chillTime = 0;
          if (event.velocity)
            [g.player.vx, g.player.vy, g.player.vz] = event.velocity;
        }
        g.combatFX?.burst(
          v(event.position),
          new THREE.Color(WEAPONS[event.glove].color).getHex(),
          16,
        );
        const destination =
          event.player === this.id
            ? event.destination
            : event.target === this.id
              ? event.targetDestination
              : null;
        if (destination) {
          [g.player.x, g.player.y, g.player.z] = destination;
          g.player.vx = g.player.vy = g.player.vz = 0;
          this.correction.set(0, 0, 0);
          this.prediction.clear();
        }
      }
      if (event.type === "trace") {
        const origin =
          event.owner === this.id
            ? g.visualMuzzle(g.player, v(event.a))
            : v(event.a);
        g.tracer(origin, v(event.b), event.team, event.color);
      }
      if (event.type === "impact")
        g.combatFX?.impact(v(event.position), v(event.normal));
      if (event.type === "damage") {
        const victim = this.entities.get(event.victim);
        if (victim?.model) {
          const source = this.entities.get(event.source);
          victim.hitReact = 0.22;
          victim.hitDirection = source
            ? Math.atan2(victim.x - source.x, victim.z - source.z)
            : 0;
          g.particles(
            new THREE.Vector3(
              victim.x,
              victim.y +
                (event.head ? victim.height - 0.2 : victim.height * 0.6),
              victim.z,
            ),
            event.head ? 0xffdf9a : 0xffc79c,
            6,
          );
        }
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
        g.player.vy -= GRAVITY * (g.player.spaceTime > 0 ? 0.28 : 1) * age;
        g.player.grounded = false;
      }
      if (event.type === "forfeit")
        g.events.toast("Opponent disconnected. Match won by forfeit.");
      if (event.type === "kill") {
        g.events.kill(event.killer, event.victim, event.head);
        if (
          event.source === this.id ||
          (!event.source && event.killer === g.player.name)
        ) {
          g.events.confirmKill(event.head);
          g.audio.play("kill");
        }
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
  predictShot() {
    const g = this.game,
      id = g.loadout[g.slot],
      w = WEAPONS[id];
    const self = this.latest?.players.find((p) => p.id === this.id);
    this.feedbackReadyByWeapon ||= {};
    this.predictedShots = this.predictedShots.filter(
      (p) => g.clock - p.time < 1,
    );
    if (
      !self ||
      !w ||
      w.glove ||
      w.slot > 1 ||
      w.type === "bow" ||
      g.state !== "playing" ||
      !g.player.alive ||
      g.selectingLoadout ||
      g.slot !== self.slot ||
      g.reloadTime > 0 ||
      g.switchTime > 0 ||
      g.quickMeleeTime > 0 ||
      g.quickUtilityTime > 0 ||
      g.healTime > 0 ||
      g.pendingThrow ||
      g.deflectTime > 0 ||
      (w.spin && g.spinTime < 0.55) ||
      g.clock < (this.feedbackReadyByWeapon[id] || 0) ||
      performance.now() / 1000 - this.lastReceived > 0.4 ||
      this.predictedShots.length >= 8 ||
      this.predictedShots.filter((p) => p.weapon === id).length >=
        (self.ammo[g.slot].mag ?? Infinity)
    )
      return false;
    this.predictedShots.push({ weapon: id, time: g.clock });
    this.feedbackReadyAt = this.feedbackReadyByWeapon[id] =
      g.clock + w.interval;
    g.presentShot(id);
    return true;
  }
  confirmShot(self, snapshot) {
    const count = self.stats?.shots;
    const confirmed =
      Number.isFinite(count) && Number.isFinite(this.lastSelfShotCount)
        ? Math.max(0, count - this.lastSelfShotCount)
        : 1;
    this.lastSelfShotCount = count;
    if (!(self.shot >= 0) || self.shot === this.lastSelfShot) return;
    this.lastSelfShot = self.shot;
    if (isGlove(self.weapon)) {
      if (this.game.clock - (this.game.lastSlapAt ?? -10) > 0.4)
        this.game.presentShot(
          self.weapon,
          Math.max(0, snapshot.time - self.shot),
        );
      return;
    }
    const g = this.game,
      id = self.weapon;
    // A snapshot can confirm several shots after loss/coalescing. Retiring just
    // one left phantom pending shots, eventually silencing automatic feedback.
    // With counters, consume across weapon switches in firing order as well.
    let matched = 0;
    for (let n = 0; n < confirmed; n++) {
      const index = this.predictedShots.findIndex(
        (p) =>
          (Number.isFinite(count) || p.weapon === id) && g.clock - p.time < 1,
      );
      if (index < 0) break;
      this.predictedShots.splice(index, 1);
      matched++;
    }
    if (
      !matched &&
      confirmed > 0 &&
      WEAPONS[id]?.slot < 2 &&
      g.loadout[g.slot] === id &&
      snapshot.time - self.shot < 0.3
    ) {
      g.presentShot(
        id,
        Math.min(0.035, Math.max(0, snapshot.time - self.shot)),
      );
      this.feedbackReadyByWeapon ||= {};
      this.feedbackReadyAt = this.feedbackReadyByWeapon[id] = Math.max(
        this.feedbackReadyByWeapon[id] || 0,
        g.clock + WEAPONS[id].interval - Math.max(0, snapshot.time - self.shot),
      );
    }
  }
  action(type) {
    if (this.game.state === "results") return;
    if (type === "fire") this.predictShot();
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
    this.inputDue = false;
    const keys = KEYS.reduce(
      (bits, key, i) => bits | (g.keys.has(key) ? 1 << i : 0),
      0,
    );
    const seq = ++this.seq;
    this.prediction?.sent(seq, g.clock, g.player);
    this.client.send({
      type: "input",
      input: {
        seq,
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
    this.client.connection?.checkState?.();
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
    const heldWeapon = WEAPONS[g.loadout[g.slot]];
    if (g.mouseDown && ["auto", "flame"].includes(heldWeapon.type))
      this.predictShot();
    if (g.state === "playing" && g.player.alive && !g.selectingLoadout) {
      g.updatePlayer(dt);
      const factor = 1 - Math.exp(-dt * 9);
      const cx = this.correction.x * factor,
        cz = this.correction.z * factor;
      const beforeX = g.player.x,
        beforeZ = g.player.z;
      moveBody(g.player, cx, cz, g.world.boxes);
      this.prediction?.applied(g.player.x - beforeX, 0, g.player.z - beforeZ);
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
          this.prediction?.applied(0, dy, 0);
          this.correction.y -= dy;
        }
      }
    }
    this.prediction?.record(g.clock, g.player);
    this.sendTime += dt;
    if (this.sendTime >= 1 / 60) {
      this.sendTime %= 1 / 60;
      this.inputDue = true;
    }

    if (g.state === "roundend" && g.player.alive) g.player.vx = g.player.vz = 0;
  }
  present(dt) {
    // Catch-up physics cannot produce new user input between render frames.
    // Transmit the freshest held state once, not a burst of stale intermediates.
    if (this.inputDue) {
      this.inputDue = false;
      this.sendInput();
    }
    const g = this.game;
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
        ragdollTime: isGlove(state.weapon) ? state.dash : 0,
        stoneTime: isGlove(state.weapon) ? state.deflect : 0,
      });
      if (isGlove(state.weapon)) receiveGloveState(e, state);
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
      else if (zone.type === "smoke")
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
          state.type === "fire"
            ? createFirePatch()
            : state.type === "brick"
              ? createBrickModel()
              : createSmokeCloud();
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
