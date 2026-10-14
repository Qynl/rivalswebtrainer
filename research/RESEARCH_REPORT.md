# RIVALS movement and Arena reconstruction research

**Research pass:** 14 October 2026 (UTC)
**Target:** Roblox RIVALS, with emphasis on the compact **Arena** map and the movement sandbox milestone
**Evidence labels:** `VERIFIED`, `OBSERVED`, `INFERRED`, `UNKNOWN`

## Scope and method

I checked the official Roblox experience page, community-maintained map/mechanics pages, a community update ledger, a map reference image, and public movement tutorials whose pages expose transcripts. The pages establish the public identity of the game and describe or demonstrate techniques, but they do **not** expose the original controller implementation or a complete set of numeric physics constants.

The implementation therefore makes a deliberate distinction:

- **VERIFIED** means directly stated by a first-party page or a reproducible public source artifact. This does not mean the statement reveals hidden implementation details.
- **OBSERVED** means visible/described behavior in public footage or a public tutorial transcript. It describes an outcome, not its internal cause.
- **INFERRED** means a controller choice that plausibly produces the observed outcome.
- **UNKNOWN** means the public evidence is insufficient. No number is promoted to a fact merely because it feels plausible.

No proprietary Roblox assets, client files, decompiled code, or extracted map geometry were used. The browser map uses original modular geometry.

## Sources reviewed

