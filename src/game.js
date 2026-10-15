import { ArenaRenderer } from "./rendering.js";
import { WeaponAnimator } from "./animation.js";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ArenaWorld, createCharacter, createViewModel } from "./world.js";
import { WEAPONS, DIFFICULTIES, MAPS } from "./data.js";
import { MOVEMENT, accelerate, steerSlide } from "./movement.js";
import { clamp, moveBody, verticalStep, canOccupy } from "./physics.js";
import { MouseLook } from "./input.js";
import { GameAudio } from "./audio.js";
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const botNames = ["VEX", "NOVA", "GHOST", "ACE", "ECHO", "BLITZ"];
export class Game {
  constructor(canvas, settings, events) {
    this.canvas = canvas;
    this.settings = settings;
    this.events = events;
    this.audio = new GameAudio();
    this.audio.volume = settings.volume / 100;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, settings.performance ? 1 : 1.75),
    );
    this.renderer.shadowMap.enabled = !settings.performance;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentMap = pmrem.fromScene(room, 0.035, 0.1, 100, { size: 128 });
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = 0.38;
    room.dispose();
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(
      settings.fov,
      innerWidth / innerHeight,
      0.08,
      180,
    );
    this.camera.rotation.order = "YXZ";
    this.scene.add(new THREE.HemisphereLight(0xddeaf5, 0x515f6a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff3e6, 2.6);
    sun.position.set(-20, 38, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -35,
      right: 35,
      top: 35,
      bottom: -35,
      near: 1,
      far: 100,
    });
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2.5;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
    this.world = new ArenaWorld(this.scene);
    this.world.build();
    this.weaponScene = new THREE.Scene();
    this.weaponScene.environment = this.environmentMap.texture;
    this.weaponScene.environmentIntensity = 0.8;
    this.weaponScene.add(new THREE.HemisphereLight(0xe6eff6, 0x424e5b, 1.15));
    const wl = new THREE.DirectionalLight(0xffebd5, 2.8);
    wl.position.set(-2, 3, 1);
    this.weaponScene.add(wl);
    const rim = new THREE.DirectionalLight(0xbadbf2, 1.4);
    rim.position.set(-3, 2, -3);
    this.weaponScene.add(rim);
    this.weaponCamera = new THREE.PerspectiveCamera(
      70,
      innerWidth / innerHeight,
      0.01,
      10,
    );
    this.state = "lobby";
    this.previousState = "lobby";
    this.keys = new Set();
    this.mouseDown = false;
    this.aiming = false;
    this.yaw = 0;
    this.pitch = 0;
    this.entities = [];
    this.effects = [];
    this.projectiles = [];
    this.smokes = [];
    this.fires = [];
    this.clock = 0;
    this.cooldown = 0;
    this.reloadTime = 0;
    this.slot = 0;
    this.frameCount = 0;
    this.fpsTime = 0;
    this.ray = new THREE.Raycaster();
    this.loadout = ["rifle", "pistol", "fists", "grenade"];
    this.flash = 0;
    this.kick = 0;
    this.burstCount = 0;
    this.player = null;
    this.score = [0, 0];
    this.matchStats = { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 };
    this.presentation = new ArenaRenderer(this.renderer);
    this.mouseLook = new MouseLook();
    this.weaponAnimator = new WeaponAnimator();
    this.lookSway = { x: 0, y: 0 };
    this.bindInputs();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.accumulator = 0;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
  bindInputs() {
    document.addEventListener("pointerlockchange", () => {
      if (
        document.pointerLockElement !== this.canvas &&
        ["playing", "countdown", "roundend"].includes(this.state)
      ) {
        this.pause();
      } else if (document.pointerLockElement === this.canvas) {
        this.captureTime = performance.now();
        this.mouseLook.reset(this.captureTime);
        this.keys.clear();
        if (this.state === "paused") {
          this.state = this.previousState;
          this.events.pause(false);
        }
      }
    });
    document.addEventListener("pointerlockerror", () => {
      this.events.toast(
        "Mouse capture unavailable. Click “Back to the arena” to try again.",
      );
      if (this.state !== "lobby") this.pause();
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === this.canvas && this.player?.alive) {
        const movement = this.mouseLook.accept(
          e.movementX,
          e.movementY,
          performance.now(),
        );
        if (!movement) return;
        const sens =
          0.002 * this.settings.sensitivity * (this.aiming ? 0.6 : 1);
        this.lookSway ||= { x: 0, y: 0 };
        this.lookSway.x = clamp(
          this.lookSway.x + movement.x * 0.00012,
          -0.018,
          0.018,
        );
        this.lookSway.y = clamp(
          this.lookSway.y + movement.y * 0.0001,
          -0.014,
          0.014,
        );
        this.yaw -= movement.x * sens;
        this.pitch = clamp(this.pitch - movement.y * sens, -1.48, 1.48);
      }
    });
    window.addEventListener("keydown", (e) => {
      if (this.state === "lobby" || this.state === "results") return;
      if (
        [
          "Space",
          "Tab",
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
          "KeyF",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === "Escape") {
        this.pause();
        return;
      }
      this.keys.add(e.code);
      if (e.repeat || this.state !== "playing") return;
      if (e.code === "Space") this.jump();
      if (
        e.code === "KeyC" ||
        e.code.startsWith("Control") ||
        e.code.startsWith("Shift")
      )
        this.slide();
      if (e.code === "KeyF") this.meleeAbility(true);
      if (e.code === "KeyR") this.reload();
      if (e.code === "KeyT" && !this.reloadTime) this.inspectTime = 1.8;
      if (/^Digit[1-4]$/.test(e.code)) this.equip(+e.code.slice(-1) - 1);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousedown", (e) => {
      if (
        document.pointerLockElement !== this.canvas ||
        this.state !== "playing"
      )
        return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.trigger = true;
      }
      if (e.button === 2) {
        this.inspectTime = 0;
        const w = WEAPONS[this.loadout[this.slot]];
        if (w.type === "heal") this.beginHeal(true);
        else if (w.dash || w.deflect) this.meleeAbility(false);
        else
          this.aiming = w.slot < 2 && this.deflectTime <= 0 && !this.quickModel;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        const held = this.mouseDown;
        this.mouseDown = false;
        if (
          held &&
          WEAPONS[this.loadout[this.slot]].type === "bow" &&
          this.state === "playing"
        )
          this.bowRelease = true;
      }
      if (e.button === 2) this.aiming = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener(
      "wheel",
      (e) => {
        if (
          document.pointerLockElement !== this.canvas ||
          this.state !== "playing"
        )
          return;
        e.preventDefault();
        this.equip((this.slot + (e.deltaY > 0 ? 1 : 3)) % 4);
      },
      { passive: false },
    );
    window.addEventListener("blur", () => {
      if (["playing", "countdown", "roundend"].includes(this.state))
        this.pause();
    });
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = innerWidth / innerHeight;
    this.weaponCamera.updateProjectionMatrix();
    this.presentation?.resize();
  }
  setSettings(settings) {
    this.settings = settings;
    this.audio.volume = settings.volume / 100;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, settings.performance ? 1 : 1.75),
    );
    this.renderer.shadowMap.enabled = !settings.performance;
    this.presentation?.resize();
  }
  preview(id) {
    this.world.build(id);
  }
  requestLock() {
    this.audio.init();
    this.mouseLook.reset(performance.now());
    try {
      const p = this.canvas.requestPointerLock();
      p?.catch(() => {
        if (!["lobby", "results"].includes(this.state)) this.pause();
      });
    } catch {
      this.pause();
      this.events.toast(
        "A desktop browser with mouse capture is required to play.",
      );
    }
  }
  start(config) {
    this.config = { ...config };
    this.loadout = [...config.loadout];
    this.score = [0, 0];
    this.matchStats = { shots: 0, hits: 0, kills: 0, deaths: 0, headshots: 0 };
    this.range = config.range || false;
    this.world.build(this.range ? "range" : config.map);
    this.round = 0;
    this.clock = 0;
    this.events.start();
    this.startRound();
    this.requestLock();
  }
  cleanEntities() {
    for (const e of this.entities) {
      if (e.model) {
        this.scene.remove(e.model.group);
        const mats = new Set();
        e.model.group.traverse((o) => {
          o.geometry?.dispose();
          if (o.material) {
            mats.add(o.material);
            o.material.map?.dispose();
          }
        });
        mats.forEach((m) => m.dispose());
      }
    }
    this.entities = [];
    for (const e of this.effects) {
      this.scene.remove(e.mesh);
      e.mesh.geometry?.dispose();
      e.mesh.material?.dispose();
    }
    this.effects = [];
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      this.disposeVisual(p.mesh);
    }
    this.projectiles = [];
    this.smokes = [];
    this.fires = [];
  }
  createEntity(team, position, index, isPlayer = false, target = false) {
    const e = {
      team,
      name: isPlayer
        ? "YOU"
        : target
          ? "TARGET"
          : botNames[index % botNames.length],
      x: position.x,
      z: position.z,
      y: 0,
      vy: 0,
      vx: 0,
      vz: 0,
      height: 1.9,
      radius: 0.38,
      grounded: true,
      jumps: 0,
      alive: true,
      health: 100,
      isPlayer,
      target,
      yaw: team === 0 ? 0 : Math.PI,
      seed: Math.random() * 100,
      path: [],
      pathTimer: 0,
      shootTimer: 1,
      seen: 0,
      reload: 0,
      ammo: 20,
      targetEntity: null,
      lastKnown: null,
      strafe: Math.random() > 0.5 ? 1 : -1,
      decision: 0,
      sliding: 0,
    };
    if (!isPlayer) {
      e.model = createCharacter(team, e.name);
      this.scene.add(e.model.group);
      e.model.group.position.set(e.x, e.y, e.z);
    }
    this.entities.push(e);
    return e;
  }
  startRound() {
    this.clearQuickMelee();
    this.cleanEntities();
    this.round++;
    this.player = this.createEntity(0, this.world.spawns[0][0], 0, true);
    this.yaw = 0;
    this.pitch = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.coyoteTime = 0;
    this.jumpBuffer = 0;
    this.walkPhase = 0;
    this.stepOffset = 0;
    this.landingDip = 0;
    this.crouched = false;
    this.renderPrevious = null;
    this.accumulator = 0;
    this.dashCooldown = 0;
    this.deflectTime = 0;
    this.deflectCooldown = 0;
    this.swingTime = 0;
    this.guardFlash = 0;
    this.slideBuffer = 0;
    this.bowCharge = 0;
    this.bowRelease = false;
    this.spinTime = 0;
    this.healTime = 0;
    this.blindTime = 0;
    this.paintTintTime = 0;
    this.cooldown = 0;
    this.reloadTime = 0;
    this.burstCount = 0;
    this.mouseDown = false;
    this.aiming = false;
    this.keys.clear();
    this.ammunition = this.loadout.map((id) => ({
      mag: WEAPONS[id].mag,
      reserve: WEAPONS[id].reserve,
    }));
    this.slot = -1;
    this.equip(0);
    this.roundTime = 90;
    this.eyeHeight = 1.66;
    if (this.range) {
      for (let i = 0; i < 5; i++)
        this.createEntity(
          1,
          { x: -14 + i * 7, z: -14 + (i % 2) * 5 },
          i,
          false,
          true,
        );
      this.state = "playing";
      this.events.banner(
        "PRACTICE RANGE",
        "GET DIALED IN.",
        "Moving targets · Infinite reserves · ESC to leave",
        2.7,
      );
    } else {
      for (let i = 1; i < this.config.mode; i++)
        this.createEntity(0, this.world.spawns[0][i], i + 2);
      for (let i = 0; i < this.config.mode; i++)
        this.createEntity(1, this.world.spawns[1][i], i);
      this.state = "countdown";
      this.countdown = 3;
      this.countSound = 4;
      this.events.banner(
        "ROUND " + this.round,
        "3",
        "Eliminate the rivals. First to 5.",
        0,
      );
    }
    this.events.round(this.round, this.score, this.range);
    this.events.update(this);
    this.events.feedClear();
    this.updateCamera(1);
    this.camera.updateMatrixWorld();
  }
  equip(slot) {
    if (slot === this.slot || !this.player?.alive) return;
    this.clearQuickMelee();
    this.deflectTime = 0;
    this.slot = slot;
    this.inspectTime = 0;
    this.throwTime = 0;
    this.bowCharge = 0;
    this.bowRelease = false;
    this.spinTime = 0;
    this.healTime = 0;
    this.reloadTime = 0;
    this.burstCount = 0;
    this.aiming = false;
    this.cooldown = Math.max(this.cooldown, 0.2);
    this.trigger = false;
    if (this.viewModel) {
      this.weaponScene.remove(this.viewModel);
      const mats = new Set();
      this.viewModel.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) mats.add(o.material);
      });
      mats.forEach((m) => m.dispose());
    }
    this.viewModel = createViewModel(
      this.loadout[slot],
      WEAPONS[this.loadout[slot]],
    );
    this.viewModel.scale.setScalar(0.78);
    this.weaponScene.add(this.viewModel);
    this.weaponAnimator?.equip();
    this.switchTime = 0.22;
    this.audio.play("switch");
    this.events.update(this);
  }
  jump() {
    if (!this.player?.alive) return;
    this.jumpBuffer = MOVEMENT.jumpBuffer;
    this.slideBuffer = 0;
    this.tryJump();
    this.slideTime = 0;
    this.crouched = !canOccupy(
      this.player,
      this.player.x,
      this.player.y,
      this.player.z,
      this.world.boxes,
      1.9,
    );
    this.player.height = this.crouched ? 1.15 : 1.9;
  }
  tryJump() {
    const p = this.player;
    const w = WEAPONS[this.loadout[this.slot]];
    if (p.grounded || (this.coyoteTime > 0 && p.jumps === 0)) {
      const slope = p.groundSlope;
      const rampBoost = slope
        ? clamp((p.vx * slope.x + p.vz * slope.z) * 0.35, 0, 4)
        : 0;
      p.vy = MOVEMENT.jumpSpeed + rampBoost;
      p.grounded = false;
      p.jumps = 1;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      this.audio.play("jump");
      // Carry the slide's actual velocity instead of snapping back to running speed.
      if (this.slideTime > 0) {
        this.slideTime = 0;
        p.vy += 0.6;
        p.vx *= 1.06;
        p.vz *= 1.06;
      }
      return true;
    }
    if (w.doubleJump && p.jumps < 2) {
      p.vy = MOVEMENT.doubleJumpSpeed;
      p.jumps = 2;
      this.jumpBuffer = 0;
      this.coyoteTime = 0;
      this.audio.play("double");
      return true;
    }
    return false;
  }
  slide() {
    const p = this.player;
    if (!p?.alive || !p.grounded || this.slideCooldown > 0) return;
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 2) {
      this.slideBuffer = 0.16;
      return;
    }
    this.slideBuffer = 0;
    this.slideTime = MOVEMENT.slideDuration;
    this.slideCooldown = MOVEMENT.slideCooldown;
    const boost = clamp(
      speed + MOVEMENT.slideBoost,
      MOVEMENT.slideMinSpeed,
      MOVEMENT.slideMaxSpeed,
    );
    p.vx = (p.vx / speed) * boost;
    p.vz = (p.vz / speed) * boost;
    this.crouched = true;
    this.audio.noiseHit(MOVEMENT.slideDuration, 0.08, 800);
  }
  dash() {
    if (this.dashCooldown > 0 || !this.player?.alive) return false;
    this.dashCooldown = 3;
    const d = this.moveDirection();
    this.player.vx = (d.length() ? d.x : -Math.sin(this.yaw)) * 28;
    this.player.vz = (d.length() ? d.z : -Math.cos(this.yaw)) * 28;
    this.player.vy = Math.max(this.player.vy, 3);
    this.player.grounded = false;
    this.player.jumps = Math.max(1, this.player.jumps);
    this.coyoteTime = 0;
    this.slideTime = 0;
    this.audio.play("double");
    return true;
  }
  meleeAbility(quick = false) {
    if (!this.player?.alive || this.state !== "playing") return false;
    const id = quick ? this.loadout[2] : this.loadout[this.slot];
    const weapon = WEAPONS[id];
    let duration = 0.36;
    if (weapon.dash) {
      if (!this.dash()) return false;
    } else if (weapon.deflect) {
      if (this.deflectCooldown > 0) return false;
      this.deflectTime = weapon.abilityDuration;
      this.deflectCooldown = weapon.abilityCooldown;
      this.player.yaw = this.yaw;
      this.mouseDown = false;
      this.trigger = false;
      this.burstCount = 0;
      duration = this.deflectTime;
      this.audio.play("guard");
    } else {
      if (quick)
        this.events.toast?.(
          "This melee has no right-click ability. Equip Scythe or Katana in your loadout.",
        );
      return false;
    }
    this.aiming = false;
    if (quick && this.slot !== 2) this.showQuickMelee(id, duration);
    this.events.update(this);
    return true;
  }
  showQuickMelee(id, duration) {
    this.clearQuickMelee();
    this.quickModel = createViewModel(id, WEAPONS[id]);
    this.quickModel.scale.setScalar(0.78);
    this.quickModelId = id;
    this.quickMeleeTime = duration;
    this.weaponScene.add(this.quickModel);
    if (this.viewModel) this.viewModel.visible = false;
  }
  clearQuickMelee() {
    if (this.quickModel) {
      this.weaponScene.remove(this.quickModel);
      const materials = new Set();
      this.quickModel.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) materials.add(o.material);
      });
      materials.forEach((m) => m.dispose());
    }
    this.quickModel = null;
    this.quickMeleeTime = 0;
    if (this.viewModel) this.viewModel.visible = true;
  }
  moveDirection() {
    const dx =
        (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0),
      dz = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    return v3(
      dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw),
      0,
      -dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw),
    ).normalize();
  }
  reload() {
    if (!this.player?.alive || this.reloadTime > 0) return;
    const w = WEAPONS[this.loadout[this.slot]],
      a = this.ammunition[this.slot];
    if (!w.reload || a.mag >= w.mag || a.reserve <= 0) return;
    this.inspectTime = 0;
    this.reloadTime = w.reload;
    this.reloadTotal = w.reload;
    this.burstCount = 0;
    this.audio.play("reload");
    this.events.update(this);
  }
  eye(e) {
    return v3(e.x, e.y + (e.isPlayer && this.crouched ? 1.02 : 1.66), e.z);
  }
  hasLOS(a, b) {
    const d = b.clone().sub(a),
      distance = d.length();
    if (distance < 0.1) return true;
    this.ray.set(a, d.normalize());
    this.ray.far = distance;
    const hits = this.ray.intersectObjects(this.world.solidMeshes, false);
    if (hits.length && hits[0].distance < distance - 0.1) return false;
    for (const s of this.smokes) {
      const line = new THREE.Line3(a, b),
        p = v3();
      line.closestPointToPoint(s.pos, true, p);
      if (p.distanceTo(s.pos) < s.radius) return false;
    }
    return true;
  }
  firePlayer() {
    const p = this.player;
    if (
      !p?.alive ||
      this.cooldown > 0 ||
      this.reloadTime > 0 ||
      this.deflectTime > 0 ||
      this.quickMeleeTime > 0 ||
      this.healTime > 0
    )
      return;
    const id = this.loadout[this.slot],
      w = WEAPONS[id],
      a = this.ammunition[this.slot];
    if (w.type === "heal") {
      this.beginHeal(false);
      return;
    }
    if (w.spin && this.spinTime < 0.55) return;
    if (a.mag <= 0) {
      this.audio.play("empty");
      this.cooldown = 0.23;
      if (w.reload) this.reload();
      return;
    }
    if (Number.isFinite(a.mag)) a.mag--;
    if (this.range && w.slot === 3) a.mag = w.mag;
    this.cooldown = w.interval;
    this.inspectTime = 0;
    this.flash = 0.055;
    this.lastShotAt = this.clock;
    this.kick = Math.min(0.13, this.kick + 0.045);
    this.audio.play(w.sound);
    const origin = this.eye(p),
      forward = v3(0, 0, -1).applyEuler(
        new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
      );
    if (w.type === "bow") {
      this.spawnProjectile(p, origin, forward, id, this.bowCharge || 0);
      this.matchStats.shots++;
      this.bowCharge = 0;
      this.reload();
    } else if (w.type === "flame") {
      this.matchStats.shots++;
      let hit = false;
      for (const enemy of this.entities) {
        if (!enemy.alive || enemy.team === p.team) continue;
        const delta = this.eye(enemy).sub(origin);
        if (
          delta.length() < w.range &&
          delta.normalize().dot(forward) > 0.88 &&
          this.hasLOS(origin, this.eye(enemy))
        ) {
          this.damage(enemy, w.damage, p);
          enemy.burnUntil = this.clock + 1.5;
          enemy.burnOwner = p;
          hit = true;
        }
      }
      if (hit) {
        this.matchStats.hits++;
        this.events.hit(false);
      }
      this.particles(
        origin.clone().addScaledVector(forward, 4 + Math.random() * 4),
        0xffad52,
        5,
      );
    } else if (w.type === "rocket" || w.type === "launcher" || w.slot === 3) {
      this.spawnProjectile(p, origin, forward, id);
      if (w.slot === 3) this.throwTime = 0.36;
      this.matchStats.shots++;
    } else if (w.type === "melee") {
      this.swingTime = 0.28;
      for (const e of this.entities) {
        if (!e.alive || e.team === p.team) continue;
        const delta = this.eye(e).sub(origin);
        if (
          delta.length() < w.range &&
          delta.normalize().dot(forward) > 0.45 &&
          this.hasLOS(origin, this.eye(e))
        ) {
          let damage = w.damage;
          if (id === "knife") {
            const behind = v3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
            if (behind.dot(v3(p.x - e.x, 0, p.z - e.z).normalize()) < -0.45)
              damage = 100;
          }
          this.damage(e, damage, p, false);
          this.events.hit(false);
          this.audio.play("hit");
        }
      }
    } else {
      this.matchStats.shots++;
      let hit = false;
      for (let i = 0; i < (w.pellets || 1); i++) {
        const spread =
          w.spread * (this.aiming ? 0.25 : 1) * (p.grounded ? 1 : 1.5);
        const dir = forward
          .clone()
          .add(
            v3(
              (Math.random() - 0.5) * spread * 2,
              (Math.random() - 0.5) * spread * 2,
              (Math.random() - 0.5) * spread * 2,
            ),
          )
          .normalize();
        if (this.bullet(p, origin, dir, w)) hit = true;
      }
      if (hit) this.matchStats.hits++;
      // Recoil animates the weapon. Never rewrite the mouse's pitch; that caused
      // sustained fire to drag/snap the user's actual look direction upward.
    }
    this.events.update(this);
  }
  bullet(shooter, origin, dir, w, reflected = false) {
    this.ray.set(origin, dir);
    this.ray.far = w.range;
    const walls = this.ray.intersectObjects(this.world.solidMeshes, false);
    let nearest = walls[0]?.distance ?? w.range;
    let victim = null,
      head = false;
    for (const e of this.entities) {
      if (!e.alive || e === shooter) continue;
      const h = e.height;
      const box = new THREE.Box3(
        v3(e.x - 0.4, e.y, e.z - 0.34),
        v3(e.x + 0.4, e.y + h, e.z + 0.34),
      );
      const hit = this.ray.ray.intersectBox(box, v3());
      if (!hit) continue;
      const distance = hit.distanceTo(origin);
      if (distance < nearest) {
        nearest = distance;
        victim = e;
        head = hit.y > e.y + h - 0.48;
      }
    }
    this.tracer(
      origin,
      origin.clone().addScaledVector(dir, nearest),
      shooter.team,
      w.paint ? 0xff73a4 : undefined,
    );
    if (w.paint) {
      if (victim) {
        this.particles(
          origin.clone().addScaledVector(dir, nearest),
          0xff6ba7,
          5,
        );
        if (victim.isPlayer) this.paintTintTime = 0.65;
      } else if (walls[0])
        this.paintSplat(
          walls[0].point,
          walls[0].face.normal
            .clone()
            .transformDirection(walls[0].object.matrixWorld),
        );
    }
    if (victim && victim.team !== shooter.team) {
      const guarding = victim.isPlayer
        ? this.deflectTime > 0
        : victim.deflectTime > 0;
      const facing = victim.isPlayer ? this.yaw : victim.yaw;
      const guardDirection = v3(-Math.sin(facing), 0, -Math.cos(facing));
      const incoming = dir.clone().negate();
      incoming.y = 0;
      incoming.normalize();
      if (guarding && !w.paint && guardDirection.dot(incoming) > 0.25) {
        const contact = origin.clone().addScaledVector(dir, nearest);
        this.particles(contact, 0x89e5ff, 10);
        this.audio.play("parry");
        if (victim.isPlayer) {
          this.guardFlash = 0.2;
          this.matchStats.deflections = (this.matchStats.deflections || 0) + 1;
          this.events.deflect?.();
        }
        if (!reflected && shooter.alive) {
          const reflectedOrigin = contact
            .clone()
            .addScaledVector(incoming, 0.08);
          const direction = this.eye(shooter).sub(reflectedOrigin).normalize();
          this.bullet(victim, reflectedOrigin, direction, w, true);
        }
        return false;
      }
      const falloff = w.pellets ? clamp(1 - nearest / w.range, 0.2, 1) : 1;
      this.damage(
        victim,
        w.damage * (head ? w.head : 1) * falloff,
        shooter,
        head,
      );
      if (shooter.isPlayer) {
        this.events.hit(head);
        this.audio.play(head ? "head" : "hit");
        if (head) this.matchStats.headshots++;
      }
      return true;
    }
    return false;
  }
  paintSplat(point, normal) {
    const color = [0xff699a, 0x52dace, 0xffdf5e][Math.floor(Math.random() * 3)];
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.25, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: false,
      }),
    );
    mesh.position.copy(point).addScaledVector(normal, 0.012);
    mesh.quaternion.setFromUnitVectors(v3(0, 0, 1), normal);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 7, max: 7 });
  }
  updateSupport(dt) {
    this.blindTime = Math.max(0, (this.blindTime || 0) - dt);
    this.paintTintTime = Math.max(0, (this.paintTintTime || 0) - dt);
    if (this.healTime > 0) {
      this.healTime -= dt;
      if (this.healTime <= 0 && this.player.alive) {
        this.player.health = Math.min(
          100,
          this.player.health + this.healAmount,
        );
        this.events.update(this);
      }
    }
  }
  beginHeal(quick = false) {
    if (
      !this.player?.alive ||
      this.state !== "playing" ||
      this.healTime > 0 ||
      this.player.health >= 100
    )
      return false;
    const a = this.ammunition[this.slot];
    if (a.mag <= 0) return false;
    if (!this.range) a.mag--;
    this.healTime = quick ? 0.8 : 2.2;
    this.healAmount = quick ? 25 : 70;
    this.mouseDown = false;
    this.trigger = false;
    this.aiming = false;
    this.audio.play("heal");
    this.events.update(this);
    return true;
  }
  disposeVisual(object) {
    const materials = new Set();
    object.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) materials.add(o.material);
    });
    for (const m of materials) m.dispose();
  }
  tracer(a, b, team, color) {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]),
      mat = new THREE.LineBasicMaterial({
        color: team === 0 ? 0xffe3b1 : 0xff9587,
        transparent: true,
        opacity: 0.7,
      });
    const mesh = new THREE.Line(geom, mat);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.075, max: 0.075 });
  }
  particles(pos, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.effects.push({
        mesh,
        life: 0.6,
        max: 0.6,
        velocity: v3(
          (Math.random() - 0.5) * 6,
          Math.random() * 5,
          (Math.random() - 0.5) * 6,
        ),
        gravity: true,
      });
    }
  }
  damage(e, amount, source, head = false) {
    if (!e.alive || amount <= 0) return;
    e.health = Math.max(0, e.health - amount);
    if (e.isPlayer) {
      this.healTime = 0;
      this.events.hurt();
      this.audio.play("hurt");
    } else this.particles(this.eye(e), head ? 0xffe2a1 : 0xeeac97, 3);
    if (e.health <= 0) {
      e.alive = false;
      if (e.model) {
        e.deathTime = 0;
        e.deathRoll = e.model.group.rotation.z;
      }
      if (e.isPlayer) {
        this.matchStats.deaths++;
        this.mouseDown = false;
        this.aiming = false;
        this.events.banner(
          "ELIMINATED",
          "STAY IN THE FIGHT.",
          this.config.mode > 1
            ? "Spectating · Your team is still fighting."
            : "The next round is yours.",
          2.5,
        );
      }
      if (source?.isPlayer) {
        this.matchStats.kills++;
        this.audio.play("kill");
      }
      this.events.kill(source?.name || "ARENA", e.name, head);
      if (this.range) {
        e.respawnAt = this.clock + 1.4;
      } else this.checkRound();
    }
    this.events.update(this);
  }
  checkRound() {
    if (this.state !== "playing" || this.range) return;
    const alive = [0, 1].map(
      (team) => this.entities.filter((e) => e.alive && e.team === team).length,
    );
    if (!alive[0] || !alive[1]) this.endRound(alive[0] ? 0 : 1);
  }
  endRound(winner) {
    if (this.state !== "playing") return;
    this.score[winner]++;
    this.state = "roundend";
    this.roundEndTime = 3.1;
    this.mouseDown = false;
    this.burstCount = 0;
    this.events.round(this.round, this.score, false);
    this.events.banner(
      "ROUND " + this.round + " COMPLETE",
      winner === 0 ? "ROUND WON." : "ROUND LOST.",
      this.score[winner] >= 5
        ? "Match complete."
        : `Next round in 3 · ${this.score[0]} — ${this.score[1]}`,
      0,
    );
  }
  finish() {
    this.state = "results";
    document.exitPointerLock?.();
    this.events.results(this);
  }
  pause() {
    if (!["playing", "countdown", "roundend"].includes(this.state)) return;
    this.previousState = this.state;
    this.state = "paused";
    this.keys.clear();
    this.mouseDown = false;
    this.trigger = false;
    this.bowCharge = 0;
    this.bowRelease = false;
    this.aiming = false;
    document.exitPointerLock?.();
    this.events.pause(true);
  }
  resume() {
    this.requestLock();
  }
  quit() {
    this.state = "lobby";
    document.exitPointerLock?.();
    this.clearQuickMelee();
    this.cleanEntities();
    this.player = null;
    if (this.range) this.world.build(this.config.map);
    this.events.lobby();
  }
  spawnProjectile(owner, origin, dir, id, charge = 0) {
    const w = WEAPONS[id],
      rocket = w.type === "rocket",
      arrow = w.type === "bow",
      mesh = new THREE.Mesh(
        arrow
          ? new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6)
          : rocket
            ? new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8)
            : new THREE.IcosahedronGeometry(0.13, 0),
        new THREE.MeshStandardMaterial({
          color: rocket ? 0xffc99a : w.color,
          emissive: rocket ? 0xe96920 : 0,
          emissiveIntensity: 0.8,
        }),
      );
    const pos = origin.clone().addScaledVector(dir, 0.55);
    mesh.position.copy(pos);
    if (arrow) {
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.065, 0.16, 6),
        new THREE.MeshStandardMaterial({
          color: 0xbbccd3,
          metalness: 0.65,
          roughness: 0.25,
        }),
      );
      tip.position.y = 0.48;
      mesh.add(tip);
    }
    if (rocket || arrow) mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos,
      vel: dir
        .clone()
        .multiplyScalar(
          arrow
            ? 58 + Math.min(1, charge / 1.2) * 27
            : rocket
              ? 40
              : id === "launcher"
                ? 28
                : 22,
        )
        .add(v3(0, rocket || arrow ? 0 : 4, 0)),
      owner,
      id,
      fuse: arrow
        ? 3
        : rocket
          ? 4
          : id === "flashbang"
            ? 1.5
            : id === "grenade"
              ? 1.8
              : 3,
      arrow,
      charge,
      damage: w.damage * (arrow ? 1 + Math.min(1, charge / 1.2) : 1),
      rocket,
      bounces: 0,
    });
  }
  explosion(pos, owner, id) {
    const w = WEAPONS[id];
    if (id === "flashbang") {
      this.audio.play("flash");
      this.particles(pos, 0xffffff, 24);
      for (const e of this.entities) {
        if (!e.alive) continue;
        const eye = this.eye(e);
        const delta = pos.clone().sub(eye);
        if (delta.length() < 17 && this.hasLOS(pos, eye)) {
          if (e.isPlayer) {
            const forward = v3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
            const strength = forward.dot(delta.normalize()) > 0 ? 2.5 : 0.7;
            this.blindTime = Math.max(this.blindTime || 0, strength);
          } else e.blindedUntil = this.clock + 2.5;
        }
      }
      return;
    }
    if (id === "smoke") {
      const radius = 4.5,
        mat = new THREE.MeshStandardMaterial({
          color: 0xaaa2be,
          transparent: true,
          opacity: 0.83,
          roughness: 1,
        }),
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), mat);
      mesh.position.copy(pos);
      mesh.position.y = Math.max(1.5, pos.y);
      this.scene.add(mesh);
      const effect = { mesh, life: 7, max: 7, smoke: true };
      this.effects.push(effect);
      this.smokes.push({ pos: mesh.position.clone(), radius, effect });
      this.audio.noiseHit(0.6, 0.1, 500);
      return;
    }
    if (id === "molotov") {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 0.08, 32),
        new THREE.MeshBasicMaterial({
          color: 0xff7940,
          transparent: true,
          opacity: 0.55,
        }),
      );
      mesh.position.set(pos.x, 0.1, pos.z);
      this.scene.add(mesh);
      const effect = { mesh, life: 5, max: 5 };
      this.effects.push(effect);
      this.fires.push({ pos: pos.clone(), effect, owner, tick: 0 });
      this.particles(pos, 0xffa44c, 22);
      return;
    }
    this.audio.play("explosion");
    this.particles(pos, 0xffbd68, 35);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffdd9a,
        transparent: true,
        opacity: 0.6,
      }),
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.3, max: 0.3, expand: true });
    const radius = id === "grenade" ? 6 : 4.5;
    for (const e of this.entities) {
      if (!e.alive || (e.team === owner.team && e !== owner)) continue;
      const distance = v3(e.x, e.y + 1, e.z).distanceTo(pos);
      if (
        distance < radius &&
        this.hasLOS(pos.clone().add(v3(0, 0.15, 0)), this.eye(e))
      ) {
        let dmg = w.damage * (1 - distance / radius);
        if (distance < 1.6) dmg = w.damage;
        this.damage(e, dmg * (e === owner ? 0.5 : 1), owner);
        if (e === owner) {
          e.vy = 15;
          e.grounded = false;
          e.vx += (e.x - pos.x) * 5;
          e.vz += (e.z - pos.z) * 5;
        }
        if (owner.isPlayer && e !== owner) {
          this.matchStats.hits++;
          this.events.hit(false);
        }
      }
    }
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      if (!p.rocket) p.vel.y -= (p.arrow ? 3 : 13) * dt;
      const next = p.pos.clone().addScaledVector(p.vel, dt),
        delta = next.clone().sub(p.pos),
        length = delta.length();
      this.ray.set(p.pos, delta.normalize());
      this.ray.far = length + 0.12;
      const hit = this.ray.intersectObjects(this.world.solidMeshes, false)[0];
      let actorHit = false;
      let nearestActor = hit ? hit.distance : length + 0.1;
      if (p.arrow || p.rocket || p.id === "launcher")
        for (const e of this.entities) {
          if (!e.alive || e === p.owner || e.team === p.owner.team) continue;
          const impact = this.ray.ray.intersectBox(
            new THREE.Box3(
              v3(e.x - 0.4, e.y, e.z - 0.34),
              v3(e.x + 0.4, e.y + e.height, e.z + 0.34),
            ),
            v3(),
          );
          if (impact && impact.distanceTo(p.pos) < nearestActor) {
            actorHit = true;
            p.victim = e;
            p.headshot = impact.y > e.y + e.height - 0.48;
            next.copy(impact);
            nearestActor = impact.distanceTo(p.pos);
          }
        }
      if ((hit && !actorHit) || next.y < 0.13) {
        if (
          p.arrow ||
          p.rocket ||
          p.id === "launcher" ||
          p.id === "molotov" ||
          p.id === "smoke"
        ) {
          p.fuse = 0;
          if (hit)
            next
              .copy(hit.point)
              .addScaledVector(
                hit.face.normal
                  .clone()
                  .transformDirection(hit.object.matrixWorld),
                0.15,
              );
          next.y = Math.max(0.2, next.y);
        } else {
          if (hit) {
            const normal = hit.face.normal
              .clone()
              .transformDirection(hit.object.matrixWorld);
            p.vel.reflect(normal).multiplyScalar(0.46);
            next.copy(hit.point).addScaledVector(normal, 0.17);
          } else {
            next.y = 0.14;
            p.vel.y = Math.abs(p.vel.y) * 0.45;
            p.vel.x *= 0.7;
            p.vel.z *= 0.7;
          }
          p.bounces++;
        }
      }
      p.pos.copy(next);
      p.mesh.position.copy(next);
      if (actorHit) p.fuse = 0;
      if (p.fuse <= 0) {
        if (p.arrow) {
          if (p.victim) {
            this.damage(
              p.victim,
              p.damage * (p.headshot ? 2 : 1),
              p.owner,
              p.headshot,
            );
            if (p.owner.isPlayer) {
              this.matchStats.hits++;
              this.events.hit(p.headshot);
              this.audio.play(p.headshot ? "head" : "hit");
            }
          }
        } else this.explosion(p.pos, p.owner, p.id);
        this.scene.remove(p.mesh);
        this.disposeVisual(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
    for (const fire of this.fires) {
      fire.tick -= dt;
      if (fire.tick <= 0) {
        fire.tick = 0.3;
        for (const e of this.entities)
          if (
            e.alive &&
            (e.team !== fire.owner.team || e === fire.owner) &&
            Math.hypot(e.x - fire.pos.x, e.z - fire.pos.z) < 3.2 &&
            e.y < 1.5
          )
            this.damage(e, 8, fire.owner);
      }
    }
    this.fires = this.fires.filter((f) => f.effect.life > 0);
    this.smokes = this.smokes.filter((s) => s.effect.life > 0);
  }
  updatePlayer(dt) {
    const p = this.player;
    if (!p.alive) return;
    const w = WEAPONS[this.loadout[this.slot]];
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.slideTime = Math.max(0, this.slideTime - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyoteTime = p.grounded
      ? MOVEMENT.coyoteTime
      : Math.max(0, this.coyoteTime - dt);
    if (this.jumpBuffer > 0) this.tryJump();
    this.crouched =
      this.slideTime > 0 || !canOccupy(p, p.x, p.y, p.z, this.world.boxes, 1.9);
    p.height = this.crouched ? 1.15 : 1.9;
    p.yaw = this.yaw;
    const dir = this.moveDirection();
    let speed = w.slot === 2 ? MOVEMENT.meleeSpeed : MOVEMENT.runSpeed;
    speed *= w.moveSpeed || 1;
    if (this.healTime > 0) speed *= 0.55;
    if (this.aiming) speed *= 0.75;

    if (this.crouched && this.slideTime <= 0) speed *= 0.55;
    this.slideBuffer = Math.max(0, (this.slideBuffer || 0) - dt);
    if (this.slideBuffer > 0 && p.grounded && Math.hypot(p.vx, p.vz) >= 2)
      this.slide();
    if (this.slideTime > 0) steerSlide(p, dir, dt);
    else accelerate(p, dir, speed, dt);
    const oldX = p.x,
      oldZ = p.z,
      oldY = p.y,
      wasGrounded = p.grounded;
    moveBody(p, p.vx * dt, p.vz * dt, this.world.boxes);
    const stepRise = p.y - oldY;
    if (wasGrounded && stepRise > 0) {
      const expected = p.groundSlope
        ? Math.max(
            0,
            p.groundSlope.x * (p.x - oldX) + p.groundSlope.z * (p.z - oldZ),
          )
        : 0;
      // Ease the extra auto-step at a ramp/platform join, not the continuous slope.
      const extra = stepRise - expected;
      if (extra > 0.025) this.stepOffset -= extra;
    }
    const fallingVelocity = p.vy;
    verticalStep(p, dt, this.world.boxes);
    if (!wasGrounded && p.grounded && fallingVelocity < -3)
      this.landingDip = Math.min(0.04, -fallingVelocity * 0.0025);
    if (p.grounded && (this.jumpBuffer > 0 || this.keys.has("Space")))
      this.tryJump();
    if (this.slideTime > 0 && Math.hypot(p.vx, p.vz) < 2) this.slideTime = 0;
    const bounds = this.world.bounds || {
      minX: -23.1,
      maxX: 23.1,
      minZ: -23.1,
      maxZ: 23.1,
    };
    p.x = clamp(p.x, bounds.minX, bounds.maxX);
    p.z = clamp(p.z, bounds.minZ, bounds.maxZ);
    this.walkPhase += Math.hypot(p.x - oldX, p.z - oldZ) * 1.8;
    this.stepTime = (this.stepTime || 0) + dt;
    if (
      p.grounded &&
      Math.hypot(p.vx, p.vz) > 2 &&
      this.stepTime > (this.slideTime > 0 ? 0.7 : 0.38)
    ) {
      this.stepTime = 0;
      this.audio.play("step");
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadTime > 0) {
      this.reloadTime -= dt;
      if (this.reloadTime <= 0) {
        const a = this.ammunition[this.slot],
          missing = w.mag - a.mag,
          amount = this.range ? missing : Math.min(missing, a.reserve);
        a.mag += amount;
        if (!this.range) a.reserve -= amount;
        this.events.update(this);
      }
    }
    if (w.spin)
      this.spinTime = clamp(
        (this.spinTime || 0) + (this.mouseDown || this.aiming ? dt : -dt * 1.5),
        0,
        0.65,
      );
    if (w.type === "bow") {
      if (this.mouseDown)
        this.bowCharge = Math.min(1.2, (this.bowCharge || 0) + dt);
      if (this.bowRelease) {
        this.firePlayer();
        this.bowRelease = false;
      }
      this.trigger = false;
      return;
    }
    if (
      w.type === "burst" &&
      this.trigger &&
      this.cooldown <= 0 &&
      this.reloadTime <= 0 &&
      this.ammunition[this.slot].mag > 0
    ) {
      this.burstCount = 3;
      this.burstTimer = 0;
      this.trigger = false;
    }
    if (this.burstCount > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.cooldown = 0;
        this.firePlayer();
        this.burstCount--;
        this.burstTimer = 0.075;
        this.cooldown = this.burstCount ? 0 : w.interval;
      }
    } else if (
      w.type !== "burst" &&
      (w.type === "auto" || w.type === "flame" ? this.mouseDown : this.trigger)
    ) {
      this.firePlayer();
      if (w.type !== "auto" && w.type !== "flame") this.trigger = false;
    }
    this.trigger = false;
  }
  animateDeath(e, dt) {
    if (e.model) {
      e.deathTime = (e.deathTime || 0) + dt;
      const t = THREE.MathUtils.smoothstep(e.deathTime, 0, 0.3);
      e.model.group.rotation.z = THREE.MathUtils.lerp(
        e.deathRoll || 0,
        1.45,
        t,
      );
      e.model.group.position.y = e.y + 0.2 * t + 0.08 * Math.sin(t * Math.PI);
    }
  }
  updateBot(e, dt) {
    if (!e.alive) {
      this.animateDeath(e, dt);
      if (this.range && this.clock >= e.respawnAt) {
        e.alive = true;
        e.health = 100;
        e.model.group.rotation.z = 0;
        e.model.group.position.y = 0;
        e.x = clamp(e.x + (Math.random() - 0.5) * 6, -18, 18);
        e.z = -12 + Math.random() * 7;
      }
      return;
    }
    if (e.burnUntil > this.clock && (e.burnTick || 0) < this.clock) {
      e.burnTick = this.clock + 0.25;
      this.damage(e, 2, e.burnOwner);
      if (!e.alive) return;
    }
    if (e.target) {
      e.vx = Math.sin(this.clock * 1.1 + e.seed) * 2.2;
      moveBody(e, e.vx * dt, 0, this.world.boxes);
      e.yaw = Math.PI;
      this.animateBot(e, dt);
      return;
    }
    const d = DIFFICULTIES[this.config.difficulty];
    e.pathTimer -= dt;
    e.shootTimer -= dt;
    e.decision -= dt;
    e.reload = Math.max(0, e.reload - dt);
    e.sliding = Math.max(0, e.sliding - dt);
    const enemies = this.entities.filter((x) => x.alive && x.team !== e.team);
    if (!enemies.length) return;
    let target = enemies.reduce((a, b) =>
      Math.hypot(e.x - a.x, e.z - a.z) < Math.hypot(e.x - b.x, e.z - b.z)
        ? a
        : b,
    );
    const origin = this.eye(e);
    let visible = false;
    if (e.decision <= 0) {
      e.decision = d.think;
      e.targetEntity = target;
      visible =
        this.hasLOS(origin, this.eye(target)) && !(e.blindedUntil > this.clock);
      e.visible = visible;
      if (visible) {
        e.lastKnown = { x: target.x, z: target.z };
        if (Math.random() < 0.3) e.strafe *= -1;
      } else e.seen = 0;
    } else {
      target = e.targetEntity?.alive ? e.targetEntity : target;
      visible =
        e.visible &&
        this.hasLOS(origin, this.eye(target)) &&
        !(e.blindedUntil > this.clock);
    }
    const distance = Math.hypot(e.x - target.x, e.z - target.z);
    e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
    let dx = 0,
      dz = 0;
    if (visible) {
      e.seen += dt;
      const tx = (target.x - e.x) / Math.max(0.1, distance),
        tz = (target.z - e.z) / Math.max(0.1, distance);
      const approach = distance > 16 ? 0.8 : distance < 7 ? -0.65 : 0.12;
      dx = tx * approach + tz * e.strafe * 0.75;
      dz = tz * approach - tx * e.strafe * 0.75;
      if (e.health < 35 || e.reload > 0) {
        dx = -tx * 0.9 + tz * e.strafe * 0.5;
        dz = -tz * 0.9 - tx * e.strafe * 0.5;
      }
      if (e.grounded && Math.random() < d.jump * dt && distance < 25) {
        e.vy = MOVEMENT.jumpSpeed;
        e.grounded = false;
        e.sliding = 0.4;
      }
      if (e.seen > d.reaction && e.shootTimer <= 0 && e.reload <= 0) {
        if (e.ammo === 0) {
          e.reload = 1.65;
          e.ammo = 20;
        } else {
          const weapon = WEAPONS.rifle,
            aim = this.eye(target)
              .add(v3(0, -0.12, 0))
              .sub(origin)
              .normalize();
          const spread = d.spread * (e.grounded ? 1 : 1.4);
          aim
            .add(
              v3(
                (Math.random() - 0.5) * spread * 2,
                (Math.random() - 0.5) * spread * 2,
                (Math.random() - 0.5) * spread * 2,
              ),
            )
            .normalize();
          this.bullet(e, origin, aim, weapon);
          e.ammo--;
          e.shootTimer = weapon.interval / d.fire;
          const soundLevel = clamp(1 - distance / 55, 0.06, 0.5);
          this.audio.play("rifle", soundLevel);
        }
      }
    } else {
      if (e.pathTimer <= 0) {
        e.pathTimer = 0.9 + Math.random() * 0.6;
        const destination =
          e.lastKnown ||
          this.world.spawns[target.team][
            Math.floor(Math.random() * this.config.mode)
          ];
        e.path = this.world.nav.path(e, destination);
        if (
          e.lastKnown &&
          Math.hypot(e.x - e.lastKnown.x, e.z - e.lastKnown.z) < 2
        )
          e.lastKnown = null;
      }
      while (
        e.path.length &&
        Math.hypot(e.x - e.path[0].x, e.z - e.path[0].z) < 0.7
      )
        e.path.shift();
      if (e.path.length) {
        const p = e.path[0],
          len = Math.hypot(p.x - e.x, p.z - e.z);
        dx = (p.x - e.x) / len;
        dz = (p.z - e.z) / len;
        e.yaw = Math.atan2(-dx, -dz);
      }
    }
    const speed = e.reload > 0 ? d.speed * 0.65 : d.speed;
    const norm = Math.max(1, Math.hypot(dx, dz));
    e.vx = (dx / norm) * speed;
    e.vz = (dz / norm) * speed;
    const oldX = e.x,
      oldZ = e.z;
    moveBody(e, e.vx * dt, e.vz * dt, this.world.boxes);
    const moved = Math.hypot(e.x - oldX, e.z - oldZ);
    e.animationPhase = (e.animationPhase || e.seed) + moved * 2.7;
    e.jumpCooldown = Math.max(0, (e.jumpCooldown || 0) - dt);
    e.stuckTime =
      moved < dt * 0.4 && Math.hypot(dx, dz) > 0.1
        ? (e.stuckTime || 0) + dt
        : 0;
    if (e.grounded && e.jumpCooldown <= 0 && e.stuckTime > 0.28) {
      e.vy = MOVEMENT.jumpSpeed;
      e.grounded = false;
      e.jumpCooldown = 1.2;
      e.stuckTime = 0;
      e.pathTimer = 0;
    }

    verticalStep(e, dt, this.world.boxes);
    const bounds = this.world.bounds || {
      minX: -23.1,
      maxX: 23.1,
      minZ: -23.1,
      maxZ: 23.1,
    };
    e.x = clamp(e.x, bounds.minX, bounds.maxX);
    e.z = clamp(e.z, bounds.minZ, bounds.maxZ);
    this.animateBot(e, dt);
  }
  animateBot(e, dt = 1 / 60) {
    const m = e.model;
    if (!m) return;
    const speed = Math.hypot(e.vx, e.vz),
      phase = e.animationPhase || this.clock * 10 + e.seed;
    const stride = e.grounded
      ? Math.sin(phase) * Math.min(0.65, speed * 0.06)
      : 0.14;
    m.group.position.set(
      e.x,
      e.y + (e.grounded ? Math.abs(Math.sin(phase)) * 0.018 : 0),
      e.z,
    );
    const turn = Math.atan2(
      Math.sin(e.yaw - m.group.rotation.y),
      Math.cos(e.yaw - m.group.rotation.y),
    );
    m.group.rotation.y += turn * (1 - Math.exp(-18 * dt));
    m.parts.leftLeg.rotation.x = stride;
    m.parts.rightLeg.rotation.x = -stride;
    m.parts.leftArm.rotation.x = -0.55 - stride * 0.16;
    m.parts.rightArm.rotation.x = -0.65;
    if (e.reload > 0) {
      m.parts.leftArm.rotation.x = -1.2;
      m.parts.leftArm.rotation.z = -0.25;
    } else m.parts.leftArm.rotation.z = 0;
    if (e.targetEntity?.alive) {
      const dy = e.targetEntity.y + 1.5 - (e.y + 1.5),
        distance = Math.hypot(e.targetEntity.x - e.x, e.targetEntity.z - e.z);
      m.parts.head.rotation.x = clamp(-Math.atan2(dy, distance), -0.5, 0.5);
    }
    m.group.scale.y = THREE.MathUtils.lerp(
      m.group.scale.y,
      e.sliding > 0 ? 0.77 : 1,
      1 - Math.exp(-16 * dt),
    );
  }
  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.velocity) {
        if (e.gravity) e.velocity.y -= 8 * dt;
        e.mesh.position.addScaledVector(e.velocity, dt);
      }
      if (e.expand) e.mesh.scale.setScalar(1 + (1 - e.life / e.max) * 7);
      if (e.mesh.material.transparent)
        e.mesh.material.opacity =
          (e.smoke ? 0.83 : 0.7) * Math.min(1, e.life / (e.max * 0.25));
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry?.dispose();
        e.mesh.material?.dispose();
        this.effects.splice(i, 1);
      }
    }
  }
  simulate(dt) {
    if (["lobby", "paused", "results"].includes(this.state)) return;
    if (this.player)
      this.renderPrevious = {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
      };
    this.clock += dt;
    this.updateSupport(dt);
    this.deflectTime = Math.max(0, (this.deflectTime || 0) - dt);
    this.deflectCooldown = Math.max(0, (this.deflectCooldown || 0) - dt);
    this.swingTime = Math.max(0, (this.swingTime || 0) - dt);
    this.inspectTime = Math.max(0, (this.inspectTime || 0) - dt);
    this.throwTime = Math.max(0, (this.throwTime || 0) - dt);
    this.guardFlash = Math.max(0, (this.guardFlash || 0) - dt);
    if (this.quickMeleeTime > 0) {
      this.quickMeleeTime -= dt;
      if (this.quickMeleeTime <= 0) this.clearQuickMelee();
    }
    this.kick = Math.max(0, this.kick - dt * 0.3);
    this.flash = Math.max(0, this.flash - dt);
    this.switchTime = Math.max(0, (this.switchTime || 0) - dt);
    if (this.state === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.countSound && n > 0) {
        this.countSound = n;
        this.events.banner(
          "ROUND " + this.round,
          "" + n,
          "Eliminate the rivals. First to 5.",
          0,
        );
        this.audio.play("count");
      }
      if (this.countdown <= 0) {
        this.state = "playing";
        this.events.banner("ROUND " + this.round, "FIGHT.", "", 0.65);
        this.audio.play("go");
      }
    }
    if (this.state === "playing") {
      this.updatePlayer(dt);
      for (const e of this.entities) if (!e.isPlayer) this.updateBot(e, dt);
      this.updateProjectiles(dt);
      if (!this.range) {
        this.roundTime -= dt;
        if (this.roundTime <= 0) {
          const health = [0, 1].map((team) =>
            this.entities
              .filter((e) => e.team === team)
              .reduce((sum, e) => sum + e.health, 0),
          );
          if (health[0] === health[1]) {
            this.state = "roundend";
            this.roundEndTime = 3;
            this.events.banner(
              "TIME EXPIRED",
              "DRAW.",
              "No points awarded. Next round in 3.",
              0,
            );
          } else this.endRound(health[0] > health[1] ? 0 : 1);
        }
      }
    } else if (this.state === "roundend") {
      for (const e of this.entities) if (!e.alive) this.animateDeath(e, dt);
      this.roundEndTime -= dt;
      if (this.roundEndTime <= 0) {
        if (Math.max(...this.score) >= 5) this.finish();
        else this.startRound();
      }
    }
    this.updateEffects(dt);
  }
  renderWorld() {
    if (this.presentation && !this.settings.performance)
      this.presentation.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }
  frame(t) {
    const elapsed = Math.max(0, (t - this.last) / 1000);
    const renderDt = Math.min(0.1, elapsed);
    this.last = t;
    this.frameCount++;
    this.fpsTime += elapsed;
    if (this.fpsTime > 0.5) {
      this.events.fps(Math.round(this.frameCount / this.fpsTime));
      this.frameCount = 0;
      this.fpsTime = 0;
    }
    if (this.state === "lobby") {
      this.accumulator = 0;
      const a = 0.62 + Math.sin(t * 0.00006) * 0.04;
      this.camera.position.set(43 * Math.sin(a), 31, 43 * Math.cos(a));
      this.camera.fov = 48;
      this.camera.lookAt(-7, 0, -3);
      this.camera.updateProjectionMatrix();
    } else if (this.state !== "paused" && this.state !== "results") {
      const step = 1 / 60;
      this.accumulator = Math.min(0.2, this.accumulator + elapsed);
      while (this.accumulator + 1e-9 >= step) {
        this.accumulator = Math.max(0, this.accumulator - step);
        this.simulate(step);
        if (["paused", "results", "lobby"].includes(this.state)) {
          this.accumulator = 0;
          break;
        }
      }
      this.updateCamera(renderDt, this.accumulator / step);
      this.events.tick(this);
    } else this.accumulator = 0;
    this.renderer.autoClear = true;
    this.renderWorld();
    if (this.state !== "lobby" && this.player?.alive && this.viewModel) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.weaponScene, this.weaponCamera);
      this.renderer.autoClear = true;
    }
    requestAnimationFrame((t) => this.frame(t));
  }
  updateCamera(dt, alpha = 1) {
    const p = this.player;
    if (!p) return;
    if (p.alive) {
      const speed = Math.hypot(p.vx, p.vz);
      const bob =
        p.grounded && !this.crouched && this.settings.shake
          ? Math.sin(this.walkPhase) *
            0.018 *
            Math.min(1, speed / MOVEMENT.runSpeed)
          : 0;
      const stance = this.crouched ? 1.03 : 1.66;
      this.eyeHeight = THREE.MathUtils.lerp(
        this.eyeHeight ?? stance,
        stance,
        1 - Math.exp(-20 * dt),
      );
      this.stepOffset *= Math.exp(-16 * dt);
      this.landingDip *= Math.exp(-18 * dt);
      const previous = this.renderPrevious || p;
      const x = THREE.MathUtils.lerp(previous.x, p.x, alpha);
      const z = THREE.MathUtils.lerp(previous.z, p.z, alpha);
      const y = THREE.MathUtils.lerp(previous.y, p.y, alpha);
      // Interpolate body movement, not gravity: the camera follows jumps immediately.
      // Only stairs/stance get a short ease, preventing the old whole-camera lag.
      const eyeY = Math.max(
        p.y + 0.8,
        y +
          this.eyeHeight +
          this.stepOffset +
          bob -
          (this.settings.shake ? this.landingDip : 0),
      );
      this.camera.position.set(x, eyeY, z);
      this.camera.rotation.set(
        this.pitch + (this.settings.shake ? this.kick * 0.15 : 0),
        this.yaw,
        this.slideTime > 0 ? -0.015 : 0,
        "YXZ",
      );
    } else {
      const follow =
        this.entities.find((e) => e.alive && e.team === 0) ||
        this.entities.find((e) => e.alive);
      if (follow) {
        this.camera.position.lerp(
          v3(follow.x + 4, follow.y + 4, follow.z + 4),
          Math.min(1, dt * 3),
        );
        this.camera.lookAt(follow.x, follow.y + 1, follow.z);
      }
    }
    const w = WEAPONS[this.loadout[this.slot]],
      fov = this.aiming
        ? w.name === "Sniper"
          ? 32
          : this.settings.fov * 0.76
        : this.settings.fov +
          (this.slideTime > 0
            ? 6
            : clamp((Math.hypot(p.vx, p.vz) - MOVEMENT.runSpeed) * 0.35, 0, 6));
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      fov,
      1 - Math.exp(-12 * dt),
    );
    this.camera.updateProjectionMatrix();
    const activeModel = this.quickModel || this.viewModel;
    if (activeModel) {
      this.weaponAnimator ||= new WeaponAnimator();
      const look = this.lookSway || { x: 0, y: 0 };
      this.weaponAnimator.update(activeModel, {
        dt,
        phase: this.walkPhase,
        speed: Math.hypot(p.vx, p.vz),
        grounded: p.grounded,
        slide: this.slideTime > 0,
        aim: this.aiming,
        kick: this.kick,
        swap: this.switchTime || 0,
        reloading: this.reloadTime > 0,
        reload:
          this.reloadTime > 0
            ? 1 - this.reloadTime / (this.reloadTotal || w.reload || 1)
            : 0,
        shake: this.settings.shake,
        lookX: this.settings.shake ? look.x : 0,
        lookY: this.settings.shake ? look.y : 0,
        spin: this.spinTime,
        draw: this.bowCharge,
        time: this.clock,
        shotAge:
          this.lastShotAt === undefined ? 10 : this.clock - this.lastShotAt,
        flash: this.flash > 0,
        heal: this.healTime,
        swing: this.swingTime,
        guard: this.deflectTime > 0,
        inspect: this.inspectTime,
        throwing: this.throwTime,
        verticalSpeed: p.vy,
        landing: this.landingDip,
        strafe: (p.vx * Math.cos(this.yaw) - p.vz * Math.sin(this.yaw)) / 11.5,
      });
      look.x *= Math.exp(-18 * dt);
      look.y *= Math.exp(-18 * dt);
    }
  }
}
