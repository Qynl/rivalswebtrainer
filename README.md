# Glint & Grapple

A 1v1 browser duel in a vertical concrete ruin over a bottomless void. One shot kills.
You get a hitscan rifle with a scope glint, a grappling hook you can swing, zip,
chain and release, and a body that dashes, slides and steers in the air.

Both players are identical: same rifle, same cycle time, same rope, same speeds.
Only the cosmetics differ. First to 3 kills wins; the void and the closing ring
hand points to the survivor.

## Stack

**React 19 + Vite 5 + TypeScript.** React owns the shell (canvas, HUD, menus,
armory); the game itself is a plain class that drives those elements by id,
because a HUD written sixty times a second should not go through a render loop.
Three.js and Rapier are bundled — there is no importmap and no CDN at runtime.

## Run

```
npm install
npm run dev        # http://localhost:3000  (game + WebSocket on one port)
npm test           # 87 tests: sim, rope, combat, audio, netcode, client, deploy
npm run build      # typecheck + static bundle into dist/
npm run preview    # serve the built bundle from the Node server
```

Open two tabs (or two machines) and pick **FIND DUEL** to play a human.
**PRACTICE VS SPECTER** gives you SPECTER, a duelist that plays through the same
input path as you do.

## Deploy on GitHub Pages

The bundle is static and path-agnostic (`base: './'`), so it runs from
`https://<user>.github.io/<repo>/` with no server and no configuration.

1. Push this branch to the repository's default branch (`main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. `.github/workflows/deploy.yml` runs the test suite, builds, and publishes
   `dist/` on every push to `main` (or on demand from the Actions tab).

Pages cannot run Node, so the page runs the authoritative duel room **in the
browser** (`src/client/localnet.ts`): the same fixed-step `Room`, the same
physics, the same match rules and the same bot the server uses. Clicking
**FIND DUEL** on a static host tries the socket, and if nothing answers it
drops you into a local scrimmage against SPECTER and says so on the HUD
(`LOCAL`). Nothing is faked — practice is the real simulation.

### Real multiplayer from a static page

Host `npm start` anywhere that has Node (a VPS, Fly, Railway, a Raspberry Pi),
then point the page at it:

```
https://<user>.github.io/<repo>/?server=wss://your-host.example/ws
```

or bake it into a build with `VITE_WS_URL=wss://your-host.example/ws npm run build`.
With a server reachable, the page behaves exactly as it does in development:
two tabs, one duel, server-authoritative, 20 s reconnect.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move (air control is real: 30 m/s² of steering) |
| Mouse | Look; click the canvas to lock the pointer |
| Space | Jump (buffered, with coyote time) |
| Shift (hold) | Fire the hook, swing, release with the momentum boost |
| Shift (tap) | Zip: pull yourself straight to the pinion |
| C or Ctrl | Slide; jump out of a slide for extra speed |
| E | Dash |
| Left mouse | Fire (one bolt, 1.15 s cycle) |
| Right mouse | Scope (0.17° reticle, no spread ever) |
| Esc | Pause |

## How the netcode works

- The server is authoritative for hits, deaths, the ring and the score. It runs a
  fixed 1/60 s step; frame rate never changes the simulation.
- Clients predict their own capsule with the same shared code and replay any
  unacknowledged inputs when a snapshot disagrees.
- The server rewinds a target's hitbox to the shooter's aim time
  (`now - 100 ms`, capped at 350 ms) before resolving a shot. The 100 ms is also
  the interpolation delay for remote players, so what you see is what you hit.
- Scoped shots online are resolved from the server's copy of your yaw/pitch: the
  client cannot pick its own bullet direction, and the crosshair is always honest.
- A dropped connection keeps your seat warm for 20 s. If you do not come back,
  the match is awarded to your opponent; both dying on the same frame is a draw.

## Layout

- `src/shared/constants.ts` — every tunable number, with the reasoning inline.
- `src/shared/sim.ts` — the one movement/grapple simulation both sides run.
- `src/shared/combat.ts` — hitscan resolution, glint visibility, pose history.
- `src/shared/arena.ts` — the arena as axis-aligned neon boxes plus link pinions.
- `src/server/` — HTTP + `/ws` host, room/duel authority, practice bot.
- `src/client/localnet.ts` — the same room hosted in the page, for static deploys.
- `src/client/ui/` — the React shell: canvas, HUD, menus, armory, results.
- `src/client/` — input, prediction, interpolation, renderer, HUD, procedural audio.
- `tests/` — simulation, arena symmetry/perch analysis, netcode, room authority,
  plus a headless client that boots the real page against a real server.

Everything visible is procedural geometry and every sound is synthesised
(WebAudio). There are no asset files, and nothing the simulation depends on is
rendered: the client can predict a whole match without a canvas at all.
