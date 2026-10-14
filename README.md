# Arena Duel

An original browser arena shooter (Vite + TypeScript + Three.js). Best-of-5 rounds of 1v1 against a bot. All names, art, maps and weapon numbers are original.

## Run

```
npm install
npm run dev        # http://localhost:3000
npm test           # movement + combat unit tests
npm run build      # typecheck + production build
```

To allow a remote preview hostname, set `PREVIEW_HOST` in the environment before `npm run dev`.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the canvas to lock the pointer) |
| Space | Jump (hold for full height, release to cut; hold to auto-hop) |
| Ctrl or C | Slide / crouch. Jump during a slide to slide-jump |
| Left mouse | Fire gun, or swing scythe |
| Right mouse | Scythe dash (cooldown) |
| 1 / 2 / 3 | Select weapon slot (1 = primary, 2 = secondary, 3 = scythe) |
| R | Reload |
| Esc | Pause menu |

## Loadout

Pick a primary (BRUTE-47 assault rifle or PANTHER SMG) and a secondary (PANTHER or the sidearm) on the menu. The bot's range preference follows its loadout.

## Website

The landing page (`index.html` + `src/landing.css`) opens first and leads into the game menu. Sound is synthesized with WebAudio in `src/audio.ts`, so there are no asset files.

## Layout

- `src/game/movement.ts`: pure movement controller (ground/air accel, friction, slide, slide-jump).
- `src/game/combat.ts`: guns, hitscan rays, headshots, scythe arc and dash.
- `src/game/bot.ts`, `src/game/nav.ts`: bot AI, navigation and aim, with difficulty tiers.
- `src/game/match.ts`: 5-round match flow and scoring.
- `src/game/game.ts`: fixed-step simulation that ties player, bot, combat and match together.
- `src/render/renderer.ts`, `src/hud.ts`, `src/input.ts`, `src/main.ts`: Three.js rendering, HUD, input and the main loop.
- `src/audio.ts`: WebAudio sound effects.
- `tests/`: Vitest unit tests for movement and combat.

## Limitations

- The bot and the feel of the movement are tuned by hand, not by playtesting against real players.
- Visuals are procedural placeholders, not finished art. Sound is synthesized and basic.
- Networking is not implemented. This is single-player only.
