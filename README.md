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
- Default Concrete Arena: a 26 × 32-metre compact gray-concrete layout inspired by the supplied references, with 24-metre perimeter walls, collision-matched diagonal slabs, opposing continuous ramp banks, mirrored window cover and 5.8–6.6-metre interior cover.
- **1v1**, **2v2**, **3v3** team elimination, first to five rounds; countdowns, health-based timeout resolution, spectators, results, and rematches.
- Four bot levels: **Rookie**, **Regular**, **Veteran**, **Elite**. A* navigation, line-of-sight perception, last-known positions, aim/reaction errors, strafing, jumps, and reload retreats. Bots use rifles plus rotating Scythe/Katana/Fists/Knife melee loadouts; they are not machine-learned replicas of real players.
- Fixed-step movement with interpolated rendering, stronger gravity for less floaty jumps, uphill ramp-launch momentum, responsive ground acceleration/braking, precise air reversals, counter-strafing, slope-driven slides, grounded stair descent, momentum-preserving air steering and slide jumps, buffered jumps (140 ms), coyote time (100 ms), Fists/Bow double jump, Scythe dash, and explosive jumping.
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
| C / Shift / Ctrl  | Short 0.36-second slide; airborne presses buffer on landing; steer or jump to cancel        |
| 1–4 / mouse wheel | Equip a loadout slot                                                                        |
| T                 | Inspect weapon (firing, aiming, switching or reloading cancels the inspection)              |
| R                 | Reload                                                                                      |
| Escape            | Pause / release mouse                                                                       |

Scythe dash recharges in **3 seconds**. Katana's frontal guard lasts **1.1 seconds** and has a **3.5-second cooldown**. It reflects bullets back along a real collision-tested ray; rear attacks, melee, and explosives are not blocked. Shooting is disabled during the guard. F never automatically swings/punches; melee without a secondary ability displays a hint instead.

Reloads animate magazine extraction/insertion, bolt motion and the support hand. Weapons ease into ADS/equip positions; T inspects them. Bots have connected head/weapon rigs, independently bending knees, body lean, aim pitch and muzzle flashes. Static weapon geometry is batched by material to reduce draw submissions; fixed Arena visuals use six batches while original ray geometry stays intact.

Graphics use darker panel-seamed concrete, a compact edge HUD, distinct original weapon models and 3D loadout previews, original procedural concrete/metal/window textures, an atmospheric sky, environment-lit metal, rounded geometry, armored bots, building vents/windows, and emissive arena trims. The sky has drifting procedural clouds and a directional sun. Fixed-size combat pools add surface hit marks, debris, bouncing shell casings and muzzle-aligned tracers without allocating a new mesh for each hit. Everything is generated locally. The world is finished with depth-aware contact shading, two-sample MSAA, restrained quarter-resolution HDR bloom, gentle sharpening and a neutral color grade; the weapon overlay stays crisp. Reloads include a raised/banked receiver, magazine extraction, supporting-hand/wrist motion and a bolt rack. Equip, jump/landing inertia, strafing, throw follow-through, blade trails and eased bot deaths provide distinct action feedback. Enable **Performance mode** in Settings to reduce render resolution and bypass post-processing and dynamic shadows on slower hardware.

## Tighter, taller Arena rebuild

- **38% less floor area** than the previous 32 × 42 layout: now **26 × 32**, with full-size actors and unchanged gameplay movement/FOV settings.
- **24-high perimeter**, **5.8–6.6-high cover**, taller window towers and **6.2-high ramp summits**. Sparse coping and height courses make the vertical proportions easier to read.
- Repositioned mirrored cover, protected spawns and connected flank/centre routes. Both ramp decks meet the rear wall without a falling pocket.
- Steep-ramp summit adhesion fixes a real downhill fall; explicit walkable summit navigation lets bots reach those decks through the ramp rather than a tall side.
- Arena lobby overview stays inside the enclosure so the taller walls do not hide the court. No extra HUD clutter.

See [the Arena scale report](docs/tight-tall-arena.md) for dimensions, visual checks and route/traversal validation. Dimensions are reconstruction estimates, not measured Roblox units.

## Combat presentation polish

- Directional bot leg motion for strafing/backpedaling, still knees at idle, and smoother crouch/air/landing transitions. These are visual poses, not changes to actor physics or hitboxes.
- A small spring-eased running carry on ranged weapons. It recovers for ADS, recent firing, reloads and abilities; Shake off suppresses it. Mouse aim and bullet direction are unchanged.
- Body/head/elimination confirmations share the existing compact marker. A mint, thicker elimination pulse cannot be overwritten by later shotgun pellets or splash hits. Self-eliminations no longer award a player kill.

