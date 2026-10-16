# Arsenal visual size and model pass

## Actual size, not just a larger number

All 17 primary/secondary weapons gain individual first-person presentation profiles. The receiver stays in approximately the same part of the screen while the enlarged model is brought forward. Scaling a model uniformly without compensating its authored -Z placement barely changes its apparent size; this pass changes both proportions and framing. Melee and utility scale remains unchanged.

Sniper receives the strongest change: a wider olive chassis, heavier handguard, folded bipod tubes/feet, thicker barrel, a ported muzzle brake, a larger optic with double mounts, adjustment controls and convex clear-coated rear glass. The external white aiming glint is seated at the new front glass rather than left at the old lens location. The first-person shoulder stock is not pushed through the camera as a large foreground block.

The other models receive brighter but restrained two-tone finishes, clearer material boundaries, vented handguards, registration inlays and class-specific mechanical detail. Pistols gain moving slide inlays, Revolver gains a heavier underlug/ejection rod, pumps have attached grip ribs, rotary/drum weapons have stronger housings, and the Flamethrower gains tank bands and heat-shield accents. Bow gains small riser hardware but retains its corrected curved limbs, string, arrow direction and draw rig.

New detail is built once and merged into existing material batches. Animated details stay attached to the slide, pump or mechanism they belong to. This does not add per-frame geometry construction, downloaded textures or a new rendering dependency.

## Measured screen presence

Before/after samples use the same 960×720 browser viewport, a 384×288 transparent render target, the existing 70° weapon camera, a neutral settled hip pose and hidden hands. Counts are actual gun pixels with alpha >32/255, not bounding-box area or a scale estimate. Shader-edge rasterization can vary between GPUs. These measurements are local visual checks, not FPS benchmarks.

| Weapon | Previous gun pixels | Current gun pixels | Ratio |
| --- | ---: | ---: | ---: |
| Assault Rifle | 5,871 | 8,933 | 1.52× |
| Shotgun | 4,913 | 6,891 | 1.40× |
| Sniper | 6,858 | 13,669 | 1.99× |
| Burst Rifle | 6,074 | 8,158 | 1.34× |
| SMG | 5,902 | 7,525 | 1.27× |
| RPG | 11,117 | 12,357 | 1.11× |
| Bow | 3,456 | 3,781 | 1.09× |
| Minigun | 13,353 | 17,370 | 1.30× |
| Paintball Gun | 7,581 | 9,462 | 1.25× |
| Grenade Launcher | 6,275 | 8,849 | 1.41× |
| Flamethrower | 8,378 | 10,272 | 1.23× |
| Handgun | 4,669 | 5,816 | 1.25× |
| Uzi | 5,743 | 6,811 | 1.19× |
| Shorty | 4,766 | 6,538 | 1.37× |
| Revolver | 5,249 | 7,033 | 1.34× |
| Burst Pistol | 4,844 | 6,145 | 1.27× |
| Dual Pistols | 7,232 | 8,276 | 1.14× |

Sniper grows from about 6.2% to 12.4% of that gun-only test frame; it is roughly twice the old pixel area, not twice as long. The biggest existing silhouettes (RPG, Minigun and Bow) use more restrained framing changes to avoid covering the screen. Actual gameplay also displays the hands, HUD and world, which are excluded from these counts.

## Loadout and aim safety

- Preview bounds ignore invisible muzzle flashes and the scope-glint billboard. In particular, Sniper's 1×1 invisible glint quad no longer controls the physical gun's fit/centering.
- The angled preview camera checks projected bounds, correcting edge clipping of the paired pistols rather than shrinking every card unnecessarily.
- Authored ADS sight points stay centered under the new scales. No hand intersects the aiming ray in the 17-model tests. Scoped Sniper still hides its viewmodel behind the unobstructed scope HUD.
- Existing shot recoil, dual-pistol alternation, reloads, bolt/pump/cylinder animations, muzzle effects, casing ejection and confirmed multiplayer feedback remain active.
- Mouse yaw/pitch, projectiles, hitboxes, damage, ammo, fire rate and the controlled movement tuning are not modified.

## Reproducible checks

`BROWSER_EXECUTABLE=/path/to/chromium node scripts/audit-weapon-presence.mjs /tmp/gun-presence` runs the dev-server render audit and writes a JSON report and one Sniper gameplay image outside Git. It requires the frontend at port 5173 (or `ARENA_URL`).

New unit tests cover the 17 authored equip scales, finite/batched geometry, actual ADS placement and clear hand rays, animated-detail parenting, a correctly seated Sniper glint and preview bounds independent of oversized effect quads. New browser tests render every gun, compare the before/after masks, check ADS hands/sights, and exercise all 17 real picker previews with projected-fit checks.

Offline support and browser-hosted multiplayer still require no user-deployed backend. Updating the published static site requires republishing the frontend/assets; an external Freebuff republish is not verified by these tests.


Completed validation: **436/436 unit tests**, **17/17 browser scenarios**, production build and `git diff --check`. Browser coverage includes both new visual/picker tests, firing presentation for all 17 weapons, scoped Sniper/white glint, Bow direction/draw, reload/slide mechanisms, confirmed hit feedback, controlled movement, offline reload, explosive Knife trickshots and real browser-hosted RTC (including six-client 3v3).
