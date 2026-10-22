/**
 * Vite + React entry.
 *
 * React renders the shell synchronously, then the game boots into it. The
 * synchronous render is deliberate: `main.ts` resolves every element by id the
 * moment it constructs, and a deferred mount would leave it looking at an empty
 * document — including in the headless client test.
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { bootGame } from './main.ts';
import './style.css';

const host = document.getElementById('root');
if (host) {
  const root = createRoot(host);
  flushSync(() => root.render(<App />));
  void bootGame();
} else {
  document.body.innerHTML = '<p style="font:14px monospace;color:#e8b25c;padding:24px">MISSING #root</p>';
}
