import { MATCH, PLAYER, WEAPONS } from './game/config';
import type { Game } from './game/game';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing HUD element #${id}`);
  return e as T;
}

export class Hud {
  private readonly root = el('hud');
  private readonly hpFill = el('hp-fill');
  private readonly hpText = el('hp-text');
  private readonly speedFill = el('stamina-fill');
  private readonly stateText = el('state-text');
  private readonly weaponName = el('weapon-name');
  private readonly ammo = el('ammo');
  private readonly dashCd = el('dash-cd');
  private readonly scoreYou = el('score-you');
  private readonly scoreBot = el('score-bot');
  private readonly roundLabel = el('round-label');
  private readonly timer = el('timer');
  private readonly feed = el('feed');
  private readonly banner = el('banner');
  private readonly hitmarker = el('hitmarker');
  private bannerTimer = 0;
  private hitTimer = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(game: Game, dt: number): void {
    const p = game.player;
    const m = game.match;

    this.hpFill.style.width = `${(Math.max(0, p.hp) / PLAYER.maxHp) * 100}%`;
    this.hpText.textContent = String(Math.max(0, Math.round(p.hp)));

    const speed = Math.hypot(p.move.vel.x, p.move.vel.z);
    this.speedFill.style.width = `${Math.min(1, speed / 14) * 100}%`;
    const state: string[] = [];
    if (p.move.sliding) state.push(p.move.slideJumping ? 'SLIDE-JUMP' : 'SLIDING');
    else if (!p.move.onGround) state.push('AIRBORNE');
    this.stateText.textContent = state.join(' ');

    if (p.slot === 3) {
      this.weaponName.textContent = 'SCYTHE';
      this.ammo.textContent = '—';
    } else {
      const w = p.slot === 1 ? p.pistol : p.primary;
      const def = WEAPONS[w.id];
      this.weaponName.textContent = def.name.toUpperCase();
      this.ammo.textContent = w.reloadTimer > 0 ? 'RELOADING' : `${w.ammo} / ${def.magSize}`;
    }

    const cd = p.scythe.dashCooldown;
    this.dashCd.textContent = cd > 0 ? `${cd.toFixed(1)}s` : 'READY';
    this.dashCd.parentElement?.classList.toggle('ready', cd <= 0);

    this.scoreYou.textContent = String(m.playerWins);
    this.scoreBot.textContent = String(m.botWins);
    this.roundLabel.textContent = `ROUND ${Math.min(m.round, MATCH.rounds)} / ${MATCH.rounds}`;
    const t = Math.max(0, Math.ceil(m.roundTimeLeft));
    this.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('show');
    }
  }

  /** Shows a centred banner for a short time. */
  flashBanner(text: string, seconds = 2): void {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  addFeed(text: string, kind: 'you' | 'bot' | 'neutral' = 'neutral'): void {
    const line = document.createElement('div');
    line.className = `feed-line ${kind}`;
    line.textContent = text;
    this.feed.prepend(line);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => line.remove(), 4000);
  }

  hitMarker(head: boolean): void {
    this.hitmarker.classList.toggle('head', head);
    this.hitmarker.classList.add('show');
    this.hitTimer = 0.18;
  }
}