See [the animation and feedback report](docs/combat-presentation-polish.md) for scope and validation.

## Tactical positioning follow-up

- Katana/Knife bots can deliberately route to reachable ramp-deck firing positions when a perceived enemy is at range, rather than using elevation only by accident.
- Bounded recovery flanks respond to persistent obstacles or a recently lost target. Plans use last-seen snapshots, prospective sightlines, complete routes and teammate spacing.
- Ground movement probes choose clear tangents around slabs and avoid accidental ledge steps while holding a perch. Corner probes stop at the next waypoint rather than steering away from a legitimate turn too early.
- Height-aware waypoints and precise final peeks; short, sightline-aware strafes from a held firing position. Offensive routes cancel for defense, close combat, changed targets and stale information.
- Existing dash/slide-jump/quick-melee actions remain available; bots avoid interrupting a committed ramp route with a dash off its side. No additional HUD panels or map-size changes.

See [the positioning report](docs/bot-positioning.md) for validation and limits.

## Player-like bot movement and melee

Combat bots now choose real abilities rather than a cosmetic crouch and random jump:

- Scythe gap-closing/traversal dashes and Katana frontal guards, including **F-style secondary-only quick abilities** without an automatic slash or rifle-ammo consumption.
- Physical slides, timed slide-jump cancels, close-fire evasive jumps, slope launch momentum, directional air steering and equipped-Fists double-jump combos, using the player movement/collision solver.
- Close-range melee equips, switch delays, visible windups, range/cone/line-of-sight checks at impact and directional Knife backstabs. They switch back to rifles outside melee range. Switching cancels an unfinished rifle reload without granting a free magazine.
- Difficulty-paced decisions, ability cooldowns and rifle locks while guarding, swinging, quick-using or switching. Katana responds to perceived shooting/pressure, not bullet contact or hidden input.
- Third-person melee models, hand IK, guard flashes, forward strikes, low slide poses/hitboxes and spatial action sounds; no additional HUD panels.

Try **3v3 / Elite** for a mixed roster. Melee archetypes rotate between rounds; a 1v1 opponent does not have all four melees at once. Range targets remain non-attacking practice targets. See [the bot implementation and validation report](docs/bot-movement-and-melee.md).

## Movement, tactics and combat-readability pass

- Fixed **120 Hz simulation** with the existing render interpolation; this is a physics update rate, not a claim of 120 rendered FPS.
- Properly aligned rear-notch/front-fibre ADS on Rifle, SMG, Handgun, Uzi, Shotgun, Shorty and Grenade Launcher, rather than merely zooming the hip-fire pose.
- Elbow-jointed bot arms use analytic IK to keep both hands on their rifle as it aims and reloads. Corrects the old backward-pointing arm rotations.
- Bots prefer visible opponents, reset reaction progress on loss of sight, seek reachable cover while reloading/under pressure, and spread away from teammates. Hidden target coordinates no longer drive their head aim.
- Positional enemy gunfire, nearby footsteps and explosions, with heading-relative stereo, distance attenuation and wall-muffled gunfire. Audio channels are capped and recycled.
- Four short-lived direction-of-damage arcs, a physical-spread reticle and a cleaner SVG headshot marker. No extra permanent status panels.
- Offline stencil wayfinding, muted north/south colours, lane arrows and cover base trims. These are visual only; the compact Arena collision layout is unchanged. Dressing is merged into two extra batches.

See [the combat-readability report](docs/combat-readability-pass.md) for validation and limitations.

## Tests

```sh
npm test                   # 181 input, abilities, physics, movement, rigging, audio, rendering and combat tests
npm run build              # Production build + offline cache generation
npx playwright install chromium
npm run test:browser       # Browser integration test
```

You may set `BROWSER_EXECUTABLE` to an installed Chromium binary for browser tests. Most integration tests validate an actual WebGL frame and pointer lock, then disable rendering to run deterministic combat/AI checks efficiently on machines using software graphics. Dedicated graphics tests retain real rendering for all 23 weapon models, skeletal bots, pooled effects, contact-shading pixel comparisons, bloom resize and the Performance bypass. They exercise loadout selection, shots/headshots, reloads, jumps, grenade/smoke/molotov lifecycles, pause/settings, map selection, team bots, five-round victory, results, and mobile layout. The fifteen-test browser suite also covers wizard steps, draft cancellation, compact HUD dimensions, tall walls, real Bow/Medkit input, Flashbang throws and rematch selection. Additional browser tests check arena floor layers, actual stair traversal, slide-jump momentum, Shift/F controls, katana reflection, mouse spike filtering, graphics settings, and the production cache/reload with networking disabled.

