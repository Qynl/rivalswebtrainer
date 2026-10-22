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
    // The preview draws the claw the skin actually has: three slim flukes,
    // four needles, two heavy barbs or the caged head. Buying a silhouette is
    // the point, so the card has to show it.
    const flukes =
      s.clawShape === 'quad'
        ? `<path d="M126 38 l15 -16 M126 38 l17 -6 M126 38 l17 6 M126 38 l15 16" stroke="${hex(s.claw)}" stroke-width="3.4" stroke-linecap="round"/>`
        : s.clawShape === 'twin'
          ? `<path d="M126 38 l20 -15 M126 38 l20 15" stroke="${hex(s.claw)}" stroke-width="7" stroke-linecap="round"/>`
          : `<path d="M126 38 l16 -14 M126 38 h20 M126 38 l16 14" stroke="${hex(s.claw)}" stroke-width="5" stroke-linecap="round"/>`;
    const cage =
      s.clawShape === 'ring'
        ? `<ellipse cx="140" cy="38" rx="9" ry="19" fill="none" stroke="${hex(s.claw)}" stroke-width="1.6" opacity="0.85"/>`
        : '';
    return `<svg viewBox="0 0 200 74" aria-hidden="true">
      <circle cx="72" cy="38" r="17" fill="none" stroke="${hex(s.rope)}" stroke-width="3"/>
      <circle cx="72" cy="38" r="7" fill="${hex(s.spool)}"/>
      <path d="M92 38 h34" stroke="${hex(s.rope)}" stroke-width="3"/>
      ${flukes}${cage}
      <circle cx="140" cy="38" r="3" fill="${hex(s.trail)}"/>
      <rect x="30" y="30" width="26" height="16" rx="4" fill="${hex(s.body)}"/>
      <circle cx="150" cy="24" r="3" fill="${hex(s.trail)}" opacity="0.9"/>
      <circle cx="158" cy="52" r="2" fill="${hex(s.trail)}" opacity="0.6"/>
    </svg>`;
  }
  return fxPreview(c as KillEffect);
}

/**
 * The effect card animates the effect it is selling: the same shape language the
 * renderer uses (shards tumble, petals open, arcs fork) drawn in 2D. The shop is
 * the only place a player can study a purchase, so a still frame undersells it.
 */
function fxPreview(s: KillEffect): string {
  const ring = hex(s.ring);
  const burst = hex(s.burst);
  const motes = hex(s.motes);
  const common = `<circle class="fx-ring" cx="100" cy="37" r="26" fill="none" stroke="${ring}" stroke-width="2.5"/>`;
  const core = `<circle cx="100" cy="37" r="4.5" fill="${motes}"/>`;
  switch (s.shape) {
    case 'shard':
      return `<svg viewBox="0 0 200 74" aria-hidden="true">${common}
        <g class="fx-spin" style="transform-origin:100px 37px">
          <path d="M100 16 l7 9 -7 12 -7 -12z" fill="${burst}" opacity="0.95"/>
          <path d="M70 30 l6 6 -6 9 -6 -9z" fill="${motes}" opacity="0.85"/>
          <path d="M130 44 l6 -7 6 8 -6 8z" fill="${burst}" opacity="0.8"/>
          <path d="M88 54 l5 5 -5 7 -5 -7z" fill="${motes}" opacity="0.7"/>
        </g>${core}</svg>`;
    case 'petal':
      return `<svg viewBox="0 0 200 74" aria-hidden="true">${common}
        <g class="fx-bloom" style="transform-origin:100px 37px">
          <ellipse cx="100" cy="26" rx="5" ry="11" fill="${burst}" opacity="0.8"/>
          <ellipse cx="111" cy="37" rx="11" ry="5" fill="${burst}" opacity="0.8"/>
          <ellipse cx="100" cy="48" rx="5" ry="11" fill="${motes}" opacity="0.7"/>
          <ellipse cx="89" cy="37" rx="11" ry="5" fill="${motes}" opacity="0.7"/>
        </g>${core}</svg>`;
    case 'arc':
      return `<svg viewBox="0 0 200 74" aria-hidden="true">${common}
        <g class="fx-flicker" stroke="${burst}" stroke-width="2.4" stroke-linecap="round" fill="none">
          <path d="M100 37 l-16 -12 8 -2 -14 -12"/>
          <path d="M100 37 l17 -13 -9 -2 15 -11"/>
          <path d="M100 37 l-14 13 9 2 -14 12"/>
          <path d="M100 37 l15 12 -10 2 14 11" stroke="${motes}"/>
        </g>${core}</svg>`;
    case 'star':
      return `<svg viewBox="0 0 200 74" aria-hidden="true">
        <circle class="fx-ring fast" cx="100" cy="37" r="26" fill="none" stroke="${ring}" stroke-width="2.5"/>
        <circle class="fx-ring slow" cx="100" cy="37" r="26" fill="none" stroke="${motes}" stroke-width="1.6"/>
        <circle cx="100" cy="37" r="9" fill="${burst}" opacity="0.9"/>${core}</svg>`;
    default:
      return `<svg viewBox="0 0 200 74" aria-hidden="true">${common}
        <g class="fx-spark" stroke="${burst}" stroke-width="3" stroke-linecap="round">
          <path d="M100 12 v12 M100 50 v12 M74 37 h12 M114 37 h12"/>
          <path d="M84 21 l7 7 M116 46 l-7 -7 M116 21 l-7 7 M84 46 l7 -7" stroke="${motes}"/>
        </g>${core}</svg>`;
  }
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
