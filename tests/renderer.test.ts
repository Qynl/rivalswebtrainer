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
import { installDomStubs } from './stubgl.ts';

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
});
