# Glint & Grapple

A 1v1 browser duel in a vertical neon ruin over a bottomless void. One shot kills.
You get a hitscan rifle with a scope glint, a grappling hook you can swing, zip,
chain and release, and a body that dashes, slides and steers in the air.

Both players are identical: same rifle, same cycle time, same rope, same speeds.
Only the cosmetics differ. First to 3 kills wins; the void and the closing ring
hand points to the survivor.

## Run

```
npm install
npm run dev        # http://localhost:3000  (game + WebSocket on one port)
npm test           # 60 tests: sim, gravity, rope, combat, match, net, client
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the built bundle
```

Open two tabs (or two machines) and pick **FIND DUEL** to play a human.
**PRACTICE VS BOT** gives you SPECTER, a server-side duelist that plays through
the same input path as you do.

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
- `src/client/` — input, prediction, interpolation, renderer, HUD, procedural audio.
- `tests/` — simulation, arena symmetry/perch analysis, netcode, room authority,
  plus a headless client that boots the real page against a real server.

Everything visible is procedural geometry and every sound is synthesised
(WebAudio). There are no asset files, no build step for the browser, and no
rendering that the simulation depends on.