| ID | Source | What it contributes | Reliability for this milestone |
| --- | --- | --- | --- |
| S1 | [Official RIVALS experience page](https://www.roblox.com/games/17625359962/RIVALS) | Identifies the experience as RIVALS by Nosniy Games and describes it as a first-person shooter with 1v1–5v5 duels. The dynamic game page was accessible but did not publish physics constants. | High for identity and broad game format; none for controller constants. |
| S2 | [Roblox Rivals Wiki: Arena](https://robloxrivals.fandom.com/wiki/Arena) | Describes Arena as a clean grid design with angled blocks and cover; lists the map's duel modes; exposes layout and side-view gallery references. | Medium: useful visual/community documentation, not first-party technical data. |
| S3 | [RIVALS/Map on NamuWiki](https://en.namu.wiki/w/RIVALS/%EB%A7%B5) | Describes Arena as the small/basic map, reports an area of 26 tiles, and states that ramps are at both ends. | Medium-low: useful corroboration and scale clue; no measurement method is given. |
| S4 | [Roblox Rivals Wiki: Mechanics/Techs](https://robloxrivals.fandom.com/wiki/Mechanics/Techs) | Community documentation says slide jumping is common, requires sprint + slide + immediate jump, and gives a speed advantage; it also documents ramp and grenade movement. | Medium for existence and sequence; low for timing and numeric claims. |
| S5 | [Miraheze movement page](https://robloxrivals.miraheze.org/wiki/Movement) | Independently lists slide jumping as a speed-advantage technique and lists other explosive/weapon movement techniques. | Medium-low: corroborating community documentation; no constants. |
| S6 | [AmazedBot beginner movement tutorial](https://www.youtube.com/watch?v=P1vE7eJLoUQ) | Public transcript demonstrates/claims slide-canceling (slide then jump), ramp jumping, grenade jumping, and movement-specific items. It explicitly frames the examples on Arena. | Medium for visible technique sequence; not a controlled measurement. |
| S7 | [YourIconicDude slide-jump tutorial](https://www.youtube.com/watch?v=7mKs0mz9m9o) | Public 33-second tutorial directly focuses on slide jumping. | Low-medium: short community demonstration, useful for cross-checking the input sequence. |
| S8 | [tripled movement guide](https://www.youtube.com/watch?v=FOb_ebvD0f4) | Public transcript/timestamps cover slide jumping, ramp jumping, long sliding, Arena window jumps, slide strafing, wall glides, jump-pad movement, and delayed slides. | Medium for the breadth of observed community techniques; low for hidden physics. |
| S9 | [Miraheze update ledger](https://robloxrivals.miraheze.org/wiki/Updates) | Records public patch-note statements such as invisible ceilings added to counter abnormal jump glitches, and historical fixes for sliding/slide-jumping behavior. | Medium as a community mirror of update notes; not used as a numeric source. |
| S10 | [Fandom update ledger](https://robloxrivals.fandom.com/wiki/Updates) | Current community ledger records later movement-related changes, including the restriction that players can no longer slide while climbing. | Medium as a community mirror; establishes a compatibility constraint, not a complete mechanic. |
| S11 | [Roblox Creator Hub: Roblox units](https://create.roblox.com/docs/physics/units) | First-party unit documentation states that 1 stud is 28 cm and that Roblox physics units are internally consistent but game-specific interpretation remains possible. | High for Roblox unit convention; none for RIVALS map scale or controller values. |
| S12 | [Roblox Wiki: RIVALS](https://roblox.fandom.com/wiki/Nosniy_Games/RIVALS) and its [Arena map thumbnail](https://static.wikia.nocookie.net/roblox/images/4/48/RIVALSMAP_Arena.png/revision/latest?cb=20240806175703) | Community reference describes running/crouching slide and ramp/explosive jump behavior, and exposes a labeled Arena map thumbnail among the map table. | Medium for broad mechanics and qualitative visual layout; not first-party technical data and not used as a shipped asset. |

### Research limits

The available pages are public, but some community pages are editable and some guides are optimized for teaching rather than measurement. Search snippets and guide tables that assert values such as “150–160% slide-jump speed” were **not** treated as verified. I also did not convert video pixels to world units because no trustworthy original scale reference or synchronized input timeline was available. The report records those as observations or unknowns rather than manufacturing precision.

## Expanded visual research pass

The second pass focused on appearance rather than movement constants. I reviewed the Arena gallery links, public Arena/map thumbnails, Creator Store reference listings, and public gameplay/video thumbnails and transcripts. The reference material is inconsistent in resolution and sometimes shows other maps, so visual findings below are classified as `OBSERVED` rather than treated as exact material specifications.

### Visual references and what was extracted

| Reference | Visual observation | Confidence / use |
| --- | --- | --- |
| [Arena gallery page](https://robloxrivals.fandom.com/wiki/Arena), including [layout file](https://robloxrivals.fandom.com/wiki/File:Screenshot_2025-05-10_211723.png) and [side-view file](https://robloxrivals.fandom.com/wiki/File:Arena_side_view.webp) | The map is presented as a compact, bright, block-built environment: light gray/white masses, blue-gray floors/trim, hard silhouettes, and a small number of large cover volumes. | `OBSERVED`, medium. Used for the light palette, hard edges, and blockout proportions. The file pages do not provide a trustworthy world-unit scale. |
| [Roblox Wiki map table](https://roblox.fandom.com/wiki/Nosniy_Games/RIVALS#Maps), including the labeled [Arena thumbnail](https://static.wikia.nocookie.net/roblox/images/4/48/RIVALSMAP_Arena.png/revision/latest?cb=20240806175703) | A second map reference labels Arena separately from Big Arena and other maps; the small preview reinforces a compact, modular, low-detail map silhouette. | `OBSERVED`, medium-low. Used as a cross-check only; thumbnail pixels are too small for dimension measurement and the image was not downloaded or embedded. |
| [Public Arena 1v1 footage](https://www.youtube.com/watch?v=8Pq9xksXz4s) | Public Arena gameplay is a first-person view with a bright outdoor sky and readable block silhouettes. It is not a controlled graphics reference and has very little metadata. | `OBSERVED`, low-medium. Used only as a sanity check for bright sky / high-contrast geometry. |
| [Updated map and movement guide](https://www.youtube.com/watch?v=MOArCefQnD4) | The transcript explicitly demonstrates slide-canceling, ramp gliding, wall sliding, head-glitching, and ramp jumping. The visible teaching context reinforces that ramps and cover are the dominant Arena readability features. | `OBSERVED`, medium for techniques; low for color/scale. Used to prioritize sightlines and ramp access rather than add decorative scenery. |
| [Creator Store: Rivals Arena pack](https://create.roblox.com/store/asset/96977958390524/Rivals-Arena-pack) | A public third-party reference listing reports 730 triangles and 12 decals for its model. It confirms that the recognizable visual language is intentionally low-detail and modular. | `VERIFIED` for the listing metadata, not for the shipped RIVALS map. Not imported: ownership/licensing and exact relationship to the live game are not established. |
| [Creator Store: Big Arena reference](https://create.roblox.com/store/asset/110390836742427/Big-Arena-Rivals-Map) | A second public third-party listing reports a 1,510 triangle / 2 MeshPart Big Arena reference. | `VERIFIED` for listing metadata, not the live game. Used only as a reminder not to over-model a simple map. |
| [Public Arena/Summer Update footage](https://www.youtube.com/watch?v=w8c_AvMOzeY) | The uploader describes the game as feeling smoother and calls out left-right movement, but this is a subjective comparison and not a measurement. | `OBSERVED`, low. Recorded as a qualitative lead only; no physics parameter was changed from this claim. |

### Visual calculations and limits

The Fandom layout preview is exposed at a small thumbnail size and public gameplay videos do not expose the original camera transform, Roblox stud scale, or synchronized player input. It is therefore not defensible to calculate exact world dimensions from screenshot pixels. The following measurement ledger records the weaker, repeatable estimates that were still useful:

| Target | Reference and measurement method | Estimate used | Uncertainty | Implementation effect |
| --- | --- | --- | --- | --- |
| Overall footprint | S3 reports an approximately 26-tile compact Arena; the Fandom gallery and the Roblox Wiki map table were used to check that the map reads as a small rectangle rather than a sprawling arena. I treated the “tile” count as a relative count, not a metric unit. | 34 × 34 browser units with a 3.5-unit visual grid cadence. | High: the source does not define tile size, whether it means area or side count, or camera scale. | Kept the Arena dense and mirrored; marked the dimensions as estimated in the source and code comments. |
| Cover / player proportion | In the Arena side-view/gallery candidates and first-person clips, the principal cover silhouettes sit around or above a player's eye line. I compared silhouette height to the visible first-person horizon, not to raw pixels across different cameras. | Main side covers about 1.36 units high, angled cover about 2.1, center wall about 1.5 above its platform. | High, at least ±25% because avatar height and camera FOV are unknown. | Preserved readable head-glitch/peek sightlines without adding a maze of small props. |
| End ramps | S2/S3 state ramps at both ends; the side-view candidate was checked for a short, visibly climbable incline rather than a long hill. I estimated a modest rise/run relationship and selected a single analytic plane. | Arena ramp length 6, rise 2.2; two mirrored ramps. | Medium-high: image perspective and thumbnail cropping prevent a reliable slope measurement. | Rendered and collided through the same ramp surface so ramp glides/jumps are testable. |
| Sightline rhythm | S6/S8/S12 footage and thumbnails show short first-person approaches with center/side cover breaking the lane. I counted the number of major silhouettes between spawn and center rather than measuring pixels. | Two side-cover pairs, one raised central platform/wall, and open outer approaches. | Medium for the motif; low for exact spacing. | Placed cover at ±9.3 / ±6.3 and retained a readable central route. |
| Palette / contrast | Gallery and gameplay thumbnails were visually compared as swatches only; no source image was sampled into the project. | Light gray/white cover, blue-gray floor/side structure, cyan accents, bright blue/cyan sky. | Medium for broad palette; exact RGB, post-processing, and Roblox material settings unknown. | Added bright materials, warm key/cool fill lighting, fog, and an original procedural atmosphere. |

These estimates are deliberately proportional and renderer-specific; they are not measurements of the proprietary map. The repeatable calculations used in this build are instead:

- Preserve a mirrored X/Z coordinate system and align both spawn approaches on the same Z axis.
- Preserve the documented “ramps at both ends” motif and make ramp collision use the same analytic surface as the visible mesh.
- Use the documented 26-tile clue only as a compactness constraint, not as “26 studs” or a square side length.
- Keep the first-party Roblox unit note (1 stud = 28 cm) separate from the Arena estimate: it provides a general convention, not evidence that the community “26 tiles” equals 26 studs or that this browser scale is metrically calibrated.
- Use shared low-poly materials and crisp edges instead of high-frequency texture detail.
- Keep the Arena palette light gray/white with blue-gray structure and a bright cyan sky treatment, matching the public screenshots more closely than the previous dark-neon blockout.

`WorldAtmosphere.ts` now supplies an original procedural blue sky gradient, soft cloud sprites, and sun disc; it does not copy a Roblox skybox or third-party texture. Arena geometry remains clean-room original geometry. This is a visual approximation, not a claim that the browser renderer is pixel-identical to Roblox's lighting pipeline.

### Research decision: exactness versus legitimate reproduction

The public Creator Store references are useful for studying the low-poly vocabulary, but downloading or embedding an unverified user-uploaded map would undermine the clean-room and licensing boundary. The implementation continues to use original meshes, materials, and procedural atmosphere. Exact replication would require permission-safe reference captures with known camera/scale or access to the original game’s controller and map data; those are not public in the reviewed material.

## Evidence ledger

| Behavior under investigation | Evidence label | Finding | Implementation consequence | Browser test |
| --- | --- | --- | --- | --- |
| RIVALS is a first-person duel shooter | `VERIFIED` (S1) | The official page identifies RIVALS by Nosniy Games and advertises first-person 1v1–5v5 duels. | Build a first-person pointer-lock trainer first; do not spend this milestone on bots or networking. | Click capture, look with mouse, release with Escape; confirm HUD remains responsive. |
| Arena's visual identity | `VERIFIED` for the wiki's description; `OBSERVED` for geometry | S2 describes a clean grid, angled blocks, and cover. The gallery exposes a layout image and side view. | Use an original modular, symmetrical blockout: grid floor, end ramps, center platform/wall, mirrored angled covers, and spawn decks. | Compare matching top/side camera views manually; walk each cover edge and sightline. |
| Overall Arena proportions | `OBSERVED`/`INFERRED` (S2, S3) | S3 calls Arena a 26-tile compact map and puts ramps at both ends. Exact tile dimensions and camera scale are not provided. | Use a 34×34 world-unit arena with 3.5-unit visual grid spacing; document it as an estimate. | Debug coordinates and measured tracks; adjust `ArenaConfig`/builder dimensions without touching movement constants. |
| Sprint exists and is central to movement tech | `OBSERVED` (S4, S6, S8) | Tutorials consistently show running/sprinting before a slide jump. Public sources disagree on whether auto-sprint is the preferred setting, not on the need for forward movement. | Explicit `Shift` sprint is the baseline; optional auto-sprint is exposed as a setting rather than silently assumed. | Rest-to-sprint acceleration track; compare shift and auto-sprint sequences. |
| Slide-jump input sequence | `OBSERVED` (S4, S6, S7, S8) | Community documentation and transcripts consistently describe slide then jump, often immediately or near the end of the slide. | Dedicated `SLIDING → JUMPING` transition; jump buffering allows the same fixed-step input to be repeatable. | Record sprint → slide → jump at fixed tick counts and compare distance/speed retention. |
| Slide has a movement advantage | `OBSERVED` (S4–S8) | Sources describe slide jumping as faster/harder to track or show it crossing ground faster, but provide no controller constants. | Slide uses its own acceleration, deceleration, steering and cap; it is not just a camera crouch animation. | Slide-distance lane; log speed at slide entry, mid-slide, exit, and jump. |
| Exact slide duration and friction | `UNKNOWN` | No reviewed source publishes a reliable duration, curve, or collision shape. | Baseline `0.68 s` duration and separate deceleration are explicitly labelled estimated in `MovementConfig`. | Measure R recording samples and adjust one parameter at a time. |
| Ramps cause special movement opportunities | `OBSERVED` (S2, S3, S6, S8) | Public map descriptions put ramps at Arena's ends; tutorials describe ramp jumping/gliding/super-jump behavior. | Ramps are analytic height surfaces with normals, not decorative meshes. Ground movement follows them and jump preserves momentum. | Ramp sequence, ramp ground-normal readout, ramp jump recording. |
| Air control and horizontal momentum | `OBSERVED`/`INFERRED` (S6, S8) | Tutorials visibly combine slide jumps and mid-air movement, but no air-acceleration constant is published. | Separate air acceleration, air braking, and cap; do not apply full ground friction in air. | Air-strafe sequence with the same yaw/input stream; compare landing position. |
| Double jumps, grenade boosts, weapon dashes | `OBSERVED` (S4–S8) | Public guides describe these as weapon/utility-dependent techs and list them separately from basic movement. | Deliberately out of scope for the first movement-only milestone; no fake weapons are added to hide the limitation. | Future milestone should add them as isolated abilities, not fold them into base movement. |
| Player collision and anti-tunnelling | `VERIFIED` as a requirement from public patch ledgers; behavior `INFERRED` | S9/S10 record fixes for slide-jump wall noclip and invisible ceilings. The exact original collider is unknown. | Use a fixed 120 Hz custom controller, circular footprint, standing/slide heights, axis-separated AABB resolution, ceiling checks, and ramp support. | Wall, corner, narrow passage, platform, and high-speed collision tests. |
| Sliding on/climbing geometry | `VERIFIED` as a patch-note statement (S10) | The community update ledger records that later RIVALS updates disallow sliding while climbing. | The trainer requires a sprinting grounded state before slide entry and does not allow an airborne/climbing slide trigger. | Attempt slide from air and on a ramp; verify only grounded momentum enters slide. |
| Camera FOV and camera spring | `UNKNOWN` | Guides recommend ranges, but recommendations are not documentation of the shipped default. No reviewed first-party source publishes the default. | Use adjustable 96° baseline, pointer lock, pitch clamp, smooth slide camera height, and no head-bob/motion blur. | F2 settings test; compare FOV and slide camera without changing physical trajectory. |
| Exact Roblox units, speeds, gravity, capsule dimensions | `UNKNOWN` | No public source reviewed exposes source code or a reliable instrumented measurement. | All values in `MovementConfig` are calibration units and are not called Roblox studs. | Vitest regression suite plus recorded lab sequences; keep source evidence separate from tuning. |

## Implementation baseline and uncertainty

The current baseline in `src/game/movement/MovementConfig.ts` is intentionally shaped by the qualitative evidence:

- walk `10.8 u/s`, sprint `15.6 u/s`, slide cap `20.4 u/s`
- ground acceleration `58`, sprint acceleration `68`, ground friction `35`
- air acceleration `15.5`, air cap `20.8`
- gravity `34`, jump velocity `15.9` (about 3.7 world-unit ballistic height before collision)
- slide duration `0.68 s`, slide deceleration `13.2`, steering `10.5`
- fixed timestep `1/120 s`

These numbers are **INFERRED tuning estimates**, not reverse-engineered constants. The `1.04` slide entry carry and `0.22 s` post-slide momentum grace are small transition conveniences selected to preserve the observed speed advantage without an unexplained second boost. If measured reference footage shows a different curve, each should be changed independently and the same recording re-run.

## Arena reconstruction notes

1. **Coordinate system:** X is left/right, Z is the long approach axis, Y is vertical. The first-person Arena spawn faces +Z from the south approach. The Movement Lab is an adjacent, clearly separated calibration annex rather than pretending to be part of the original match map.
2. **Blockout:** original meshes only: 34×34 Arena floor, 3.5-unit grid accents, end ramps, 7.2×5.4 center platform, center cover, four mirrored angled blocks, side covers, and low spawn decks.
3. **Collision:** every gameplay box is added to the same `CollisionWorld` that renders its mesh; ramp collision is an analytic plane with a calculated normal. Decorative trim/grid strips do not create accidental collision.
4. **Materials:** cool gray-blue modular cover, cyan edge accents, subdued teal lab, controlled directional/hemisphere lighting, no extracted textures or assets.
5. **Confidence:** the *motifs and symmetry* are medium-confidence from S2/S3 and public images; the exact coordinates, heights, cover footprints, and scale are low-to-medium confidence estimates. The project intentionally avoids “to scale” language.

## Repeatable calibration plan

The lab and tests cover the first 16 acceptance checks as follows:

1. Acceleration from rest — flat track + `MovementController.test.ts`.
2. Time to max speed — debug telemetry and recordings.
3. Fixed-interval distance — metre markers.
4. Braking distance — release movement on the flat track.
5. Direction reversal — hold W then S in a recording.
6. Jump height — vertical meter/height platforms.
7. Jump duration — `jumpElapsed` and landing transition.
8. Horizontal distance during jump — record position at takeoff/landing.
9. Slide duration — `slideElapsed`/recording samples.
10. Slide distance — slide track.
11. Speed retained after slide — telemetry at exit.
12. Slide-jump retention — `SLIDING → JUMPING` test and recording.
13. Air strafing — same start/yaw with different strafe input.
14. Surfaces — ramp/raised platforms.
15. Walls/corners — collision station and automated wall test.
16. Refresh-rate stability — two render schedules feed the same 120 Hz fixed ticks in the automated test.

## Known differences from the original

- No weapons, utilities, bots, matchmaking, damage, double-jump items, grenade/rocket boosts, or weapon-specific speed modifiers.
- The original controller may use a different capsule, slope limit, substep rate, friction model, slide curve, camera spring, and air-control model.
- Exact speed, jump, and slide values are not established by the reviewed public evidence.
- The Arena blockout is a clean-room approximation of the public layout motifs, not a claim of geometric identity or licensed map asset reproduction.
- The browser's pointer-lock/mouse behavior and monitor refresh timing differ from Roblox's input pipeline.

## Next high-impact research and engineering work

1. Build a frame-counted reference dataset from permission-safe, publicly viewable Arena footage with a known scale reference; measure takeoff/landing, slide length, ramp height, and camera FOV uncertainty explicitly.
2. Add an in-browser calibration export/CSV view and overlay two recordings so one parameter can be optimized against a reference trace.
3. Validate capsule-vs-ramp edge behavior at more Arena cover corners, then add isolated optional ability modules only after base movement traces are stable.
