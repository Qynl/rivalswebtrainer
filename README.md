# Rivals Arena — Offline + Multiplayer

A React + Vite application with a framework-independent Three.js simulation: a standalone, fan-made browser FPS inspired by the four-slot, first-to-five duel format of Roblox RIVALS. **Not an exact recreation, an official Roblox client, or an affiliated product.** Maps, meshes, interface, sounds, and implementation are original. No Roblox assets or extracted code are included.

## Play locally

Requires Node.js 20.19+ or 22.12+, a WebGL-capable desktop browser, and mouse/keyboard.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Select an arena, team size, difficulty, then **Enter Arena**. Choose **Primary → Secondary → Melee → Utility** in the compact pre-match picker and click **Deploy**. Rematches use the same picker; cancelling it leaves your saved loadout unchanged. Click **Warm Up in the Range** for moving targets and unlimited ammunition reserves. In offline modes, every teammate and opponent other than you is a local bot. Choose **Multiplayer** for human-only online lobbies: create/join by code, pick teams and weapons, ready up, then let the host start 1v1–3v3. The default multiplayer runs in the host browser with automatic PeerJS discovery: **no backend deployment, accounts, API configuration or manual WebRTC exchange**. Share the invite link/code and keep the host tab open and active. See [multiplayer and its network limits](docs/multiplayer.md).

### Production / disconnected use

```sh
npm run build
npm run preview
```

Production builds include a service worker that precaches the application. Open the production site once while connected and wait for the assets to cache; subsequent visits and reloads work offline on that same browser/origin. Service workers require HTTPS or localhost. Development mode does not install a service worker. You can also run the local server with your internet disconnected after dependencies are installed. Offline training needs no gameplay traffic, external fonts, analytics, account, or backend. Multiplayer is optional and requires an Internet connection to discover/connect to the host browser; public signaling/relay availability and network restrictions still apply. API and WebRTC signalling responses are excluded from the offline cache.

Mobile layouts support browsing/configuration, but combat requires desktop pointer lock, mouse, and keyboard. A browser embedding the app must allow pointer lock (`allow="..."` / sandbox `allow-pointer-lock`); opening in a new browser tab is an alternative.

## Included

- Five original arenas: **Concrete Arena**, **Skyline**, **Hangar 09**, **Foundry**, **Courtyard**; elevated cover, walkable stairs, and collision.
- Default Concrete Arena: a 40 × 50-metre gray-concrete layout inspired by the supplied references, with 14-metre perimeter walls, collision-matched diagonal slabs, opposing ramp banks, mirrored window cover, 4.2–4.8-metre interior cover, and two long 3.2-high playable upper galleries with four access ramps.
- **1v1**, **2v2**, **3v3** team elimination, first to five rounds; five-second preparation countdowns, health-based timeout resolution, spectators, results, and rematches.
- Four bot levels: **Rookie**, **Regular**, **Veteran**, **Elite**. A* navigation, line-of-sight perception, last-known positions, aim/reaction errors, strafing, jumps, and reload retreats. Bots use rifles plus rotating Scythe/Katana/Fists/Knife melee loadouts; they are not machine-learned replicas of real players.
- **150 HP** for players, bots and range targets; capped healing, normalized health bars and confirmed-hit floating damage numbers above opponents. Knife front/side hits deal **40**; behind-facing backstabs deal **150**.
- **M** opens the four-step weapon picker during the five-second round preparation only. An already-open picker may finish after the countdown, while bots move and fight; only your own movement/input stays locked. Unchanged slots keep their ammunition.
- Fixed-step movement with interpolated rendering, stronger gravity for less floaty jumps, uphill ramp-launch momentum, responsive ground acceleration/braking, precise air reversals, counter-strafing, slope-driven slides, grounded stair descent, momentum-preserving air steering and slide jumps, buffered jumps (140 ms), coyote time (100 ms), Fists/Bow double jump, Scythe dash, and explosive jumping.
- Twenty-six usable weapons/utilities, all unlocked:
  - Primary: Assault Rifle, Shotgun, Sniper, Burst Rifle, SMG, RPG, Bow, Minigun, Paintball Gun, Grenade Launcher, Flamethrower.
  - Secondary: Handgun, Uzi, Shorty, **Revolver**, **Burst Pistol**, **Dual Pistols**.
  - Melee: Fists, Knife (rear backstab / F quick stab), Scythe (dash), Katana (bullet deflection).
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
| F                 | Quick melee-slot ability: **Knife stab**, Scythe dash or Katana guard; keeps current slot/ammo |
| G                 | Quick utility throw / 25-HP quick Medkit; keeps your selected weapon and its ammunition       |
| Space             | Jump and cancel slide; press again for Fists/Bow double jump (no automatic held-key hops)                           |
| C / Shift / Ctrl  | Controlled 0.27-second slide; short landing buffer; steer, release movement to brake, or jump to cancel        |
| 1–4 / mouse wheel | Equip a loadout slot                                                                        |
| M                 | Change weapons during five-second round preparation; an open picker can finish afterward    |
| T                 | Inspect weapon (firing, aiming, switching or reloading cancels the inspection)              |
| R                 | Reload                                                                                      |
| Escape            | Pause / release mouse                                                                       |

