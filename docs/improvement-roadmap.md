# Rivals Arena: big improvement roadmap

**Audit date:** 17 October 2026  
**Scope:** the repository as it exists today, plus the first implementation slice shipped with this roadmap.  
**Intent:** make this a better *trainer*, not merely a larger browser shooter.

## Executive direction

This project already has a lot of difficult work in place: an offline-first Three.js arena, five authored maps, 26 weapons/utilities, a fixed-step simulation, local bots, a free-play range, a browser-hosted invite multiplayer path, procedural presentation, and a sizeable automated regression suite. More weapons, maps, particles, or bot tricks are not the highest-value next step.

The missing product loop is **practice with a goal → get a trustworthy result → know what to try next → repeat**. The free range is useful, but before this change it was an open-ended sandbox with a few aggregate counters. The code also has no per-weapon learning history, no guided first session, and no built-in way to distinguish training results across loadouts. Online play is intentionally casual and host-owned; its dependency on the host tab and public PeerJS signaling is documented, not something this app can promise away with UI polish.

### North star

A player should be able to open the site, choose a skill to work on, complete a short drill without setup or an account, understand the result, and repeat it later on the same device. That flow must remain fast, original, private-by-default, and usable offline.

### Product guardrails

1. **Keep offline-first real.** Training, scores, and results must not need an account, network call, analytics SDK, or server.
2. **Measure what the game actually observed.** Do not advertise inferred “aim quality,” latency, or accuracy that is not supported by the simulation events.
3. **Do not compare unlike runs.** Scores from different weapons, target movement, drill versions, or rules need separate records until they are normalized and tested.
4. **Preserve the existing mechanics.** Add a mode or tool around the 120 Hz simulation before changing core weapon/movement balance.
5. **Prove visual claims on real devices.** Software-WebGL stability tests are useful, but they do not establish integrated-GPU frame rate or battery use.
6. **Stay original and transparent.** Continue to describe the game as a fan-made trainer, not an official client or an exact recreation.

## Repository reality check

### Strong foundation

- `src/game.js` runs the game and owns the fixed-step movement/combat loop; `src/physics.js` and `src/movement.js` have focused test coverage.
- `src/net/` and `server/` already separate much of the networking and authority work. The default browser-hosted PeerJS path has real local-browser regression coverage, and `docs/multiplayer.md` clearly states its host, relay, and fairness limits.
- Production builds have offline precaching. Existing tests cover game rules, rendering lifecycle, movement, bots, utilities, multiplayer, and a disconnected production reload.
- The feature set is already broad enough to support a real practice curriculum: moving respawning targets, multiple weapons, head hits, match statistics, local persistence, and a fixed-step clock.

### High-leverage gaps, in order

1. **A real practice loop.** The previous range showed aggregate shots/accuracy/eliminations but did not run timed goals or retain practice records.
2. **Better diagnostics.** The existing counters are not yet a complete per-trigger/per-weapon measurement model. For example, pellets, flames, and explosive splash do not mean the same thing as one ordinary hitscan hit.
3. **First-session clarity and accessibility.** Combat requires desktop pointer lock and keyboard/mouse. Local key rebinding is now available; a short guided first run and clearer input/device setup flow would lower the entry barrier further.
4. **Network resilience.** Browser-hosted matches intentionally end if the host leaves; public signaling/relay availability and Internet NAT behavior are not controlled by this repo. Ranked play would need a different trust model and operated infrastructure.
5. **Maintainability and performance evidence.** `src/game.js` is a large gameplay module, the UI/game bridge is centralized, and the 540 KB Three.js bundle is a known large dependency. There is a software-WebGL soak, but no representative hardware performance baseline.
6. **A product-shaped documentation surface.** The README records many historical passes. Keep those records, but make the “what can I do now / what comes next” path easier to find.

This is not a recommendation to rewrite the engine. The safer approach is to extract and test seams as real new work needs them, while preserving existing behavior.

## Delivered in this roadmap slice

A first, deliberately bounded training loop is now implemented:

