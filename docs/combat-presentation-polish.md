# Combat presentation polish

A focused follow-up to tactical positioning: improve movement readability, weapon handling and hit confirmation without changing the 26 × 32 Arena, controls or weapon balance.

## Bot locomotion

`src/bot-animation.js` holds one cached visual pose per character. The pose uses actual horizontal velocity transformed into the rendered body's frame:

- Forward, backward and lateral movement produce different thigh rotations. Lateral angles are bounded to avoid excessive leg crossing while strafing.
- Knee recovery scales with movement speed. Stationary bots no longer cycle their knees or root bob merely because the idle clock advances.
- Hip, knee, crouch and airborne poses ease instead of snapping at a stance boundary.
- A small, bounded landing compression uses the previous falling speed and decays after contact.
- Zero is a valid distance-driven animation phase, rather than a reason to fall back to the idle clock.

The existing upper-body aim, arm IK, cached melee rigs and death animation remain in place. The pose does not modify actor position, velocity, hitboxes, collision or navigation. It allocates no new meshes or materials per update.

## First-person handling

Ranged weapons, excluding the Bow and quick-melee model, get a small running carry when moving forward quickly: a 0.035-unit lower hold with a restrained tilt. A critically damped spring blends it in and out. ADS, recent fire, reload, swapping, slide, airborne movement, guard, swing, dash, heal, throw and inspect suppress the carry. Equipping resets its spring. Shake off also disables it.

This is **model-space motion only**. It does not change camera yaw/pitch, mouse input, bullet direction, cooldowns or movement speed. Existing ADS sight alignment remains in place. It is not a new sprint or Shift mechanic.

## Hit and elimination feedback

The same small center marker now distinguishes:

- Body hit: white, 160 ms.
- Head hit: amber, slightly larger, 210 ms.
- Confirmed enemy elimination: mint, thicker and slightly larger, 300 ms.

`HitConfirmation` gives elimination > head > body priority. A lower-priority later pellet/splash event neither overwrites the stronger confirmation nor extends its expiration. A new equal/higher-priority confirmation can refresh it. Lobby/round resets clear priority and pending timers. Expiration uses real monotonic time, independently of paused simulation.

Enemy elimination confirmation is emitted by the actual centralized damage/death path, so it also works for projectile and damage-over-time deaths. The existing kill feed remains unchanged. Self-eliminations no longer increment player kill stats or play the kill reward sound. No extra permanent HUD panel, floating damage number or camera shake was added.

## Validation

- **181 Node tests pass**, including 14 new tests for idle knees, mirrored strafing, backward/yaw-relative motion, eased stances, landing bounds, constant-target 60/144 Hz convergence, running-carry limits/suppression/recovery/equip reset, hit priority/expiry/reset, genuine enemy-kill accounting and real cached-rig geometry/finite-transform checks.
- **15 browser tests pass** across combat, player controls, bot abilities, the compact Arena, high-ground routing, rendering, all 23 weapon models and disconnected production reload.
- New real-game browser coverage verifies a running rifle's lowered hold, a real shot originating at the camera with unchanged aim inputs, recovered ADS sight alignment, actual body/head/lethal bullet events, prioritized elimination feedback, feed reset and timer expiry with RAF stopped.
- The same browser test renders actual idle, lateral, crouched/slide and airborne bot poses through the WebGL world pipeline. No browser or GL errors were observed. Optional idle/strafe/slide screenshots were inspected at `/tmp/combat-polish`; these are controlled poses, not evidence of autonomous decision quality.
- The existing autonomous real-Arena high-ground test still physically reached y=6.2 and fired additional shots after arrival. The accelerated two-minute 3v3 test retained dash, slide/slide-jump, double-jump, guard/deflection, melee and rifle activity with no invalid positions.
- Production build and `git diff --check` pass.

Optional rendering screenshots:

```sh
ARENA_SCREENSHOTS=/tmp/combat-polish npm run test:browser -- tests/combat-polish.spec.js
```

Use `BROWSER_EXECUTABLE` when Chromium is installed at a custom path. Generated screenshots stay outside Git. Rendering was checked with software WebGL; this is not a hardware FPS benchmark.

## Limits

These are procedural, block-style poses, not motion capture or terrain-aware foot planting. There are no new weapon models, materials, combat balance changes or map dimensions in this pass. The trainer remains an original reconstruction, not an exact Roblox RIVALS implementation.
