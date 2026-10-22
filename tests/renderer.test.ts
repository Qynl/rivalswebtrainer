// @vitest-environment jsdom
/**
 * Builds the real Three.js scene under a stub WebGL2 context. No pixels are
 * produced, but every geometry merge, material and update path the game runs
 * on the first frame is exercised, which is where a black screen would come from.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { createPlayer, respawnPlayer } from '../src/shared/sim.ts';
import type { Renderer as R } from '../src/client/renderer.ts';
import { glStats, installDomStubs } from './stubgl.ts';

let Renderer: typeof R;
let renderer: R;

beforeAll(async () => {
  installDomStubs();
  Renderer = (await import('../src/client/renderer.ts')).Renderer;
});

function makeRenderer(): R {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  return new Renderer(canvas, ARENA);
}

describe('renderer', () => {
  it('builds the arena, players, ring and viewmodel without a real GPU', () => {
    renderer = makeRenderer();
    expect(renderer).toBeTruthy();
  });

  it('runs a frame of every visual state', () => {
    const local = createPlayer(0, 0);
    respawnPlayer(local, ARENA, 0);
    const remote = createPlayer(1, 1);
    respawnPlayer(remote, ARENA, 1);
    const remoteView = {
      pos: { ...remote.pos },
      yaw: remote.yaw,
      pitch: 0,
      alive: true,
      sliding: false,
      scoped: true,
      glint: 1,
      speed: 26,
      vel: { x: 0, y: -4, z: 6 },
      grounded: false,
      scopeT: 0.2,
      grapple: { active: true, mode: 'swing' as const, anchor: { x: 0, y: 24, z: 0 }, length: 20, target: 0 as const },
      slot: 0 as const,
      hook: { active: false, pos: { x: 0, y: 0, z: 0 } },
    };
    expect(() => {
      for (let i = 0; i < 12; i++) {
        renderer.update(1 / 60, {
          local,
          localRope: { active: true, anchor: { x: 6, y: 18, z: 4 }, length: 22, mode: 'swing' },
          remote: remoteView,
          remoteRope: { active: true, anchor: { x: 0, y: 24, z: 0 }, length: 20, mode: 'swing' },
          ringRadius: 60,
          ringActive: true,
          scoped: 0.4,
          glintVisible: true,
          glintIntensity: 1,
          killcam: i > 6 ? { t: 0.2, killerPos: { x: 2, y: 6, z: 2 }, victimPos: { ...local.pos } } : null,
          reducedFx: false,
        });
      }
      renderer.orbit(1 / 60);
      renderer.orbit(1 / 60);
      renderer.tracer({ x: 0, y: 3, z: 0 }, { x: 20, y: 10, z: -30 }, 0x9df9ff);
      renderer.spark({ x: 4, y: 2, z: 4 }, 0xff3f86, 8);
      renderer.recoil();
      renderer.punch(0.02, 0.01);
      renderer.shake(0.03);
      renderer.setSkin(1);
      renderer.setRingColor(false);
      renderer.resize();
    }).not.toThrow();
  });

  it('snaps the lens in with the scope, in well under a fifth of a second', () => {
    const local = createPlayer(0, 0);
    respawnPlayer(local, ARENA, 0);
    const remote = createPlayer(1, 1);
    respawnPlayer(remote, ARENA, 1);
    const frame = (scopeT: number): void => {
      local.scopeT = scopeT;
      renderer.update(1 / 60, {
        local,
        localRope: { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' },
        remote: {
          pos: { ...remote.pos }, vel: { x: 0, y: 0, z: 0 }, grounded: true, scopeT: 0,
          yaw: 0, pitch: 0, alive: false, sliding: false, scoped: false, glint: 0, speed: 0,
          grapple: { active: false, mode: 'none', anchor: { x: 0, y: 0, z: 0 }, length: 0, target: 0 },
          slot: 0, hook: { active: false, pos: { x: 0, y: 0, z: 0 } },
        },
        remoteRope: { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' },
        ringRadius: 60,
        ringActive: false,
        scoped: 0,
        glintVisible: false,
        glintIntensity: 0,
        killcam: null,
        reducedFx: false,
      });
    };
    frame(0);
    const hip = renderer.camera.fov;
    expect(hip).toBeGreaterThan(60);
    // The simulation ramps scopeT in 0.12 s; the lens must be there with it,
    // not another 0.3 s behind.
    for (let i = 0; i < 9; i++) frame(i / 8);
    frame(1);
    frame(1);
    frame(1);
    expect(renderer.camera.fov).toBeLessThan(38);
    frame(0);
    frame(0);
    frame(0);
    expect(renderer.camera.fov).toBeGreaterThan(55);
  });

  it('draws the first-person rifle and grapnel, not just builds them', () => {
    // Regression: the viewmodel hangs off the camera, and three.js only draws
    // what it can reach from the scene root. For a long time the weapon was
    // built, animated and never rendered.
    const scene = (renderer as unknown as { scene: import('three').Scene }).scene;
    const viewmodel = (renderer as unknown as { viewmodel: import('three').Object3D }).viewmodel;
    expect(viewmodel.parent).toBe(renderer.camera);
    expect(scene.children).toContain(renderer.camera);

    const local = createPlayer(0, 0);
    respawnPlayer(local, ARENA, 0);
    const view = {
      local,
      localRope: { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' as const },
      remote: {
        pos: { x: 0, y: 0, z: 40 }, vel: { x: 0, y: 0, z: 0 }, grounded: true, scopeT: 0,
        yaw: 0, pitch: 0, alive: false, sliding: false, scoped: false, glint: 0, speed: 0,
        grapple: { active: false, mode: 'none' as const, anchor: { x: 0, y: 0, z: 0 }, length: 0, target: 0 as const },
        slot: 0 as const, hook: { active: false, pos: { x: 0, y: 0, z: 0 } },
      },
      remoteRope: { active: false, anchor: { x: 0, y: 0, z: 0 }, length: 0, mode: 'none' as const },
      ringRadius: 60,
      ringActive: false,
      scoped: 0,
      glintVisible: false,
      glintIntensity: 0,
      killcam: null,
      reducedFx: false,
    };

    // One frame with the weapon up, one with it stowed: the difference is the
    // weapon actually reaching the GPU.
    renderer.update(1 / 60, view);
    renderer.render();
    const before = glStats.draws;
    renderer.render();
    const armed = glStats.draws - before;
    viewmodel.visible = false;
    renderer.render();
    const after = glStats.draws;
    renderer.render();
    const stowed = glStats.draws - after;
    expect(armed).toBeGreaterThan(stowed);
    viewmodel.visible = true;
  });
});
