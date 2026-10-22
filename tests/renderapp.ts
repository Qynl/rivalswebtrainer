/**
 * Mounts the real React shell into a DOM, for tests that only want the markup.
 *
 * The screens are React components now, so anything that needs `#hud`,
 * `#armory` or `#menu` has to render the app first — exactly as the browser
 * does. `flushSync` keeps it synchronous, which is what the game's by-id
 * lookups on construction assume.
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { App as AppComponent } from '../src/client/ui/App.tsx';

export async function mountApp(host?: HTMLElement | null): Promise<void> {
  const { App } = await import('../src/client/ui/App.tsx');
  const target = host ?? document.getElementById('root');
  if (!target) throw new Error('missing #root for the React shell');
  // React reads `document` from the global scope; tests install their own
  // window before calling this, so nothing else is needed here.
  const root = createRoot(target as HTMLElement);
  flushSync(() => root.render(createElement(App as unknown as typeof AppComponent)));
}
