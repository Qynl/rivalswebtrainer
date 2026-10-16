import { ReloadCues } from "./weapon-handling.js";
import { WeaponClearance } from "./weapon-clearance.js";
import { weaponPresentation } from "./weapon-presentation.js";
import { operatorPose } from "./operator-pose.js";
import { weaponFeel, shotEnvelope } from "./weapon-feel.js";
import { updateScopeGlint } from "./scope-glint.js";
import { updateProjectileTrail } from "./projectile-feedback.js";
import { FlameJet } from "./flame-fx.js";
import {
  MAX_HEALTH,
  ROUND_COUNTDOWN,
  BOW_DRAW_TIME,
  knifeDamage,
  isBackstab,
} from "./combat-rules.js";
import { DamageNumbers } from "./damage-numbers.js";
import {
  THROWN_UTILITIES,
  THROW_DURATION,
  THROW_RELEASE,
  animateThrown,
  createFirePatch,
  animateFire,
} from "./throwables.js";
import { createSmokeCloud, animateSmoke } from "./smoke-fx.js";
import { evadeHazards } from "./bot-hazards.js";
import { BotLocomotion } from "./bot-animation.js";
import { positionBot, steerBotWish } from "./bot-positioning.js";
import { ARENA } from "./arena-layout.js";
import { updateBotWeapon } from "./bot-visuals.js";
import {
  BOT_MELEES,
  initBotActions,
  tickBotActions,
  botCanShoot,
  decideBotAction,
  moveBotVelocity,
  botJump,
} from "./bot-actions.js";
import { aimArm } from "./rigging.js";
import { chooseCover, followRoute, selectOpponent } from "./bot-tactics.js";
import { CombatFX } from "./combat-fx.js";
import { ArenaRenderer } from "./rendering.js";
import { WeaponAnimator, selectShotSide } from "./animation.js";
import * as THREE from "three";
import { createProjectileModel } from "./projectile-model.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ArenaWorld, createCharacter, createViewModel } from "./world.js";
import { WEAPONS, DIFFICULTIES, MAPS } from "./data.js";
import {
  MOVEMENT,
  SIMULATION_STEP,
  accelerate,
  rampJumpBoost,
  steerSlide,
  startSlide,
} from "./movement.js";
import { clamp, moveBody, verticalStep, canOccupy } from "./physics.js";
import { MouseLook } from "./input.js";
import { GameAudio } from "./audio.js";
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const botNames = ["VEX", "NOVA", "GHOST", "ACE", "ECHO", "BLITZ"];
const botActionSounds = {
  guard: "guard",
  dash: "double",
  swing: "melee",
  slide: "step",
  doubleJump: "double",
  jump: "jump",
};
export class Game {
  constructor(canvas, settings, events) {
    this.warming = !!events.deferWarmup;
    this.canvas = canvas;
    this.settings = settings;
    this.events = events;
    this.damageNumbers = new DamageNumbers();
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
    if (events.environmentData) {
      const data = events.environmentData;
      const texture = new THREE.DataTexture(
        data.values,
        data.width,
        data.height,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
      );
      texture.mapping = THREE.CubeUVReflectionMapping;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;
      this.environmentMap = { texture, dispose: () => texture.dispose() };
    } else {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environmentMap = pmrem.fromScene(room, 0.035, 0.1, 100, {
        size: 128,
      });
      room.dispose();
      pmrem.dispose();
    }
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = 0.38;
    this.camera = new THREE.PerspectiveCamera(
      settings.fov,
      innerWidth / innerHeight,
      0.08,
      180,
    );
    this.camera.rotation.order = "YXZ";
    const fill = new THREE.HemisphereLight(0xddeaf5, 0x515f6a, 0.85);
    fill.name = "arena-fill";
    this.scene.add(fill);
    const sun = new THREE.DirectionalLight(0xfff3e6, 2.6);
    sun.name = "arena-sun";
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
    this.muzzleLight = new THREE.PointLight(0xffd29a, 0, 3, 2);
    this.scene.add(this.muzzleLight);
    this.world = new ArenaWorld(this.scene);
    this.world.build();
    this.combatFX = new CombatFX(this.scene);
    this.flameFX = new FlameJet(this.scene);
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
    this.weaponFlashLight = new THREE.PointLight(0xffc889, 0, 2.2, 2);
    this.weaponScene.add(this.weaponFlashLight);
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
  async prepare() {
    // Parallel shader compilation happens behind the already-painted React shell.
    // No shadow, texture, resolution or post-processing quality is reduced.
    this.camera.position.set(8, 12, 13);
    this.camera.lookAt(0, 2, 0);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.autoClear = true;
    this.renderWorld();
    this.warming = false;
    this.last = performance.now();
  }
  bindInputs() {
    document.addEventListener("pointerlockchange", () => {
      if (
        document.pointerLockElement !== this.canvas &&
        ["playing", "countdown", "roundend"].includes(this.state)
      ) {
        if (!this.selectingLoadout) this.pause();
      } else if (document.pointerLockElement === this.canvas) {
        this.captureTime = performance.now();
        this.mouseLook.reset(this.captureTime);
        this.lookSway = { x: 0, y: 0 };
        this.keys.clear();
        if (this.state === "paused") {
          this.state = this.previousState;
          this.events.pause(false);
        }
      }
    });
    document.addEventListener("pointerlockerror", () => {
      // Chromium may dispatch the raw-input error before OR after rejecting
      // its promise. Do not let either ordering pause a normal-lock fallback.
      if (this.rawMousePending) {
        this.rawMouseErrorSeen = true;
        return;
      }
      if (this.ignoredRawErrors > 0 && performance.now() < this.rawErrorUntil) {
        this.ignoredRawErrors--;
        return;
      }
      this.events.toast(
        "Mouse capture unavailable. Click “Back to the arena” to try again.",
      );
      if (this.state !== "lobby") this.pause();
    });
    document.addEventListener("mousemove", (e) => {
      if (
        document.pointerLockElement === this.canvas &&
        this.player?.alive &&
        ["playing", "countdown", "roundend"].includes(this.state)
      ) {
        const movement = this.mouseLook.accept(
          e.movementX,
          e.movementY,
          performance.now(),
          e.timeStamp,
          this.settings.invertMouseY,
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
          "KeyG",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
        ].includes(e.code)
      )
        e.preventDefault();
      if (
        e.code === "KeyM" &&
        !e.repeat &&
        this.state === "countdown" &&
        !this.selectingLoadout
      ) {
        e.preventDefault();
        this.beginSelection();
        return;
      }
      if (this.selectingLoadout) return;
      if (e.code === "Escape") {
        this.pause();
        return;
      }
      this.keys.add(e.code);
      if (!e.repeat && this.state === "playing")
        this.network?.keyAction(e.code);
      if (e.repeat || this.state !== "playing") return;
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
        this.network?.sendInput();
      if (e.code === "Space") this.jump();
      if (
        e.code === "KeyC" ||
        e.code.startsWith("Control") ||
        e.code.startsWith("Shift")
      )
        this.slide();
      if (e.code === "KeyF") this.meleeAbility(true);
      if (e.code === "KeyG") this.quickUtility();
      if (e.code === "KeyR") this.reload();
      if (e.code === "KeyT" && !this.reloadTime) this.inspectTime = 1.8;
      if (/^Digit[1-4]$/.test(e.code)) this.equip(+e.code.slice(-1) - 1);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code))
        this.network?.sendInput();
    });
    window.addEventListener("mousedown", (e) => {
      if (
        document.pointerLockElement !== this.canvas ||
        this.state !== "playing" ||
        this.selectingLoadout
      )
        return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.queueFire();
        this.network?.action("fire");
      }
      if (e.button === 2) {
        this.network?.secondary();
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
        this.network?.action("release");
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
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.mouseLook.reset(performance.now());
        this.lookSway = { x: 0, y: 0 };
        this.pause();
      }
    });
    window.addEventListener("blur", () => {
      this.mouseLook.reset(performance.now());
      this.lookSway = { x: 0, y: 0 };
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
    const failed = () => {
      if (!["lobby", "results"].includes(this.state)) this.pause();
    };
    const capture = (raw) => {
      try {
        const promise = this.canvas.requestPointerLock(
          raw ? { unadjustedMovement: true } : undefined,
        );
        if (raw && promise?.then) {
          this.rawMousePending = true;
          this.rawMouseErrorSeen = false;
        }
        promise?.then(
          () => {
            this.rawMousePending = false;
          },
          (error) => {
            this.rawMousePending = false;
            if (
              raw &&
              ["NotSupportedError", "TypeError"].includes(error.name)
            ) {
              this.rawMouseSupported = false;
              this.ignoredRawErrors = this.rawMouseErrorSeen ? 0 : 1;
              this.rawErrorUntil = performance.now() + 500;
              capture(false);
            } else failed();
          },
        );
      } catch (error) {
        if (raw) {
          this.rawMousePending = false;
          this.rawMouseSupported = false;
          capture(false);
        } else {
          failed();
          this.events.toast("Mouse capture unavailable. Click to retry.");
        }
      }
    };
    capture(this.rawMouseSupported !== false);
  }
  start(config) {
    if (config.capture !== false) this.requestLock();
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
  }
  beginSelection() {
    if (
      this.state !== "countdown" ||
      this.selectingLoadout ||
      !this.player?.alive
    )
      return false;
    this.selectingLoadout = true;
    this.network?.beginSelection();
    this.fireBufferedUntil = 0;
    this.mouseDown = this.trigger = this.aiming = false;
    this.keys.clear();
    document.exitPointerLock?.();
    this.events.selectWeapons?.();
    return true;
  }
  finishSelection(loadout) {
    if (!this.selectingLoadout) return false;
    if (
      loadout &&
      this.player?.alive &&
      ["countdown", "playing"].includes(this.state)
    ) {
      const next = loadout.map((id, i) =>
        WEAPONS[id]?.slot === i ? id : this.loadout[i],
      );
      // Preserve ammunition for unchanged slots; never refill a spent utility.
      this.ammunition = next.map((id, i) =>
        id === this.loadout[i]
          ? this.ammunition[i]
          : { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve },
      );
      this.loadout = next;
      this.config.loadout = [...next];
      this.slot = -1;
      this.equip(0);
    }
    this.network?.finishSelection(loadout ? this.loadout : null);
    this.selectingLoadout = false;
    this.keys.clear();
    this.events.update(this);
    if (["countdown", "playing", "roundend"].includes(this.state))
      this.requestLock();
    return true;
  }
  cleanEntities() {
    this.cancelThrow(false);
    this.disposeQuickModels();
    this.damageNumbers?.clear();
    this.combatFX?.clear();
    this.flameFX?.clear();
    for (const e of this.entities) {
      if (e.model) {
        this.scene.remove(e.model.group);
        this.disposeVisual(e.model.group);
      }
    }
    this.entities = [];
    for (const e of this.effects) {
      this.scene.remove(e.mesh);
      this.disposeVisual(e.mesh);
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
  createEntity(
    team,
    position,
    index,
    isPlayer = false,
    target = false,
    displayName = null,
  ) {
    const e = {
      team,
      name:
        displayName ||
        (isPlayer
          ? "YOU"
          : target
            ? "TARGET"
            : botNames[index % botNames.length]),
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
      health: MAX_HEALTH,
      maxHealth: MAX_HEALTH,
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
    if (!isPlayer && !target)
      initBotActions(
        e,
        BOT_MELEES[
          (index + Math.max(0, (this.round || 1) - 1)) % BOT_MELEES.length
        ],
      );
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
    this.audio?.clearSpatial?.();
    this.selectingLoadout = false;
    this.playerMeleePending = null;
    this.round++;
    this.player = this.createEntity(0, this.world.spawns[0][0], 0, true);
    this.yaw = 0;
    this.pitch = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.coyoteTime = 0;
    this.jumpBuffer = 0;
    this.walkPhase = 0;
    this.stepDistance = 0;
    this.stepOffset = 0;
    this.landingDip = 0;
    this.crouched = false;
    this.forcedCrouch = false;
    this.dashTime = 0;
    this.renderPrevious = null;
    this.accumulator = 0;
    this.dashCooldown = 0;
    this.deflectTime = 0;
    this.deflectCooldown = 0;
    this.knifeQuickCooldown = 0;
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
    this.weaponReadyAt = [0, 0, 0, 0];
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
      if (!this.config.online) {
        for (let i = 1; i < this.config.mode; i++)
          this.createEntity(0, this.world.spawns[0][i], i + 2);
        for (let i = 0; i < this.config.mode; i++)
          this.createEntity(1, this.world.spawns[1][i], i);
      }
      this.state = "countdown";
      this.countdown = ROUND_COUNTDOWN;
      this.countSound = ROUND_COUNTDOWN + 1;
      this.events.banner(
        "ROUND " + this.round,
        String(ROUND_COUNTDOWN),
        "M to change weapons · Eliminate the rivals. First to 5.",
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
    if (!this.network?.applying) this.network?.action("slot" + slot);
    this.cancelThrow();
    this.playerMeleePending = null;
    this.fireBufferedUntil = 0;
    this.clearQuickMelee();
    this.trimQuickModels();
    this.deflectTime = 0;
    this.slot = slot;
    this.inspectTime = 0;
    this.throwTime = 0;
    this.throwReleased = false;
    this.bowCharge = 0;
    this.bowRelease = false;
    this.spinTime = 0;
    this.healTime = 0;
    this.reloadTime = 0;
    this.burstCount = 0;
    this.aiming = false;
    const equipTime = WEAPONS[this.loadout[slot]].slot === 1 ? 0.14 : 0.22;
    this.cooldown = Math.max(
      equipTime,
      (this.weaponReadyAt?.[slot] || 0) - (this.clock || 0),
    );
    this.trigger = false;
    if (this.headless) {
      this.switchTime = equipTime;
      return;
    }
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
    this.viewModel.scale.setScalar(
      weaponPresentation(this.loadout[slot]).scale,
    );
    this.weaponScene.add(this.viewModel);
    this.weaponAnimator?.equip();
    this.switchTime = equipTime;
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
      p.vy = MOVEMENT.jumpSpeed + rampJumpBoost(p);
      p.grounded = false;
      p.jumps = 1;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      p.landingGrace = 0;
      this.audio.play("jump");
      // Carry the slide's actual velocity instead of snapping back to running speed.
      if (this.slideTime > 0) {
        this.slideTime = 0;
        p.airCarrySpeed = Math.hypot(p.vx, p.vz);
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
    // No speed gate or post-slide lockout. Ignore extra presses during an
    // active slide instead of resetting its timer or stacking another boost.
    if (!p?.alive || this.slideTime > 0) return;
    if (!p.grounded) {
      this.slideBuffer = MOVEMENT.slideBuffer;
      return;
    }
    this.slideBuffer = 0;
    this.slideTime = MOVEMENT.slideDuration;
    this.slideCooldown = MOVEMENT.slideCooldown;
    startSlide(p, this.moveDirection(), this.yaw);
    p.height = 1.15;
    this.crouched = true;
    this.audio.noiseHit(MOVEMENT.slideDuration, 0.08, 800);
  }
  dash() {
    if (this.dashCooldown > 0 || !this.player?.alive) return false;
    this.dashCooldown = 3;
    this.dashTime = 0.24;
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
    if (
      !this.player?.alive ||
      this.state !== "playing" ||
      this.pendingThrow ||
      this.quickUtilityTime > 0
    )
      return false;
    const id = quick ? this.loadout[2] : this.loadout[this.slot];
    const weapon = WEAPONS[id];
    let duration = 0.36;
    if (quick && id === "knife") {
      if (
        this.knifeQuickCooldown > 0 ||
        (this.weaponReadyAt?.[2] || 0) > (this.clock || 0) ||
        this.playerMeleePending ||
        this.quickMeleeTime > 0 ||
        this.deflectTime > 0
      )
        return false;
      // Separate recovery permits a rocket/launcher -> F combo, not a gun timer wait.
      this.knifeQuickCooldown = weapon.interval;
      (this.weaponReadyAt ||= [0, 0, 0, 0])[2] =
        (this.clock || 0) + weapon.interval;
      this.knifeQuickTime = 0.36;
      this.cooldown = Math.max(this.cooldown || 0, weapon.interval);
      this.reloadTime = this.healTime = this.burstCount = this.inspectTime = 0;
      this.mouseDown = this.trigger = false;
      this.swingTime = 0.36;
      this.swingSequence = (this.swingSequence || 0) + 1;
      this.backstabTime = 0;
      this.knifeStabAttack = true;
      this.playerMeleePending = {
        id,
        remaining: 0.105,
        quick: true,
        slot: this.slot,
      };
      duration = 0.42;
      this.audio.play("melee");
    } else if (weapon.dash) {
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
  // G uses utility-slot inventory/recovery, never the selected gun's ammo or timer.
  quickUtility() {
    const id = this.loadout[3],
      w = WEAPONS[id],
      a = this.ammunition?.[3];
    if (
      !this.player?.alive ||
      this.state !== "playing" ||
      this.selectingLoadout ||
      !w ||
      w.slot !== 3 ||
      !a ||
      this.pendingThrow ||
      this.quickUtilityTime > 0 ||
      this.quickMeleeTime > 0 ||
      this.deflectTime > 0 ||
      this.healTime > 0 ||
      this.playerMeleePending ||
      (this.weaponReadyAt?.[3] || 0) > (this.clock || 0)
    )
      return false;
    if (a.mag <= 0) {
      this.audio.play("empty");
      this.events.toast?.(w.name + " is empty. Utility restocks next round.");
      return false;
    }
    if (w.type === "heal") {
      if (!this.beginHeal(true, 3)) return false;
    } else {
      if (!THROWN_UTILITIES.has(id)) return false;
      if (!this.range) a.mag--;
      this.pendingThrow = {
        owner: this.player,
        id,
        remaining: THROW_RELEASE,
        ammo: a,
        slot: 3,
        quick: true,
      };
      this.throwTime = THROW_DURATION;
      this.throwReleased = false;
      this.matchStats.shots++;
      this.audio.play(w.sound);
    }
    const duration = w.type === "heal" ? this.healTime : THROW_DURATION;
    (this.weaponReadyAt ||= [0, 0, 0, 0])[3] = (this.clock || 0) + w.interval;
    this.reloadTime =
      this.burstCount =
      this.inspectTime =
      this.bowCharge =
      this.fireBufferedUntil =
        0;
    this.bowRelease = this.mouseDown = this.trigger = this.aiming = false;
    if (this.slot !== 3) this.showQuickAction(id, duration, true);
    else {
      this.quickUtilityTime = duration;
      this.cooldown = Math.max(this.cooldown || 0, w.interval);
    }
    this.events.update(this);
    return true;
  }
  showQuickMelee(id, duration) {
    this.showQuickAction(id, duration);
  }
  showQuickAction(id, duration, utility = false) {
    this.clearQuickMelee();
    this.quickModelId = id;
    this[utility ? "quickUtilityTime" : "quickMeleeTime"] = duration;
    if (this.headless) return;
    this.trimQuickModels();
    this.quickModels ||= new Map();
    this.quickModel = this.quickModels.get(id);
    if (!this.quickModel) {
      this.quickModel = createViewModel(id, WEAPONS[id]);
      this.quickModel.scale.setScalar(0.78);
      this.quickModels.set(id, this.quickModel);
    }
    this.quickModel.visible = true;
    this.weaponScene.add(this.quickModel);
    if (this.viewModel) this.viewModel.visible = false;
    this.weaponAnimator?.quickDraw();
  }
  clearQuickMelee() {
    if (this.quickModel) {
      this.weaponScene.remove(this.quickModel);
      if (this.quickModels?.get(this.quickModelId) !== this.quickModel)
        this.disposeVisual(this.quickModel);
    }
    this.quickModel = null;
    this.quickModelId = null;
    this.quickMeleeTime = this.quickUtilityTime = 0;
    if (this.viewModel) this.viewModel.visible = true;
  }
  trimQuickModels() {
    // At most the currently equipped melee + utility, never the whole roster.
    for (const [id, model] of this.quickModels || []) {
      if (id === this.loadout[2] || id === this.loadout[3]) continue;
      this.disposeVisual(model);
      this.quickModels.delete(id);
    }
  }
  disposeQuickModels() {
    this.clearQuickMelee();
    for (const model of this.quickModels?.values() || [])
      this.disposeVisual(model);
    this.quickModels?.clear();
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
    if (
      !this.player?.alive ||
      this.reloadTime > 0 ||
      this.pendingThrow ||
      this.quickUtilityTime > 0 ||
      this.quickMeleeTime > 0 ||
      this.healTime > 0
    )
      return;
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
    const height = e.isPlayer
      ? this.crouched
        ? 1.02
        : 1.66
      : Math.min(1.66, (e.height || 1.9) - 0.17);
    return v3(e.x, e.y + height, e.z);
  }
  hasLOS(a, b, includeSmoke = true) {
    const d = b.clone().sub(a),
      distance = d.length();
    if (distance < 0.1) return true;
    this.ray.set(a, d.normalize());
    this.ray.far = distance;
    const hits = this.ray.intersectObjects(this.world.solidMeshes, false);
    if (hits.length && hits[0].distance < distance - 0.1) return false;
    for (const s of includeSmoke ? this.smokes : []) {
      const line = new THREE.Line3(a, b),
        p = v3();
      line.closestPointToPoint(s.pos, true, p);
      if (p.distanceTo(s.pos) < s.radius) return false;
    }
    return true;
  }
  queueFire() {
    this.trigger = true;
    // A tap just before recovery ends is one request, not a macro/autofire.
    this.fireBufferedUntil = (this.clock || 0) + 0.14;
    this.fireBufferedWeapon = this.loadout[this.slot];
  }
  firePlayer() {
    const p = this.player;
    if (
      !p?.alive ||
      this.cooldown > 0 ||
      this.reloadTime > 0 ||
      this.deflectTime > 0 ||
      this.quickMeleeTime > 0 ||
      this.quickUtilityTime > 0 ||
      this.healTime > 0 ||
      this.pendingThrow
    )
      return;
    const id = this.loadout[this.slot],
      w = WEAPONS[id],
      a = this.ammunition[this.slot];
    if (w.type === "heal") {
      return this.beginHeal(false);
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
    (this.weaponReadyAt ||= [0, 0, 0, 0])[this.slot] =
      (this.clock || 0) + w.interval;
    this.inspectTime = 0;
    this.presentShot(id);
    // Visual stance easing must not put the bullet below the visible crosshair.
    const origin = this.camera ? this.camera.position.clone() : this.eye(p),
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
          delta.normalize().dot(forward) > 0.98 &&
          this.hasLOS(origin, this.eye(enemy))
        ) {
          this.damage(enemy, w.damage, p);
          enemy.burnUntil = this.clock + 1.5;
          enemy.burnOwner = p;
          hit = true;
        }
      }
      if (hit && !this.network) {
        this.matchStats.hits++;
        this.events.hit(false);
      }
      const socket = this.viewModel?.userData.flameSocket;
      this.viewModel?.updateWorldMatrix(true, true);
      this.camera?.updateMatrixWorld();
      const muzzle =
        socket && this.camera
          ? this.weaponPointToWorld(socket.getWorldPosition(v3()))
          : origin;
      this.flameFX?.emit(
        muzzle,
        forward,
        this.world.solidMeshes,
        10,
        "local",
        origin,
      );
    } else if (w.type === "rocket" || w.type === "launcher" || w.slot === 3) {
      if (THROWN_UTILITIES.has(id)) {
        this.pendingThrow = { owner: p, id, remaining: THROW_RELEASE, ammo: a };
        this.throwTime = THROW_DURATION;
        this.throwReleased = false;
      } else this.spawnProjectile(p, origin, forward, id);
      this.matchStats.shots++;
    } else if (w.type === "melee") {
      this.swingTime = 0.36;
      this.swingSequence = (this.swingSequence || 0) + 1;
      this.backstabTime = 0;
      this.knifeStabAttack =
        id === "knife" &&
        this.entities.some(
          (e) =>
            e.alive &&
            e.team !== p.team &&
            isBackstab(p, e) &&
            this.eye(e).distanceTo(origin) < w.range &&
            this.eye(e).sub(origin).normalize().dot(forward) > 0.45 &&
            this.hasLOS(origin, this.eye(e)),
        );
      this.playerMeleePending = { id, remaining: 0.105 };
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
    this.fireBufferedUntil = 0;
    this.events.update(this);
    return true;
  }
  updatePlayerMelee(dt) {
    const attack = this.playerMeleePending;
    if (!attack) return;
    attack.remaining -= dt;
    if (attack.remaining > 1e-8) return;
    this.playerMeleePending = null;
    if (
      !this.player?.alive ||
      (attack.quick
        ? this.loadout[2] !== attack.id || this.slot !== attack.slot
        : this.loadout[this.slot] !== attack.id)
    )
      return;
    const p = this.player,
      w = WEAPONS[attack.id],
      origin = this.eye(p);
    const forward = v3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
    );
    const targets = this.entities
      .filter((e) => e.alive && e.team !== p.team)
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      );
    for (const e of targets) {
      const delta = this.eye(e).sub(origin);
      if (
        delta.length() >= w.range ||
        delta.normalize().dot(forward) <= 0.45 ||
        !this.hasLOS(origin, this.eye(e))
      )
        continue;
      const backstab = attack.id === "knife" && isBackstab(p, e);
      if (backstab) {
        this.backstabTime = 0.26;
        this.knifeStabAttack = true;
      }
      this.damage(
        e,
        attack.id === "knife" ? knifeDamage(p, e) : w.damage,
        p,
        false,
        p,
        backstab,
      );
      if (!this.network) {
        this.events.hit(false);
        this.audio.play("hit");
      }
      break;
    }
  }
  // Presentation only: safe for immediate network prediction; never spends
  // ammunition, spawns a gameplay projectile, or confirms damage.
  presentShot(id = this.loadout[this.slot], age = 0) {
    const w = WEAPONS[id];
    if (!w || w.slot > 1) return;
    this.flash = Math.max(0, 0.065 - age);
    this.lastShotAt = this.clock - Math.max(0, age);
    this.shotSequence = (this.shotSequence || 0) + 1;
    selectShotSide(this.viewModel, this.shotSequence);
    this.kick = Math.min(
      0.13,
      this.kick + Math.min(0.09, weaponFeel(id).kick * 0.7),
    );
    if (w.type !== "flame" || !this.audio.updateFlame) this.audio.play(w.sound);
    if (
      this.combatFX?.eject &&
      w.slot < 2 &&
      id !== "revolver" &&
      !["bow", "flame", "rocket", "launcher", "paint"].includes(w.type) &&
      !w.paint
    ) {
      this.viewModel?.updateWorldMatrix(true, true);
      this.camera?.updateMatrixWorld();
      const socket = this.viewModel?.userData.bolt;
      const local = socket
        ? socket.getWorldPosition(v3())
        : v3(0.24, -0.16, -0.65).applyMatrix4(
            this.viewModel?.matrixWorld || new THREE.Matrix4(),
          );
      const eject = this.weaponPointToWorld(local);
      this.combatFX.eject(
        eject,
        v3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)),
        v3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
        id,
      );
    }
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
        v3(e.x - 0.46, e.y, e.z - 0.36),
        v3(e.x + 0.46, e.y + h, e.z + 0.36),
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
      nearest > 1.4 ? this.visualMuzzle(shooter, origin) : origin,
      origin.clone().addScaledVector(dir, nearest),
      shooter.team,
      w.paint ? 0xff73a4 : undefined,
    );
    if (!victim && walls[0] && !w.paint) {
      const normal = walls[0].face.normal
        .clone()
        .transformDirection(walls[0].object.matrixWorld);
      this.combatFX?.impact(walls[0].point, normal);
      this.surfaceImpact?.(walls[0].point, normal);
    }
    if (w.paint) {
      if (victim) {
        this.particles(
          origin.clone().addScaledVector(dir, nearest),
          0xff6ba7,
          5,
        );
        if (victim.context) victim.context.paintTintTime = 0.65;
        else if (victim === this.player) this.paintTintTime = 0.65;
      } else if (walls[0])
        this.paintSplat(
          walls[0].point,
          walls[0].face.normal
            .clone()
            .transformDirection(walls[0].object.matrixWorld),
        );
    }
    if (victim && victim.team !== shooter.team) {
      const localVictim = victim === this.player;
      const guarding = localVictim
        ? this.deflectTime > 0
        : victim.deflectTime > 0;
      const facing = localVictim ? this.yaw : victim.yaw;
      const guardDirection = v3(-Math.sin(facing), 0, -Math.cos(facing));
      const incoming = dir.clone().negate();
      incoming.y = 0;
      incoming.normalize();
      if (guarding && !w.paint && guardDirection.dot(incoming) > 0.25) {
        const contact = origin.clone().addScaledVector(dir, nearest);
        this.particles(contact, 0x89e5ff, 10);
        this.audio.play("parry");
        if (!victim.isPlayer) {
          victim.guardFlash = 0.2;
          if (victim.actionCounts)
            victim.actionCounts.deflections =
              (victim.actionCounts.deflections || 0) + 1;
        }
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
      if (shooter.isPlayer && !this.network) {
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
    this.reloadCues ||= new ReloadCues();
    const cue = this.reloadCues.sample(
      this.loadout?.[this.slot],
      this.reloadTime,
      this.reloadTotal || WEAPONS[this.loadout?.[this.slot]]?.reload,
      this.clock,
    );
    if (cue && this.player?.alive) this.audio?.play(cue);

    if (this.quickUtilityTime > 0) {
      this.quickUtilityTime = Math.max(0, this.quickUtilityTime - dt);
      if (this.quickUtilityTime <= 1e-8) this.clearQuickMelee();
    }
    this.knifeQuickTime = Math.max(0, (this.knifeQuickTime || 0) - dt);
    this.knifeQuickCooldown = Math.max(0, (this.knifeQuickCooldown || 0) - dt);
    this.blindTime = Math.max(0, (this.blindTime || 0) - dt);
    this.paintTintTime = Math.max(0, (this.paintTintTime || 0) - dt);
    if (this.healTime > 0) {
      this.healTime -= dt;
      if (this.healTime <= 0 && this.player.alive && !this.network) {
        this.player.health = Math.min(
          this.player.maxHealth || MAX_HEALTH,
          this.player.health + this.healAmount,
        );
        this.events.update(this);
      }
    }
  }
  beginHeal(quick = false, slot = this.slot) {
    if (
      !this.player?.alive ||
      this.state !== "playing" ||
      this.healTime > 0 ||
      this.pendingThrow ||
      WEAPONS[this.loadout[slot]]?.type !== "heal" ||
      this.player.health >= (this.player.maxHealth || MAX_HEALTH)
    )
      return false;
    const a = this.ammunition[slot];
    if (a.mag <= 0) return false;
    if (!this.range) a.mag--;
    this.healTime = this.healTotal = quick ? 0.8 : 2.2;
    this.healAmount = quick ? 25 : 70;
    this.mouseDown = false;
    this.trigger = false;
    this.aiming = false;
    this.audio.play("heal");
    this.events.update(this);
    return true;
  }
  disposeVisual(object) {
    const materials = new Set(),
      textures = new Set();
    object.traverse((o) => {
      // Instance transforms/colors are owned by the mesh, not its geometry.
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose();
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material])
        if (material) materials.add(material);
    });
    for (const m of materials) {
      for (const key of [
        "map",
        "normalMap",
        "bumpMap",
        "roughnessMap",
        "metalnessMap",
        "alphaMap",
      ])
        if (m[key]) textures.add(m[key]);
      m.dispose();
    }
    for (const t of textures) t.dispose();
  }
  weaponPointToWorld(point) {
    const ratio =
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) /
      Math.tan(THREE.MathUtils.degToRad(this.weaponCamera.fov * 0.5));
    return point
      .clone()
      .multiply(v3(ratio, ratio, 1))
      .applyMatrix4(this.camera.matrixWorld);
  }
  visualMuzzle(shooter, fallback) {
    if (
      shooter.isPlayer &&
      this.camera &&
      this.viewModel?.userData.muzzleFlash
    ) {
      this.viewModel.updateWorldMatrix(true, true);
      this.camera.updateMatrixWorld();
      return this.weaponPointToWorld(
        this.viewModel.userData.muzzleFlash.getWorldPosition(v3()),
      );
    }
    const socket = shooter.model?.parts.muzzleFlash;
    return socket ? socket.getWorldPosition(v3()) : fallback;
  }
  tracer(a, b, team, color) {
    if (this.combatFX) {
      this.combatFX.trace(a, b, team, color);
      return;
    }
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
    if (this.combatFX) {
      this.combatFX.burst(pos, color, count);
      return;
    }
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
  damage(
    e,
    amount,
    source,
    head = false,
    hitOrigin = source,
    backstab = false,
  ) {
    if (this.network) return;
    if (!e.alive || amount <= 0 || e === source) return;
    const applied = Math.min(e.health, amount);
    if (source?.isPlayer && source !== e && source.team !== e.team)
      this.damageNumbers?.add(e, applied, head, this.clock, backstab);
    if (e.model) {
      e.hitReact = 0.22;
      e.hitDirection = source ? Math.atan2(e.x - source.x, e.z - source.z) : 0;
    }
    e.health = Math.max(0, e.health - amount);
    if (e.isPlayer) {
      if (this.healTime > 0 && this.quickUtilityTime > 0)
        this.clearQuickMelee();
      this.healTime = 0;
      this.events.hurt(hitOrigin, amount);
      this.audio.play("hurt");
    } else {
      if (source && source.team !== e.team) e.pressureUntil = this.clock + 0.85;
      this.particles(
        v3(e.x, e.y + (head ? e.height - 0.2 : e.height * 0.6), e.z),
        head ? 0xffdf9a : 0xffc79c,
        6,
      );
    }
    if (e.health <= 0) {
      e.alive = false;
      if (e.model) {
        e.deathTime = 0;
        e.deathRoll = e.model.group.rotation.z;
      }
      if (e.isPlayer) {
        this.cancelThrow(false);
        this.clearQuickMelee();
        this.fireBufferedUntil = this.deflectTime = this.burstCount = 0;
        this.playerMeleePending = null;
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
      if (source?.isPlayer && source !== e && source.team !== e.team) {
        this.matchStats.kills++;
        this.audio.play("kill");
        this.events.confirmKill?.(head);
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
    this.fireBufferedUntil = this.burstCount = 0;
    this.bowCharge = 0;
    this.bowRelease = false;
    this.aiming = false;
    this.network?.sendInput();
    document.exitPointerLock?.();
    this.events.pause(true);
  }
  resume() {
    this.requestLock();
  }
  quit() {
    this.network?.leave();
    this.network = null;
    this.state = "lobby";
    document.exitPointerLock?.();
    this.clearQuickMelee();
    this.cleanEntities();
    this.player = null;
    if (this.range) this.world.build(this.config.map);
    this.events.lobby();
  }
  spawnProjectile(owner, origin, dir, id, charge = 0) {
    if (this.network) return;
    const w = WEAPONS[id],
      rocket = w.type === "rocket",
      arrow = w.type === "bow",
      mesh = this.headless ? new THREE.Object3D() : createProjectileModel(id);
    this.ray.set(origin, dir);
    this.ray.far = 0.7;
    const muzzleWall = this.ray.intersectObjects(
      this.world.solidMeshes,
      false,
    )[0];
    const clearance = muzzleWall
      ? Math.max(0, Math.min(0.55, muzzleWall.distance - 0.16))
      : THROWN_UTILITIES.has(id)
        ? 0.18
        : 0.55;
    const pos = origin.clone().addScaledVector(dir, clearance);
    mesh.position.copy(pos);
    if (rocket || arrow || id === "launcher")
      mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos,
      vel: dir
        .clone()
        .multiplyScalar(
          arrow
            ? 72 + Math.min(1, charge / BOW_DRAW_TIME) * 43
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
      damage: w.damage * (arrow ? 1 + Math.min(1, charge / BOW_DRAW_TIME) : 1),
      rocket,
      bounces: 0,
      spin: THROWN_UTILITIES.has(id)
        ? v3(id === "molotov" ? 5 : 8, 1.7, 2.3)
        : null,
    });
    if (THROWN_UTILITIES.has(id)) {
      const p = this.projectiles.at(-1);
      p.vel.x += (owner.vx || 0) * 0.35;
      p.vel.z += (owner.vz || 0) * 0.35;
    }
  }
  projectileBounce(p, position) {
    if (!THROWN_UTILITIES.has(p.id) || p.bounces > 3 || p.vel.lengthSq() < 2.25)
      return;
    if (this.audio.playAt && this.player)
      this.audio.playAt(
        "bounce",
        position,
        this.eye(this.player),
        this.yaw,
        0.45,
      );
  }
  cancelThrow(refund = true) {
    const p = this.pendingThrow;
    if (p && refund && !this.range && p.ammo && Number.isFinite(p.ammo.mag))
      p.ammo.mag = Math.min(WEAPONS[p.id].mag, p.ammo.mag + 1);
    this.pendingThrow = null;
    this.throwReleased = false;
    this.throwTime = 0;
  }
  updateThrow(dt) {
    const p = this.pendingThrow;
    if (!p) return;
    p.remaining -= dt;
    if (p.remaining > 1e-8) return;
    if (!p.owner.alive || (p.quick && this.loadout[3] !== p.id)) {
      this.cancelThrow(false);
      return;
    }
    const dir = v3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
    );
    const eye = this.eye(p.owner),
      hand = eye
        .clone()
        .addScaledVector(v3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.18)
        .addScaledVector(dir, 0.18);
    hand.y -= 0.08;
    const segment = hand.clone().sub(eye);
    this.ray.set(eye, segment.clone().normalize());
    this.ray.far = segment.length() + 0.05;
    const wall = this.ray.intersectObjects(this.world.solidMeshes, false)[0];
    if (wall)
      hand
        .copy(wall.point)
        .addScaledVector(
          wall.face.normal.clone().transformDirection(wall.object.matrixWorld),
          0.18,
        );
    this.spawnProjectile(p.owner, hand, dir, p.id);
    this.pendingThrow = null;
    this.throwReleased = true;
  }
  explosion(pos, owner, id) {
    const w = WEAPONS[id];
    if (id === "flashbang") {
      this.audio.play("flash");
      this.particles(pos, 0xffffff, 24);
      for (const e of this.entities) {
        if (!e.alive || e === owner) continue;
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
        mesh = this.headless ? new THREE.Object3D() : createSmokeCloud();
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
      const grounded = pos.clone();
      this.ray.set(pos.clone().add(v3(0, 0.2, 0)), v3(0, -1, 0));
      this.ray.far = 30;
      const support = this.ray.intersectObjects(
        this.world.solidMeshes,
        false,
      )[0];
      grounded.y = support ? support.point.y : Math.max(0, pos.y - 0.2);
      const mesh = this.headless ? new THREE.Object3D() : createFirePatch();
      mesh.position.copy(grounded);
      this.scene.add(mesh);
      const effect = { mesh, life: 5, max: 5, fire: true };
      this.effects.push(effect);
      this.fires.push({ pos: grounded, effect, owner, tick: 0 });
      this.particles(grounded, 0xffa44c, 16);
      return;
    }
    if (this.audio.playAt && this.player)
      this.audio.playAt("explosion", pos, this.eye(this.player), this.yaw);
    else this.audio.play("explosion");
    this.particles(pos, 0xffbd68, 35);
    const mesh = this.headless
      ? new THREE.Object3D()
      : new THREE.Mesh(
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
        if (e !== owner) this.damage(e, dmg, owner, false, pos);
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
              v3(e.x - 0.46, e.y, e.z - 0.36),
              v3(e.x + 0.46, e.y + e.height, e.z + 0.36),
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
          this.projectileBounce(p, next);
        }
      }
      p.pos.copy(next);
      p.mesh.position.copy(next);
      if (!this.headless)
        updateProjectileTrail(p, this.combatFX, dt, p.owner.team);
      if ((p.arrow || p.id === "launcher") && p.vel.lengthSq() > 0)
        p.mesh.quaternion.setFromUnitVectors(
          v3(0, 1, 0),
          p.vel.clone().normalize(),
        );
      if (p.mesh.userData.exhaust)
        p.mesh.userData.exhaust.scale.set(
          1 + Math.sin((this.clock || 0) * 90) * 0.12,
          1,
          1 + Math.cos((this.clock || 0) * 90) * 0.12,
        );
      animateThrown(p, dt, this.clock || 0);
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
            e.team !== fire.owner.team &&
            Math.hypot(e.x - fire.pos.x, e.z - fire.pos.z) < 3.2 &&
            Math.abs(e.y - fire.pos.y) < 1.5 &&
            this.hasLOS(fire.pos.clone().add(v3(0, 0.2, 0)), this.eye(e))
          )
            this.damage(e, 8, fire.owner, false, fire.pos);
      }
    }
    this.fires = this.fires.filter((f) => f.effect.life > 0);
    this.smokes = this.smokes.filter((s) => s.effect.life > 0);
  }
  updatePlayer(dt) {
    const p = this.player;
    if (!p.alive) return;
    this.updatePlayerMelee(dt);
    this.updateThrow(dt);
    const w = WEAPONS[this.loadout[this.slot]];
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.slideTime = Math.max(0, this.slideTime - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyoteTime = p.grounded
      ? MOVEMENT.coyoteTime
      : Math.max(0, this.coyoteTime - dt);
    p.landingGrace = Math.max(0, (p.landingGrace || 0) - dt);
    if (this.jumpBuffer > 0) this.tryJump();
    this.forcedCrouch = !canOccupy(p, p.x, p.y, p.z, this.world.boxes, 1.9);
    this.crouched = this.slideTime > 0 || this.forcedCrouch;
    p.height = this.crouched ? 1.15 : 1.9;
    p.yaw = this.yaw;
    const dir = this.moveDirection();
    let speed = w.slot === 2 ? MOVEMENT.meleeSpeed : MOVEMENT.runSpeed;
    speed *= w.moveSpeed || 1;
    if (this.healTime > 0) speed *= 0.55;
    if (this.aiming) speed *= 0.75;

    if (this.crouched && this.slideTime <= 0) speed *= 0.55;
    this.slideBuffer = Math.max(0, (this.slideBuffer || 0) - dt);
    if (this.slideBuffer > 0 && p.grounded) this.slide();
    if (this.slideTime > 0) steerSlide(p, dir, dt);
    else accelerate(p, dir, speed, dt);
    const oldX = p.x,
      oldZ = p.z,
      oldY = p.y,
      previousSlope = p.groundSlope,
      wasGrounded = p.grounded;
    moveBody(p, p.vx * dt, p.vz * dt, this.world.boxes);
    const fallingVelocity = p.vy;
    verticalStep(p, dt, this.world.boxes);
    const elevationChange = p.y - oldY;
    if (wasGrounded && p.grounded && Math.abs(elevationChange) > 0.025) {
      const expected = previousSlope
        ? previousSlope.x * (p.x - oldX) + previousSlope.z * (p.z - oldZ)
        : 0;
      const extra = elevationChange - expected;
      if (Math.abs(extra) > 0.025)
        this.stepOffset = clamp((this.stepOffset || 0) - extra, -0.4, 0.4);
    }
    if (!wasGrounded && p.grounded) {
      p.landingGrace = MOVEMENT.landingGrace;
      if (fallingVelocity < -3) {
        this.landingDip = Math.min(0.018, -fallingVelocity * 0.001);
        this.audio.play("land", Math.min(1, -fallingVelocity / 18));
        if (fallingVelocity < -10)
          this.combatFX?.burst(v3(p.x, p.y + 0.07, p.z), 0xb3afa5, 4);
      }
    }
    if (p.grounded && this.jumpBuffer > 0) this.tryJump();
    else if (p.grounded && this.slideBuffer > 0) this.slide();
    if (this.slideTime > 0 && Math.hypot(p.vx, p.vz) < 2) this.slideTime = 0;
    const bounds = this.world.bounds || {
      minX: -23.1,
      maxX: 23.1,
      minZ: -23.1,
      maxZ: 23.1,
    };
    const boundedX = clamp(p.x, bounds.minX, bounds.maxX),
      boundedZ = clamp(p.z, bounds.minZ, bounds.maxZ);
    if (boundedX !== p.x) p.vx = 0;
    if (boundedZ !== p.z) p.vz = 0;
    p.x = boundedX;
    p.z = boundedZ;
    this.walkPhase += Math.hypot(p.x - oldX, p.z - oldZ) * 1.8;
    this.stepDistance =
      (this.stepDistance || 0) + Math.hypot(p.x - oldX, p.z - oldZ);
    if (
      p.grounded &&
      this.slideTime <= 0 &&
      this.stepDistance > (this.crouched ? 2.2 : 3.4)
    ) {
      this.stepDistance = 0;
      this.audio.play(
        "step",
        this.crouched
          ? 0.45
          : Math.min(1, Math.hypot(p.vx, p.vz) / MOVEMENT.runSpeed),
      );
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
      const ready =
        this.reloadTime <= 0 &&
        this.cooldown <= 0 &&
        !(this.quickMeleeTime > 0) &&
        !(this.quickUtilityTime > 0) &&
        this.deflectTime <= 0 &&
        this.ammunition[this.slot].mag > 0;
      if (this.mouseDown && ready)
        this.bowCharge = Math.min(BOW_DRAW_TIME, (this.bowCharge || 0) + dt);
      if (this.bowRelease) {
        if (ready && this.bowCharge > 0) this.firePlayer();
        this.bowCharge = 0;
        this.bowRelease = false;
      }
      this.trigger = false;
      return;
    }
    const fireRequested =
      this.trigger ||
      (this.fireBufferedUntil > (this.clock || 0) &&
        this.fireBufferedWeapon === this.loadout[this.slot]);
    if (
      w.type === "burst" &&
      fireRequested &&
      this.ammunition[this.slot].mag <= 0
    )
      this.firePlayer(); // Empty burst weapons should reload on a tap too.
    if (
      w.type === "burst" &&
      fireRequested &&
      !(this.quickMeleeTime > 0) &&
      !(this.quickUtilityTime > 0) &&
      !(this.deflectTime > 0) &&
      !(this.healTime > 0) &&
      !this.pendingThrow &&
      this.cooldown <= 0 &&
      this.reloadTime <= 0 &&
      this.ammunition[this.slot].mag > 0
    ) {
      this.burstCount = w.burstSize || 3;
      this.fireBufferedUntil = 0;
      this.burstTimer = 0;
      this.trigger = false;
    }
    if (this.burstCount > 0) {
      // Empty/partial bursts must not count phantom shots or push the counter negative.
      if (this.reloadTime > 0 || this.ammunition[this.slot].mag <= 0) {
        this.burstCount = 0;
        if (this.ammunition[this.slot].mag <= 0 && this.reloadTime <= 0)
          this.reload();
        return;
      }
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.cooldown = 0;
        if (this.firePlayer()) {
          this.burstCount--;
          this.burstTimer = w.burstSpacing || 0.075;
          this.cooldown = this.burstCount ? 0 : w.interval;
        }
      }
    } else if (
      w.type !== "burst" &&
      (w.type === "auto" || w.type === "flame"
        ? this.mouseDown || fireRequested
        : fireRequested)
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
        e.health = e.maxHealth || MAX_HEALTH;
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
    const impact = tickBotActions(e, dt);
    if (impact) this.resolveBotMelee(e, impact);
    const d = DIFFICULTIES[this.config.difficulty];
    const skill = ["rookie", "regular", "veteran", "elite"].indexOf(
      this.config.difficulty,
    );
    let movementPath = null;
    e.pathTimer -= dt;
    e.shootTimer -= dt;
    e.decision -= dt;
    e.sliding = e.slideTime;
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
      const selection = selectOpponent(
        e,
        enemies,
        (opponent) =>
          !(e.blindedUntil > this.clock) &&
          this.hasLOS(origin, this.eye(opponent)),
      );
      target = selection.target;
      if (target !== e.targetEntity) e.seen = 0;
      e.targetEntity = target;
      visible = selection.visible;
      e.visible = visible;
      if (visible) {
        e.lastKnown = { x: target.x, y: target.y, z: target.z };
        e.lastKnownAt = this.clock;
        if (Math.random() < 0.3) e.strafe *= -1;
      } else e.seen = 0;
    } else {
      target = e.targetEntity?.alive ? e.targetEntity : target;
      visible =
        e.visible &&
        this.hasLOS(origin, this.eye(target)) &&
        !(e.blindedUntil > this.clock);
    }
    e.visible = visible;
    if (!visible) e.seen = 0;
    const distance = Math.hypot(e.x - target.x, e.z - target.z);
    if (visible) e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
    if (e.lastKnown && this.clock - (e.lastKnownAt ?? this.clock) > 3.5)
      e.lastKnown = null;
    let dx = 0,
      dz = 0;
    if (visible) {
      e.seen += dt;
      const tx = (target.x - e.x) / Math.max(0.1, distance),
        tz = (target.z - e.z) / Math.max(0.1, distance);
      const rushing =
        e.activeWeapon === e.meleeId ||
        (e.meleeId === "scythe" && e.dashCooldown > 1.8 && distance < 12) ||
        (distance < 6 && e.health > 35);
      const approach = rushing
        ? distance > 2.3
          ? 1
          : 0
        : distance > 16
          ? 0.8
          : distance < 7
            ? -0.65
            : 0.12;
      const strafe = rushing ? 0.23 : 0.75;
      dx = tx * approach + tz * e.strafe * strafe;
      dz = tz * approach - tx * e.strafe * strafe;
      if (e.health < 35 || e.reload > 0) {
        dx = -tx * 0.9 + tz * e.strafe * 0.5;
        dz = -tz * 0.9 - tx * e.strafe * 0.5;
      }
    } else {
      if (e.pathTimer <= 0 && !e.attackPlan) {
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
      const direction = followRoute(e, e.path);
      dx = direction.x;
      dz = direction.z;
      movementPath = e.path;
      if (Math.hypot(dx, dz) > 0.001) e.yaw = Math.atan2(-dx, -dz);
    }

    // Retreat to reachable occlusion, not merely backwards into another lane.
    const defensive =
      e.reload > 0 || e.health < 35 || e.pressureUntil > this.clock;
    if (e.coverPlan && (this.clock >= e.coverUntil || !defensive)) {
      e.coverPlan = null;
      e.coverReadyAt = this.clock + 1.1;
    }
    if (
      !e.coverPlan &&
      defensive &&
      e.lastKnown &&
      this.clock >= (e.coverReadyAt || 0)
    ) {
      e.coverReadyAt = this.clock + 0.75;
      const threat = e.lastKnown;
      const plan = chooseCover(
        e,
        threat,
        this.world,
        (point) =>
          !this.hasLOS(
            v3(threat.x, (threat.y || 0) + 1.66, threat.z),
            v3(point.x, (point.y || 0) + 1.66, point.z),
          ),
        this.entities,
      );
      if (plan) {
        e.coverPlan = plan;
        e.coverUntil = this.clock + 1.8;
      }
    }
    const positioning = positionBot(e, {
      clock: this.clock,
      world: this.world,
      visible,
      reacted: e.seen > d.reaction,
      defensive,
      skill,
      teammates: this.entities,
      targetKey: target,
      speed: d.speed,
      canSee: (point, threat) =>
        this.hasLOS(
          v3(point.x, (point.y || 0) + 1.66, point.z),
          v3(threat.x, (threat.y || 0) + 1.4, threat.z),
        ),
    });
    if (positioning) {
      dx = positioning.x;
      dz = positioning.z;
      movementPath = positioning.path;
      if (!visible && Math.hypot(dx, dz) > 0.001) e.yaw = Math.atan2(-dx, -dz);
    }
    if (e.coverPlan) {
      const direction = followRoute(e, e.coverPlan.path);
      movementPath = e.coverPlan.path;
      dx = direction.x;
      dz = direction.z;
      if (!visible && Math.hypot(dx, dz) > 0) e.yaw = Math.atan2(-dx, -dz);
    }
    const hazard = evadeHazards(e, {
      clock: this.clock,
      projectiles: this.projectiles,
      fires: this.fires,
      world: this.world,
      reaction: d.reaction,
      canSee: (point) =>
        this.hasLOS(origin, v3(point.x, point.y + 0.15, point.z)),
    });
    e.evadingHazard = !!hazard;
    if (hazard) {
      dx = hazard.x;
      dz = hazard.z;
      movementPath = null;
      // Keep eyes on a visible rival while backing away from a grenade/fire.
      if (!visible) e.yaw = Math.atan2(-dx, -dz);
    }
    // Teammates spread out rather than occupying the same firing position.
    for (const other of this.entities) {
      if (other === e || !other.alive || other.team !== e.team) continue;
      const separation = Math.hypot(e.x - other.x, e.z - other.z);
      if (separation > 0.01 && separation < 1.15) {
        dx += ((e.x - other.x) / separation) * (1.15 - separation);
        dz += ((e.z - other.z) / separation) * (1.15 - separation);
      }
    }
    const norm = Math.max(1, Math.hypot(dx, dz));
    const nextPoint = movementPath?.[0];
    const nav = this.world.nav;
    const unchartedRoof =
      nav && e.y > (nav.heights[nav.index(e.x, e.z)] || 0) + 1;
    const wish = steerBotWish(
      e,
      { x: dx / norm, z: dz / norm },
      this.world,
      this.clock,
      {
        maxDistance: nextPoint
          ? Math.hypot(nextPoint.x - e.x, nextPoint.z - e.z)
          : Infinity,
        allowDrop: !e.attackPlan && unchartedRoof,
      },
    );
    const lastShot = target.isPlayer ? this.lastShotAt : target.lastShotAt;
    const underFire =
      visible &&
      (e.pressureUntil > this.clock ||
        (lastShot !== undefined && this.clock - lastShot < 0.32));
    const action = decideBotAction(e, {
      visible,
      target,
      distance,
      world: this.world,
      wish,
      skill,
      reaction: d.reaction,
      reacted: e.seen > d.reaction,
      underFire: underFire || !!hazard,
      defensive: defensive || !!hazard,
      speed: d.speed,
      positioning: !!positioning?.moving,
    });
    if (botActionSounds[action]) this.playBotAction(e, botActionSounds[action]);
    if (visible && e.seen > d.reaction && e.shootTimer <= 0 && botCanShoot(e))
      this.fireBotRifle(e, target, d, distance);
    const speed =
      d.speed *
      (e.reload > 0 ? 0.65 : 1) *
      (e.activeWeapon === e.meleeId
        ? MOVEMENT.meleeSpeed / MOVEMENT.runSpeed
        : 1);
    const groundedBeforeAction = e.grounded;
    moveBotVelocity(e, wish, speed, dt, this.world);
    if (groundedBeforeAction && !e.grounded) this.playBotAction(e, "jump");
    const oldX = e.x,
      oldZ = e.z;
    moveBody(e, e.vx * dt, e.vz * dt, this.world.boxes);
    const moved = Math.hypot(e.x - oldX, e.z - oldZ);
    e.animationPhase = (e.animationPhase || e.seed) + moved * 2.7;
    e.footDistance = (e.footDistance || 0) + moved;
    if (
      e.grounded &&
      e.footDistance > 3.4 &&
      this.audio.playAt &&
      this.player
    ) {
      e.footDistance = 0;
      if (Math.hypot(e.x - this.player.x, e.z - this.player.z) < 20)
        this.audio.playAt(
          "step",
          this.eye(e),
          this.eye(this.player),
          this.yaw,
          0.65,
        );
    }
    e.jumpCooldown = Math.max(0, (e.jumpCooldown || 0) - dt);
    e.stuckTime =
      moved < dt * 0.4 && Math.hypot(dx, dz) > 0.1
        ? (e.stuckTime || 0) + dt
        : 0;
    if (e.grounded && e.jumpCooldown <= 0 && e.stuckTime > 0.28) {
      if (botJump(e, this.world)) this.playBotAction(e, "jump");
      e.jumpCooldown = 1.2;
      e.stuckTime = 0;
      e.pathTimer = 0;
    }

    const wasGrounded = e.grounded;
    verticalStep(e, dt, this.world.boxes);
    if (!wasGrounded && e.grounded) {
      e.slideJumpCombo = false;
      e.jumpAge = 0;
    }
    const bounds = this.world.bounds || {
      minX: -23.1,
      maxX: 23.1,
      minZ: -23.1,
      maxZ: 23.1,
    };
    const boundedX = clamp(e.x, bounds.minX, bounds.maxX),
      boundedZ = clamp(e.z, bounds.minZ, bounds.maxZ);
    if (boundedX !== e.x) e.vx = 0;
    if (boundedZ !== e.z) e.vz = 0;
    e.x = boundedX;
    e.z = boundedZ;
    this.animateBot(e, dt);
  }
  playBotAction(e, sound) {
    if (this.player && this.audio?.playAt)
      this.audio.playAt(
        sound,
        this.eye(e),
        this.eye(this.player),
        this.yaw,
        0.5,
      );
  }
  fireBotRifle(e, target, d, distance) {
    if (e.ammo === 0) {
      e.reload = WEAPONS.rifle.reload;
      return;
    }
    const weapon = WEAPONS.rifle,
      origin = this.eye(e),
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
    e.lastShotAt = this.clock;
    e.ammo--;
    e.shootTimer = weapon.interval / d.fire;
    e.actionCounts.rifleShots = (e.actionCounts.rifleShots || 0) + 1;
    if (this.audio.playAt && this.player)
      this.audio.playAt(
        "rifle",
        origin,
        this.eye(this.player),
        this.yaw,
        0.7,
        !this.hasLOS(origin, this.eye(this.player), false),
      );
    else this.audio.play("rifle", clamp(1 - distance / 55, 0.06, 0.5));
  }
  resolveBotMelee(e, attack) {
    if (
      !e.alive ||
      e.activeWeapon !== attack.id ||
      e.deflectTime > 0 ||
      e.quickMeleeTime > 0
    )
      return;
    const w = WEAPONS[attack.id],
      origin = this.eye(e),
      forward = v3(-Math.sin(attack.yaw), 0, -Math.cos(attack.yaw));
    const enemies = this.entities
      .filter((t) => t.alive && t.team !== e.team)
      .sort(
        (a, b) =>
          Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z),
      );
    for (const victim of enemies) {
      const delta = this.eye(victim).sub(origin),
        length = delta.length();
      if (
        length > w.range ||
        (length > 0.1 && delta.normalize().dot(forward) < 0.45) ||
        !this.hasLOS(origin, this.eye(victim))
      )
        continue;
      const backstab = attack.id === "knife" && isBackstab(e, victim);
      this.damage(
        victim,
        attack.id === "knife" ? knifeDamage(e, victim) : w.damage,
        e,
        false,
        e,
        backstab,
      );
      e.actionCounts.meleeHits = (e.actionCounts.meleeHits || 0) + 1;
      break;
    }
  }
  animateBot(e, dt = 1 / 60) {
    const m = e.model;
    if (!m) return;
    const speed = Math.hypot(e.vx, e.vz),
      phase = e.animationPhase ?? this.clock * 10 + (e.seed || 0);
    const stride = e.grounded
      ? Math.sin(phase) * Math.min(0.65, speed * 0.06)
      : 0.14;
    m.parts.locomotion ||= new BotLocomotion();
    const pose = m.parts.locomotion.update(e, phase, dt, m.group.rotation.y);
    e.hitReact = Math.max(0, (e.hitReact || 0) - dt);
    const hitPulse = Math.sin((e.hitReact / 0.22) * Math.PI) * 0.085;
    m.group.position.set(e.x, e.y + pose.bob, e.z);
    const turn = Math.atan2(
      Math.sin(e.yaw - m.group.rotation.y),
      Math.cos(e.yaw - m.group.rotation.y),
    );
    m.group.rotation.y += turn * (1 - Math.exp(-18 * dt));
    const expression = operatorPose(e, this.clock, turn);
    if (m.parts.torso) m.parts.torso.rotation.y = expression.torsoYaw;
    m.parts.head.rotation.z = expression.headRoll;
    if (m.parts.leftLid)
      m.parts.leftLid.scale.y = m.parts.rightLid.scale.y = Math.max(
        0.001,
        expression.blink,
      );
    if (m.parts.leftFoot) {
      m.parts.leftFoot.rotation.x = expression.leftFoot;
      m.parts.rightFoot.rotation.x = expression.rightFoot;
    }
    if (m.parts.armorMaterial) {
      m.parts.armorMaterial.emissive.setHex(0xffbd88);
      m.parts.armorMaterial.emissiveIntensity = expression.impact;
    }
    const crouch = e.height < 1.4;
    m.parts.leftLeg.rotation.set(pose.leftX, 0, pose.leftZ);
    m.parts.rightLeg.rotation.set(pose.rightX, 0, pose.rightZ);
    if (m.parts.leftKnee) {
      m.parts.leftKnee.rotation.x = pose.leftKnee;
      m.parts.rightKnee.rotation.x = pose.rightKnee;
      m.parts.leftLeg.position.y = m.parts.rightLeg.position.y = pose.hipY;
    }
    let aimPitch = e.netId ? e.pitch || 0 : 0;
    if (!e.netId && e.visible && e.targetEntity?.alive) {
      const dy = this.eye(e.targetEntity).y - this.eye(e).y,
        distance = Math.hypot(e.targetEntity.x - e.x, e.targetEntity.z - e.z);
      aimPitch = clamp(Math.atan2(dy, distance), -0.5, 0.5);
    }
    m.parts.head.rotation.x = THREE.MathUtils.damp(
      m.parts.head.rotation.x,
      aimPitch - (m.parts.upperBody?.rotation.x || 0),
      18,
      dt,
    );
    m.parts.head.rotation.y = clamp(turn, -0.4, 0.4);
    m.parts.leftArm.rotation.x = -1.05 + aimPitch - stride * 0.1;
    m.parts.rightArm.rotation.x = -1.15 + aimPitch;
    m.parts.leftArm.rotation.z = e.reload > 0 ? -0.32 : 0.08;
    if (e.reload > 0)
      m.parts.leftArm.rotation.x = -0.55 - Math.sin(e.reload * 5) * 0.45;
    if (m.parts.upperBody) {
      const lateral = e.vx * Math.cos(e.yaw) - e.vz * Math.sin(e.yaw),
        forward = -e.vx * Math.sin(e.yaw) - e.vz * Math.cos(e.yaw);
      m.parts.upperBody.rotation.z = THREE.MathUtils.damp(
        m.parts.upperBody.rotation.z,
        clamp(-lateral * 0.012, -0.1, 0.1) +
          hitPulse * Math.sin((e.hitDirection || 0) - e.yaw),
        16,
        dt,
      );
      m.parts.upperBody.rotation.x = THREE.MathUtils.damp(
        m.parts.upperBody.rotation.x,
        crouch
          ? -0.55
          : e.dashTime > 0
            ? -0.18
            : clamp(-forward * 0.006, -0.07, 0.07) +
              hitPulse * Math.cos((e.hitDirection || 0) - e.yaw),
        16,
        dt,
      );
      m.parts.upperBody.position.y = pose.bodyY + expression.breath;
      const shotAge = e.netId
          ? (e.netShotAge ?? 10)
          : e.lastShotAt === undefined
            ? 10
            : this.clock - e.lastShotAt,
        feel = weaponFeel(e.activeWeapon),
        recoil = shotEnvelope(shotAge, e.activeWeapon);
      m.parts.weaponRig.rotation.x =
        aimPitch -
        m.parts.upperBody.rotation.x +
        recoil * feel.pitch * 0.75 +
        (e.reload > 0 &&
        e.activeWeapon !== "fists" &&
        !(e.quickMeleeTime > 0) &&
        !(e.activeWeapon === e.meleeId)
          ? 0.3
          : 0);
      m.parts.weaponRig.position.z = -0.25 + recoil * feel.kick * 0.7;
      m.parts.muzzleFlash.visible = shotAge < 0.055;
      m.parts.muzzleFlash.rotation.z = this.clock * 71;
    }
    m.group.scale.y = 1;
    updateBotWeapon(m, e, this.clock);
    if (m.parts.belt)
      m.parts.belt.position.y = THREE.MathUtils.damp(
        m.parts.belt.position.y,
        crouch ? 0.61 : 0.73,
        20,
        dt,
      );
    if (m.parts.leftElbow && m.parts.weaponRig && m.parts.upperBody) {
      // Weapon and shoulders share an upper-body parent. Solve directly in
      // that space instead of updating/inverting the entire skeleton twice.
      const rig = m.parts.weaponRig;
      m.parts.ikLeftTarget ||= new THREE.Vector3();
      m.parts.ikRightTarget ||= new THREE.Vector3();
      const leftTarget = m.parts.ikLeftTarget
        .copy(m.parts.botLeftGrip)
        .multiply(rig.scale)
        .applyQuaternion(rig.quaternion)
        .add(rig.position);
      const rightTarget = m.parts.ikRightTarget
        .copy(m.parts.botRightGrip)
        .multiply(rig.scale)
        .applyQuaternion(rig.quaternion)
        .add(rig.position);
      aimArm(m.parts.leftArm, m.parts.leftElbow, leftTarget, -1);
      aimArm(m.parts.rightArm, m.parts.rightElbow, rightTarget, 1);
    }
    updateScopeGlint(m, e, this.camera?.position, this.clock);
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
      if (e.fire) animateFire(e.mesh, this.clock || 0, e.life);
      if (e.smoke)
        animateSmoke(
          e.mesh,
          this.clock || 0,
          e.life,
          e.max,
          this.settings?.performance,
        );
      if (e.mesh.material?.transparent)
        e.mesh.material.opacity =
          (e.smoke ? 0.83 : 0.7) * Math.min(1, e.life / (e.max * 0.25));
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.disposeVisual(e.mesh);
        this.effects.splice(i, 1);
      }
    }
  }
  simulate(dt) {
    if (this.network) {
      if (this.player)
        this.renderPrevious = {
          x: this.player.x,
          y: this.player.y,
          z: this.player.z,
        };
      this.clock += dt;
      this.network.step(dt);
      return;
    }
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
    this.backstabTime = Math.max(0, (this.backstabTime || 0) - dt);
    this.dashTime = Math.max(0, (this.dashTime || 0) - dt);
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
      if (!this.selectingLoadout) this.updatePlayer(dt);
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
    this.combatFX?.update(dt, this.world.boxes);
    this.flameFX?.update(dt);
  }
  renderWorld() {
    if (this.presentation && !this.settings.performance)
      this.presentation.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }
  frame(t) {
    if (this.warming) {
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
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
      if (this.world?.layout || this.world?.mapId === "blockout") {
        // The former orbit was outside the perimeter: taller walls hid the
        // court. Keep the Arena overview inside the enclosure, above cover.
        const layout = this.world.layout || ARENA;
        this.camera.position.set(
          layout.width * 0.31 * Math.sin(a),
          layout.wallHeight * 0.9,
          layout.depth * 0.31 * Math.cos(a),
        );
        this.camera.fov = 70;
        this.camera.lookAt(-layout.width * 0.1, 0, -layout.depth * 0.08);
      } else {
        this.camera.position.set(43 * Math.sin(a), 31, 43 * Math.cos(a));
        this.camera.fov = 48;
        this.camera.lookAt(-7, 0, -3);
      }
      this.camera.updateProjectionMatrix();
    } else if (this.state !== "paused" && this.state !== "results") {
      const step = SIMULATION_STEP;
      this.accumulator = Math.min(0.2, this.accumulator + elapsed);
      while (this.accumulator + 1e-9 >= step) {
        this.accumulator = Math.max(0, this.accumulator - step);
        this.simulate(step);
        if (["paused", "results", "lobby"].includes(this.state)) {
          this.accumulator = 0;
          break;
        }
      }
      this.network?.present?.(renderDt);
      this.updateCamera(renderDt, this.accumulator / step);
      this.events.tick(this);
    } else this.accumulator = 0;
    this.audio?.updateFlame?.(
      this.state === "playing" &&
        this.player?.alive &&
        this.loadout[this.slot] === "flame" &&
        this.mouseDown &&
        this.clock - (this.lastShotAt ?? -10) < 0.18 &&
        this.reloadTime <= 0,
    );
    this.world?.atmosphere?.update(t * 0.001, this.settings.performance);
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
            0.004 *
            Math.min(1, speed / MOVEMENT.runSpeed)
          : 0;
      const stance = this.crouched ? 1.03 : 1.66;
      this.eyeHeight = THREE.MathUtils.lerp(
        this.eyeHeight ?? stance,
        stance,
        1 - Math.exp(-20 * dt),
      );
      this.stepOffset *= Math.exp(-20 * dt);
      this.landingDip *= Math.exp(-18 * dt);
      const previous = this.renderPrevious || p;
      const x = THREE.MathUtils.lerp(previous.x, p.x, alpha);
      const z = THREE.MathUtils.lerp(previous.z, p.z, alpha);
      const y = THREE.MathUtils.lerp(previous.y, p.y, alpha);
      // Interpolate body movement, not gravity: the camera follows jumps immediately.
      // Only stairs/stance get a short ease, preventing the old whole-camera lag.
      let eyeY = Math.max(
        p.y + 0.8,
        y +
          this.eyeHeight +
          this.stepOffset +
          bob -
          (this.settings.shake ? this.landingDip : 0),
      );
      if (this.forcedCrouch) eyeY = Math.min(eyeY, p.y + 1.02);
      this.camera.position.set(x, eyeY, z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
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
          (this.settings.dynamicFov === false
            ? 0
            : this.slideTime > 0
              ? 0.8
              : clamp(
                  (Math.hypot(p.vx, p.vz) - MOVEMENT.runSpeed) * 0.18,
                  0,
                  3,
                ));
    this.baseCameraFov = THREE.MathUtils.lerp(
      this.baseCameraFov ?? this.camera.fov,
      fov,
      1 - Math.exp(-12 * dt),
    );
    this.camera.fov = this.baseCameraFov;
    if (
      this.settings.shake !== false &&
      this.lastShotAt !== undefined &&
      w.slot < 2
    )
      this.camera.fov +=
        shotEnvelope(this.clock - this.lastShotAt, this.loadout[this.slot]) *
        weaponFeel(this.loadout[this.slot]).fov;
    this.camera.updateProjectionMatrix();
    const activeModel = this.quickModel || this.viewModel;
    if (activeModel) {
      activeModel.visible = !(
        this.aiming && this.loadout[this.slot] === "sniper"
      );
      this.weaponAnimator ||= new WeaponAnimator();
      this.weaponClearance ||= new WeaponClearance();
      const clearance = this.weaponClearance.sample(
        this.camera,
        this.world?.solidMeshes || [],
        this.clock,
        this.loadout[this.slot],
        p.alive &&
          !this.aiming &&
          !this.quickModel &&
          w.slot < 2 &&
          w.type !== "bow" &&
          this.settings.shake !== false,
      );
      const look = this.lookSway || { x: 0, y: 0 };
      this.weaponAnimator.update(activeModel, {
        dt,
        phase: this.walkPhase,
        speed: Math.hypot(p.vx, p.vz),
        clearance,
        carryAllowed: !this.quickModel && w.slot < 2 && w.type !== "bow",
        forwardSpeed: -p.vx * Math.sin(this.yaw) - p.vz * Math.cos(this.yaw),
        grounded: p.grounded,
        slide: this.slideTime > 0,
        aim: this.aiming,
        kick: this.kick,
        swap: this.switchTime || 0,
        reloading: this.reloadTime > 0,
        ammo:
          this.ammunition?.[this.quickUtilityTime > 0 ? 3 : this.slot]?.mag ??
          Infinity,
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
        shotSequence: this.shotSequence || 0,
        shotAge:
          this.lastShotAt === undefined ? 10 : this.clock - this.lastShotAt,
        flash: this.flash > 0,
        heal: this.healTime,
        healTotal: this.healTotal,
        quickStab: this.knifeQuickTime > 0,
        knifeStab: this.knifeStabAttack,
        swing: this.swingTime,
        swingSequence: this.swingSequence,
        backstab: this.backstabTime,
        dash: this.dashTime,
        guard: this.deflectTime > 0,
        inspect: this.inspectTime,
        throwing: this.throwTime,
        throwReleased: this.throwReleased,
        verticalSpeed: p.vy,
        landing: this.landingDip,
        strafe: (p.vx * Math.cos(this.yaw) - p.vz * Math.sin(this.yaw)) / 11.5,
      });
      if (
        activeModel.userData.weaponId === "flame" &&
        activeModel.userData.flameSocket
      ) {
        const active =
          this.state === "playing" &&
          this.mouseDown &&
          this.clock - (this.lastShotAt ?? -10) < 0.18 &&
          this.reloadTime <= 0;
        if (active) {
          activeModel.updateWorldMatrix(true, true);
          this.camera.updateMatrixWorld();
          this.flameFX?.track(
            "local",
            this.weaponPointToWorld(
              activeModel.userData.flameSocket.getWorldPosition(v3()),
            ),
            v3(0, 0, -1).applyEuler(
              new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
            ),
            this.world.solidMeshes,
            this.camera.position,
          );
        } else this.flameFX?.stop("local");
      } else this.flameFX?.stop("local");
      if (this.muzzleLight && this.weaponFlashLight) {
        const flame = activeModel.userData.weaponId === "flame";
        const socket = flame
            ? activeModel.userData.flameSocket
            : activeModel.userData.muzzleFlash,
          lit =
            (flame
              ? this.clock - (this.lastShotAt ?? -10) < 0.16
              : this.flash > 0) &&
            socket &&
            !this.settings.performance;
        const flicker = flame ? 1 + Math.sin(this.clock * 31) * 0.12 : 1;
        this.muzzleLight.intensity = lit ? (flame ? 3 : 7) * flicker : 0;
        this.weaponFlashLight.intensity = lit
          ? (flame ? 0.8 : 1.7) * flicker
          : 0;
        if (lit) {
          activeModel.updateWorldMatrix(true, true);
          const local = socket.getWorldPosition(v3());
          this.weaponFlashLight.position.copy(local);
          this.camera.updateMatrixWorld();
          this.muzzleLight.position.copy(this.weaponPointToWorld(local));
        }
      }
      look.x *= Math.exp(-18 * dt);
      look.y *= Math.exp(-18 * dt);
    }
  }
}
