# Courts, thrown utilities and mouse input

This supersedes the earlier tight/tall Arena dimensions. All dimensions are original trainer-space estimates, not measured Roblox units.

## Delivered

| Court          | Floor   | Wall height | Ramp summit |
| -------------- | ------- | ----------- | ----------- |
| Concrete Arena | 30 × 38 | 14          | 4.4         |
| Foundry        | 34 × 42 | 10          | 3.4         |
| Courtyard      | 36 × 40 | 8.5         | 2.8         |

Foundry and Courtyard are original, distinct mirrored layouts, not claimed copies of Roblox maps. All three authored courts share the procedural concrete/PBR kit, panel joints, stencil wayfinding, shadows, contact shading and offline texture generation. Foundry adds gantries, bronze markings and cool concrete; Courtyard adds warm stone, low planted cover and wall lamps. Cosmetic dressing does not create hidden collision. Skyline, Hangar 09 and the dedicated range remain available.

Grenade, Molotov, Smoke and Flashbang use their detailed held-item geometry without hands as the actual airborne payload. Release occurs after 160 ms of a 480 ms windup/cast/recovery sequence. A successful release hides the held payload; an equipped-slot change before release cancels/refunds it. Release uses current aim, collision-checked hand clearance and partial horizontal velocity inheritance. Utility payloads tumble; the Molotov wick flickers.

Molotov impacts create a bounded two-draw fire group: a noise-shaped ember/scorch patch and 22 instanced, curling flame tongues. Fire is placed on the actual struck support, fades over its final 0.6 seconds, and damages with elevation and line-of-sight checks. Recursive disposal covers all child resources.

Mouse look retains immediate proportional normal movement. A bounded five-packet history rejects isolated moderate outliers, stale queued movement and recapture spikes without replay. Coherent subsequent fast-flick packets can pass. Focus/capture transitions reset history and view-model sway; paused movement cannot accumulate. Raw input is requested where supported; unsupported raw capture falls back to standard pointer lock. Both event-before-promise and promise-before-event error orderings are handled without accidentally pausing the fallback. This cannot establish that a real hardware/browser snatch is universally cured.

## Validation

- 214 Node tests pass, including 21 new regressions covering input outliers, throw release/cancellation/visibility/spin, raised fire and cleanup, map roster and route clearance.
- Real WebGL browser checks cover all three authored courts, all nine opposing spawn pairings per court, both physically walked ramp summits per court, protected spawns, finite transforms and no GL errors.
- New-map autonomous bot simulations exercise rifles, melee, slides and abilities with real collision and navigation. These are bounded simulations, not a human-equivalence claim.
- Additional browser coverage checks delayed releases for all four utilities, rendered flame shaders, paused-input suppression and both raw-pointer fallback event orderings.
- Existing loadout, movement, positional AI, melee abilities, weapon mechanisms, graphics and disconnected production tests are retained. Old fixed-position fixtures were moved away from newly repositioned cover/window geometry rather than weakening their assertions.
- Production build succeeds. Rendered screenshots of Foundry, Courtyard, Molotov fire and all four airborne utilities were inspected; audit outputs remain outside Git under `/tmp/court-rework`.

No long endurance run or hardware FPS benchmark was performed for this pass.

Final check detail: the complete 19-test run passed 18 tests; the impact pixel fixture still used the old wall distance. Moving its actor from x=9 to x=11 restores the original four-unit impact distance in the wider court, without lowering the pixel assertion. The corrected impact test and all three new browser tests then passed together (4/4). Thus all 19 cases have passing results, not a claimed single uninterrupted 19/19 run. A prior disconnected-capture timeout also passed its isolated recheck; raw-pointer fallback now has explicit event-order regression coverage.
