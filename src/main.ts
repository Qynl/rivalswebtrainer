import './style.css';
import { Game } from './game/game';
import { InputManager } from './input';
import { Hud } from './hud';
import { render, VIEW_W, VIEW_H } from './render/renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hudEl = document.getElementById('hud')!;
const pauseEl = document.getElementById('pause')!;
const enterBtn = document.getElementById('enter')!;
const resumeBtn = document.getElementById('resume')!;
const quitBtn = document.getElementById('quit')!;
const restartBtn = document.getElementById('restart-chamber')!;

const input = new InputManager();
input.attach(window);

const game = new Game();
const hud = new Hud();

let playing = false;
let paused = false;

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const aspect = VIEW_W / VIEW_H;
  let cssW = window.innerWidth;
  let cssH = window.innerHeight;
  if (cssW / cssH > aspect) {
    cssW = cssH * aspect;
  } else {
    cssH = cssW / aspect;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function startGame(): void {
  playing = true;
  paused = false;
  document.body.classList.add('playing');
  hudEl.classList.remove('hidden');
  pauseEl.classList.add('hidden');
  game.reset();
  canvas.focus();
}

function quitToMenu(): void {
  playing = false;
  paused = false;
  document.body.classList.remove('playing');
  hudEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
}

enterBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', () => {
  paused = false;
  pauseEl.classList.add('hidden');
});
restartBtn.addEventListener('click', () => {
  game.reset();
  paused = false;
  pauseEl.classList.add('hidden');
});
quitBtn.addEventListener('click', quitToMenu);

const FIXED_DT = 1 / 120;
let accumulator = 0;
let lastTime = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.25) dt = 0.25;

  if (!playing) return;

  if (input.pausePressed()) {
    paused = !paused;
    pauseEl.classList.toggle('hidden', !paused);
  }

  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 8) {
      const frameInput = input.poll();
      game.update(frameInput, FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
  } else {
    input.poll();
  }

  const scale = canvas.width / VIEW_W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  render(ctx, game, FIXED_DT);

  hud.update(game);
}

requestAnimationFrame(frame);
