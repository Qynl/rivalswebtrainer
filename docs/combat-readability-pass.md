# Movement, tactics and combat readability

Follow-up to the earlier movement/graphics pass, on 15 October 2026.

## Gameplay and animation

- The game loop now advances physics at **1/120 second**, independent of render rate. Existing interpolation is retained. A deterministic test runs 30, 60 and 144 render callbacks per second and checks exactly 120 equal simulation steps. This is not a hardware-FPS promise. The existing 0.2-second catch-up budget remains bounded.
- Seven iron-sighted guns now carry an authored rear sight and front-fibre aiming point. ADS springs bring both points to the screen centre using the model's actual scale. Their notch geometry is open and proportioned for compact vs long guns. Tests check both points, not just a convenient root coordinate. Real-browser verification projects the actual rifle sight through the weapon camera.
- Bot arms now have shoulder, elbow and hand joints. An analytic two-bone solver maintains bone lengths and clamps unreachable targets; the support hand follows the rifle during aiming/reloading. Targets are solved in the shared upper-body space, avoiding repeated whole-skeleton world-matrix updates. The previous negative-X rotations pointed the old arms behind the gun.
- Bots evaluate up to three nearby opponents at a decision, prefer visible targets with modest stickiness, and reset reaction progress immediately when sight is lost—not just on the next decision. Hidden opponents do not drive head pitch.
- Reloading, low health and recent damage can initiate a local cover search. At most 24 grid candidates are considered, and up to three complete routes are tested. Chosen cover must occlude the last observed threat and have a walkable route; an already-safe actor can hold position. Teammates and their reserved cover goals contribute a crowd penalty. Cover holds and replanning have bounded timers, rather than permanent camping.
- Threat memory expires after 3.5 seconds without observation. Team separation and eased bot velocity changes reduce stacking/instant sideways reversals. Difficulty reaction/accuracy settings were not replaced with perfect aim.

## Combat feedback

- Spatial gunfire, nearby enemy/ally footsteps and explosions use heading-relative stereo and distance attenuation. Solid cover muffles gunfire; smoke does not act as an acoustic wall. Environmental sound channels are limited to 32, with lifetimes matched to the actual sound envelope rather than retaining every rifle channel for a full second. Round/menu/pause transitions disconnect them.
- Damage directions are stored as four reused world-position slots. The short arcs rotate correctly as the camera turns, merge nearby bearings and fade. Self/environment damage without a meaningful direction does not invent an attacker. Explosion/fire feedback uses the impact position while kill credit still uses the owner.
- Crosshair gap reflects weapon spread, ADS multiplier, airborne multiplier and viewport projection, with a stable centre dot and bounded expansion. Sniper scope hides the extra crosshair. Headshots use a crisp SVG marker rather than the platform-dependent text glyph.
- No camera shake, angle recoil, or automatic changes to mouse aim were introduced.

## Arena visuals

A cached 512×512 locally drawn stencil atlas supplies north/south numbers and ramp/crossing labels. Muted coral/blue floor routes and low base trims improve orientation without adding more cover, changing wall heights, widening the Arena, or modifying hit/collision geometry. The dressing is merged into **two additional material batches**; the original fixed Arena geometry remains **64 → 6**, with **38 original exact ray meshes retained**. These are draw-submission counts, not measured FPS gains.

## Validation

- **124/124 unit tests passed.** New coverage includes damage bearings/pool/expiry, projected ADS/air spread, spatial attenuation and 32-channel cleanup, visible-target preference, reachable cover, route completion, singular/unreachable IK targets, real rifle-grip positions, hidden-head tracking, immediate lost-sight reaction reset, actual ADS alignment, and the fixed timestep.
- **11/11 browser tests passed** in one final full run (2 minutes), including the offline production reload, two-minute simulated 3v3 navigation/combat, live locomotion, mouse/slide/F/Katana controls, all 23 rendered weapon models, bloom/contact shading and the new in-game readability/audio/ADS check.
- Production build passed. The browser suite also rebuilds production before testing offline caching.
- Final visual audit captured **13 full-size frames**, including Rifle and Handgun ADS, without page/shader/WebGL errors. Their rear/front sights and the revised bot hand pose were personally inspected. Reported scene resources: 49 geometries / 14 textures. Screenshots are deliberately outside Git.
- The all-weapon GPU stress test kept geometry allocations unchanged at **50 → 50** during 500 pooled impacts/bursts.
- Final isolated two-minute resource check **passed**: **126 seconds**, **14 complete 23-item batches**, **57,960 simulation updates** and **322 actual world/weapon render pairs**, with **no page/console/WebGL errors**, exit 0. Reported end-of-batch GPU geometry stayed **28–29**, textures **14** and programs **25**. It advances each weapon through 180 simulation steps at 120 Hz per batch. Audio/shadows are disabled and render resolution is halved; sky, contact shading and HDR bloom remain active. Camera visibility varies, so this count is not a full-scene mesh total or a hardware benchmark.
- A separate actual Arena render confirmed all **six entities** present (player plus five target rigs), finite rig transforms, and **124 allocated geometries / 14 textures** in that controlled scene. The smaller end-of-batch soak count must not be mistaken for every target being on-screen in every view.

The earlier ten-minute result in `hour-pass.md` belongs to that earlier revision, not this follow-up. Bots still use ground-grid navigation: this is not human-equivalent AI, advanced rooftop planning or verified frame-perfect Roblox behaviour. Browser audio tests verify the graph and channels, not a human listening assessment.
