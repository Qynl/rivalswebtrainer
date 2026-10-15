# React, combat and startup pass

The preceding maps/utility/input work was finished and pushed first as **5e8e204**, before this pass started, as requested.

## Request checklist

1. **React + Vite:** the entire interface is now a React tree: lobby tabs, five-map selector, settings, loadout cards, four-step modal, HUD, overlays, kill feed, results and damage feedback. No legacy imperative UI entry remains. The existing Three.js renderer, movement, collision, audio and AI are retained outside React's render loop. The official Vite React plugin handles JSX/Fast Refresh. Engine boot is singleton guarded against repeated effects/input bindings.
2. **Lower jumps:** initial speed 14.3 → 11.2, at unchanged gravity 30. Flat ballistic apex 3.408 → 2.091 units, about 39% lower. Extra-jump speed 14 → 10.8. Directional movement, slides, slide jumps, coyote time, buffering and Fists/Bow extra jumps remain. Ramp launch momentum can still add height.
3. **Cleaner melee/attacks:** a real 105 ms windup precedes one nearest valid impact, evaluated against current range, facing cone and line of sight. A switch or death cancels the pending strike. Alternating Knife cuts, alternating fists, phased Scythe/Katana swings, short trails, and recovery separate actions rather than repeating a generic bob.
4. **Knife/backstab:** front/side 40; rear-facing hit 150, lethal against full 150 HP. The rear test is shared with bots and evaluated at impact. A confirmed player backstab adds a distinct thrust/withdrawal pose and labeled damage feedback. Merely swinging behind someone out of range does not trigger it. The blade also has fuller/bevel details and a restrained trail.
5. **150 HP:** players, teammates, opponents and respawning range targets start at 150. Health bars normalize to maximum health. Medkit quick/long healing remains 25/70, capped at 150.
6. **Damage above opponents:** a bounded 24-entry pool projects confirmed player-inflicted damage above the struck actor, merges near-simultaneous pellets, highlights headshots/backstabs, rises and fades. Offscreen, behind-camera, occluded and expired labels are rejected; actor scans do not reveal unseen enemies. Actual applied damage, not theoretical overkill, is displayed.
7. **Bullets:** short moving cosmetic streaks replace static full-ray beams, using the same fixed GPU buffers. Hit detection remains hitscan and unchanged. Surface impacts, dust/chips, casings and per-shot mechanisms remain.
8. **Utilities:** retain the previous detailed airborne models, timed release, spin and animated support-height fire. Pull rings now visibly prepare during the held windup, while airborne payload rendering and gameplay damage/fuses remain intact.
9. **ADS/weapon cleanup:** Paintball's hopper/feed is offset and its raised irons have explicit matching sight coordinates. Sniper has an explicit eye-box and uses the clear scope overlay while its opaque near-eye weapon geometry is hidden only during ADS. Releasing ADS restores the weapon.
10. **Five-second countdown:** round preparation is five seconds, independent of Scythe/Katana ability cooldowns.
11. **M loadout timing:** open only during preparation. Opening releases mouse capture without pausing the simulation. If still choosing when the five seconds expire, bots move/fight normally and only the player's movement/input stays locked. Deploy applies the chosen loadout without restarting the round, preserves ammo for unchanged slots, and recaptures input. M cannot reopen the picker after preparation. Escape/cancel retains the existing loadout.
12. **Startup without quality reduction:** React paints the shell first, then loads game code; the 3D preview is loaded on demand. Shader preparation occurs behind the loading status. HUD icons are memoized, replacing the former repeated SVG/HTML rebuild. A 141,683-byte lossless asset stores the exact 384 × 512 half-float output of the existing RoomEnvironment capture/convolution, avoiding that repeated startup GPU work. The original procedural path is the fallback if decoding/loading is unsupported. No resolution, shadows, texture detail, bloom, contact shading, map, weapon or bot feature is removed to achieve this.

## Validation

- **224/224 Node tests passed**, including ten new rules, projection, bounded feedback, timed melee and sight-model regressions.
- **22/22 browser tests passed in one complete run**: original gameplay, all 23 rendered weapons, five-map integration, bot abilities/positioning, controls, movement, loadout, settings, real shader rendering and disconnected production reload remain covered.
- New browser cases exercise real M input, a picker kept open past five seconds, bots physically moving while the player's position is unchanged, no round restart or free unchanged-slot ammunition, confirmed floating damage, rendered Paintball/Sniper ADS and weapon restoration.
- The new lighting comparison renders the original procedural path and the baked path with identical camera/sky/settings and compares every RGBA channel: **zero changed channels**, maximum difference 0, mean difference 0 in the complete run. This establishes equivalence for that controlled frame, not all possible hardware/drivers.
- Example startup-ready timings in that same software-rendered test were 1390 ms procedural / 1213 ms baked. A previous isolated run was 2969 / 992 ms. Caches/order/software GPU affect these observations; they are not a user-hardware benchmark or a promised percentage improvement.
- Production build succeeds and its offline cache includes React, dynamically imported engine/preview chunks and the generated lighting asset.
- Paintball/Sniper ADS, floating damage and the React lobby were visually inspected. Audit screenshots remain outside Git.

The trainer remains an original approximate implementation, not an exact Roblox client or a claim of human-equivalent AI. Mouse snatching mitigations from the prior pass remain; actual mouse/browser behavior still needs user hardware feedback. No endurance run or hardware FPS claim was made.

## Regenerating the lighting asset

With the dev preview running:

```sh
BROWSER_EXECUTABLE=/path/to/chromium node scripts/bake-environment.mjs
```

The script opens `?rebuild-environment=1` to force the original procedural path, reads its half-float render target, predicts consecutive same-channel values, separates low/high bytes and losslessly gzips them. The asset intentionally uses `.bin` so static servers do not automatically decompress it via a gzip content-encoding header before the application decodes it. If capture dimensions/options change, update the metadata and rerun the pixel comparison.
