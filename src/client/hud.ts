/**
 * All game UI is DOM/SVG/CSS — deliberately not 3D, so it is crisp at any
 * resolution and costs nothing on the GPU. This file owns nothing but the
 * presentation of state; it never touches the simulation.
 */

import { MATCH } from '../shared/constants.ts';
import { clamp, smoothstep } from '../shared/mathx.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

export class Hud {
  private root = el('hud');
  private menu = el('menu');
  private results = el('results');
  private pause = el('pause');
  private toast = el('toast');
  private crosshair = el('crosshair');
  private hitmarkerEl = el('hitmarker');
  private scope = el('scope');
  private feed = el('feed');
  private banner = el('banner');
  private killbanner = el('killbanner');
  private killtext = el('killtext');
  private scoreA = el('score-a');
  private scoreB = el('score-b');
  private nameA = el('name-a');
  private nameB = el('name-b');
  private ringbar = el('ringbar');
  private ringlabel = el('ringlabel');
  private ringwarn = el('ringwarn');
  private respawn = el('respawn');
  private respawnval = el('respawnval');
  private protect = el('protect');
  private chainglow = el('chainglow');
  private speedval = el('speedval');
  private chainval = el('chainval');
  private reloadArc = el('reloadArc');
  private reloadCircle = el('reloadCircle') as unknown as SVGCircleElement;
  private ping = el('ping');
  private connection = el('connection');
  private hint = el('hint');
  private speedvignette = el('speedvignette');
  private ringvignette = el('ringvignette');
  private weaponLabel = el('weaponLabel');
  private ammoCount = el('ammoCount');
  private matchTimer = el('matchtimer');
  private hitdir = el('hitdir');
  private menuStatus = el('menu-status');
  private menuNote = el('menu-note');
  private resultTitle = el('result-title');
  private resultEyebrow = el('result-eyebrow');
  private resultScore = el('result-score');
  private resultNote = el('result-note');
  private flashEl: HTMLDivElement;
  private hitTimer = 0;
  private bannerTimer = 0;

