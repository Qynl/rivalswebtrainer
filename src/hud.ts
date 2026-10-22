import type { Game } from './game/game';

export class Hud {
  private masksEl = document.getElementById('masks')!;
  private dashFill = document.getElementById('dash-fill')!;
  private areaCard = document.getElementById('area-card')!;
  private areaCardText = document.getElementById('area-card-text')!;
  private lastMasksMax = -1;
  private cardShown = false;

  update(game: Game): void {
    const { hud } = game;

    if (hud.masksMax !== this.lastMasksMax || this.masksEl.children.length !== hud.masksMax) {
      this.masksEl.innerHTML = '';
      for (let i = 0; i < hud.masksMax; i++) {
        const d = document.createElement('div');
        d.className = 'mask';
        this.masksEl.appendChild(d);
      }
      this.lastMasksMax = hud.masksMax;
    }
    const children = this.masksEl.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('empty', i >= hud.masks);
    }

    const pct = hud.dashReady ? 100 : Math.max(0, 100 * (1 - hud.dashCooldown / 0.46));
    this.dashFill.style.width = `${pct}%`;

    if (hud.messageTimer > 0) {
      if (this.areaCardText.textContent !== hud.message) this.areaCardText.textContent = hud.message;
      if (!this.cardShown) {
        this.areaCard.classList.add('show');
        this.cardShown = true;
      }
    } else if (this.cardShown) {
      this.areaCard.classList.remove('show');
      this.cardShown = false;
    }
  }
}