Scythe dash recharges in **3 seconds**. Katana's frontal guard lasts **1.1 seconds** and has a **3.5-second cooldown**. It reflects bullets back along a real collision-tested ray; rear attacks, melee, and explosives are not blocked. Shooting is disabled during the guard. With Knife in your melee slot, **F** performs a quick stab after a **105 ms windup**, without switching away from your gun. It deals **40 front/side / 150 rear** damage, checks range/cone/cover at impact, and has a separate **0.55-second recovery**, so an RPG firing cooldown does not block an aerial follow-up. Fists still do not automatically punch with F.

Reloads animate magazine extraction/insertion, bolt motion and the support hand. Weapons ease into ADS/equip positions; T inspects them. Bots have connected head/weapon rigs, independently bending knees, body lean, aim pitch and muzzle flashes. Static weapon geometry is batched by material to reduce draw submissions; fixed Arena visuals use nine batches while original ray geometry stays intact.

Graphics use darker panel-seamed concrete, a compact edge HUD, distinct original weapon models and 3D loadout previews, original procedural concrete/metal/window textures, an atmospheric sky, environment-lit metal, rounded geometry, armored bots, building vents/windows, and emissive arena trims. The sky has drifting procedural clouds and a directional sun. Fixed-size combat pools add surface hit marks, debris, bouncing shell casings and muzzle-aligned tracers without allocating a new mesh for each hit. Everything is generated locally. The world is finished with depth-aware contact shading, two-sample MSAA, restrained quarter-resolution HDR bloom, gentle sharpening and a neutral color grade; the weapon overlay stays crisp. Reloads include a raised/banked receiver, magazine extraction, supporting-hand/wrist motion and a bolt rack. Equip, jump/landing inertia, strafing, throw follow-through, blade trails and eased bot deaths provide distinct action feedback. Enable **Performance mode** in Settings to reduce render resolution and bypass post-processing and dynamic shadows on slower hardware.

## Quick utility and responsive combat

**G** uses the utility in slot 4 without selecting it. Grenade, Molotov, Smoke and Flashbang use the same 160 ms hand-release and 480 ms throw action as a normal throw, then your previous gun/melee comes back. Your gun's ammo and firing recovery are retained. Utility ammunition and recovery are shared between G and slot 4; repeat-key events, weapon switching and retransmitted online actions cannot duplicate a charge. Switching before release refunds the reserved throwable; switching after release does not. Range utility remains unlimited, with normal recovery.

With Medkit equipped, G channels the **25-HP / 0.8-second quick heal** using utility ammo, not gun ammo. Full-health use does nothing. Damage interrupts healing and consumes the Medkit as with a normal heal. Death clears pending throws and quick models rather than leaving ghost actions behind.

Repeated F/G actions lazily reuse at most the two equipped offhand models instead of rebuilding geometry on every press. Changing loadout evicts old items; round/lobby cleanup releases the cache.

A **140 ms single-request firing buffer** catches taps just before recovery/reload ends. It does not create extra shots, replay clicks on another weapon, or fire a stale request after a pause. Empty burst weapons reload on a tap, and bursts do not advance during a blocking utility animation. Compact F/G chips show readiness, remaining utility and active actions; the action bar follows actual simulation progress.

