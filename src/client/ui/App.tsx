/**
 * The React shell.
 *
 * React owns the page: one canvas and the DOM screens around it. The game
 * itself stays a plain class (`main.ts`) that addresses these elements by id,
 * because a HUD written sixty times a second does not belong in a render loop.
 * Keeping the shell small means React never re-renders under the HUD's feet.
 */

import { Armory, Menu, Pause, Results } from './Screens.tsx';
import { Hud } from './Hud.tsx';

export function App(): React.JSX.Element {
  return (
    <>
      <canvas id="view" />
      <Hud />
      <Menu />
      <Results />
      <Pause />
      <Armory />
      <div id="toast" className="hidden" />
    </>
  );
}