- A new **TRAIN** lobby tab with three 60-second drills: **Track the strafe**, **Headshot discipline**, and **Target clear sprint**.
- The drills use distinct target counts, movement speeds, and respawn cadence while reusing the actual range, weapons, hitboxes, and fixed simulation.
- The timer is simulation-driven and pauses with the game. Ending a drill freezes play, releases pointer lock, clears active projectiles/effects, and shows a result instead of silently continuing.
- Results report shots, hits, accuracy, head tags, eliminations, and the drill’s explicit score. Bow head hits are now included in the head-tag counter.
- Personal bests and the last 50 runs are stored only in local storage, **per exact four-slot loadout**. Users can clear the records. No player data is uploaded.
- The run-again and return-to-training paths are covered. The first implementation uses existing game counters; it does **not** claim scores are comparable across weapon families or that this is a ranked leaderboard.
- A CI workflow runs Node tests and a production build, plus the Chromium browser regression suite.

### Follow-on implementation — trustworthy local progress

A second follow-on slice extends that loop without introducing a backend:

- Every drill run now records a rules version. Personal-best and trend comparisons are scoped to that version and the exact four-slot loadout; legacy records are migrated as version 1, and different versions remain visible in history without being compared.
- Settings now exposes locally saved movement/combat key rebinding with duplicate-key swaps, reset-to-default, Escape/blur cancellation, and reserved browser shortcuts. Dynamic in-game movement and ability actions still map to the existing multiplayer input protocol; no server-side binding or schema change is required.
- Training records have bounded per-weapon diagnostics: emitted fire/attack events, ADS/moving context, direct contacts and head contacts, splash contacts, continuing area-effect ticks, applied training HP, and sampled direct-hit range in original trainer units.
- Per-run action IDs link delayed projectile, splash, and continuing-effect outcomes back to the initiating action while the simulation is live. The saved record keeps aggregate counters rather than a replayable event timeline.
- Those counters explicitly **do not** turn shotgun pellets, flame pulses, or explosive splash into a cross-weapon accuracy percentage. Pellet contacts and unique hit actions stay separate; a persisted event timeline and broader weapon-specific denominators remain future hardening steps.
- The TRAIN cards show a five-run sparkline and score average for the same drill/rules/loadout. A directional trend is withheld until three runs exist; no opaque “skill rating” is produced.
- Players can export a versioned JSON backup and manually import it offline. Imports are bounded to 1 MB / 500 input rows, validated against known drills/weapons/rules, deduplicated by run ID, ordered newest-first, and capped at 50 local records. Clear-history still works.

The scope is intentionally small enough to validate before adding progression, profiles, or cloud services.

## Roadmap and gates

### Phase 0 — Protect the foundation (start now; low/medium)

**Goal:** make it difficult to regress the existing game while new trainer features are added.

- Keep `npm test`, `npm run build`, and Playwright browser regressions green in CI.
- Keep deterministic simulation/rule tests separate from browser/render tests; keep screenshots, soak artifacts, and generated datasets out of Git.
- Record known build warnings and performance constraints rather than hiding them. Fix the `ui-session.js` dynamic/static import warning only when the UI/network boundary can be made cleaner without delaying offline startup.
- Add an explicit release checklist: offline reload, desktop startup, 390 px configuration layout, one complete training run, one offline match, and one online invite smoke test when the public signaling service is reachable.

**Exit gate:** CI is green on a clean install; a failed browser test is actionable and reproducible; no environment-specific browser binary is committed.

### Phase 1 — Ship a useful daily practice loop (first implementation delivered; medium)

**Goal:** make the range produce repeatable sessions and understandable local records.

Delivered in this change: timed tracking/precision/elimination drills, per-loadout bests, recent history, result/retry UI, reset action, and tests.

Next refinements:

- Tune target lanes and respawn positions through playtesting, not arbitrary code-only assumptions.
- Add an explicit “recommended weapon” or one-click loadout preset only after the drill scoring is weapon-aware.
- Add drill version/ruleset IDs to stored records before changing movement, timing, targets, or scoring. Old scores should not quietly become incomparable.
- Add export/import only with schema validation and a clear local-data privacy statement.

