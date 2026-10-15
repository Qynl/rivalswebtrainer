# Rivals Offline Arena

A standalone, fan-made browser FPS inspired by the four-slot, first-to-five duel format of Roblox RIVALS. **Not an exact recreation, an official Roblox client, or an affiliated product.** Maps, meshes, interface, sounds, and implementation are original. No Roblox assets or extracted code are included.

## Play locally

Requires Node.js 20.19+ or 22.12+, a WebGL-capable desktop browser, and mouse/keyboard.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Select an arena, team size, difficulty, then **Enter Arena**. Choose **Primary → Secondary → Melee → Utility** in the compact pre-match picker and click **Deploy**. Rematches use the same picker; cancelling it leaves your saved loadout unchanged. Click **Warm Up in the Range** for moving targets and unlimited ammunition reserves. Every teammate and opponent other than you is a local bot.

### Production / disconnected use

```sh
npm run build
npm run preview
```

Production builds include a service worker that precaches the application. Open the production site once while connected and wait for the assets to cache; subsequent visits and reloads work offline on that same browser/origin. Service workers require HTTPS or localhost. Development mode does not install a service worker. You can also run the local server with your internet disconnected after dependencies are installed. No gameplay traffic, external fonts, analytics, account, or backend are required.

Mobile layouts support browsing/configuration, but combat requires desktop pointer lock, mouse, and keyboard. A browser embedding the app must allow pointer lock (`allow="..."` / sandbox `allow-pointer-lock`); opening in a new browser tab is an alternative.

## Included

- Three original arenas: **Concrete Arena**, **Skyline**, **Hangar 09**; elevated cover, walkable stairs, and collision.
- Default Concrete Arena: a 32 × 42-metre compact gray-concrete layout inspired by the supplied references, with 19.2-metre perimeter walls, collision-matched diagonal slabs, opposing continuous ramp banks, mirrored window cover and taller interior cover.
- **1v1**, **2v2**, **3v3** team elimination, first to five rounds; countdowns, health-based timeout resolution, spectators, results, and rematches.
- Four bot levels: **Rookie**, **Regular**, **Veteran**, **Elite**. A* navigation, line-of-sight perception, last-known positions, aim/reaction errors, strafing, jumps, and reload retreats. Bots use rifles; they are not machine-learned replicas of real players.
- Fixed-step movement with interpolated rendering, stronger gravity for less floaty jumps, uphill ramp-launch momentum, responsive ground acceleration/braking, momentum-preserving air steering and slide jumps, buffered jumps (140 ms), coyote time (100 ms), Fists/Bow double jump, Scythe dash, and explosive jumping.
- Twenty-three usable weapons/utilities, all unlocked:
  - Primary: Assault Rifle, Shotgun, Sniper, Burst Rifle, SMG, RPG, Bow, Minigun, Paintball Gun, Grenade Launcher, Flamethrower.
  - Secondary: Handgun, Uzi, Shorty.
  - Melee: Fists, Knife (backstab), Scythe (dash), Katana (bullet deflection).
  - Utility: Grenade, Molotov, Smoke, Flashbang, Medkit.
- Charged ballistic arrows, minigun spin-up with animated barrels, paint splats, arcing impact grenades, close-range flame/afterburn, LOS-aware flashbang blindness, and interruptible 70-HP / quick 25-HP medkit heals. Medkits are one use per round (unlimited in the range).
- Headshots, pellet falloff, reloads, recoil, scope/ADS, ballistic explosives, fire pools, smoke blocking bot perception, tracers, and hit/kill feedback.
- Dedicated open-lane practice range with moving/respawning targets, unlimited reserves/utilities, and accuracy/elimination metrics.
- Procedural Web Audio sounds; locally persisted sensitivity, FOV, volume, performance mode, loadout, and the last 20 match results.

## Controls

| Input             | Action                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| WASD              | Move; steer in all directions in the air, including reversing                               |
| Mouse             | Look (capture/recenter spikes are filtered; recoil does not rewrite look pitch)             |
| Left mouse        | Shoot / melee strike / throw / heal; hold and release to fire Bow                           |
| Right mouse       | ADS; Scythe dash or Katana guard when equipped; quick Medkit heal                           |
| F                 | Quick **right-click ability only** from the loadout's melee slot; keeps current weapon/ammo |
| Space             | Jump and cancel slide; hold for bunny hops; Fists/Bow double jump                           |
| C / Shift / Ctrl  | Short 0.4-second slide while moving; steer or jump to cancel                                |
| 1–4 / mouse wheel | Equip a loadout slot                                                                        |
| T                 | Inspect weapon (firing, aiming, switching or reloading cancels the inspection)              |
| R                 | Reload                                                                                      |
| Escape            | Pause / release mouse                                                                       |

