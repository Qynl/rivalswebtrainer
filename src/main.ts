import './style.css';
import './landing.css';
import { Game, type GameEvent, type Command } from './game/game';
import type { Difficulty, WeaponId } from './game/config';
import { Renderer } from './render/renderer';
import { Input } from './input';
import { Hud } from './hud';
import { Sfx } from './audio';

const STEP = 1 / 120;
const MAX_FRAME = 0.05;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu');
const pause = $('pause');
const matchEnd = $('match-end');

const renderer = new Renderer(canvas);
const input = new Input(canvas);
const hud = new Hud();
const sfx = new Sfx();

const difficultyEl = $<HTMLSelectElement>('difficulty');
const loadoutEl = $<HTMLSelectElement>('loadout');
const secondaryEl = $<HTMLSelectElement>('secondary');
const sensitivityEl = $<HTMLInputElement>('sensitivity');
const invertEl = $<HTMLInputElement>('sensitivity-invert');

type Screen = 'menu' | 'playing' | 'paused' | 'over';
let screen: Screen = 'menu';
let game: Game | null = null;
let accumulator = 0;
let lastTime = performance.now();
let arenaBuilt = false;

function readSettings(): { primary: WeaponId; secondary: WeaponId; difficulty: Difficulty } {
  input.sensitivity = Number(sensitivityEl.value);
  input.invertY = invertEl.checked;
  return {
    primary: loadoutEl.value as WeaponId,
    secondary: secondaryEl.value as WeaponId,
    difficulty: difficultyEl.value as Difficulty,
  };
}

/** Builds a fresh match with the chosen settings and points the camera at the spawn. */
function newGame(): Game {
  const settings = readSettings();
  const g = new Game({
    primary: settings.primary,
    secondary: settings.secondary,
    difficulty: settings.difficulty,
  });
  if (!arenaBuilt) {
    renderer.buildArena(g.solids);
    arenaBuilt = true;
  }
  renderer.setLoadout(settings.primary, settings.secondary);
  input.setView(g.player.yaw, 0);
  return g;
}

function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle('hidden', !visible);
}

function startMatch(): void {
  sfx.unlock();
  game = newGame();
  accumulator = 0;
  screen = 'playing';
  show(menu, false);
  show(pause, false);
  show(matchEnd, false);
  hud.show(true);
  hud.flashBanner('ROUND 1', 1.8);
  input.requestLock();
}

function resume(): void {
  if (screen !== 'paused') return;
  screen = 'playing';
  show(pause, false);
  input.requestLock();
}

function pauseGame(): void {
  if (screen !== 'playing') return;
  screen = 'paused';
  show(pause, true);
}

function quitToMenu(): void {
  input.releaseLock();
  screen = 'menu';
  game = newGame();
  hud.show(false);
  show(pause, false);
  show(matchEnd, false);
  show(menu, true);
}

function handleEvents(events: GameEvent[], g: Game): void {
  renderer.handleEvents(events);
  for (const e of events) {
    switch (e.type) {
      case 'shot':
        if (e.by === 'player') sfx.gunshot('mid');
        break;
      case 'swing':
        sfx.swing();
        break;
      case 'dash':
        sfx.dash();
        break;
      case 'roundStart':
        if (e.round > 1) hud.flashBanner(`ROUND ${e.round}`, 1.8);
        break;
      case 'roundEnd':
        sfx.roundEnd(e.result === 'player');
        hud.flashBanner(e.result === 'player' ? 'ROUND WON' : e.result === 'bot' ? 'ROUND LOST' : 'DRAW', 2);
        hud.addFeed(
          e.result === 'player' ? 'You won the round' : e.result === 'bot' ? 'Bot won the round' : 'Round drawn',
          e.result === 'player' ? 'you' : e.result === 'bot' ? 'bot' : 'neutral',
        );
        break;
      case 'hit':
        if (e.by === 'player') {
          hud.hitMarker(e.head);
          sfx.hitMarker(e.head);
        }
        if (e.target === 'player') sfx.hurt();
        break;
      case 'death':
        hud.addFeed(e.target === 'bot' ? 'Bot eliminated' : 'You were eliminated', e.target === 'bot' ? 'you' : 'bot');
        break;
      case 'matchEnd':
        endMatchScreen(e.winner, g);
        break;
    }
  }
}

function endMatchScreen(winner: 'player' | 'bot' | 'draw', g: Game): void {
  screen = 'over';
  input.releaseLock();
  hud.show(false);
  $('match-result').textContent = winner === 'player' ? 'VICTORY' : winner === 'bot' ? 'DEFEAT' : 'DRAW';
  $('match-score').textContent = `${g.match.playerWins} - ${g.match.botWins}`;
  show(matchEnd, true);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - lastTime) / 1000);
  lastTime = now;

  if (game && screen === 'playing') {
    const cmd: Command = input.sample();
    accumulator += dt;
    const g = game;
    let first = true;
    while (accumulator >= STEP && screen === 'playing') {
      // One-shot inputs (edges) only apply on the first fixed step of the frame.
      const stepCmd: Command = first
        ? cmd
        : { ...cmd, fireEdge: false, melee: false, dash: false, reload: false, slot: null,
            move: { ...cmd.move, jumpPressed: false, crouchPressed: false } };
      g.step(STEP, stepCmd);
      first = false;
      accumulator -= STEP;
      handleEvents(g.drainEvents(), g);
    }
    hud.update(g, dt);
  } else if (game) {
    handleEvents(game.drainEvents(), game);
  }

  if (game) renderer.render(game, dt);
}

// Input-driven screen transitions.
document.addEventListener('pointerlockchange', () => {
  if (!input.locked && screen === 'playing') pauseGame();
});

$('play').addEventListener('click', startMatch);
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', quitToMenu);
$('rematch').addEventListener('click', startMatch);
$('to-menu').addEventListener('click', quitToMenu);
canvas.addEventListener('click', () => {
  sfx.unlock();
  if (screen === 'playing' && !input.locked) input.requestLock();
});

game = newGame();
show(menu, false);
$('enter').addEventListener('click', () => {
  sfx.unlock();
  show($('landing'), false);
  show(menu, true);
});
requestAnimationFrame(t => {
  lastTime = t;
  frame(t);
});
