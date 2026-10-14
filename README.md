# RIVALS // Arena 1v1

A research-driven browser FPS inspired by the public movement language and compact Arena layout of Roblox **RIVALS**. Phase 2 adds a fair single-player 1v1: two original procedural weapons, a first-to-three-round match loop, combat feedback, and a movement-aware bot with perception, memory, tactical decisions, shared physics, predictive aim, and difficulty profiles.

> **Fidelity note:** the original game's controller, map source, weapon assets, and numeric combat constants are not public in the reviewed material. This project does not claim pixel or physics identity. [`research/RESEARCH_REPORT.md`](research/RESEARCH_REPORT.md) and [`research/VISUAL_REFERENCE_BOARD.md`](research/VISUAL_REFERENCE_BOARD.md) separate verified facts, public observations, estimates, and unknowns.

## Run it

```bash
npm install
npm run dev
```

Open the Vite URL in a modern desktop browser. The preview server binds to `0.0.0.0` and accepts the generated Arena preview host.

Production checks:

```bash
npm test
npm run build
npm run preview
```

## Controls

| Input | Arena duel | Movement Lab |
| --- | --- | --- |
| `W A S D` / arrow keys | Move / strafe | Move / strafe |
| `Shift` | Sprint | Sprint |
| `Space` | Jump; slide-jump | Jump; slide-jump |
| `C` or `Ctrl` | Enter a slide while moving | Enter a slide while moving |
| Mouse | Look after pointer lock | Look after pointer lock |
| Left mouse | Fire active weapon | — |
| Right mouse | Focus weapon view | — |
| `1` / `2` | Carbine / sidearm | — |
| `R` | Reload | Start/stop bounded recording |
| `F9` | — | Replay the last recording |
| `Esc` | Release pointer lock / pause | Release pointer lock / pause |
| `F2` | Settings | Settings |
| `F3` | Physics + bot debug | Physics debug |

Click the viewport or the start button to capture the mouse. `Esc` releases pointer lock; the game pauses rather than silently continuing. Difficulty changes bot decision quality, reaction time, aim control, prediction, movement choices, and adaptation. It does **not** grant extra health or damage.

## Phase 2 gameplay

1. Select **Arena** and choose Easy, Skilled, Expert, Elite, or Rival.
2. Capture the mouse and wait through the short round countdown.
3. Use cover, ramps, sprinting, sliding, jumps, and slide-jumps while firing with the carbine or sidearm.
4. Win three rounds. After a round, choose the next round; after the match, rematch or return to the menu.
5. Use `F3` to inspect player speed, bot line of sight, tactical state, distance, and frame telemetry.

The bot is not a target dummy. It uses the same `MovementController` and `CollisionWorld`, observes through collision-aware raycasts, stores bounded sighting/strafe memory, chooses approach/strafe/retreat/cover/search actions, predicts target motion, reloads and changes weapons, and can adapt after repeated player movement habits. It is intentionally bounded by visibility and reaction timing.

## Architecture

```text
src/
  App.tsx                         Main menu, difficulty, match HUD, pause/summary UI
  styles.css                      Arena HUD, combat feedback, overlays, settings
  game/
    GameCanvas.tsx                Three.js renderer + fixed-step loop + presentation
    CameraController.ts            Pointer-lock look, pitch clamp, recoil kick
    InputManager.ts                Keyboard movement and edge-triggered movement inputs
    CombatInput.ts                 Mouse firing/aim and weapon/reload input
    MovementRecorder.ts            Bounded deterministic lab recordings
    combat/
      CombatTypes.ts               Weapons, difficulty profiles, bot/match contracts
      CombatSimulation.ts          Health, weapons, hit resolution, round/match state
      WeaponSystem.ts              Ammo, fire cadence, reload and loadout state
      BotPerception.ts             Collision-world line of sight and observations
      BotMemory.ts                 Bounded sightings, threats, strafe habit memory
      BotDecision.ts               Tactical movement/weapon/state decisions
      BotAim.ts                    Reaction, bounded turn, prediction, accuracy
      BotController.ts              AI orchestration over shared movement physics
      BotEvaluation.ts              Repeatable bot-vs-test-agent scenarios
      CombatPresentation.ts         Original bot avatar, weapon views, impact effects
    movement/
      MovementConfig.ts             Central fixed-step tuning
      MovementController.ts          Stateful ground/air/sprint/slide/jump movement
      CollisionWorld.ts              AABB/surface collision + combat raycasts
      MovementTypes.ts               Pure movement contracts
    arena/
      ArenaBuilder.ts               Original Arena/Lab geometry and lighting
      ArenaConfig.ts                 Spawns and layout notes
      WorldAtmosphere.ts             Original procedural sky, sun and clouds
research/
  RESEARCH_REPORT.md                Evidence ledger, calibration, limitations, Phase 2 notes
  VISUAL_REFERENCE_BOARD.md         Public visual references and art-direction decisions
```

