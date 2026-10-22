// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:3411/"}
/**
 * End-to-end client smoke test: the real index.html, the real main.ts, a real
 * WebSocket to a real game server. No GPU, so WebGL is stubbed (see stubgl.ts),
 * but every screen transition, input path and HUD write the player experiences
 * runs for real here. This is the closest thing to a browser this sandbox has.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { glStats, installDomStubs, installWebSocketShim } from './stubgl.ts';

const PORT = 3411;
const ROOT = process.cwd();
const errors: string[] = [];
let server: ChildProcessWithoutNullStreams;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout: ${what}`);
    await sleep(25);
  }
}

beforeAll(async () => {
  // The DOM the client expects, straight from the shipped page.
  const html = readFileSync(`${ROOT}/index.html`, 'utf8');
  document.documentElement.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</html>'));
  installDomStubs();
  await installWebSocketShim();

  const fail = (e: unknown): void => {
    errors.push(String((e as Error)?.message ?? e));
  };
  window.addEventListener('error', (e) => fail(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => fail(e.reason));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(' '));
    origError(...args);
  };

  server = spawn(process.execPath, ['src/server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not boot')), 15000);
    server.stdout.on('data', (d: Buffer) => {
      if (d.toString().includes('server on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (d: Buffer) => errors.push(`server: ${d.toString()}`));
  });

  await import('../src/client/main.tsx');
}, 40000);

afterAll(() => {
  server?.kill('SIGKILL');
});

describe('client', () => {
  it('boots to the menu with a live 3D backdrop', async () => {
    await until(() => document.getElementById('menu-status')?.textContent === 'READY', 5000, 'menu ready');
    expect(document.getElementById('menu')?.classList.contains('hidden')).toBe(false);
    await until(() => glStats.draws > 0, 5000, 'first frame drawn');
    expect(errors).toEqual([]);
  });

  it('starts a practice match, fires and moves through the real input path', async () => {
    (document.getElementById('play-bot') as HTMLButtonElement).click();
    await until(() => !document.getElementById('hud')?.classList.contains('hidden'), 8000, 'hud visible');
    await until(() => document.getElementById('score-a')?.textContent === '0', 3000, 'score synced');
    // Warmup ends, then the seat shield drops.
    await sleep(2600);
    const g = (window as unknown as { __gg: Record<string, any> }).__gg;
    expect(g.started).toBe(true);
    expect(g.input.locked).toBe(true);

    // Firing goes through: the bolt is spent, so the HUD starts its reload arc.
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    await until(() => g.local.fireCooldown > 0.2, 1500, 'shot fired');
    expect(document.getElementById('reloadArc')?.classList.contains('on')).toBe(true);

    // A short hop forward: input → predicted capsule → HUD readout.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    await sleep(220);
    const speed = Number(document.getElementById('speedval')?.textContent ?? '0');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    expect(speed).toBeGreaterThan(0.5);
    expect(g.local.alive).toBe(true);

    // Frame budget: the whole scene must stay well inside a few hundred draw
    // calls, which is what an integrated GPU comfortably handles at 60 fps.
    const d0 = glStats.draws;
    let frames = 0;
    const raf = (): void => {
      frames++;
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    await sleep(800);
    const perFrame = (glStats.draws - d0) / Math.max(1, frames);
    expect(frames).toBeGreaterThan(20);
    expect(perFrame).toBeLessThan(150);
    // The server acknowledges our inputs and streams the score back.
    await until(() => (document.getElementById('connection')?.textContent ?? '') === 'ONLINE', 4000, 'net online');
    expect(errors).toEqual([]);
  }, 20000);

  it('fires one round per click and never fires on its own', async () => {
    const g = (window as unknown as { __gg: Record<string, any> }).__gg;
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const net = g.net as { sendShot: (s: unknown) => void };
    const orig = net.sendShot.bind(net);
    let shots = 0;
    net.sendShot = (s: unknown): void => {
      shots++;
      orig(s);
    };
    // Wait on simulation state, not the wall clock: under a loaded machine the
    // client's frame rate drops and a sleep-based test measures the CPU.
    const ready = (): Promise<void> =>
      until(() => g.local.alive && g.local.protect <= 0 && g.local.fireCooldown <= 0, 15000, 'ready');

    // An idle trigger must never cycle the bolt on its own.
    await ready();
    shots = 0;
    await sleep(900);
    expect(shots).toBe(0);

    // One click, one round — holding the button across a whole bolt adds none.
    // The practice bot is live and may kill us between the readiness gate and
    // the click, so retry the gate rather than depending on a single race.
    for (let attempt = 0; attempt < 4 && shots === 0; attempt++) {
      await ready();
      if (shots === 0) canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      try {
        await until(() => shots >= 1, 2500, 'first round');
      } catch {
        canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        await sleep(200);
      }
    }
    expect(shots).toBe(1);
    await sleep(1300);
    expect(shots).toBe(1);
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    await sleep(200);
    expect(shots).toBe(1);

    // The next click is a fresh round once the bolt is home.
    for (let attempt = 0; attempt < 4 && shots === 1; attempt++) {
      await ready();
      if (shots === 1) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      }
      try {
        await until(() => shots >= 2, 2500, 'second round');
      } catch {
        await sleep(200);
      }
    }
    expect(shots).toBe(2);
    net.sendShot = orig;
    expect(errors).toEqual([]);
  }, 60000);

  it('pauses on Escape, resumes, and leaves through the pause panel', async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    await sleep(120);
    expect(document.getElementById('pause')?.classList.contains('hidden')).toBe(false);
    (document.getElementById('pause-resume') as HTMLButtonElement).click();
    await sleep(120);
    expect(document.getElementById('pause')?.classList.contains('hidden')).toBe(true);
  }, 10000);

  it('presents kill feedback, the results screen and a clean return to the menu', async () => {
    const g = (window as unknown as { __gg: Record<string, any> }).__gg;
    const you = g.you as number;
    expect(() => {
      g.onShotMsg({ t: 'shot', shooter: 1 - you, origin: { x: 0, y: 50, z: 0 }, end: { x: 1, y: 50, z: 1 }, hit: false });
      g.onKillMsg({
        t: 'kill',
        event: { killer: you, victim: 1 - you, cause: 'shot' },
        scores: [1, 0],
        phase: 'live',
        victimAt: { ...g.remoteSim.pos },
      });
    }).not.toThrow();
    expect(document.getElementById('killbanner')?.classList.contains('hidden')).toBe(false);

    g.onOverMsg({ t: 'over', winner: you, draw: false, scores: [3, 1], forfeited: null });
    expect(document.getElementById('results')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('result-title')?.textContent).toBe('VICTORY');
    expect(document.getElementById('result-score')?.textContent).toBe('3 — 1');

    (document.getElementById('result-menu') as HTMLButtonElement).click();
    await until(() => !document.getElementById('menu')?.classList.contains('hidden'), 4000, 'menu back');
    expect(document.getElementById('hud')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('results')?.classList.contains('hidden')).toBe(true);
    expect(errors).toEqual([]);
  }, 10000);

  it('opens the armory, switches shelves and comes back to the menu', async () => {
    const { GUN_SKINS, KILL_EFFECTS } = await import('../src/shared/cosmetics.ts');
    (document.getElementById('armory-open') as HTMLButtonElement).click();
    await until(() => !document.getElementById('armory')?.classList.contains('hidden'), 4000, 'armory open');
    expect(document.querySelectorAll('#armory-grid .card').length).toBe(GUN_SKINS.length);
    expect(document.getElementById('menu')?.classList.contains('hidden')).toBe(true);

    (document.querySelector('[data-armory-tab="effect"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#armory-grid .card').length).toBe(KILL_EFFECTS.length);

    (document.getElementById('armory-back') as HTMLButtonElement).click();
    await until(() => document.getElementById('armory')?.classList.contains('hidden') === true, 4000, 'armory closed');
    expect(document.getElementById('menu')?.classList.contains('hidden')).toBe(false);
    expect(errors).toEqual([]);
  }, 15000);
});