  constructor() {
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'flash';
    this.root.appendChild(this.flashEl);
    this.reloadCircle.style.strokeDasharray = `${2 * Math.PI * 16}`;
    this.reloadCircle.style.strokeDashoffset = `${2 * Math.PI * 16}`;
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  showMenu(show: boolean): void {
    this.menu.classList.toggle('hidden', !show);
    if (show) this.root.classList.add('hidden');
  }

  showGame(show: boolean): void {
    this.root.classList.toggle('hidden', !show);
    if (show) {
      this.menu.classList.add('hidden');
      this.results.classList.add('hidden');
      this.pause.classList.add('hidden');
    }
  }

  showPause(show: boolean): void {
    this.pause.classList.toggle('hidden', !show);
  }

  showResults(opts: {
    title: string;
    eyebrow: string;
    score: string;
    note: string;
    win: boolean;
  }): void {
    this.resultTitle.textContent = opts.title;
    this.resultTitle.className = opts.win ? 'win' : 'lose';
    this.resultEyebrow.textContent = opts.eyebrow;
    this.resultScore.textContent = opts.score;
    this.resultNote.textContent = opts.note;
    this.results.classList.remove('hidden');
    this.root.classList.add('hidden');
    this.pause.classList.add('hidden');
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }

  setMenuStatus(text: string, kind: 'ok' | 'wait' | 'bad' = 'ok'): void {
    this.menuStatus.textContent = text;
    this.menuStatus.className = kind;
  }

  setMenuNote(text: string): void {
    this.menuNote.textContent = text;
  }

  toastMsg(text: string, ms = 2200): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), ms);
  }
  private toastTimer = 0;

  // ── Match state ──────────────────────────────────────────────────────────
  setScore(a: number, b: number, mine: 0 | 1, nameA: string, nameB: string): void {
    this.scoreA.textContent = String(a);
    this.scoreB.textContent = String(b);
    this.scoreA.classList.toggle('mine', mine === 0);
    this.scoreB.classList.toggle('mine', mine === 1);
    this.nameA.textContent = nameA;
    this.nameB.textContent = nameB;
  }

  setRing(active: boolean, radius: number, inside: boolean, elapsed: number): void {
    const t = clamp((radius - MATCH.ringRadiusEnd) / (MATCH.ringRadiusStart - MATCH.ringRadiusEnd), 0, 1);
    this.ringbar.querySelector('i')!.style.width = `${(1 - t) * 100}%`;
    this.ringbar.classList.toggle('active', active);
    this.ringlabel.textContent = active ? 'RING CLOSING' : `RING HOLDS ${Math.max(0, Math.ceil(MATCH.ringStartAt - elapsed))}s`;
    this.ringwarn.classList.toggle('hidden', inside);
    this.ringvignette.classList.toggle('on', !inside);
    if (!inside) {
      const pulse = Math.sin(performance.now() / 140) * 0.5 + 0.5;
      this.ringvignette.style.opacity = String(0.35 + pulse * 0.35);
    }
  }

  feedLine(text: string, tone: 'me' | 'them' | 'system'): void {
    const line = document.createElement('div');
    line.className = `feedline ${tone}`;
    line.textContent = text;
    this.feed.appendChild(line);
    while (this.feed.children.length > 4) this.feed.firstElementChild?.remove();
    window.setTimeout(() => line.classList.add('out'), 3400);
    window.setTimeout(() => line.remove(), 4100);
  }

  bannerText(text: string, tone: 'me' | 'them' | 'system', ms = 1600): void {
    this.banner.textContent = text;
    this.banner.className = `show ${tone}`;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.className = '';
    }, ms);
  }

  killBanner(text: string): void {
    this.killtext.textContent = text;
    this.killbanner.classList.remove('hidden');
    this.killbanner.classList.remove('pop');
    void this.killbanner.offsetWidth;
    this.killbanner.classList.add('pop');
    window.setTimeout(() => this.killbanner.classList.add('hidden'), 1400);
  }

  hitmarker(kill: boolean): void {
    this.hitmarkerEl.classList.remove('show', 'kill');
    void this.hitmarkerEl.offsetWidth;
    this.hitmarkerEl.classList.add('show');
    if (kill) this.hitmarkerEl.classList.add('kill');
    this.hitTimer = performance.now();
  }

  /** Seconds of match time, shown as m:ss in the score pod. */
  setTimer(seconds: number): void {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    this.matchTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /** Damage arc rotated to the shooter, relative to where you are looking. */
  hitDirection(angle: number): void {
    this.hitdir.style.setProperty('--dir', `${angle}rad`);
    this.hitdir.classList.remove('show');
    void this.hitdir.offsetWidth;
    this.hitdir.classList.add('show');
    window.clearTimeout(this.hitdirTimer);
    this.hitdirTimer = window.setTimeout(() => this.hitdir.classList.remove('show'), 900);
  }
  private hitdirTimer = 0;

  damage(): void {
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  frame(opts: {
    speed: number;
    scopeT: number;
    hipSpread: number;
    fireCooldown: number;
    chain: number;
    alive: boolean;
    respawnIn: number;
    protect: boolean;
  }): void {
    const spread = 8 + opts.hipSpread * 10 + Math.min(26, opts.speed * 0.4);
    this.crosshair.style.setProperty('--spread', `${spread.toFixed(1)}px`);
    this.crosshair.classList.toggle('scoped', opts.scopeT > 0.72);
    this.crosshair.classList.toggle('dead', !opts.alive);
    this.scope.style.opacity = String(smoothstep(0.55, 1, opts.scopeT));
    this.scope.classList.toggle('on', opts.scopeT > 0.55);
    this.speedval.textContent = String(Math.round(opts.speed));
    this.chainval.textContent = String(opts.chain);
    this.chainval.parentElement?.classList.toggle('hot', opts.chain > 0);
    this.chainglow.classList.toggle('hidden', opts.chain < 2);

    const reloadPct = opts.fireCooldown > 0 ? 1 - opts.fireCooldown / 1 : 1;
    this.reloadArc.classList.toggle('on', opts.fireCooldown > 0);
    const loaded = opts.fireCooldown <= 0;
    this.ammoCount.textContent = loaded ? '1' : '0';
    this.ammoCount.classList.toggle('empty', !loaded);
    const circ = 2 * Math.PI * 16;
    this.reloadCircle.style.strokeDashoffset = `${circ * (1 - reloadPct)}`;

    this.respawn.classList.toggle('hidden', opts.alive);
    if (!opts.alive) this.respawnval.textContent = Math.max(0, opts.respawnIn).toFixed(1);
    this.protect.classList.toggle('hidden', !opts.protect || !opts.alive);

    this.speedvignette.style.opacity = String(clamp((opts.speed - 22) / 55, 0, 0.5));

    if (performance.now() - this.hitTimer > 260) this.hitmarkerEl.classList.remove('show', 'kill');
  }

  setNet(ping: number, label: string, tone: 'ok' | 'warn' | 'bad'): void {
    this.ping.textContent = `${Math.round(ping)} MS`;
    this.connection.textContent = label;
    this.connection.className = tone;
  }

  setHint(visible: boolean): void {
    this.hint.classList.toggle('show', visible);
  }

  setWeaponLabel(text: string): void {
    this.weaponLabel.textContent = text;
  }
}
