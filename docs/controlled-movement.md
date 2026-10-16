# Controlled movement pass

The goal is fast, readable movement rather than constant launches and camera surges. These values supersede the earlier agility/hour-pass tuning. Physics remains shared by offline players, remote-client prediction, browser-worker authority and the optional dedicated authority.

| Parameter | Previous | Current |
| --- | ---: | ---: |
| Normal / melee run | 12.2 / 14.1 | 10.6 / 12 |
| Ground acceleration / braking / counter-strafe acceleration | 125 / 150 / 180 | 105 / 135 / 155 |
| Jump impulse | 11.2 | 9.7 |
| Flat ballistic apex (gravity 30) | 2.091 | 1.568 |
| Flat airtime | 0.747 s | 0.647 s |
| Fists/Bow extra jump impulse | 10.8 | 9.4 |
| Slide duration / cooldown | 0.36 / 0.50 s | 0.27 / 0.72 s |
| Slide entry speed floor / cap | 18.5 / 25 | 8 / 16.5 |
| Added slide speed | 5 | 2.4 |
| Minimum movement to start a slide | 2 | 5.5 |
| Air acceleration / reverse braking | 115 / 165 | 34 / 75 |
| Air heading turn rate | 16 rad/s | 7.5 rad/s |
| Ordinary air speed cap | 34 | 28 |
| Maximum ramp jump assistance | +4 | +1.5 |
| Slide FOV expansion | +6° | +2° |
| Camera walk bob | 0.018 | 0.009 |
| Maximum landing dip | 0.065 | 0.035 |

Normal running still reaches target speed in roughly 110 ms; stopping takes less than 90 ms. A straight, uninterrupted running slide travels about 2.6 units rather than 5.6, excluding subsequent running. Letting go of movement applies stronger slide drag for a deliberate exit. Slides do not reset mouse aim or forcibly turn the camera.

## Behavior fixes

- **No stacked slide-jump kick:** jumping keeps the actual slide velocity instead of multiplying it by 1.06 and adding 0.6 vertical impulse. Repeated slide-jump inputs cannot stack a second hidden launch on every jump.
- **Bounded ramp assistance:** players and bots use the same helper. Uphill motion gets a little help, downhill does not gain an upward kick, and assistance cannot exceed 1.5.
- **No stale slide request:** a too-slow slide request expires after its input buffer. Previously a grounded low-speed retry could keep rearming the buffer indefinitely, unexpectedly activating much later when movement resumed.
- **Deliberate jump presses:** holding Space no longer starts repeated hops on every landing. Fresh jump presses, the existing coyote/jump buffer and explicitly pressed Fists/Bow extra jumps still work. Jump cancels a slide as before; C/Shift/Ctrl slide bindings are unchanged.
- **Readable air control:** strafing changes heading progressively and reversing first brakes. No-input momentum is preserved. Explosive launches and ability impulses above the ordinary cap are not abruptly truncated; this preserves aerial Knife/rocket trickshots.
- **Same pace for bots:** difficulty run speeds change from 7/9.5/11/12.5 to 6.2/8.3/9.6/10.9. Shared slide/jump/air mechanics are used; combat accuracy, tactics, utility use, health and damage are unchanged.

## Validation

New unit regressions cover measured acceleration/stopping, slide travel/cooldown, low-speed buffer expiry, repeated slide-jump caps, jump apex/airtime, held-key landing behavior, gradual air direction changes, release-to-brake, retained explosive momentum, player/bot ramp parity and unchanged aim under the reduced FOV effect. An authoritative-input test additionally holds the network Space bit and repeats an acknowledged jump action: it must not cause extra jumps.

The new browser regression uses actual C, Shift, Space and movement keyboard events, checks a short slide and jump cancellation, holds Space through landing, presses again, and renders the resulting frame with no WebGL error. Existing stairs/ramp/collision, offline reload, real RTC multiplayer (including six-client 3v3), and explosive-launch/Knife tests are checked separately. Test measurements use controlled local scenarios, not a claim of Internet-wide responsiveness.

Completed checks: **397/397 unit tests**, **9/9 browser scenarios** (controlled keys, real-map stairs/slides, disconnected production reload, four real RTC scenarios including 3v3, and two trickshot/model scenarios), production build, and `git diff --check`. Local controlled testing does not verify every Internet connection or republish the external static site.