Smoke now grows and dissipates as depth-tested procedural billows, with an interior haze. One instanced draw uses 32 puffs, or 16 with lower shader detail in Performance mode; switching quality does not rebuild resources. Projectiles have short pooled travel traces, thrown fuse markers and positional bounce audio. Remote operators display and animate the actual quick utility before returning to their gun. Bots can react to **visible hostile explosives and fire**, with difficulty-dependent reaction time, legal escape probes and no through-wall hazard perception. Flashed bots cannot acquire or retain visually perceived hazard knowledge while blinded.

Implementation, validation and actual elapsed time: [work log](docs/night-pass.md).

## Knife and Sniper animation update

Knife F now uses a **reverse-grip overhand stab**, with a real grip pivot, an independent bracing hand and wrist/forearm counter-rotation. Normal attacks from behind select the same distinct drive. Contact remains at 105 ms; the animation does **not** change front/side 40 versus rear 150 damage. Reused models return to their idle grip cleanly.

Scoped opponents with Sniper show a **directional white scope glint** at the objective lens. Opaque cover depth-occludes it; hip fire, reload, death and quick actions suppress it. Your own viewmodel does not emit a glint. Sniper also has a lift–pull–push–lock bolt cycle, and remote slides/magazines animate. ADS and stab styles are synchronized without increasing ordinary snapshot size. See [validation and animation details](docs/knife-scope-animation.md).

## Expanded secondaries and handling

The secondary roster now has **six choices**. Revolver offers six precision shots (45 body / 78.75 head), a rotating cylinder and speedloader-style reload. Burst Pistol fires three 14-damage rounds per click, with a compact open reflex sight. Dual Pistols hold 24 shared rounds and alternate two separately cycling guns while LMB is held; each gun has its own flash, slide and magazine. New weapons have bespoke models, icons, audio/feel profiles, reloads, previews and online loadout support.

Drawing a secondary takes **0.14 seconds**. A primary's remaining firing delay no longer blocks your backup; per-slot ready times prevent swapping back to bypass recovery. Bursts stop cleanly and reload when the magazine empties mid-burst. Low/empty ammo is amber/red on the existing counter, without adding another HUD panel. All recoil remains viewmodel-only, and self-immunity / launch force / Knife F rules remain intact.

[Secondary implementation and validation notes](docs/secondary-expansion.md).

## Trickshots, Bow and weapon-model pass

- Your own damage cannot reduce your HP, including explosive splash and your Molotov fire; your own Flashbang does not blind you. **RPG, Grenade Launcher and Grenade self-knockback still launches you.** Enemies remain vulnerable to your weapons. Multiplayer applies the same rule on the server.
- Bow orientation is corrected to a **left-hand grip / right-hand draw**, rearward-swept limbs and an inward-facing hip pose; the sight bracket and limb/string endpoints stay attached. The Bow is a rebuilt compound model with articulated carbon limbs, rotating cams, a sight, two hands, and a string/nock/arrow that move together. Full draw takes **0.8 seconds**; the crosshair has a small draw indicator. Release plucks the string; an empty/reloading bow hides its arrow. Arrows have proper tips/fletching and a short pooled trail; RPG rockets now have noses, fins and a pulsing exhaust, and launcher shells have an ogive and brass base.
- Gun families have machined receiver panels, rail/vent cuts, controls, fasteners, magazines and deliberately different finishes, plus armored first-person gloves. Moving bolts, pumps, magazines and minigun assemblies remain independent of static batches. Guns have distinct, faster **viewmodel-only** shot impulses and ADS response; this does not move the mouse aim.
- Player/bot **Striker** rigs have original human faces, hair, goggles, headsets, ceramic shoulder/forearm/chest armor, fabric bump detail, equipment, belt pouches, articulated knees and boots. Team accents remain readable. Both offline bots and online opponents hold the actual detailed gun model, not a generic substitute. Existing joint anchors, hitboxes and IK are unchanged.
- Hit confirmations appear immediately with a short punch; headshot/elimination priority is preserved under automatic/pellet fire. Damage numbers pop more distinctly, and headshot sounds are sharper. No extra camera kick is added.