Scythe dash recharges in **3 seconds**. Katana's frontal guard lasts **1.1 seconds** and has a **3.5-second cooldown**. It reflects bullets back along a real collision-tested ray; rear attacks, melee, and explosives are not blocked. Shooting is disabled during the guard. F never automatically swings/punches; melee without a secondary ability displays a hint instead.

Reloads animate magazine extraction/insertion, bolt motion and the support hand. Weapons ease into ADS/equip positions; T inspects them. Bots animate around hip/shoulder joints instead of rotating entire limbs around their centres. Static weapon geometry is batched by material to reduce draw submissions.

Graphics use darker panel-seamed concrete, a compact edge HUD, distinct original weapon models and 3D loadout previews, original procedural concrete/metal/window textures, an atmospheric sky, environment-lit metal, rounded geometry, armored bots, building vents/windows, and emissive arena trims. Everything is generated locally. The world is finished with depth-aware contact shading, two-sample MSAA, gentle sharpening and a neutral color grade; the weapon overlay stays crisp. Reloads include a raised/banked receiver, magazine extraction, supporting-hand/wrist motion and a bolt rack. Equip, jump/landing inertia, strafing, throw follow-through, blade trails and eased bot deaths provide distinct action feedback. Enable **Performance mode** in Settings to reduce render resolution and bypass post-processing and dynamic shadows on slower hardware.

## Tests

```sh
npm test                   # 79 input, abilities, physics, movement, navigation, animation and combat tests
npm run build              # Production build + offline cache generation
npx playwright install chromium
npm run test:browser       # Browser integration test
```

You may set `BROWSER_EXECUTABLE` to an installed Chromium binary for browser tests. The integration tests validate an actual WebGL frame and pointer lock, then disable rendering to run deterministic combat/AI checks efficiently on machines using software graphics. They exercise loadout selection, shots/headshots, reloads, jumps, grenade/smoke/molotov lifecycles, pause/settings, map selection, team bots, five-round victory, results, and mobile layout. The eight-test browser suite also covers wizard steps, draft cancellation, compact HUD dimensions, tall walls, real Bow/Medkit input, Flashbang throws and rematch selection. Additional browser tests check arena floor layers, actual stair traversal, slide-jump momentum, Shift/F controls, katana reflection, mouse spike filtering, graphics settings, and the production cache/reload with networking disabled.

## Structure

- `src/game.js`: game loop, input, combat, bots, round state machine, effects.
- `src/world.js`: procedural arenas, block-style actors and first-person meshes.
- `src/weapon-models.js`, `src/weapon-preview.js`: detailed procedural weapons and the static loadout turntable.
- `src/physics.js`: swept circle/AABB/rotated-cover collision, vertical movement, and rectangular ground-grid A* navigation.
- `src/arena-layout.js`: compact Arena dimensions and mirrored half-layout (visual estimates, not verified Roblox measurements).
- `src/animation.js`: frame-rate-independent weapon pose springs, phased reload/inspect animations and moving weapon parts.
- `src/movement.js`: ground/air acceleration, slide steering, and movement tuning constants.
- `src/data.js`: weapons, settings and difficulty parameters.
- `src/audio.js`: synthesized sound effects.
- `src/input.js`: pointer-lock mouse-packet validation.
- `src/graphics.js`: offline procedural textures, palette and sky.
- `src/rendering.js`: depth-aware world finishing pass, antialiasing, render-target lifecycle and resize handling.
- `src/main.js`, `src/style.css`, `index.html`: lobby, loadout, guide, HUD, menus.
- `vite.config.js`: bundling, preview-host support and production offline cache.

This is an original playable trainer foundation, not every map, weapon, animation, mode, cosmetic, or mechanic in Roblox RIVALS. Balancing is approximate. Bot pathfinding is on a ground grid, so bots do not plan advanced rooftop routes or weapon-specific movement combinations.

## Reference research and endurance validation

See [Arena reconstruction notes](docs/arena-research.md) for sources, what could/could not be verified, tuning choices and validation scope. The default Arena is deliberately compact and distinct from Big Arena. Dimensions are original trainer-space estimates, not claimed Roblox stud measurements.

With the development preview running, an optional stability/resource run exercises every weapon, movement, projectiles, effects and real WebGL rendering:

```sh
npm run test:soak -- --minutes 10
```

The soak forces each of the 23 actual view models to be equipped, including consecutive weapons in the same slot, and checks for WebGL errors after every draw. It uses half-resolution rendering with audio and dynamic shadows disabled; the contact-shading pass remains enabled.

Use `BROWSER_EXECUTABLE` when Chromium is installed outside Playwright's default location. Do not edit/rebuild the app during this development-server soak, because Vite hot reload resets the test session. This is not a hardware FPS benchmark.
