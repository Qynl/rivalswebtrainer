# RIVALS // Movement Replication

A small, research-driven browser FPS movement trainer inspired by the public movement techniques and blockout references for Roblox **RIVALS**. This is a movement sandbox, not a weapon or multiplayer clone: the first milestone prioritizes fixed-step acceleration, sprinting, jumping, sliding, slide-jumping, ramps, collision, and repeatable calibration.

> **Fidelity note:** the original game's controller source and numeric physics constants are not publicly available in the sources reviewed. This project does not claim an exact replication. The research report separates verified/documented observations from estimates and unknowns.

## Run it

```bash
npm install
npm run dev
```

Open the Vite URL in a modern desktop browser. The preview server is configured for Arena's proxied host (`0.0.0.0`, permissive Vite host checks).

Production checks:

```bash
npm test
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | Move / strafe |
| `Shift` | Sprint while moving forward |
| `Space` | Jump; press during a slide for a slide-jump |
| `C` or `Ctrl` | Enter a slide while sprinting with momentum |
| Mouse | Look after pointer lock is captured |
| `Esc` | Release pointer lock and pause |
| `F2` | Open settings |
| `F3` | Toggle the physics debug overlay |
| `R` | Start/stop a bounded fixed-step input recording |
| `F9` | Replay the last recording through the same controller |

Click the viewport or **Click to play** to capture the mouse. The settings panel exposes FOV, sensitivity, and optional auto-sprint. Use the top mode switcher to reset into the research-informed Arena blockout or the dedicated Movement Lab.

## What is in the first milestone

- A dedicated `MovementController` with explicit grounded, sprinting, jumping, airborne, sliding, landing, and slide-jump transitions.
- 120 Hz fixed-step simulation, render-rate-independent accumulation, and interpolated camera presentation.
- Independent ground acceleration/friction, air acceleration/braking, gravity, jump velocity, slide steering/deceleration, coyote time, and jump buffering.
- Analytic AABB collision for cover, platforms, walls, corners, and ramps. The player has a capsule-like circular footprint, a shortened slide height, stable top-face support, and wall response without a rigid-body dependency.
- Arena blockout based on the public references: mirrored compact grid, central raised cover, end ramps, symmetrical angled cover, spawn decks, light-gray/blue modular materials, and an original procedural sky/sun/cloud atmosphere. No proprietary game assets are extracted or redistributed.
- Movement Lab stations for acceleration/distance, jump height, ramps and slide distance, wall/edge/corner collision, and a combined sprint → slide → jump route.
- Debug overlay with position, velocity, horizontal speed, state, grounded flag, slide timer, jump elapsed time, ground normal, collision id, frame time, FPS, and simulation steps.
- Bounded recording/replay that stores fixed-step input, yaw, state, collision, position, and velocity, then re-feeds the same stream through the controller.
- Deterministic Vitest coverage for acceleration/diagonal normalization, jump flight, slide-jump carry, wall tunnelling prevention, ramp support, and fixed-step render-rate stability.

## Project structure

```text
src/
  App.tsx                         HUD, capture screen, settings, mode switcher
  styles.css                      Compact research-tool visual system
  game/
    GameCanvas.tsx                Three.js renderer + fixed-step loop
    InputManager.ts                Keyboard state and edge-triggered actions
    CameraController.ts            Pointer-lock look and slide camera height
    MovementRecorder.ts            Bounded deterministic input/state recordings
    movement/
      MovementConfig.ts            Central movement tuning
      MovementController.ts         Testable stateful controller
      CollisionWorld.ts             Analytic AABB/surface collision
      MovementTypes.ts              Pure movement contracts
    arena/
      ArenaBuilder.ts               Modular Arena and Movement Lab geometry
      ArenaConfig.ts                Spawns and layout notes
      WorldAtmosphere.ts            Original procedural sky, sun, and cloud sprites
  game/movement/MovementController.test.ts
research/
  RESEARCH_REPORT.md               Evidence ledger and calibration limits
```

## Calibration workflow

1. Select **Movement Lab**.
2. Enable **F3 Debug**.
3. Run one input sequence at a time from a known station and use the metre/height markings.
4. Press `R`, perform the sequence, and press `R` again. `F9` replays the same fixed-step stream.
5. Change one parameter in `src/game/movement/MovementConfig.ts`, rerun `npm test`, and compare the recording rather than tuning several values at once.

The current baseline is intentionally labelled as an estimate. It is chosen to make the observed slide-jump and ramp techniques feel plausible at browser scale; it is not a claimed Roblox-stud conversion.

## Research and limitations

Read [`research/RESEARCH_REPORT.md`](research/RESEARCH_REPORT.md) for source URLs, evidence labels, confidence, implementation decisions, and a list of unknowns. The report records that official/public material confirms the game's identity and community-documented movement techniques, while exact acceleration, gravity, capsule dimensions, FOV, camera spring, and map scale remain unknown without instrumented access to the original.
