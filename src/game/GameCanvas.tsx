import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { CameraController } from './CameraController';
import { InputManager } from './InputManager';
import { MovementRecorder } from './MovementRecorder';
import { buildArena } from './arena/ArenaBuilder';
import { ARENA_SPAWN, type ArenaMode } from './arena/ArenaConfig';
import { DEFAULT_MOVEMENT_CONFIG } from './movement/MovementConfig';
import { MovementController } from './movement/MovementController';
import type { MovementSnapshot } from './movement/MovementTypes';

export interface GameSettings {
  fov: number;
  sensitivity: number;
  autoSprint: boolean;
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
}

export interface GameCanvasProps {
  mode: ArenaMode;
  settings: GameSettings;
  paused: boolean;
  onPointerLockChange: (locked: boolean) => void;
  onTelemetry: (snapshot: MovementSnapshot, metrics: FrameMetrics) => void;
  onRecordingChange?: (recording: boolean, sampleCount: number) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
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

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  {
    mode,
    settings,
    paused,
    onPointerLockChange,
    onTelemetry,
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
  const onPointerLockChangeRef = useRef(onPointerLockChange);
  const onRecordingChangeRef = useRef(onRecordingChange);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  settingsRef.current = settings;
  pausedRef.current = paused;
  onTelemetryRef.current = onTelemetry;
  onPointerLockChangeRef.current = onPointerLockChange;
  onRecordingChangeRef.current = onRecordingChange;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const controllerRef = useRef<MovementController | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const arenaRef = useRef<ReturnType<typeof buildArena> | null>(null);
  const renderPreviousRef = useRef({ x: 0, y: 0, z: 0 });
  const renderPositionRef = useRef({ x: 0, y: 0, z: 0 });

  useImperativeHandle(ref, () => ({
    requestPointerLock: () => {
      const canvas = hostRef.current?.querySelector('canvas');
      if (canvas && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    },
    exitPointerLock: () => {
      if (document.pointerLockElement) document.exitPointerLock();
    },
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
    renderer.domElement.setAttribute('aria-label', 'RIVALS movement trainer viewport');
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
    arenaRef.current = arena;
    const spawn = arena.spawns[modeRef.current] ?? ARENA_SPAWN;
    const controller = new MovementController(arena.world, {}, spawn.position);
    controllerRef.current = controller;
    renderPreviousRef.current.x = controller.position.x;
    renderPreviousRef.current.y = controller.position.y;
    renderPreviousRef.current.z = controller.position.z;
    renderPositionRef.current.x = controller.position.x;
    renderPositionRef.current.y = controller.position.y;
    renderPositionRef.current.z = controller.position.z;
    cameraRef.current = camera;
    const cameraController = new CameraController();
    cameraController.setSensitivity(settingsRef.current.sensitivity * 0.0022);
    cameraController.reset(spawn.yaw, 0);
    cameraControllerRef.current = cameraController;

    const input = new InputManager();
    input.attach();
    const recorder = new MovementRecorder();
    let lastRecording: ReturnType<MovementRecorder['stop']> | null = null;
    let recording = false;
    let replaying = false;
    let replayIndex = 0;
    let animationFrame = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let lastTelemetry = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let fps = 0;
    let destroyed = false;

    const requestLock = (): void => {
      if (!pausedRef.current && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
      }
    };
    const releaseLock = (): void => {
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
    };

    const onCanvasClick = (): void => requestLock();
    const onPointerLockChange = (): void => {
      const locked = document.pointerLockElement === renderer.domElement;
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
      accumulator = 0;
      lastTime = performance.now();
      if (document.visibilityState === 'hidden') releaseLock();
    };
    const onRecordingKey = (event: KeyboardEvent): void => {
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
        // Re-feed the exact input and camera-yaw stream through the same fixed
        // 120 Hz controller. This makes a recording useful as a regression
        // sequence rather than merely a screenshot of the final position.
        controller.reset(lastRecording.initialPosition);
        renderPreviousRef.current.x = controller.position.x;
        renderPreviousRef.current.y = controller.position.y;
        renderPreviousRef.current.z = controller.position.z;
        renderPositionRef.current.x = controller.position.x;
        renderPositionRef.current.y = controller.position.y;
        renderPositionRef.current.z = controller.position.z;
        cameraController.reset(lastRecording.initialYaw, 0);
        input.clear();
        replayIndex = 0;
        replaying = true;
      }
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
          let snapshotInput = input.snapshot(settingsRef.current.autoSprint);
          let simulationYaw = cameraController.getYaw();
          if (replaying && lastRecording) {
            const replaySample = lastRecording.samples[replayIndex];
            if (replaySample) {
              snapshotInput = replaySample.input;
              simulationYaw = replaySample.yaw;
              replayIndex += 1;
            } else {
              replaying = false;
            }
          }
          renderPreviousRef.current.x = controller.position.x;
          renderPreviousRef.current.y = controller.position.y;
          renderPreviousRef.current.z = controller.position.z;
          controller.step(
            snapshotInput,
            DEFAULT_MOVEMENT_CONFIG.fixedTimeStep,
            simulationYaw,
          );
          input.consumePressed();
          if (recording) recorder.record(controller.getSnapshot(), snapshotInput, simulationYaw);
          if (replaying && lastRecording && replayIndex >= lastRecording.samples.length) {
            replaying = false;
          }
          accumulator -= DEFAULT_MOVEMENT_CONFIG.fixedTimeStep;
          simulationSteps += 1;
        }
        if (simulationSteps >= DEFAULT_MOVEMENT_CONFIG.maxCatchUpSteps) {
          accumulator = 0;
        }
      } else {
        accumulator = 0;
        renderPreviousRef.current.x = controller.position.x;
        renderPreviousRef.current.y = controller.position.y;
        renderPreviousRef.current.z = controller.position.z;
      }

      const interpolation = Math.min(
        1,
        accumulator / DEFAULT_MOVEMENT_CONFIG.fixedTimeStep,
      );
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
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      controllerRef.current = null;
      cameraControllerRef.current = null;
      cameraRef.current = null;
      arenaRef.current = null;
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
  }, [settings.fov, settings.sensitivity]);

  useEffect(() => {
    const arena = arenaRef.current;
    const controller = controllerRef.current;
    const cameraController = cameraControllerRef.current;
    if (!arena || !controller || !cameraController || modeRef.current === mode) return;
    modeRef.current = mode;
    const spawn = arena.spawns[mode];
    controller.reset(spawn.position);
    renderPreviousRef.current.x = controller.position.x;
    renderPreviousRef.current.y = controller.position.y;
    renderPreviousRef.current.z = controller.position.z;
    renderPositionRef.current.x = controller.position.x;
    renderPositionRef.current.y = controller.position.y;
    renderPositionRef.current.z = controller.position.z;
    cameraController.reset(spawn.yaw, 0);
  }, [mode]);

  return <div ref={hostRef} className="game-canvas-host" />;
});