**Exit gate:** a new player can start a drill in two clicks; pause stops the clock; finishing/retrying cannot preserve stale shots, projectiles, UI state, or targets; history survives reload and can be cleared; record comparisons are limited to the same drill rules and exact loadout.

### Phase 2 — Instrument real skill, not proxy counters (large)

**Goal:** turn practice summaries into trustworthy feedback.

- Introduce an event model with a stable shot/action ID. Count a trigger pull once, and track the outcome separately: one hit, multiple pellet contacts, projectile direct hit, explosion splash, damage-over-time tick, melee, and healing.
- Record results per weapon and context: stationary vs moving, ADS vs hip-fire, head/body hit, target distance, and time-to-first-hit. Avoid capturing raw mouse movement or anything unnecessary for the goal.
- Put minimum sample counts and confidence labels on percentages. A 100% rate from one shot is not a meaningful trend.
- Make the metric’s meaning visible (“hits per trigger”, “head tags”, “eliminations/minute”) and avoid a single opaque skill rating.
- Store a versioned summary locally. Add export/import and “delete all training data” after the format is stable.

**Exit gate:** deterministic tests prove each weapon family increments the correct event exactly once; metrics explain their denominator; different weapons or drill versions never share a personal-best bucket by accident.

### Phase 3 — Better onboarding, controls, and accessibility (medium/large)

**Goal:** make it easier to enter the game and play comfortably.

- Build an optional 2–3 minute tutorial: mouse look/pointer lock, movement, slide/jump, ADS, reload, switching, quick utility, and safe exit. Each step should be skippable and replayable.
- Add remappable keyboard bindings with conflict detection, reset-to-defaults, and storage migration. Keep an always-visible way to release/pause pointer lock.
- Add an input/device readiness screen that clearly explains desktop-only combat instead of making mobile users discover it after clicking Play.
- Improve text scaling, contrast choices, reduced-motion behavior, reticle color/shape/scale, and non-color-only hit feedback. Audit focus order and dialog focus restoration.
- Consider gamepad support only after the input abstraction can represent analog movement and aim without weakening mouse behavior.

**Exit gate:** keyboard-only lobby and dialogs work; every modal returns focus; controls can be reset; reduced-motion and high-contrast settings are browser-tested; mobile configuration has no horizontal overflow and clearly communicates the combat requirement.

### Phase 4 — Turn drills into a small, deliberate curriculum (large)

**Goal:** practice specific skills and build repeatable sessions without flooding the app with modes.

- Add deterministic target patterns: lateral tracking, mixed-speed tracking, target switching, head-height taps, and short peek/hold exercises.
- Add authored distance/height/target-size variants and seeded randomization so a drill can be challenging but reproducible.
- Add custom session length and target pace only if scores include those settings in their comparison key.
- Create a lightweight weekly plan only from local completed-drill history; do not add streak pressure, notifications, accounts, or cloud sync before users ask for them.
- Give players one evidence-based next step (“repeat head-height drill”) instead of speculative advice about sensitivity or aim style.

**Exit gate:** every drill has one stated skill, one measurable outcome, one repeatable setup, clear reset/pause behavior, and unit/browser coverage. No drill claims to reproduce real-player behavior or official game measurements.

### Phase 5 — Train against pressure, not only targets (large)

**Goal:** make bots useful sparring partners while keeping them fair and inspectable.

- Add selectable bot behavior presets (patient angle holder, aggressive entry, utility user, movement-heavy) that change decisions, not hidden accuracy cheats.
- Provide scenario controls for distance, cover, utility, team count, bot skill, and reset time.
- Add “review” only for observable events: damage taken in open space, missed reload opportunity, or utility that did not affect a visible opponent. Show the event and evidence; avoid prescriptive claims without validation.
- Keep target bots, combat bots, and multiplayer authority rules separate. A trainer scenario must not leak hidden bot coordinates into player-facing advice.

**Exit gate:** difficulty changes perception/reaction/decision rules, not impossible information; tests verify LOS and hazard fairness; visual audits inspect actual scenarios; humans review bot feel before labeling it “realistic.”

### Phase 6 — Improve online reliability before adding competition (large/extra-large)

**Goal:** make a casual invite match explainable and recoverable.

