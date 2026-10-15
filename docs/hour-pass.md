# Movement and visual implementation pass — 15 October 2026

## Timing and scope

- User requested **one hour of real implementation work**, not an hour-long endurance timer.
- Started **2026-10-15T06:12:48Z**, on top of `d40fdb1`.
- Work is still in progress. Final elapsed time and validation results will be recorded before completion.
- Validation remains limited to a **ten-minute** isolated soak, with implementation, visual inspection, regression work and review making up the rest of the pass.

## Implemented

### Locomotion

- Running 11.5 → 12.2; melee running 13.5 → 14.1 trainer units/second.
- Ground acceleration 105 → 125; braking 110 → 150; dedicated counter-strafe acceleration 180.
- Direct reverse input in air brakes/reverses along its axis instead of choosing an arbitrary sideways orbit. Sideways steering retains carried momentum; explosion overspeed eases instead of being instantly truncated.
- Slides shortened from 0.40 to 0.36 seconds, with a sharper initial burst. Airborne slide presses buffer into landing. Ramp gravity changes slide velocity; uphill/downhill are no longer identical.
- Short support steps adhere on descent as well as ascent. Genuine ledges still fall and retain coyote jumping. Wall collision projects the remaining travel along the contact plane.
- New rounds reset forced crouching, dash pose, input buffers and camera offsets before the first countdown camera update.
- Landing grace preserves intentional hop chains; releasing input still brakes. Hold-Space hopping, explicit extra jumps and the existing coyote/jump buffer remain intact.
- Distance-based footsteps and a landing sound; bounded stair camera smoothing, head clearance under low cover, and an independent speed-FOV toggle.
- Air acceleration increased from 75 to 115, retaining 16-radian/second lateral steering. Wall impacts and landing clear stale carried-speed targets so blocked speed cannot be regenerated for free.
- Removed camera angular recoil; actual shots start at the visible camera position so stance easing does not put bullets below the crosshair. Recoil remains on the weapon, not mouse aim.
- Projectiles check forward spawn clearance instead of being placed through a nearby wall.

These are original trainer-space tuning values, not claimed Roblox frame-perfect measurements.

### Visuals and animation

- Analytic blue sky with drifting procedural clouds, directional sun and horizon haze. The sky writes no depth, so it cannot interfere with bullets, cover or ambient occlusion.
- More neutral concrete, mild slab variation and base weathering, fine surface relief and subtle floor wear/roughness.
- Restrained quarter-resolution HDR bloom, retaining the depth-aware contact shading and crisp weapon overlay. Performance mode bypasses the finishing pipeline.
- All 23 loadout items now use the detailed factory. Rebuilt fists, knife, Scythe, Katana, grenade, smoke canister, Molotov and RPG; retained detailed ranged models. Hands share the same sleeved style. Showroom fists remain visible.
- Weapon-specific presentation offsets keep the Scythe away from the score and remove the RPG's close-up rear cap from the FPS view. Scythe support-arm sleeves angle towards the player rather than floating as a horizontal block.
- Head accessories and weapon now follow their actual skeletal pivots. Bots have two-bone legs, knee flexion, body lean, aim pitch, reload motion and visible muzzle flashes, without squashing their whole bodies.
- Fixed-size pools for debris, muzzle-aligned tracers, surface-oriented hit marks and bouncing brass casings. No new geometry/material per ordinary bullet hit.
- Static Arena batching: **64 fixed visual meshes → 6 batches**, with **38 original exact ray meshes retained** in a collision-only hierarchy. This is a draw-submission count, **not** a hardware FPS claim.

## Verification

- **110 unit tests passed**, including pooling bounds/lifetime, casing support, exact ray surfaces after batching, all 23 full/showroom models, camera/muzzle projection, stair descent and slide buffering.
- The **10-test browser suite passed** in a single full run after the full-air-reversal fix; controls and locomotion also passed again after the final round-state reset. A final full-suite rerun remains pending until the isolated soak has finished.
- Those ten browser tests include the new live locomotion/aim check and actual WebGL rendering of all 23 models, bot rigs and combat shaders.
- WebGL stress check: 500 pooled impact/burst updates left allocated geometry unchanged (**44 → 44**) in its controlled test scene.
- First manual visual audit inspected 11 full-size frames; no page/shader errors. Inspection then identified and corrected Scythe support-arm framing and the RPG's oversized near-camera rear cap.
- Final production build passed. Isolated ten-minute validation of the final app source started **2026-10-15T07:05:47.485Z**; result pending.
- Two earlier short runs were intentionally interrupted for a low-speed air-reversal correction and a round-camera/dash-state reset, not counted as completed validations.
- Additional deterministic checks cover 1,000 seeded fast angled-wall approaches (including long, thin no-tunneling slabs), 30 complete ramp round trips, slide steering at 30/60/144 Hz, full airborne reversals at 60/120/600 Hz, round camera/input resets, sky matrix/depth/disposal contracts, and HDR pass order/target ownership/resize/disposal.

## Reproducible movement comparison

Run `node scripts/movement-audit.mjs` with local history for baseline `d40fdb1` available. Both revisions use their own physics constants, sampled at 600 Hz. These are isolated controller measurements, not browser FPS, network latency or exact Roblox measurements.

| Check | Previous | Current |
| --- | ---: | ---: |
| Normal run speed | 11.5 | 12.2 |
| Time to full run | 0.1100 s | 0.0983 s |
| Time to stop from full run | 0.1050 s | 0.0817 s |
| Ground reversal to 99% reverse speed | 0.2183 s | 0.1650 s |
| Unwanted lateral travel during a straight air reversal | 1.7499 | 0.0000 |
| Slide duration | 0.40 s | 0.36 s |
| Flat slide travel | 5.0158 | 5.5411 |

Stopping is about 22% faster and ground reversal about 24% faster in this controller comparison. Slides end sooner but the stronger opening burst covers about 10% more flat distance—shorter duration does **not** mean shorter travel. Ramp slope, collisions and jumping change in-game results.

The comparison exposed a small-speed transition bug that a first-frame reversal test missed: the final fraction of forward speed could re-enter angular steering and initiate an unwanted orbit. The fix keeps the braking branch active through that transition; the new test follows the entire reversal at three update rates.

## Reproducing the visual audit

With the dev preview on port 5173:

```sh
BROWSER_EXECUTABLE=/path/to/chromium npm run audit:visual -- /tmp/arena-visuals
```

The audit writes individual full-size screenshots outside Git. It is a controlled, paused visual inspection, not a hardware FPS benchmark or proof of exact Roblox equivalence.

## Fixed resources and limits

- Combat pools: 384 debris points, 64 tracers, 128 hit marks and 48 shell casings. Expired transient entries are hidden/reused; round/map changes clear the pools.
- Current first-person rifle: 21 meshes / 28,500 vertices. Additional detail is not free; this is not a promise of higher FPS on every device. The prior 51-mesh factory still required more submissions.
- Current bot: 19 meshes with independent skeletal pivots.
- Performance mode skips HDR/contact-shading/bloom and dynamic shadows, while the sky uses fewer cloud octaves.