### Separation of responsibilities

- **Movement:** `MovementController` owns all player and bot locomotion. Combat never teleports an agent or directly edits its position.
- **Perception:** `BotPerceptionSystem` only sees current visibility and bounded last-known data; cover blocks sight.
- **Decision:** `BotDecision` selects tactical state and movement intent at a difficulty-dependent cadence.
- **Aim:** `BotAimController` adds reaction time, smooth turn limits, prediction lead, confidence, and weapon spread.
- **Combat:** `CombatSimulation` resolves hits against the same collision solids, applies health, and owns match state.
- **Presentation:** Three.js renders original geometry, an original blocky bot silhouette, weapon views, muzzle/impact signals, and HUD feedback. Rendering never becomes the physics authority.

## Movement calibration

1. Select **Movement Lab**.
2. Enable **F3 Debug**.
3. Run one input sequence at a time from a marked station.
4. Press `R`, perform the sequence, press `R` again, and use `F9` to replay the same fixed-step input/yaw stream.
5. Change one value in `src/game/movement/MovementConfig.ts`, rerun `npm test`, and compare the recording.

Movement remains a 120 Hz fixed-step system with render interpolation. The current constants are calibration estimates, not verified Roblox values. Existing tests cover acceleration, diagonal normalization, jump/landing, slide-jump carry, edge falls, wall collision, ramp support, raycast cover, and render-rate stability.

## Bot evaluation

The headless harness in `src/game/combat/BotEvaluation.ts` runs stationary, straight-line, strafing, jumping, sliding, slide-jumping, direction-change, line-of-sight, and elevation scenarios. It reports shots/hits, visibility samples, movement collisions, bot slide/jump ticks, health, and final phase.

```bash
npm test
```

The tests prove that the scenarios execute through the fixed-step combat path and that perception is blocked by cover. They do not prove human-level skill or balance. Browser playtesting and recorded traces remain necessary for final difficulty calibration.

See [`research/BASELINE_TEST_REPORT.md`](research/BASELINE_TEST_REPORT.md) for the pre-combat movement baseline and regression checkpoints.

## Visual and licensing boundary

Arena geometry, atmosphere, bot avatar, weapon silhouettes, muzzle/impact effects, and HUD styling are original procedural/browser assets. Public screenshots, thumbnails, videos, community pages, and Creator Store listings were used as qualitative references only. No downloaded screenshot, Roblox texture, proprietary model, texture pack, decompiled client code, or unverified Creator Store asset is shipped.

The visual direction prioritizes light gray/blue block geometry, bright cyan sky, short readable sightlines, compact high-contrast crosshair, minimal HUD, restrained recoil, and cheap effects. Ambient occlusion and other expensive post effects are intentionally not enabled without a measured need.

## Known limitations

- The original RIVALS controller, weapon stats, hitboxes, map measurements, HUD coordinates, and server/client timing are unavailable.
- The browser uses an analytic AABB/surface collision world; rotated cover is represented as collision-friendly bounds rather than a full mesh physics engine.
- The two weapons are original hitscan approximations. There are no explosives, melee abilities, projectile weapons, damage falloff, networking, or multiplayer.
- Bot evaluation is deterministic and scenario-based; it is a quality signal, not a claim of tournament-level behavior.
- Browser Pointer Lock, WebGL performance, console state, and cross-browser behavior require manual validation in a real browser.

## Next highest-impact improvements

1. Add permission-safe reference capture and frame-counted combat traces, then calibrate weapon spread, FOV, cover scale, and bot aim against repeatable observations.
2. Add projectile/utility modules and cover-aware path candidates only after browser bot sessions show the base hitscan duel is balanced.
3. Profile a real browser session, reduce shared material/draw-call overhead where measured, and add automated browser smoke tests for pointer lock, match reset, and round summary.
