# Arena reconstruction notes — 15 October 2026

## What was checked

1. [Arena wiki page and gallery](https://robloxrivals.fandom.com/wiki/Arena): the standard map is grid-based, with angled cover. The gallery contains the overhead layout (`Screenshot_2025-05-10_211723.png`) and a side view.
2. [Maps overview](https://robloxrivals.fandom.com/wiki/Maps): Arena is mirrored, opposing spawn areas face each other, and ramps exist on both sides. It has no explosive-barrel/window-breaking gimmicks.
3. [Big Arena](https://robloxrivals.fandom.com/wiki/Big_Arena): a separate, larger and more complex mirrored map for bigger teams. It is not the target for this rebuild.
4. [RIVALS gameplay overview](https://roblox.fandom.com/wiki/Nosniy_Games/RIVALS): crouch-sliding, explosive boosts and upward ramp slides are movement mechanics. Fists have an extra jump; Scythe has a directional dash; Katana reflects bullets.
5. [Assault Rifle overview / trivia](https://robloxrivals.fandom.com/wiki/Assault_Rifle): the default gun is described as SCAR-L-based. The trainer keeps an original procedural model, with a tan receiver, dark furniture, sights, ejection port and a moving magazine/bolt rather than importing the game's mesh.

Searches also examined community movement descriptions and several first-person/reference thumbnails. Low-resolution images, third-party settings articles and anecdotal movement guides were not treated as authoritative measurements or frame-by-frame animation specifications.

## Important limits

No trustworthy published dimensions, Roblox stud measurements, collision export or original animation timings were found. **The numbers in `src/arena-layout.js` are trainer tuning values, not verified measurements of Roblox Arena.** The geometry, materials, animations and implementation are original. This remains a reference-informed trainer, not a pixel-perfect Roblox recreation.

## Concrete changes from the previous build

| Item                  | Previous                              | Revised                                                                 |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Playable floor        | 48 × 64 trainer metres                | 32 × 42 (56.25% less floor area)                                        |
| Perimeter wall height | 16.8                                  | 19.2                                                                    |
| Main interior cover   | Mostly 2.1–4.0 high                   | Main diagonal cover 4.6 high                                            |
| Layout fairness       | Individually positioned pieces        | One half repeated by 180-degree rotation                                |
| Vertical routes       | Central stairs; no actual ramp slopes | Two opposing 4.4-rise / 6.4-run ramp banks                              |
| Window cover          | One large arch-like central piece     | Mirrored window walls near spawns and through the centre                |
| Ramp collision        | Not implemented                       | A continuous heightfield shared by movement, support, clearance and nav |
| Jump feel             | Gravity 22 / launch 12.3              | Gravity 30 / launch 14.3: similar height, shorter hang time             |
| Ground slide          | 0.4 seconds                           | Now 0.36 seconds, with slope response and landing buffering             |
| Weapon reload         | Whole-model fixed tilt                | Timed extraction, insertion, bolt rack and support-hand motion          |
| Equip / ADS           | Position changes with frame lerp      | Exact critically damped springs                                         |
| Bot walk cycle        | Rotating meshes around their centres  | Hip/shoulder pivots and distance-driven strides                         |

## Rendering decisions

- A clearer blue sky, neutral fill, warmer sun, and a separate cool rim light for the weapon overlay rather than strong purple lighting.
- Darker matte floor, panel seams with subtle slab-to-slab variation, contact shadows and dynamic sun shadows.
- The depth-aware finishing pipeline adds 12-tap local ambient occlusion, restrained sharpening, quarter-resolution soft HDR bloom and a neutral grade. The world render target uses two-sample MSAA; weapons are drawn afterwards. Performance mode bypasses the pipeline.
- Softer sky wisps instead of repeated hard-edged cloud stamps.
- Static weapon details are batched by material; moving parts remain separate. The first-person rifle initially fell from 51 to 17 meshes, then 23 with additional side hardware and articulated black/white sleeves; sleeve batching in the latest pass uses 21 (node traversal measurements). This reduces weapon draw submissions; it is **not** a claim of a threefold frame-rate improvement.
- Compact HUD and pre-match wizard retained; no extra permanent animation/debug panels.
- All content is generated locally and remains available offline after production caching.

## Validation strategy

Unit tests cover ramp ascent/descent, side blocking, ceiling clearance, launch momentum, slope-aware navigation, exact spring integration at 30/60/144 Hz, repeated reload reset, geometry batching and limb pivots. Browser tests also check the actual generated layout is mirrored, ramp traversal remains grounded, window apertures can be traversed, and live reload/inspect controls work.

The optional `npm run test:soak -- --minutes 10` repeatedly exercises all 23 loadout items, movement, jumping, effects, projectile cleanup, weapon re-equipping and real WebGL draws. It checks finite entity state and bounded geometry/texture/program allocations. It is a stability/resource check on software-rendered Chromium, not a hardware FPS benchmark. The user explicitly limited this validation to ten minutes. The accelerated run uses half-resolution rendering, audio and dynamic shadows disabled, and the depth-aware world pass enabled. Each rendered model is checked against its requested weapon ID, including consecutive same-slot items; WebGL errors are checked after each draw.

## Latest graphics and animation pass

- Reload presentation now raises and banks the receiver while the support hand tracks the magazine; the wrist and sleeve articulate separately, and the shotgun hand follows the pump.
- Equipping starts below the frame; firing adds a short local impulse, and movement adds modest jump/landing and lateral weapon inertia. These are weapon-space changes, not mouse pitch/yaw recoil.
- Fists/knife use forward jabs; Katana/Scythe retain sweeping cuts with a short fading blade trail. Utility throws have a follow-through.
- Bot deaths ease into a fall over 0.3 seconds at their current platform height, including the round-ending elimination. This is an authored collapse, not a physics ragdoll.
- A real WebGL regression scene compares occlusion on/off pixel output, checks target resizing and GL errors, and verifies the Performance-mode bypass. Unit tests cover equip/reload recovery, trail cleanup and platform-height death easing.

See [the one-hour implementation pass](hour-pass.md) for the newer movement, batching, procedural sky, skeletal rig, detailed-model and fixed-pool combat-effects changes and their validation.
