# Earlier compromise: immediate slides and quicker movement

> **Superseded:** the user explicitly chose to restore the earlier movement, not keep this compromise. See [current movement restoration](movement-restoration.md).

This revision supersedes the previous controlled/flowing-slide settings. The user found the movement too slow, slides still too short, and the run-up/cooldown prevented an immediate slide. The goal is to restore a faster, fluid feel while staying slightly below the earlier high-speed running/air-control tuning—not to restore oversized jumps or camera snaps.

## Current tuning

| Parameter                    | Last version | Earlier faster reference |            Now |
| ---------------------------- | -----------: | -----------------------: | -------------: |
| Run / melee speed            |      8 / 9.2 |                10.6 / 12 | **9.6 / 10.8** |
| Ground acceleration          |           80 |                      105 |        **100** |
| Air acceleration             |           22 |                       34 |         **28** |
| Air turn rate                |    4.5 rad/s |                7.5 rad/s |    **6 rad/s** |
| Air reverse acceleration     |           48 |                       75 |         **60** |
| Maximum slide time           |        0.8 s |                        — |      **1.5 s** |
| Minimum run-up speed         |          4.5 |                        — |       **None** |
| Post-slide cooldown          |          1 s |                        — |       **None** |
| Slide entry floor / cap      |   6.6 / 11.8 |                 8 / 16.5 |  **10.4 / 13** |
| Running slide entry          |          9.4 |                       13 |       **11.2** |
| Forward/lateral slide cruise |          6.4 |                        — |        **8.2** |
| Slide coast drag             |          2/s |                        — |      **1.2/s** |
| Counter-input brake drag     |        8.5/s |                        — |       **10/s** |
| Slide turn rate              |    2.8 rad/s |                        — |  **3.6 rad/s** |

Jump remains **7.8** (about **1.01 units** high), extra jump **7.6**, ground braking **125**, counter-strafe acceleration **130**, air cap **28** and ramp assistance capped at **0.8**. Camera bob, landing dip and the restrained 0.8-degree slide FOV effect are unchanged. No weapon, health, damage, inventory, hit-registration or network grammar changes.

## Controls and safeguards

- **Tap C, Shift or Ctrl to slide immediately on the ground**, including from rest. No sprint-up or low-speed input retry is needed. At rest, held movement chooses the direction; without WASD, the slide follows your look yaw. Once moving, velocity determines entry direction so momentum is retained. A pure numeric `startSlide` helper is shared with bots and authoritative player simulation; it handles zero velocity without dividing by zero.
- **Release WASD to coast**, hold forward/lateral input to sustain a flowing glide, or counter-steer to brake. A standing no-input tap starts at 10.4 and travels about **6.98 units**; a normal running no-input slide starts at 11.2 and coasts about **7.65 units**, rather than the last version's 3.68. On a flat open lane, holding forward covers about **14.38 units at 1.5 seconds**, then returns to normal running. These are controlled trainer units, not Roblox measurements.
- **Jump cancels immediately and keeps horizontal momentum.** Dash still cancels. After cancellation/landing, a new tap is immediately available; there is no hidden one-second lockout. An airborne press uses the existing short landing buffer, without creating an air slide or mid-air boost.
- **Extra presses during an active slide do nothing**: they cannot refresh its timer, reapply entry boost or stack speed. An expired airborne request cannot unexpectedly activate later. Holding a key still cannot auto-bunnyhop or repeatedly retrigger slides.
- Slide hitbox lowers on the input edge. Collision, headroom and jump buffering stay in place; forward steering does not manufacture uphill momentum once slowed below cruise speed. The shared helper is used by offline prediction, browser-worker authority and optional dedicated authority. Bots retain difficulty-specific run speeds, their deliberate mobility decisions and clearance checks.

## Validation

New regressions cover immediate standing/slow starts (including existing cooldown values), no-WASD look direction, finite zero-velocity entry, active-press anti-stacking, jump-cancel/re-slide on landing, expired airborne requests, and authority action-edge execution/deduplication. Movement assertions now explicitly check the new speed and much longer travel instead of retaining the superseded slow constants. Existing held-Space behavior, modest jump apex, frame-rate invariance, collision, stable aim, explosive momentum and network historical reconciliation remain tested.

**532/532 unit tests and the production build passed.** **Seven distinct browser scenarios passed** across a six-case production-assets sweep and a two-case final run (the instant-slide case was repeated). They cover actual C/Shift standing starts, no active-slide boost stacking, immediate jump cancellation and re-slide, the much longer coast, opposite-input braking, stable jump/aim/FOV, stairs/slide-jump/landing buffers, disconnected production reload, static-only invite/play/leave, six real RTC clients firing and delayed/lossy host/guest movement. The final run repeated immediate-slide input and validated the updated live-locomotion distance/slide-jump assertions.

The delayed/lossy RTC case measured host travel **31.073 units**, guest **30.478** (about **1.92% less**), **zero backwards steps**, and local movement response **0–16.1 / 0–8 ms**. These are frozen-render transport/physics measurements, not a GPU benchmark. The six-client combat case retained **zero trace/impact events on reliable control**, with all guests receiving 61 new snapshots over its combat sample. No zero-latency or public-network guarantee is implied. Local RTC tests exercise real data channels with test-injected delay/loss, not public cloud signaling, six GPU clients or Internet-wide performance. Both peers should refresh the updated frontend and start a fresh lobby; a Git push does not verify deployment of an independently published site.
