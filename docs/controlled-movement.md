# Controlled movement pass

The goal is fast, readable movement rather than constant launches and camera surges. These values supersede the earlier agility/hour-pass tuning. Physics remains shared by offline players, remote-client prediction, browser-worker authority and the optional dedicated authority.

| Parameter                                                   |        Previous |                       Current |
| ----------------------------------------------------------- | --------------: | ----------------------------: |
| Normal / melee run                                          |       10.6 / 12 |                       8 / 9.2 |
| Ground acceleration / braking / counter-strafe acceleration | 105 / 135 / 155 |                80 / 125 / 130 |
| Jump impulse                                                |             9.7 |                           7.8 |
| Flat ballistic apex (gravity 30)                            |           1.568 |                         1.014 |
| Flat airtime                                                |         0.647 s |                       0.520 s |
| Fists/Bow extra jump impulse                                |             9.4 |                           7.6 |
| Slide duration / cooldown                                   |   0.27 / 0.72 s |                 0.19 / 1.00 s |
| Slide entry speed floor / cap                               |        8 / 16.5 |                    6.6 / 11.8 |
| Added slide speed                                           |             2.4 |                           1.4 |
| Minimum movement to start a slide                           |             5.5 |                           4.5 |
| Air acceleration / reverse braking                          |         34 / 75 |                       22 / 48 |
| Air heading turn rate                                       |       7.5 rad/s |                     4.5 rad/s |
| Ordinary air speed cap                                      |              28 | 28 (preserve explosive carry) |
| Maximum ramp jump assistance                                |            +1.5 |                          +0.8 |
| Slide FOV expansion                                         |             +2° |                         +0.8° |
| Camera walk bob                                             |           0.009 |                         0.004 |
| Maximum landing dip                                         |           0.035 |                         0.018 |

Normal running reaches target speed in roughly 100 ms; stopping takes about 64 ms. A normal full-speed slide starts at 9.4 rather than 13 and travels roughly 1.4 units rather than 2.6, excluding subsequent running. Letting go of movement applies stronger slide drag for a deliberate exit. Slides do not reset mouse aim or forcibly turn the camera. These values supersede the first controlled pass as requested: running, jumping, slide bursts, air steering and camera motion are all less exaggerated.

## Behavior fixes

- **No stacked slide-jump kick:** jumping keeps the actual slide velocity instead of multiplying it by 1.06 and adding 0.6 vertical impulse. Repeated slide-jump inputs cannot stack a second hidden launch on every jump.
- **Bounded ramp assistance:** players and bots use the same helper. Uphill motion gets a little help, downhill does not gain an upward kick, and assistance cannot exceed 0.8.
- **No stale slide request:** a too-slow slide request expires after its input buffer. Previously a grounded low-speed retry could keep rearming the buffer indefinitely, unexpectedly activating much later when movement resumed.
- **Deliberate jump presses:** holding Space no longer starts repeated hops on every landing. Fresh jump presses, the existing coyote/jump buffer and explicitly pressed Fists/Bow extra jumps still work. Jump cancels a slide as before; C/Shift/Ctrl slide bindings are unchanged.
- **Readable air control:** strafing changes heading progressively and reversing first brakes. No-input momentum is preserved. Explosive launches and ability impulses above the ordinary cap are not abruptly truncated; this preserves aerial Knife/rocket trickshots.
- **Shared mechanics for bots:** bots use the reduced jump, slide and air-control mechanics. Difficulty-specific bot run speeds and combat accuracy, tactics, utility use, health and damage are unchanged in this pass.

## Validation

New unit regressions cover measured acceleration/stopping, slide travel/cooldown, low-speed buffer expiry, repeated slide-jump caps, jump apex/airtime, held-key landing behavior, gradual air direction changes, release-to-brake, retained explosive momentum, player/bot ramp parity and unchanged aim under the reduced FOV effect. An authoritative-input test additionally holds the network Space bit and repeats an acknowledged jump action: it must not cause extra jumps.

The new browser regression uses actual C, Shift, Space and movement keyboard events, checks a short slide and jump cancellation, holds Space through landing, presses again, and renders the resulting frame with no WebGL error. Existing stairs/ramp/collision, offline reload, real RTC multiplayer (including six-client 3v3), and explosive-launch/Knife tests are checked separately. Test measurements use controlled local scenarios, not a claim of Internet-wide responsiveness.

Previous controlled-pass checks: **397/397 unit tests**, **9/9 browser scenarios** (controlled keys, real-map stairs/slides, disconnected production reload, four real RTC scenarios including 3v3, and two trickshot/model scenarios), production build, and `git diff --check`. Local controlled testing does not verify every Internet connection or republish the external static site.

Current joining-player/movement pass: **477/477 unit tests** and production build passed. The real RTC adverse-network regression compares both roles under delay/jitter/loss rather than assuming a fast localhost join establishes equal responsiveness; see [multiplayer](multiplayer.md) for the measured results and transport limitations. Updated browser movement assertions check the new 8-unit run, 9.4-unit slide entry, 0.19-second slide, 0.8-degree FOV cap and approximately 1.01-unit jump.

All **49 distinct browser scenarios** were validated across the broad sweep and corrected-fixture reruns, including this updated real-key movement case, slower ramp/stair/window traversal, independent FOV baseline, all weapon/visual checks, offline production reload and real host/guest networking. The targeted delayed-guest acceptance additionally requires zero backwards steps and host/guest travel within 5% under the synthetic adverse-network trace.
