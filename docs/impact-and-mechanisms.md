# Impact and weapon-mechanism polish

A focused combat-feedback pass. The compact 26 × 32 Arena, taller geometry, player controls, weapon balance and bot decision rules are unchanged.

## Surface impacts

Concrete bullet impacts now emit six small angular chips, four expanding dust particles and two brief warm flecks instead of using only round debris. The single existing particle shader renders the different shapes, with a per-slot style/rotation attribute. Existing impact decals remain in place.

Emission is constrained to the outward surface hemisphere, including ceiling and non-unit normals. This fixes debris initially travelling back into the hit wall. Chips get short cosmetic ground/raised-support bounces; dust drifts and fades, and the warm flecks disappear quickly. The generic flesh/explosion burst keeps its original round style.

Effects reuse the existing four scene objects and GPU buffers. Limits remain 384 particles, 64 traces, 128 decals and 48 casings; sustained fire wraps the pools instead of creating new meshes/materials per hit. Clearing now also resets activity counters. Invalid or nonpositive effect time steps are ignored.

These are stylized cosmetic particles, not destructible geometry or gameplay projectiles. Chip support checks are not a complete swept collision solution against every vertical obstacle. There is no promise of material-specific metal/wood effects on other maps.

## Weapon mechanisms

`mechanismPose` samples short, bounded cycles from time since the last shot:

- Bolt travel peaks at 18 ms and returns by 85 ms. Continued weapon recoil no longer leaves the bolt permanently pulled back during automatic fire.
- Pump travel starts after 45 ms, peaks at 145 ms and returns by 310 ms. The support hand uses the same displacement rather than a separate approximation.
- The Handgun now has a retained moving magazine. Its irons and slide serrations are attached to the slide, not the static frame.
- An empty Handgun slide stays open through magazine insertion and releases during the final reload rack. Equipping/showroom defaults remain at rest when ammunition state is not supplied.

The animated parts are reset from their stored rest transforms each update, preventing accumulated drift. This does not change firing intervals, magazine capacity, reload duration, bullet origin/direction, camera aim, weapon selection or quick melee.

## Validation

- **193 Node tests pass**, including 12 new tests covering bounded mechanism cycles, per-shot bolt recovery under sustained recoil, pump/hand synchronization, empty-slide/reload behavior, rate-independent sampled mechanisms, mixed impact styles, outward emission, dust growth, generic burst reuse, raised-platform chip support, pool/resource stability, clearing, zero normals and invalid time steps.
- **16 browser tests pass**. The complete suite retains actual bot abilities, accelerated two-minute 3v3 combat with no invalid positions, autonomous high-ground ascent/fire, compact-map connectivity, player movement/input checks, all 23 rendered weapon models and production reload with networking disabled.
- New real-game browser coverage fires the Handgun's last round, observes the locked slide, runs its real reload to 12 rounds, checks 0.28-unit magazine extraction and exact mechanism restoration. It then fires a real rifle ray at an Arena wall and verifies the 6/4/2 particle styles.
- The impact test compares actual WebGL frames with the particle pool hidden/visible while holding other effects fixed. The final full-suite run observed 51 changed pixels, four retained FX scene objects and zero WebGL errors. Particle layout varies randomly; pixel count is not a performance benchmark.
- Production build and whitespace validation pass. A controlled impact/Handgun frame was inspected; screenshots remain outside Git.

Optional screenshot:

```sh
ARENA_SCREENSHOTS=/tmp/impact-polish npm run test:browser -- tests/impact-mechanisms.spec.js
```

Set `BROWSER_EXECUTABLE` for a custom Chromium path. Validation used software WebGL, not a hardware FPS benchmark. This pass does not introduce photorealistic assets, new weapons, AI capabilities or a claim of exact Roblox RIVALS recreation.
