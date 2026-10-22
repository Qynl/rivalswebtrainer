/**
 * DOM smoke test: builds the real HUD against the real index.html markup and
 * drives every method the game calls. This is the closest thing to a browser
 * we can run headlessly, and it catches every element-id typo.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { MATCH } from '../src/shared/constants.ts';

let hud: import('../src/client/hud.ts').Hud;

beforeAll(async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const g = globalThis as unknown as { window: unknown; document: unknown; performance: unknown; HTMLElement: unknown; HTMLDivElement: unknown; SVGElement: unknown };
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLDivElement = dom.window.HTMLDivElement;
  g.SVGElement = dom.window.SVGElement;
  const { Hud } = await import('../src/client/hud.ts');
  hud = new Hud();
});

describe('hud', () => {
  it('wires every element the game touches', () => {
    expect(() => {
      hud.showMenu(false);
      hud.showGame(true);
      hud.setScore(2, 1, 0, 'ALPHA', 'BETA');
      hud.setRing(true, 40, false, 30);
      hud.feedLine('YOU KILLED BETA', 'me');
      hud.bannerText('VICTORY', 'me');
      hud.killBanner('ELIMINATED');
      hud.hitmarker(true);
      hud.damage();
      hud.frame({
        speed: 32,
        scopeT: 0.2,
        hipSpread: 2.4,
        fireCooldown: 0.4,
        chain: 2,
        alive: false,
        respawnIn: 1.7,
        protect: false,
        slot: 0,
        hookFlying: false,
        hooked: false,
      });
      hud.setNet(42, 'ONLINE', 'ok');
      hud.setHint(true);
      hud.setWeaponLabel('LANCE');
      hud.showPause(true);
      hud.showPause(false);
      hud.showResults({ title: 'VICTORY', eyebrow: 'DUEL WON', score: '3 — 1', note: 'GG', win: true });
      hud.hideResults();
      hud.setMenuStatus('WAITING', 'wait');
      hud.setMenuNote('SEARCHING…');
      hud.toastMsg('HELLO');
    }).not.toThrow();
  });

  it('renders the score, ring and reload state', () => {
    hud.setScore(2, 1, 1, 'ALPHA', 'BETA');
    expect(document.getElementById('score-a')?.textContent).toBe('2');
    expect(document.getElementById('score-b')?.textContent).toBe('1');
    hud.setRing(false, MATCH.ringRadiusStart, true, 3);
    expect(document.getElementById('ringlabel')?.textContent).toContain('RING HOLDS 22s');
    const bar = document.querySelector('#ringbar i') as HTMLElement | null;
    expect(bar?.style.width).toBe('0%');
    hud.setRing(true, MATCH.ringRadiusEnd, true, 90);
    expect(document.getElementById('ringlabel')?.textContent).toBe('RING CLOSING');
    expect((document.querySelector('#ringbar i') as HTMLElement).style.width).toBe('100%');
    hud.frame({
      speed: 10,
      scopeT: 0,
      hipSpread: 2.4,
      fireCooldown: 0.575,
      chain: 0,
      alive: true,
      respawnIn: 0,
      protect: true,
      slot: 0,
      hookFlying: false,
      hooked: false,
    });
    const arc = document.getElementById('reloadArc');
    expect(arc?.classList.contains('on')).toBe(true);
    expect(document.getElementById('respawn')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('protect')?.classList.contains('hidden')).toBe(false);
  });

  it('shows and hides the scope with the scope transition', () => {
    const scope = document.getElementById('scope') as HTMLElement;
    hud.frame({ speed: 0, scopeT: 0, hipSpread: 2.4, fireCooldown: 0, chain: 0, alive: true, respawnIn: 0, protect: false, slot: 0, hookFlying: false, hooked: false });
    expect(scope.classList.contains('on')).toBe(false);
    hud.frame({ speed: 0, scopeT: 1, hipSpread: 0, fireCooldown: 0, chain: 0, alive: true, respawnIn: 0, protect: false, slot: 0, hookFlying: false, hooked: false });
    expect(scope.classList.contains('on')).toBe(true);
    expect(document.getElementById('crosshair')?.classList.contains('scoped')).toBe(true);
  });

  it('reads the claw target state on the crosshair', () => {
    const crosshair = document.getElementById('crosshair') as HTMLElement;
    const frame = (hookAim: 0 | 1 | 2): void =>
      hud.frame({
        speed: 0, scopeT: 0, hipSpread: 0, fireCooldown: 0, chain: 0,
        alive: true, respawnIn: 0, protect: false, slot: 1,
        hookFlying: false, hooked: false, hookAim,
      });
    frame(0);
    expect(crosshair.classList.contains('aim0')).toBe(true);
    frame(1);
    expect(crosshair.classList.contains('aim0')).toBe(false);
    expect(crosshair.classList.contains('aim1')).toBe(true);
    frame(2);
    expect(crosshair.classList.contains('aim1')).toBe(false);
    expect(crosshair.classList.contains('aim2')).toBe(true);
    // Back on the rifle the state clears, so it can never leak across slots.
    hud.frame({ speed: 0, scopeT: 0, hipSpread: 0, fireCooldown: 0, chain: 0, alive: true, respawnIn: 0, protect: false, slot: 0, hookFlying: false, hooked: false });
    expect(crosshair.classList.contains('aim2')).toBe(false);
  });
});
