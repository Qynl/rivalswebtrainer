# Quick utility and gameplay improvement work log

Requested scope: G quick utility, a substantial overall improvement pass, and at least six hours of tracked work.

Actual work started: **2026-10-15T20:00:15Z** (22:00:15 Europe/Berlin).

Requested six-hour mark: **2026-10-16T02:00:15Z** (04:00:15 Europe/Berlin). That mark has not been reached at the checkpoints below.

This log records elapsed wall time and actual completed work. It is not a claim that a six-hour overnight run has completed. No idle timer or unattended process is counted as implementation work.

## Implementation scope

1. G quick use for every equipped utility, keeping the selected gun/melee slot; shared finite inventory, cancellation, quick Medkit, per-slot recovery, offline and authoritative multiplayer.
2. Compact F/G status and real action progress; clear cancellation/empty/recovery feedback without adding large HUD panels.
3. Combat input responsiveness during weapon recovery/switching, without changing mouse aim or allowing extra shots.
4. Visible utility presentation and more capable hazard-aware opponents.
5. Unit, Chromium, production/offline and multiplayer regression validation; inspect real renders and push the changes.

## Progress

- 20:00 UTC: inspected input, quick melee, throw/heal lifecycle, per-slot recovery, compact snapshot format, multiplayer authority and existing regression harnesses.

- 20:03 UTC: implemented G quick utility, shared finite inventory/recovery, cancellation, quick Medkit and compact snapshot flag/client reconciliation. First existing 280-test suite passed.
- 20:05 UTC: compact F/G chips, utility feedback, actual action progress and guide controls; production build passed.
- 20:09 UTC: bounded hazard-perception/escape planner and procedural billowing smoke integrated in offline and online presentation.
- 20:12 UTC: quick-utility, input-buffer, smoke, trails and hazard unit scenarios implemented; identified and fixed a hazard-call argument bug with an actual reaction test.
- 20:15 UTC: first real G/Smoke Chromium checks passed. Screenshot review caught an initially off-screen quick-throw draw; added a dedicated quick-draw pose and a projected-geometry regression.
- 20:17 UTC: repeated G/Smoke checks passed; inspected actual grenade-in-hand and smoke exterior/interior screenshots.
- 20:20 UTC: two real online clients validated authoritative G inventory, remote held utility, server projectile and return to the original sniper; all three existing multiplayer browser checks passed.
- 20:23 UTC: death/pause cancellation fixes, empty-burst reload and actual elite-bot grenade-avoidance browser scenario passed. Full unit suite reached 314 passing tests.
- 20:25 UTC: 32/16-puff smoke quality handling and mesh-owned instance-buffer disposal regression added; 315 Node tests pass. Production build passes.
- 20:26 UTC: full single-worker Chromium suite started, including production disconnected reload and both online clients. Source changes are frozen during that run.
- 20:38 UTC: complete Chromium suite finished successfully: 32/32. Core checkpoint **f52db56** pushed before further quick-action allocation work.
- 20:39 UTC: lazy two-item F/G model cache, eviction and round/lobby disposal implemented; 100 alternating model-reuse/geometry-identity scenarios pass. Blinded bots now clear cached hazard perception before the throttle check. **317/317 Node tests passed** in 12.01 seconds.
- 20:40 UTC: latest-code dev/server restarted; ten targeted browser regressions started. The ten-minute stability harness now exercises real F/G actions on primary/secondary slots, all five utilities across batches, bounded model counts and released-body pose reset.
- 20:43 UTC: nine targeted browser checks passed; the new cache test incorrectly assumed the weapon scene contained no lights. Corrected the assertion to compare against its real baseline (not a fixed child count), added repeated actual G grenade/body-visible checks, and restarted all ten targeted checks.
- 20:46 UTC: **10/10 targeted browser checks passed in 2.5 minutes**, including eighty rendered cached F/G swaps with zero warmed-geometry growth and lobby disposal. Started the ten-minute all-weapon/quick-action stability check.
- 20:47 UTC: final Node run **317/317 passed** (33.45 seconds while software-WebGL stability work ran).
- 20:55 UTC: original unyielding stress run **failed after 549 seconds**, 20 batches / 93,600 simulation steps / 620 successful quick uses. Kernel log confirms an OS OOM kill of Chromium (renderer anonymous RSS 2,521,784 KiB), not an assertion or WebGL failure. GPU counters were still bounded at 391–392 geometries / 20 textures / 50–51 programs. This failed run is not counted as a passing ten-minute check.
- 20:58 UTC: updated the stress harness to yield a browser frame between equipped weapons, as real play does, instead of monopolizing the main thread across all 26. Added precise JS-heap and optional Linux renderer-RSS diagnostics; no forced garbage collection or app quality removal. Started a new configured ten-minute check to test the scheduling-starvation hypothesis. At the first nine batches (286 seconds), renderer RSS stays about 568–593 thousand KiB and measured JS heap about 55–81 MB, rather than growing towards the earlier kill threshold.