Implementation and validation notes: [trickshots and models](docs/trickshots-and-models.md).

## React, combat feedback and startup pass

- All menus, the four-step picker, settings, results and HUD are React-owned. Vite's React plugin provides Fast Refresh; Three.js remains responsible for real-time rendering/physics, not React state.
- The interface paints before the game module initializes. The weapon preview loads only when needed; repeated HUD updates reuse memoized weapon icons instead of replacing SVG markup. A singleton engine prevents Fast Refresh from duplicating input listeners.
- A **losslessly encoded** 384 × 512 half-float copy of our original environment lighting avoids rebuilding its cube capture/convolution on each visit. The same procedural generation path remains the fallback. Shadow resolution, textures, contact shading, bloom and render resolution are unchanged. A browser comparison verifies identical rendered pixels with both lighting paths.
- Flat jump height is about **1.57** trainer units (previously 2.09). Slides, air steering, buffered/coyote jumps, ramp momentum and Fists/Bow double jumps remain.
- Melee now has a 105 ms windup and a single range/cone/LOS-checked impact. Knife slashes alternate, rear hits add a distinct thrust/withdrawal, fists alternate, and blades have phased follow-through/trails. Bots briefly react visually to hits without changing their physical hitboxes.
- Bullet feedback uses short travelling streaks rather than full-length stationary lines. Utility preparation has a pull-ring animation; the detailed thrown payloads and animated Molotov fire remain.
- Paintball has an offset hopper and aligned raised sights. Sniper ADS uses a clear scope view instead of putting opaque scope geometry in front of the camera.

See [the React and combat report](docs/react-combat-startup.md) for the full checklist, validation and limits.

## Multiplayer, upper Arena and Flamethrower

- Browser-hosted six-player invite lobbies, short codes/links, team/readiness/loadout controls, first-to-five rounds, forfeits and rematches. No game-backend setup; host leaving ends the match.
- **PeerJS + real WebRTC data channels by default**, using free hosted discovery and default ICE services. Worker-hosted authority targets 120 Hz with 20 Hz compact binary snapshots on an unordered, zero-retransmission state channel, plus reliable lobby/combat control, local prediction, adaptive interpolation and bounded hitscan rewind. Third-party service availability, network conditions and the host device still matter.
- Optional legacy `?network=server` mode retains Geckos/WebSocket adapters, public rooms and binary snapshots for people deliberately operating a dedicated backend. It is not required by the static site.
- Arena floor area grows **75.4%**, with **200 m² of actual upper-floor lanes**, low upper cover and four accessible ramps.
- Flamethrower gains a continuous turbulent shader jet, blue ignition, detached wisps, animated heated nozzle/valve/pilot, pressure vibration and smoothly looping audio in bounded GPU/audio pools.

See [architecture, hosting, visual changes and limits](docs/multiplayer.md).

## Earlier court/utility pass

- Before the multiplayer expansion, Arena was **30 × 38**, with a **14-high perimeter**, **4.2–4.8-high cover** and **4.4-high ramp decks**. That pass superseded the earlier tight/tall rebuild: 37% more floor area and substantially lower walls, without changing player scale or movement speed.
- **Foundry** (34 × 42) has cool industrial concrete, bronze markings, overhead gantries and offset firing lanes. **Courtyard** (36 × 40) has warm stone, green planted islands, low cover and wall lamps. Both use the same offline rendering kit, mirrored protected spawns and physically reachable ramp decks.
- Grenade, Molotov, Smoke and Flashbang now fly as their recognizable detailed models, not generic balls. Throws wind up, release at 160 ms and recover over 480 ms; the held item disappears at release. Projectiles tumble and inherit some lateral movement. Switching before release cancels/refunds the throw.
- Molotov fire has animated flames and a softly irregular ember/scorch patch on the actual impact support height, with height/line-of-sight-aware damage and recursive resource cleanup.
- Mouse input rejects stale queued packets and isolated mid-session outliers, resets across capture/focus changes, and requests raw input with a normal pointer-lock fallback. This is a mitigation, not proof that every mouse/browser issue is eliminated.

