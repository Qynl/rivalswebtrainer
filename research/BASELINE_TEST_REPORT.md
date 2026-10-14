# Phase 2 baseline and regression report

**Repository:** `Qynl/rivalswebtrainer`
**Branch:** `arena/3ddabc10-rivalswebtrainer`
**Phase 2 start:** 14 October 2026 (Europe/Berlin workspace date)

## Pre-combat baseline

The repository was inspected before combat changes. The existing movement architecture consisted of:

- `MovementController` as the fixed-step movement authority.
- `CollisionWorld` with AABB solids, analytic floor/ramp surfaces, vertical collision, slide clearance, and edge falls.
- `GameCanvas` with a 120 Hz accumulator, pointer-lock camera, render interpolation, recorder/replay, and Arena/Movement Lab switching.
- `ArenaBuilder` with original mirrored Arena geometry, ramps, cover, lab stations, and procedural atmosphere.
- Vitest coverage for movement and recorder behavior.

Commands run before Phase 2 implementation:

```text
npm test
2 test files
8 tests passed

npm run build
passed
known warning: Three.js production chunk larger than 500 kB
```

The exact pre-combat suite was:

- 7 `MovementController` tests.
- 1 `MovementRecorder` test.

No movement test was removed or rewritten to hide a regression.

## Audit findings carried into Phase 2

- The controller is testable and stateful, but its rotated Arena cover collision is represented by axis-aligned bounds. This keeps collision deterministic but can make a diagonal cover feel thicker than its rendered edge.
- The controller has no original RIVALS source constants, authoritative capsule, slope limit, weapon behavior, or networking model. Existing values remain explicitly estimated.
- The Movement Lab is the reliable calibration space; no browser screenshot, Pointer Lock session, console inspection, or live FPS trace was available before Phase 2.
- Before this phase there was no health, weapon, target perception, bot, round state, damage feedback, or match reset path. Phase 2 adds those without moving position outside `MovementController`.

## Phase 2 regression checkpoints

| Checkpoint | Movement tests | Combat tests | Build | Notes |
| --- | ---: | ---: | --- | --- |
| After shared-world raycast | 8 | 0 | pass | Added a raycast test against the same cover solids used by movement. |
| After weapons and combat simulation | 8 | 4 | pass | Added weapon cadence/reload, cover-blocked perception, and hit resolution tests. |
| Current Phase 2 tree | 8 | 7 | pass | Added bot evaluation harness across nine movement/visibility scenarios and the no-through-wall combat case. |

Current command output:

```text
npm test
5 test files passed
16 tests passed

npm run build
passed
known warning: Three.js production chunk larger than 500 kB
```

## What is validated automatically

- Ground acceleration, sprint cap, diagonal normalization, jump/landing, slide-jump carry, edge falls, wall collision, ramp support, and fixed-step render-rate stability.
- Combat raycasts are blocked by cover and cannot use a target through a wall.
- Weapon fire cadence, magazine depletion, reserve reload, and independent weapon slots.
- Combat simulation applies damage, exposes explicit phases, and keeps player health valid while the bot is engaged.
- Bot evaluation runs stationary, straight-line, strafing, jumping, sliding, slide-jumping, direction-change, line-of-sight, and elevation scenarios and records measurable signals.

## Not validated in this environment

- Browser Pointer Lock interaction, mouse firing, WebGL rendering, browser console, real frame time/FPS, screen-size HUD layout, and cross-browser round reset.
- Human win-rate or fairness balance against a real player.
- Pixel-level Arena, weapon, avatar, or HUD comparison with Roblox RIVALS.

A live Vite server was run during implementation, but no browser automation binary is installed in the sandbox. These are recorded as unavailable observations rather than claimed results.
