# Player models, gun feedback and multiplayer responsiveness

## Visible operators

The shared bot/remote-player rig gains articulated feet, a breathing chest, velocity/turn-driven torso motion, head counter-roll and blinking. Existing IK hands, slide/air/landing poses, reloads, melee abilities, Knife reverse grip, remote held weapons and Sniper scope glints remain in use.

Team panels are larger and more contrasting on the front/back, shoulders and legs. These are normally depth-tested materials, not through-wall outlines. The head is lowered into better alignment with the damage region; movement collision and player scale are unchanged. Bullet bounds expand from ±0.40 to ±0.46 horizontally and ±0.34 to ±0.36 in depth, shared by offline and browser/dedicated authority. HP, damage, fire rate and headshot multipliers are not changed.

Confirmed damage drives an armor flash, body flinch, contact particles, hit markers and floating damage. Offline and remote operators share the pose code. Cosmetic animation never writes an actor's physical position or aim.

## Every primary/secondary weapon

All 17 primary/secondary IDs have explicit kick-back, pitch, roll, recovery, ADS and lens-impulse profiles. Shotgun, Shorty, Revolver and Sniper are heavier; SMG/Uzi/Minigun are faster; Bow release and sustained Flamethrower retain their distinct behavior. Recoil is time-based and returns to rest rather than accumulating permanent aim drift.

The muzzle effect now includes a frontal crown and crossed gas jets in one mesh/draw, so another player's flash remains visible side-on. Mechanisms, dual-pistol alternation, ejected casings and muzzle lighting remain attached to the firing weapon. Sniper's report has a sharper transient and lower body/tail than Shotgun.

Scoped Sniper no longer depends only on a hidden viewmodel for feedback: a bounded lens/FOV impulse and scope-rim response show the shot. Other guns open the existing reticle briefly. The bullet direction and stored camera yaw/pitch are unchanged; there is no artificial upward mouse snap. Disabling motion/shake disables the added lens/FOV movement, while the weapon still visibly fires.

## Missing multiplayer presentation fixed

Online input previously reached authority without running the local shot presentation. The client now predicts presentation for eligible trigger/automatic shots, then matches the confirmed shot to avoid a second kick/report. It does not spend authoritative ammo, invent hits or create gameplay projectiles. Confirmed burst tails and Bow release still receive presentation when not locally predicted. Reload/empty/selection/utility/stale-connection guards bound prediction; per-weapon recovery avoids delaying a sidearm after a Sniper shot.

Own confirmed traces are no longer filtered out. Confirmed wall impacts, hit flinches and kill sounds are replicated. Hit markers and damage numbers remain host-confirmed. Kill events include IDs so same-named players do not confuse new-match elimination feedback.

## Multiplayer timer and performance work

The joining player's stuck countdown came from comparing a local paused state to the authoritative playing state. Phase transitions now follow authoritative round/phase values, and paused HUD values update from received snapshots. Late/reordered snapshots cannot turn FIGHT back into “1”.

Authority moves into a browser Web Worker to separate match stepping from renderer/UI stalls, with a compatibility fallback. Online startup skips creation/disposal of five unnecessary bot rigs. A negotiated unordered, zero-retransmission data channel carries binary snapshots and disposable movement; lobby/combat messages and pending action edges remain reliable. Queues are bounded, interpolation adapts to jitter, and a stalled state lane can recover through the reliable path.

A measured ordinary six-player frame was **587 binary bytes versus 4,195 JSON bytes**, or **86% smaller**. That excludes packet headers and projectile-heavy scenes and is not a claim of 86% less total traffic or zero Internet lag. See [multiplayer](multiplayer.md) for provider, host-device and network limitations.

## Regression coverage

- Unit tests cover every weapon's bounded kick/return, prediction/ack deduplication, blocked firing states, sidearm switching, own traces/impacts, shared body-edge hits, immutable poses, worker lifecycle/cancellation, paused countdown transitions and adaptive state buffering.
- An actual browser fires/renders all 17 weapon models, verifies scoped Sniper response without aim drift, and samples the animated operator rig.
- Static-only two-browser tests verify real WebRTC, worker authority, countdown/HUD progress without rendering, loss/reordering and reliable fallback after a deliberately stalled state channel. A separate six-client RTC test verifies worker-authoritative 3v3 with five binary-state guests; it uses one browser with six independent network clients rather than six GPU renderers. Existing offline, weapons, Knife, utility and multiplayer compatibility checks remain separate.

These are controlled regressions, not proof that software has no bugs or that every Internet route is lag-free. The published static site still needs the updated frontend/assets to be republished; no game backend setup is required.