See [the court/throw/input report](docs/courts-throws-input.md) for validation and limits.

## Impact and weapon-mechanism polish

- Concrete hits now mix small angular chips, expanding dust and brief spark flecks. Debris launches away from the surface, with cosmetic chip bounces on ground and raised support. Existing particle/decal/tracer/casing pool limits are unchanged.
- Bolts cycle per shot instead of staying back with sustained recoil. Shotgun pumping starts after firing, with the support hand following the same cycle.
- Handgun irons and serrations move with the slide; its magazine visibly extracts during reload. The empty slide locks back and releases near the end of reload. These are visual changes, not changes to weapon timing or aim.

See [the impact and mechanism report](docs/impact-and-mechanisms.md) for validation and limits.

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
npm test                   # 334 input, abilities, physics, movement, rigging, audio, rendering and combat tests
npm run build              # Production build + offline cache generation
npx playwright install chromium
npm run test:browser       # Browser integration test
```

You may set `BROWSER_EXECUTABLE` to an installed Chromium binary for browser tests. Most integration tests validate an actual WebGL frame and pointer lock, then disable rendering to run deterministic combat/AI checks efficiently on machines using software graphics. Dedicated graphics tests retain real rendering for all 26 weapon models, skeletal bots, pooled effects, contact-shading pixel comparisons, bloom resize and the Performance bypass. They exercise loadout selection, shots/headshots, reloads, jumps, grenade/smoke/molotov lifecycles, pause/settings, map selection, team bots, five-round victory, results, and mobile layout. The browser suite also covers wizard steps, draft cancellation, compact HUD dimensions, tall walls, real Bow/Medkit input, Flashbang throws and rematch selection. Additional browser tests check arena floor layers, actual stair traversal, slide-jump momentum, Shift/F controls, katana reflection, mouse spike filtering, graphics settings, and the production cache/reload with networking disabled.

## Structure

- `src/game.js`: game loop, input, combat, bots, round state machine, effects.
- `src/world.js`: procedural arenas and actor animation; `src/character-model.js`: original articulated Striker character models.
- `src/weapon-models.js`, `src/weapon-detailing.js`, `src/weapon-preview.js`: detailed procedural weapons and the static loadout turntable; `src/weapon-feel.js`: viewmodel-only impulse and ADS profiles.
- `src/physics.js`: swept circle/AABB/rotated-cover collision, vertical movement, and rectangular ground-grid A* navigation.
- `src/arena-layout.js`: Arena dimensions and mirrored half-layout (visual estimates, not verified Roblox measurements).
- `src/map-layouts.js`: authored Foundry/Courtyard layouts and non-colliding themed dressing.
- `src/throwables.js`: detailed airborne utilities and bounded animated fire.
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
- `src/main.jsx`, `src/App.jsx`, `src/ui-layout.jsx`, `src/ui-hud.jsx`: React entry, declarative lobby/picker/menus and HUD.
- `src/ui-session.js`, `src/ui-store.js`: UI/game bridge, persisted configuration and bounded HUD snapshots.
- `src/combat-rules.js`, `src/damage-numbers.js`: shared health/backstab rules and bounded confirmed-hit feedback.
- `src/environment.js`, `src/assets/studio-environment.*`: lossless generated lighting asset and procedural fallback.
- `src/style.css`, `index.html`: presentation and minimal Vite entry shell.
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

Bow direction regression notes: [Bow body-plane correction](docs/bow-direction.md).


## Player animation, gun feel and multiplayer responsiveness

- More readable team markings, articulated boots, breathing, turn/stride poses, blinking and confirmed armor-hit reactions; the visible head sits closer to the actual damage region. Slightly more forgiving shared body-hit bounds do not alter movement collision, HP or weapon damage.
- All **17 primary/secondary weapons** have stronger individual recoil profiles. Sniper has a heavier scoped impulse and a distinct layered report. Three-dimensional muzzle crowns, casings, mechanisms and expanding reticles make a shot readable without rewriting mouse aim. The motion setting disables the added lens/FOV impulse.
- Multiplayer now predicts gun presentation immediately and deduplicates host echoes, rather than omitting local shot effects. Own confirmed tracers and wall impacts are visible; hit/kill feedback remains authoritative.
- Joining-player countdown/HUD fixes, worker authority, smaller disposable binary state, bounded queues, adaptive interpolation and reliable recovery improve multiplayer responsiveness. No backend deployment/configuration is required, and no zero-lag/zero-bug guarantee is made.

See [the player/gun feedback report](docs/player-gun-feedback.md) and [multiplayer architecture and limits](docs/multiplayer.md).


## Controlled movement pass

Movement is now less exaggerated: run/melee speed **10.6/12**, a **0.27 s** slide with a smaller boost, **0.72 s** slide cooldown, and a **1.57-unit** flat jump. Slides require actual movement, releasing movement brakes them, and slide-jumps no longer multiply velocity or add an extra upward kick. Air steering remains directional but takes a readable turn rather than snapping around. Held Space no longer chains automatic jumps; tap again for another jump or the equipped Fists/Bow extra jump.

Camera bob is halved, landing dip is smaller, and slide FOV expansion is reduced from 6° to 2°. Mouse yaw/pitch, weapon recoil presentation, collision, rocket/launcher trickshot launches, and 120 Hz offline/online shared physics are retained. Bot locomotion is tuned to the same pace. See [movement tuning and validation](docs/controlled-movement.md) for exact changes; these values supersede older movement reports.


## Larger, clearer weapon models

All **17 primary/secondary models** now have individual first-person sizes and forward framing instead of one small shared 0.78 scale. Sniper gets the largest emphasis: a wider long-range chassis, larger reflective scope glass, twin scope mounts, folded bipod detail and a ported muzzle brake. The other guns gain clearer two-tone finishes, larger readable handguards/mechanisms and class-specific details. Bow keeps its corrected limb/string orientation.

The actual gun-only render audit measured Sniper at **about twice its previous pixel area**, with every gun showing increased screen presence. Hands are excluded from that measurement. ADS alignment, recoil/confirmed-hit presentation, reload mechanisms and gameplay aim remain intact; weapon stats and the calmer movement tuning are unchanged.

Loadout cards now fit physical weapon geometry rather than invisible muzzle/glint meshes, and the angled preview camera keeps paired pistols inside the frame. See [the arsenal visual report](docs/arsenal-visuals.md) for measurements and validation. A published static copy requires the updated frontend/assets to be republished; pushing code alone does not verify that deployment.


## Map and environment polish

All six combat maps, plus the Range, now have coordinated daylight/sky/fog profiles,
cleaner concrete surface detail and more distinctive surroundings. Arena gains a
stepped campus skyline; Foundry/Hangar get industrial landmarks; Courtyard gains
exterior trees and pergolas. Rooftops/Compound receive maintenance grilles, detailed
fan guards and container finishing, with textured floors across the legacy maps.

New substantial scenery stays outside the court; inside details are flush paint or
surface cladding. Existing collision, spawn positions, navigation, two-level Arena
routes, controlled movement and weapon rules are preserved. New art is batched into
4–7 additional batches per map, with cached offline-generated textures and no new
per-frame lights. See [the map-art report](docs/map-art.md) and run
`npm run audit:maps -- /tmp/map-art` for reproducible overview/eye-level renders.


## Broader presentation polish

- Neutral steel/container palettes replace leftover purple props; concrete, metal
  and crate boards now have distinct material finishes.
- Mirrored staging-floor graphics, hazard thresholds and real ramp-approach arrows
  improve map navigation without adding obstacles or more HUD panels.
- Three cosmetic operator finishes, stable callsign patches and carrier/radio
  detailing keep team identity readable. Gloves/sleeves gain plates and stitching.
- Firearms smoothly tuck near real walls, but ADS, mouse aim, damage and projectiles
  remain unchanged. Motion-off disables the extra pose.
- Pooled depth-tested bullet ribbons replace browser-limited one-pixel lines,
  with safe near-plane clipping and no per-shot mesh allocation.
- The compact HUD adds an in-bar damage chip and a thin actual magazine-capacity
  underline rather than extra overlays.

See [implementation and validation](docs/broad-polish.md). The controlled movement,
all-gun sizing and backend-free multiplayer architecture are retained.
