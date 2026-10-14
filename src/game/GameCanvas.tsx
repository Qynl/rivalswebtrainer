import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { CameraController } from './CameraController';
import { CombatInputManager } from './CombatInput';
import { CombatSimulation } from './combat/CombatSimulation';
import { BotAvatarView, WeaponView, createImpactEffect } from './combat/CombatPresentation';
import type {
  BotDifficulty,
  CombatSnapshot,
  MatchPhase,
} from './combat/CombatTypes';
import { InputManager } from './InputManager';
import { MovementRecorder } from './MovementRecorder';
import { buildArena } from './arena/ArenaBuilder';
import { ARENA_SPAWN, BOT_SPAWN, LAB_SPAWN, type ArenaMode } from './arena/ArenaConfig';
import { DEFAULT_MOVEMENT_CONFIG } from './movement/MovementConfig';
import { MovementController } from './movement/MovementController';
import type { MovementSnapshot, Vec3 } from './movement/MovementTypes';

export interface GameSettings {
  fov: number;
  sensitivity: number;
  autoSprint: boolean;
  difficulty: BotDifficulty;
}

export interface FrameMetrics {
  frameTimeMs: number;
  fps: number;
  simulationSteps: number;
  recordingSamples: number;
}

export interface GameCanvasHandle {
  requestPointerLock: () => void;
  exitPointerLock: () => void;
  startMatch: () => void;
  nextRound: () => void;
  restartMatch: () => void;
  stopMatch: () => void;
}

export interface GameCanvasProps {
  mode: ArenaMode;
  settings: GameSettings;
  paused: boolean;
  onPointerLockChange: (locked: boolean) => void;
  onTelemetry: (snapshot: MovementSnapshot, metrics: FrameMetrics) => void;
  onCombatState?: (snapshot: CombatSnapshot) => void;
  onRecordingChange?: (recording: boolean, sampleCount: number) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}

interface ActiveEffect {
  object: THREE.Group;
  remaining: number;
  duration: number;
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    materials.forEach((material) => {
      const materialWithMap = material as THREE.Material & {
        map?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
      };
      materialWithMap.map?.dispose();
      materialWithMap.alphaMap?.dispose();
      material.dispose();
    });
  });
}

function setEffectOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((object) => {
    const renderable = object as THREE.Mesh;
    const material = renderable.material as THREE.Material & { opacity?: number } | undefined;
    if (material && 'opacity' in material) material.opacity = opacity;
  });
}

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  {
    mode,
    settings,
    paused,
    onPointerLockChange,
    onTelemetry,
    onCombatState,
    onRecordingChange,
    onReady,
    onError,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  const modeRef = useRef(mode);
  const pausedRef = useRef(paused);
  const onTelemetryRef = useRef(onTelemetry);
  const onCombatStateRef = useRef(onCombatState);
  const onPointerLockChangeRef = useRef(onPointerLockChange);
  const onRecordingChangeRef = useRef(onRecordingChange);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  settingsRef.current = settings;
  pausedRef.current = paused;
  onTelemetryRef.current = onTelemetry;
  onCombatStateRef.current = onCombatState;
  onPointerLockChangeRef.current = onPointerLockChange;
  onRecordingChangeRef.current = onRecordingChange;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const controllerRef = useRef<MovementController | null>(null);
  const combatRef = useRef<CombatSimulation | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const renderPreviousRef = useRef({ x: 0, y: 0, z: 0 });
  const renderPositionRef = useRef({ x: 0, y: 0, z: 0 });
  const startMatchRef = useRef<() => void>(() => undefined);
  const nextRoundRef = useRef<() => void>(() => undefined);
  const restartMatchRef = useRef<() => void>(() => undefined);
  const stopMatchRef = useRef<() => void>(() => undefined);

  useImperativeHandle(ref, () => ({
    requestPointerLock: () => {
      const canvas = hostRef.current?.querySelector('canvas');
      if (canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
    },
    exitPointerLock: () => {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    startMatch: () => startMatchRef.current(),
    nextRound: () => nextRoundRef.current(),
    restartMatch: () => restartMatchRef.current(),
    stopMatch: () => stopMatchRef.current(),
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fd8f2);
    scene.fog = new THREE.Fog(0xa8e1f1, 64, 135);

    const camera = new THREE.PerspectiveCamera(
      settingsRef.current.fov,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      0.05,
      150,
    );
    camera.rotation.order = 'YXZ';

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WebGL could not be initialized.';
      onErrorRef.current?.(`Renderer initialization failed: ${message}`);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.setAttribute('aria-label', 'RIVALS movement and combat viewport');
    host.appendChild(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xdff8ff, 0x527986, 2.05);
    scene.add(hemisphere);
    const keyLight = new THREE.DirectionalLight(0xfff8e2, 3.05);
    keyLight.position.set(-20, 32, -18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 100;
    keyLight.shadow.camera.left = -52;
    keyLight.shadow.camera.right = 52;
    keyLight.shadow.camera.top = 42;
    keyLight.shadow.camera.bottom = -42;
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x62cce2, 18, 50, 2);
    rimLight.position.set(4, 10, 3);
    scene.add(rimLight);

    let arena: ReturnType<typeof buildArena>;
    try {
      arena = buildArena(scene);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The arena could not be built.';
      onErrorRef.current?.(`Arena initialization failed: ${message}`);
      renderer.dispose();
      renderer.domElement.remove();
      return undefined;
    }

    const combat = new CombatSimulation(
      arena.world,
      ARENA_SPAWN,
      BOT_SPAWN,
      settingsRef.current.difficulty,
    );
    combatRef.current = combat;
    const controller = combat.playerMovement;
    controllerRef.current = controller;

    const cameraController = new CameraController();
    cameraController.setSensitivity(settingsRef.current.sensitivity * 0.0022);
    cameraController.reset(ARENA_SPAWN.yaw, 0);
    cameraControllerRef.current = cameraController;
    cameraRef.current = camera;

    const weaponView = new WeaponView(camera);
    const botAvatar = new BotAvatarView();
    botAvatar.addTo(scene);
    botAvatar.group.visible = false;

    const input = new InputManager();
    const combatInput = new CombatInputManager();
    input.attach();
    combatInput.attach();
    const recorder = new MovementRecorder();
    const effects: ActiveEffect[] = [];
    let lastRecording: ReturnType<MovementRecorder['stop']> | null = null;
    let recording = false;
    let replaying = false;
    let replayIndex = 0;
    let animationFrame = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let lastTelemetry = 0;
    let lastCombatTelemetry = -Infinity;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let fps = 0;
    let destroyed = false;
    let lastPhase: MatchPhase = combat.getSnapshot().phase;

    const setRenderPosition = (position: Vec3): void => {
      renderPreviousRef.current.x = position.x;
      renderPreviousRef.current.y = position.y;
      renderPreviousRef.current.z = position.z;
      renderPositionRef.current.x = position.x;
      renderPositionRef.current.y = position.y;
      renderPositionRef.current.z = position.z;
    };
    setRenderPosition(controller.position);

    const updateCombatState = (): CombatSnapshot => {
      const snapshot = combat.getSnapshot();
      onCombatStateRef.current?.(snapshot);
      return snapshot;
    };

    const releaseLock = (): void => {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    };

    const startMatch = (): void => {
      if (modeRef.current !== 'arena') return;
      combat.setDifficulty(settingsRef.current.difficulty);
      if (!combat.isActive) combat.beginMatch();
      input.clear();
      combatInput.clear();
      updateCombatState();
    };
    const nextRound = (): void => {
      combat.nextRound();
      input.clear();
      combatInput.clear();
      updateCombatState();
    };
    const restartMatch = (): void => {
      combat.setDifficulty(settingsRef.current.difficulty);
      combat.beginMatch();
      input.clear();
      combatInput.clear();
      updateCombatState();
    };
    const stopMatch = (): void => {
      combat.stopMatch();
      releaseLock();
      updateCombatState();
    };
    startMatchRef.current = startMatch;
    nextRoundRef.current = nextRound;
    restartMatchRef.current = restartMatch;
    stopMatchRef.current = stopMatch;
    updateCombatState();

    const requestLock = (): void => {
      if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
    };
    const onCanvasClick = (): void => requestLock();
    const onPointerLockChange = (): void => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (!locked) {
        input.clear();
        combatInput.clear();
      }
      onPointerLockChangeRef.current(locked);
    };
    const onMouseMove = (event: MouseEvent): void => {
      if (document.pointerLockElement === renderer.domElement) {
        cameraController.handleMouseMovement(event.movementX, event.movementY);
      }
    };
    const onResize = (): void => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight, false);
    };
    const onVisibilityChange = (): void => {
      input.clear();
      combatInput.clear();
      accumulator = 0;
      lastTime = performance.now();
      if (document.visibilityState === 'hidden') releaseLock();
    };
    const onRecordingKey = (event: KeyboardEvent): void => {
      if (modeRef.current !== 'lab') return;
      if (event.code === 'KeyR' && !event.repeat) {
        if (!recording) {
          replaying = false;
          recorder.start(controller.getSnapshot(), cameraController.getYaw());
          recording = true;
        } else {
          lastRecording = recorder.stop(DEFAULT_MOVEMENT_CONFIG.fixedTimeStep);
          recording = false;
        }
        onRecordingChangeRef.current?.(recording, recorder.getSampleCount());
      }
      if (event.code === 'F9' && !event.repeat && lastRecording) {
        controller.reset(lastRecording.initialPosition);
        setRenderPosition(controller.position);
        cameraController.reset(lastRecording.initialYaw, 0);
        input.clear();
        replayIndex = 0;
        replaying = true;
      }
    };

    const addImpact = (point: Vec3 | null): void => {
      if (!point) return;
      const effect = createImpactEffect(scene, point, { x: 0, y: 1, z: 0 });
      effects.push({ object: effect, remaining: 0.22, duration: 0.22 });
    };

    renderer.domElement.addEventListener('click', onCanvasClick);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('keydown', onRecordingKey);
    onResize();
    onReadyRef.current?.();

    const renderLoop = (now: number): void => {
      if (destroyed) return;
      const rawFrameTime = Math.max(0, now - lastTime);
      lastTime = now;
      const frameTime = Math.min(rawFrameTime / 1000, 0.1);
      fpsAccumulator += rawFrameTime;
      fpsFrames += 1;
      if (fpsAccumulator >= 500) {
        fps = fpsFrames / (fpsAccumulator / 1000);
        fpsAccumulator = 0;
        fpsFrames = 0;
      }

      let simulationSteps = 0;
      if (!pausedRef.current) {
        accumulator += frameTime;
        while (
          accumulator >= DEFAULT_MOVEMENT_CONFIG.fixedTimeStep &&
          simulationSteps < DEFAULT_MOVEMENT_CONFIG.maxCatchUpSteps
        ) {
          const snapshotInput = input.snapshot(settingsRef.current.autoSprint);
          const simulationYaw = cameraController.getYaw();
          const simulationPitch = cameraController.getPitch();
          if (modeRef.current === 'arena' && combat.isActive) {
            const combatStep = combat.step(
              DEFAULT_MOVEMENT_CONFIG.fixedTimeStep,
              snapshotInput,
              { yaw: simulationYaw, pitch: simulationPitch },
              combatInput.snapshot(),
            );
            if (combatStep.playerShot?.fired) {
              weaponView.triggerFire();
              cameraController.addRecoil(
                combat.playerWeapons.activeDefinition.recoilPitch,
                combat.playerWeapons.activeDefinition.recoilYaw * (Math.sin(combat.getSnapshot().round + simulationSteps) * 0.5),
              );
              addImpact(combatStep.playerShot.hit ? combatStep.playerShot.point : null);
            }
            if (combatStep.botShot?.fired) addImpact(combatStep.botShot.hit ? combatStep.botShot.point : null);
            if (combatStep.playerShot?.hit && combatStep.playerShot.targetId === 'bot') botAvatar.flashHit();
            input.consumePressed();
            combatInput.consumePressed();
            const combatSnapshot = combat.getSnapshot();
            if (combatSnapshot.phase !== lastPhase) {
              lastPhase = combatSnapshot.phase;
              if (combatSnapshot.phase === 'roundSummary' || combatSnapshot.phase === 'matchSummary') releaseLock();
              updateCombatState();
            }
            if (combatSnapshot.phase === 'fight') weaponView.setWeapon(combat.playerWeapons.activeId);
          } else {
            let stepInput = snapshotInput;
            let stepYaw = simulationYaw;
            if (replaying && lastRecording) {
              const replaySample = lastRecording.samples[replayIndex];
              if (replaySample) {
                stepInput = replaySample.input;
                stepYaw = replaySample.yaw;
                replayIndex += 1;
              } else {
                replaying = false;
              }
            }
            renderPreviousRef.current.x = controller.position.x;
            renderPreviousRef.current.y = controller.position.y;
            renderPreviousRef.current.z = controller.position.z;
            controller.step(stepInput, DEFAULT_MOVEMENT_CONFIG.fixedTimeStep, stepYaw);
            input.consumePressed();
            combatInput.consumePressed();
            if (recording) recorder.record(controller.getSnapshot(), stepInput, stepYaw);
          }
          accumulator -= DEFAULT_MOVEMENT_CONFIG.fixedTimeStep;
          simulationSteps += 1;
        }
        if (simulationSteps >= DEFAULT_MOVEMENT_CONFIG.maxCatchUpSteps) accumulator = 0;
      } else {
        accumulator = 0;
        renderPreviousRef.current.x = controller.position.x;
        renderPreviousRef.current.y = controller.position.y;
        renderPreviousRef.current.z = controller.position.z;
      }

      const interpolation = Math.min(1, accumulator / DEFAULT_MOVEMENT_CONFIG.fixedTimeStep);
      renderPositionRef.current.x = renderPreviousRef.current.x +
        (controller.position.x - renderPreviousRef.current.x) * interpolation;
      renderPositionRef.current.y = renderPreviousRef.current.y +
        (controller.position.y - renderPreviousRef.current.y) * interpolation;
      renderPositionRef.current.z = renderPreviousRef.current.z +
        (controller.position.z - renderPreviousRef.current.z) * interpolation;

      const snapshot = controller.getSnapshot();
      cameraController.update(
        camera,
        renderPositionRef.current,
        snapshot,
        frameTime,
        DEFAULT_MOVEMENT_CONFIG.eyeHeight,
        DEFAULT_MOVEMENT_CONFIG.slidingEyeHeight,
      );
      weaponView.group.visible = modeRef.current === 'arena' && combat.isActive;
      weaponView.update(frameTime, snapshot, combatInput.snapshot().aimHeld, combat.getSnapshot().playerReloading);
      botAvatar.group.visible = modeRef.current === 'arena' && combat.isActive;
      if (botAvatar.group.visible) {
        botAvatar.update(combat.bot.movement.position, combat.bot.aim.state.yaw, combat.bot.movement.getSnapshot(), frameTime);
      }

      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index];
        effect.remaining -= frameTime;
        const progress = 1 - Math.max(0, effect.remaining / effect.duration);
        effect.object.scale.setScalar(0.7 + progress * 1.8);
        setEffectOpacity(effect.object, 1 - progress);
        if (effect.remaining <= 0) {
          scene.remove(effect.object);
          effects.splice(index, 1);
        }
      }

      renderer.render(scene, camera);
      if (now - lastTelemetry >= 90) {
        lastTelemetry = now;
        onTelemetryRef.current(snapshot, {
          frameTimeMs: rawFrameTime,
          fps,
          simulationSteps,
          recordingSamples: recorder.getSampleCount(),
        });
      }
      if (modeRef.current === 'arena' && now - lastCombatTelemetry >= 90) {
        lastCombatTelemetry = now;
        onCombatStateRef.current?.(combat.getSnapshot());
      }
      animationFrame = window.requestAnimationFrame(renderLoop);
    };

    animationFrame = window.requestAnimationFrame(renderLoop);

    return () => {
      destroyed = true;
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener('click', onCanvasClick);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', onRecordingKey);
      input.detach();
      combatInput.detach();
      releaseLock();
      botAvatar.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      controllerRef.current = null;
      combatRef.current = null;
      cameraControllerRef.current = null;
      cameraRef.current = null;
      startMatchRef.current = () => undefined;
      nextRoundRef.current = () => undefined;
      restartMatchRef.current = () => undefined;
      stopMatchRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const cameraController = cameraControllerRef.current;
    if (cameraController) cameraController.setSensitivity(settings.sensitivity * 0.0022);
    const camera = cameraRef.current;
    if (camera) {
      camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    }
    combatRef.current?.setDifficulty(settings.difficulty);
  }, [settings.fov, settings.sensitivity, settings.difficulty]);

  useEffect(() => {
    const combat = combatRef.current;
    const controller = controllerRef.current;
    const cameraController = cameraControllerRef.current;
    if (!combat || !controller || !cameraController || modeRef.current === mode) return;
    modeRef.current = mode;
    combat.stopMatch();
    const spawn = mode === 'arena' ? ARENA_SPAWN : LAB_SPAWN;
    controller.reset(spawn.position);
    renderPreviousRef.current.x = controller.position.x;
    renderPreviousRef.current.y = controller.position.y;
    renderPreviousRef.current.z = controller.position.z;
    renderPositionRef.current.x = controller.position.x;
    renderPositionRef.current.y = controller.position.y;
    renderPositionRef.current.z = controller.position.z;
    cameraController.reset(spawn.yaw, 0);
    onCombatStateRef.current?.(combat.getSnapshot());
  }, [mode]);

  return <div ref={hostRef} className="game-canvas-host" />;
});