- 21:08 UTC: the corrected frame-yielding stability run passed at 21:08:29Z, after 618 seconds. Memory remains far below the failed unyielding run; unchanged gameplay/geometry quality, with no forced garbage collection.

## Delivered design details

- G is a reliable, validated `utility` action, not client-authored damage/projectile data.
- A spare player flag carries quick utility, reusing existing throw/heal timers. Protocol 2, binary grammar 1, stable weapon IDs and ordinary 587-byte 3v3 snapshots are retained.
- A 140 ms gun-request buffer contains a single click for the current weapon only; successful fire, weapon changes, quick utility and pause clear it. Burst shots still obey their own magazine/recovery rules.
- Visible-hazard search is bounded to 64 projectiles/24 fire zones, at roughly 8 Hz per bot; at most four threats and eight local escape probes are evaluated. Friendly, hidden, distant and different-floor hazards are filtered out.
- Travel traces reuse the fixed 64-trace pool and reject long network-correction jumps. Smoke owns one instanced mesh and shader, with no downloaded textures or per-frame geometry allocation. Disposal now also releases mesh-owned instance buffers.
- Offhand F/G models are lazily cached for only the current melee and utility; old loadout items and round/lobby cleanup release their resources. Cached props reset their windup/release state on reuse.
- Original Bow body alignment, 150 HP, Knife front/rear rules, F abilities, explosive self-immunity/launches, all 26 weapons, maps and movement settings are preserved.

## Validation status

- Latest unit run: **317/317 passed** (33.45 seconds alongside software WebGL; prior identical run 12.01 seconds). Previous core run: 315/315.
- Original focused G/Smoke checks: **3/3 passed**, including all five utilities, actual rendered models, compact 390-pixel HUD, smoke interior/exterior, and an actual elite bot evading a visible grenade.
- Focused multiplayer: **3/3 passed**, including G through two actual browser clients and server-side inventory/projectiles.
- Final cache/blindness follow-up browser regressions: **10/10 passed**, including all five utilities, repeat grenade visibility, cached render/disposal, real multiplayer, F/deflect/mouse controls and Bow/trickshots.
- Production build: passed (latest 3.40 seconds). Existing Vite shared-chunk warning remains; no new dependency was added.
- Full single-worker browser suite on **f52db56**: **32/32 passed in 11.9 minutes**, including offline production reload, G through two real clients, all 26 rendered weapons, movement, Bow and trickshot regressions.
- Final configured ten-minute frame-yielding stability check: **passed**, actual **618 seconds** (finishes its last complete batch), 20 complete rosters / **93,600 simulation steps** / **620 successful F/G actions**. All 26 weapons render each batch; no runtime/WebGL/pose/finite-state/cache assertions failed.
- Retry GPU resources: **391–392 geometries, 20 textures, 50–51 programs**, at most two cached offhand models. Precise JS heap **44,512,497–82,553,435 bytes**; renderer RSS **568,404–605,268 KiB**, with no forced GC. The realistic frame-yielding schedule prevented the OOM in this run; this is not a guarantee against every production memory issue.

No claim is made here about hardware FPS, native UDP transport, exact Roblox equivalence, or six hours of completed work. Chromium validation uses software WebGL; this environment uses the WebSocket multiplayer fallback.

## Actual elapsed checkpoint

- Start: **2026-10-15T20:00:15Z**.
- Final pre-push checkpoint: **2026-10-15T21:09:08Z**.
- Tracked elapsed wall time: **1 hour 8 minutes 53 seconds**, including implementation, review, automated validation and OOM diagnosis/retest.
- **The requested six-hour duration has not been completed.** This report does not claim continued unattended development after the turn.
- Core implementation already pushed as **f52db56**; the cache, blindness fairness, realistic stress harness and final record are the follow-up change.