- Surface room/connection state, measured RTT, reconnect attempts, and a clear “host closed the session” result. Never imply a connection is healthy just because a lobby code exists.
- Add reconnect only with explicit ownership, room revision, and match-state rules; test disconnect/rejoin and stale packets through real browser clients.
- Measure public PeerJS signaling and relay reachability from supported regions/devices before claiming Internet-wide reliability. Keep public-service outages visible and recoverable.
- Treat host migration as a separate design project. The current host browser is authoritative; migration requires state transfer, a new authority epoch, and disagreement handling.
- Do not ship ranked/anti-cheat promises on the current browser-hosted model. A ranked path needs operated authority, identity/abuse controls, replay/auditability, and a clear cost/maintenance owner.

**Exit gate:** connection failures are diagnosable; casual session behavior is documented; cross-browser real-Internet soak is measured; no “ranked” label or cheat-proof claim is made until server authority exists.

### Phase 7 — Performance, architecture, and release discipline (medium/large)

**Goal:** keep the game responsive as the trainer grows.

- Establish a hardware matrix (integrated GPU laptop, discrete GPU desktop, and one lower-power supported device). Measure 1% low FPS, frame-time percentiles, startup time, memory, and thermal/battery impact in real rendering—not only SwiftShader.
- Set a performance budget for startup JS, textures, draw calls, GPU render scale, and memory. Use the existing Performance mode as a compatibility floor, not a substitute for measurement.
- Split `src/game.js` by responsibilities only along tested seams: session lifecycle, combat resolution, target/drill controller, and presentation. Keep physics and rules pure where possible.
- Give the Game instance a single disposal path for listeners, renderer resources, pools, timers, and audio. Add lifecycle tests for remount/quit/restart.
- Revisit the Three.js chunk and dynamic-import boundaries with measured cache/startup data before attempting a risky engine split.

**Exit gate:** no monotonic resource growth in a realistic 20-minute session; stated frame-time targets pass on supported hardware; all split modules have contract tests; startup/quality settings remain correct offline.

### Phase 8 — Content and product learning (ongoing; after the loop works)

**Goal:** add content where it improves repeat play.

- Use opt-in, privacy-preserving player feedback or a local questionnaire. No hidden analytics.
- Prioritize new maps/weapons only when playtests identify a specific missing training situation.
- Keep visual identity, names, audio, geometry, and documentation original. Review every new feature against the existing non-affiliation and asset-origin disclaimers.
- Publish changes only after a clean build, unit suite, browser suite, offline reload, and a human playtest. Pushing a branch is not proof that an independent static host has deployed it.

**Exit gate:** every content addition supports a named skill or match need; no breadth-only feature blocks reliability, accessibility, or training feedback.

## Recommended next three implementation tickets

1. **Persisted event timeline and weapon-specific denominators** — per-run IDs now link async outcomes to an action and summary counters avoid pellet inflation. Next, persist a compact event timeline or richer summaries that can support carefully defined weapon-specific comparisons; keep fire pulses, projectile hits, pellet contacts and continuing area ticks distinct.
2. **First-run tutorial and device setup** — surface the existing movement/combat depth, explain desktop pointer-lock requirements before the first launch, and allow a safe no-pressure practice sequence.
3. **Deterministic drill patterns and custom sessions** — local history export/import and rules-versioning now exist; add seeded target patterns and key every setting into the ruleset before allowing custom comparisons.

## Validation scoreboard for future work

Every roadmap ticket should answer these before it is called done:

- What player problem does this solve, and what existing flow must remain unchanged?
- What exact event or metric proves it works?
- What unit, browser, offline, network, rendering, or hardware check covers it?
- Is the result comparable across weapons/devices/settings? If not, is that clearly labelled?
- Does the feature still work after pause, quit, reload, offline reload, and a second run?
- Does it need data? If yes, where is it stored, how is it cleared/exported, and is anything sent off-device?

## Scope warning

This roadmap is large by design; it is not a commitment to build all of it immediately. The best next outcome is a reliable, accessible, measurable training loop—not an endless feature list. The new drill mode is the first step; the next major feature should improve the accuracy of its feedback, not just add another menu.
