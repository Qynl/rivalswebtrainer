# Tactical positioning follow-up

This pass improves fighting movement on the tighter/taller Arena without changing its dimensions, the player controller, loadout UI or quick-melee semantics.

## Deliberate positioning

`src/bot-positioning.js` adds a bounded tactical layer between perception and the existing ability/movement controller:

- Regular/Veteran/Elite Katana and Knife bots can choose an authored, walkable ramp summit with a useful firing line to an observed enemy. Scythe and Fists retain their gap-closing/traversal emphasis.
- Local recovery flanks can be chosen when a visible fight repeatedly meets an obstacle or when a recently reacted-to opponent is lost from sight.
- Candidate evaluation uses a **last-seen position snapshot**, not current hidden coordinates. The live target reference is used only as an identity key. A new hidden recovery flank requires a recent reaction to that same opponent.
- Prospective line of sight, standing clearance, a complete route, route-length limits and teammate destination spacing are required. Searches examine authored summit samples and four local flank samples, with **at most five expensive route solves** per attempt, on per-actor cooldowns.
- Plans have bounded lifetimes. Defensive pressure/reloading, close-range combat, switching away from rifle, a changed opponent, lost memory, a substantially changed last-seen position or timeout cancel the offensive route.
- Arrival produces a brief anchored firing hold with small, sightline-aware strafes, not permanent camping. Normal perception, reaction delay, ammunition, reloads, spread and shooting restrictions still apply.

## Physical steering and route progress

Ground movement now checks a short capsule/support trajectory using the real movement and vertical solver. An intended wall collision or unsupported ledge move tries nearby tangent directions; if all are blocked, it stops instead of inventing an escape. Probes are throttled and cached, with updates on significant input changes. Actor state is not changed by the probe.

When following a route, the probe length is limited to the next waypoint. This matters at a tight corner: looking beyond the intended turn would reject a valid route too early. Ground checks do not replace dash impulses, slide steering or airborne input. Actors that land on an uncharted cover roof are permitted to descend rather than being permanently trapped by perch edge protection.

Waypoint consumption now considers elevation and uses closer corner tolerances. Offensive firing-position endpoints use a tighter final tolerance. A real integration failure caught an important issue: reaching the correct nav cell was not enough to expose a narrow firing angle. Bots now finish that peek more precisely and test the proposed strafe side before stepping behind cover again.

Committed positioning routes suppress opportunistic dash/slide starts that would abandon the ramp route. Existing quick guards, rifle fire where visible, close-range cancellation and ordinary movement/ability combos remain intact. No actor is teleported to high ground.

## Validation

- **167/167 Node tests pass**, including 19 new positioning tests. Coverage includes real ramp entry routes, reachable authored summits, line-of-sight/route rejection, teammate spacing, memory-only planning with throwing getters on hidden live coordinates, lifecycle cancellation, bounded hold duration, difficulty/reaction gates, wall and rotated-slab steering, support/ledge checks, intentional descent, cache throttling, boxed-in stopping, waypoint/height correctness, precise endpoint handling, sightline-aware holds, bounded route solves and recent-target recovery requirements.
- **14/14 browser tests pass**, retaining the existing full game, actual bot abilities, map topology, movement, graphics, all 23 weapon models and production offline reload checks.
- **Controlled real-Arena combat test:** a rifle-armed Katana bot observes a stationary opponent, chooses a summit on its own, walks the real ramp to y=6.2, arrives at the firing perch and continues firing from there. Real damage events are counted while actors remain alive. No preloaded route or direct movement command is injected. The test retains real WebGL rendering and checks browser/GL errors.
- The controlled combat test passed **three consecutive runs** after the precise-peek correction. Each selected a roughly 10.10-unit route, reached y=6.2 at simulation frame 154 at 120 Hz, and fired further shots after arrival, with zero invalid positions and no GL errors. Random spread changes hit counts and tactical steering can change arrival timing in other runs; this is not an aim/performance benchmark.
- **Accelerated two-minute 3v3 simulation** continues to assert autonomous dashes, slides, slide-jumps, Fists double-jumps, switches, melee swings/hits and rifle shots, with no non-finite/below-floor/out-of-bounds states. Tactical behavior varies with the fight; this simulation does not require every bot to finish a high-ground plan under close-range pressure.
- A legacy full-game test fixture exposed a teleport/camera-origin race: the scripted first shot could still originate at the old rendered position if RAF had not run after teleporting the player. The fixture now explicitly publishes its camera transform before firing, without weakening the kill assertion or altering game shooting. The full-game test passed three repeated runs after this correction.
- Production build and whitespace validation pass.

For an optional screenshot of the real autonomous high-ground test:

```sh
ARENA_SCREENSHOTS=/tmp/positioning-views npm run test:browser -- tests/positioning.spec.js
```

Use `BROWSER_EXECUTABLE` for a nonstandard Chromium binary. Screenshot output stays outside Git. The fixed-step test is accelerated; paused screenshots and software WebGL do not establish hardware FPS.

## Limits

These are original, local behavior rules, not learned human RIVALS play. High-ground choice is restricted to authored walkable decks; the navigation grid is still single-support-height, not a full multilayer rooftop/trick-route planner. Local steering is not a guarantee of globally optimal routes or perfect collision avoidance in every impulse/airborne situation. Bots still use rifles as their only ranged weapon. No new HUD, exact-recreation claim or hardware performance claim is introduced.
