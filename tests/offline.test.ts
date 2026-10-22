// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:3499/"}
/**
 * Static-hosting behaviour: there is no server on this origin.
 *
 * This is the GitHub Pages path. The client tries the socket at
 * `location.host/ws`, nothing answers, and it must fall back to the in-page
 * authority and still give you a real match instead of "CONNECTION LOST" for
 * ever. Everything runs through the real `main.tsx` and the real React shell.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStubs, installWebSocketShim } from './stubgl.ts';

const errors: string[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout: ${what}`);
    await sleep(25);
  }
}

beforeAll(async () => {
  const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
  document.documentElement.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</html>'));
  installDomStubs();
  await installWebSocketShim();
  window.addEventListener('error', (e) => errors.push(String(e.error ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(' '));
  };
  // The socket will fail: nothing is listening on this port.
  await import('../src/client/main.tsx');
}, 40000);

afterAll(() => {
  (window as unknown as { __gg?: { net: { disconnectNow(): void } } }).__gg?.net.disconnectNow();
});

describe('static hosting', () => {
  it('falls back to the in-page authority and starts a real match', async () => {
    await until(() => document.getElementById('menu-status')?.textContent === 'READY', 8000, 'menu ready');
    (document.getElementById('play-bot') as HTMLButtonElement).click();

    // The socket attempt fails, then the fallback comes up on its own.
    await until(
      () => document.getElementById('connection')?.textContent === 'LOCAL',
      9000,
      'local authority online',
    );
    expect(document.getElementById('hud')?.classList.contains('hidden')).toBe(false);

    // Seats are live: a welcome arrived and the authority is streaming.
    const gg = (window as unknown as { __gg: { started: boolean; local: { alive: boolean } } }).__gg;
    expect(gg.started).toBe(true);
    await sleep(400);
    expect(gg.local.alive).toBe(true);
    expect(document.getElementById('score-a')?.textContent).toBe('0');
    // The offline note is honest about what you are playing.
    expect(document.getElementById('menu-note')?.textContent).toContain('LOCAL SCRIMMAGE');
    expect(errors).toEqual([]);
  }, 30000);
});
