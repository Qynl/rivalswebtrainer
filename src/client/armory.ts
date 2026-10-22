/**
 * The Armory: the store for cosmetics.
 *
 * DOM only. Everything is cards and CSS, so it stays crisp at any resolution
 * and never costs the GPU a draw call. Prices come from the shared catalogue,
 * so the server and the UI can never disagree about what a skin is.
 */

import {
  CATALOGUE,
  type Cosmetic,
  type CosmeticKind,
  type GunSkin,
  type GrappleSkin,
  type KillEffect,
} from '../shared/cosmetics.ts';
import type { Progress } from './progress.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A tiny 2D drawing of the item, tinted with its own palette. */
function preview(c: Cosmetic): string {
  if (c.kind === 'gun') {
    const s = c as GunSkin;
    return `<svg viewBox="0 0 200 74" aria-hidden="true">
      <rect x="10" y="30" width="120" height="12" rx="2" fill="${hex(s.body)}"/>
      <rect x="18" y="22" width="52" height="9" rx="2" fill="${hex(s.panel)}"/>
      <rect x="130" y="32" width="54" height="6" rx="2" fill="${hex(s.metal)}"/>
      <rect x="176" y="30" width="12" height="10" rx="2" fill="${hex(s.trim)}"/>
      <rect x="58" y="16" width="44" height="8" rx="3" fill="${hex(s.metal)}"/>
      <circle cx="102" cy="20" r="5" fill="${hex(s.glow)}"/>
      <rect x="34" y="42" width="22" height="18" rx="3" fill="${hex(s.panel)}"/>
      <rect x="12" y="42" width="14" height="20" rx="3" fill="${hex(s.body)}"/>
      <rect x="60" y="42" width="12" height="14" rx="2" fill="${hex(s.trim)}"/>
    </svg>`;
  }
  if (c.kind === 'grapple') {
    const s = c as GrappleSkin;
    return `<svg viewBox="0 0 200 74" aria-hidden="true">
      <circle cx="72" cy="38" r="17" fill="none" stroke="${hex(s.rope)}" stroke-width="3"/>
      <circle cx="72" cy="38" r="7" fill="${hex(s.spool)}"/>
      <path d="M92 38 h34" stroke="${hex(s.rope)}" stroke-width="3"/>
      <path d="M126 38 l16 -14 M126 38 h20 M126 38 l16 14" stroke="${hex(s.claw)}" stroke-width="5" stroke-linecap="round"/>
      <rect x="30" y="30" width="26" height="16" rx="4" fill="${hex(s.body)}"/>
      <circle cx="150" cy="24" r="3" fill="${hex(s.trail)}" opacity="0.9"/>
      <circle cx="158" cy="52" r="2" fill="${hex(s.trail)}" opacity="0.6"/>
    </svg>`;
  }
  const s = c as KillEffect;
  return `<svg viewBox="0 0 200 74" aria-hidden="true">
    <circle cx="100" cy="37" r="26" fill="none" stroke="${hex(s.ring)}" stroke-width="2.5" opacity="0.85"/>
    <circle cx="100" cy="37" r="15" fill="none" stroke="${hex(s.burst)}" stroke-width="1.5" opacity="0.7"/>
    <path d="M100 9 v10 M100 55 v10 M72 37 h10 M118 37 h10 M82 19 l7 7 M118 48 l-7 -7 M118 19 l-7 7 M82 48 l7 -7"
      stroke="${hex(s.burst)}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="37" r="5" fill="${hex(s.motes)}"/>
  </svg>`;
}

const TIER_LABEL: Record<string, string> = {
  field: 'FIELD',
  precision: 'PRECISION',
  signature: 'SIGNATURE',
};

export class Armory {
  private progress: Progress;
  private onChange: () => void;
  private root = el('armory');
  private grid = el('armory-grid');
  private coins = el('armory-coins');
  private level = el('armory-level');
  private levelFill = el('armory-level-fill');
  private levelSub = el('armory-level-sub');
  private note = el('armory-note');
  private tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-armory-tab]')];
  private kind: CosmeticKind = 'gun';
  private open = false;

  constructor(progress: Progress, onChange: () => void) {
    this.progress = progress;
    this.onChange = onChange;
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        this.kind = (tab.dataset.armoryTab as CosmeticKind) ?? 'gun';
        this.render();
      });
    }
    el<HTMLButtonElement>('armory-back').addEventListener('click', () => this.close());
    this.grid.addEventListener('click', (ev) => this.onCardClick(ev));
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(kind: CosmeticKind = 'gun'): void {
    this.kind = kind;
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  private close(): void {
    this.hide();
    this.onChange();
    window.dispatchEvent(new CustomEvent('gg:armory-closed'));
  }

  private onCardClick(ev: MouseEvent): void {
    const target = (ev.target as HTMLElement).closest('[data-item]') as HTMLElement | null;
    if (!target) return;
    const id = target.dataset.item!;
    const kind = target.dataset.kind as CosmeticKind;
    if (target.dataset.action === 'buy') {
      const result = this.progress.buy(kind, id);
      this.note.textContent =
        result.reason === 'poor' ? 'NOT ENOUGH COINS — WIN DUELS TO EARN MORE' : 'UNLOCKED';
      this.note.classList.toggle('warn', result.reason === 'poor');
    } else {
      this.progress.equip(kind, id);
      this.note.textContent = 'EQUIPPED';
      this.note.classList.remove('warn');
    }
    this.onChange();
    this.render();
  }

  private render(): void {
    const state = this.progress.state;
    const lvl = this.progress.level;
    this.coins.textContent = String(state.coins);
    this.level.textContent = `LV ${lvl.level}`;
    this.levelFill.style.width = `${Math.round(lvl.fraction * 100)}%`;
    this.levelSub.textContent = `${lvl.into} / ${lvl.need} XP`;
    for (const tab of this.tabs) {
      tab.classList.toggle('on', tab.dataset.armoryTab === this.kind);
    }

    const equipped = state.loadout[this.kind];
    const owned = (id: string): boolean => this.progress.owns(this.kind, id);
    const cards = CATALOGUE[this.kind]
      .map((item) => {
        const isEquipped = equipped === item.id;
        const have = owned(item.id);
        const action = isEquipped ? 'equipped' : have ? 'equip' : 'buy';
        const label = isEquipped ? 'EQUIPPED' : have ? 'EQUIP' : `${item.price}`;
        const disabled = action === 'equipped' ? 'disabled' : '';
        const poor = !have && state.coins < item.price ? 'poor' : '';
        return `<article class="card tier-${item.tier} ${isEquipped ? 'active' : ''} ${poor}" data-item="${item.id}" data-kind="${this.kind}">
          <div class="card-art">${preview(item)}</div>
          <div class="card-tier"><span>${TIER_LABEL[item.tier]}</span><i class="tier-dot"></i></div>
          <h3>${item.name}</h3>
          <p>${item.blurb}</p>
          <button class="card-btn ${action}" data-action="${have ? 'equip' : 'buy'}" data-item="${item.id}" data-kind="${this.kind}" ${disabled}>
            ${action === 'buy' ? '<span class="coin">◆</span>' : ''}${label}
          </button>
        </article>`;
      })
      .join('');
    this.grid.innerHTML = cards;
  }
}