## Structure

- `src/game.js`: game loop, input, combat, bots, round state machine, effects.
- `src/world.js`: procedural arenas and skeletal block-style actors.
- `src/weapon-models.js`, `src/weapon-preview.js`: detailed procedural weapons and the static loadout turntable.
- `src/physics.js`: swept circle/AABB/rotated-cover collision, vertical movement, and rectangular ground-grid A* navigation.
- `src/arena-layout.js`: compact Arena dimensions and mirrored half-layout (visual estimates, not verified Roblox measurements).
- `src/animation.js`: frame-rate-independent weapon pose springs, phased reload/inspect animations and moving weapon parts.
- `src/movement.js`: ground/air acceleration, slide steering, and movement tuning constants.
- `src/data.js`: weapons, settings and difficulty parameters.
- `src/audio.js`: synthesized sound effects.
- `src/input.js`: pointer-lock mouse-packet validation.
- `src/bot-tactics.js`: visibility-aware selection, bounded reachable-cover search and route following.
- `src/bot-actions.js`: cooldown-gated abilities, deliberate action selection, collision probes and player-like physical movement.
- `src/bot-positioning.js`: bounded high-ground/flank plans, sightline-aware perch holds and collision/support-aware ground steering.
- `src/bot-animation.js`: velocity-relative visual locomotion, eased stances and bounded landing compression.
- `src/bot-visuals.js`: cached third-person melee weapons, grips and guard/swing poses.
- `src/rigging.js`: analytic two-bone arm IK.
- `src/combat-feedback.js`: camera-relative damage bearings, spatial mix, projected reticle spread and prioritized hit confirmations.
- `src/arena-dressing.js`: cached offline stencil atlas and non-colliding Arena wayfinding.
- `src/graphics.js`: offline procedural textures, palette and sky.
- `src/rendering.js`: depth-aware HDR finishing, antialiasing, soft bloom and render-target lifecycle.
- `src/atmosphere.js`: analytic procedural sky, clouds and sun.
- `src/combat-fx.js`: bounded debris/tracer/impact/casing pools and cosmetic support collision.
- `src/batching.js`: fixed-sibling batching with optional exact ray-mesh retention.
- `src/main.js`, `src/style.css`, `index.html`: lobby, loadout, guide, HUD, menus.
- `vite.config.js`: bundling, preview-host support and production offline cache.

This is an original playable trainer foundation, not every map, weapon, animation, mode, cosmetic, or mechanic in Roblox RIVALS. Balancing is approximate. Global bot pathfinding is still a single-support-height grid, with explicit ramp decks and bounded firing-position plans. Local movement/melee combos do not constitute planned rooftop trick routes, human-equivalent decisions, or support for every weapon in the bot loadout.

## Reference research and endurance validation

See the [one-hour movement/visual pass](docs/hour-pass.md) and [Arena reconstruction notes](docs/arena-research.md) for sources, what could/could not be verified, tuning choices and validation scope. The default Arena is deliberately compact and distinct from Big Arena. Dimensions are original trainer-space estimates, not claimed Roblox stud measurements.

With the development preview running, an optional stability/resource run exercises every weapon, movement, projectiles, effects and real WebGL rendering:

```sh
npm run test:soak -- --minutes 10
```

The soak forces each of the 23 actual view models to be equipped, including consecutive weapons in the same slot, and checks for WebGL errors after every draw. It uses half-resolution rendering with audio and dynamic shadows disabled; contact shading, sky animation and HDR bloom remain enabled.

Use `BROWSER_EXECUTABLE` when Chromium is installed outside Playwright's default location. Do not edit/rebuild the app during this development-server soak, because Vite hot reload resets the test session. This is not a hardware FPS benchmark.

For controlled full-size screenshots of the updated weapons, bot rig and Arena:

```sh
npm run audit:visual -- /tmp/arena-visuals
npm run audit:bots -- /tmp/bot-poses
npm run audit:arena -- /tmp/arena-scale
```

This uses the development preview and the same `BROWSER_EXECUTABLE` override. Images go outside Git; the paused audit is not an FPS benchmark. Settings also include an independent **speed-based field of view** toggle.

For a reproducible numerical comparison against the previous local movement revision:

```sh
node scripts/movement-audit.mjs             # defaults to d40fdb1
node scripts/movement-audit.mjs <revision>  # requires that revision's local Git history
```

This samples both controllers and their own physics constants at 600 Hz without checking out another branch. It reports acceleration, stopping, reversal drift and flat slide travel in trainer units—not measured Roblox values or hardware FPS. The latest values and trade-offs are in [the implementation report](docs/hour-pass.md).
