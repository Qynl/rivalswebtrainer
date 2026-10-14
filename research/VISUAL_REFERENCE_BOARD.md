# RIVALS-inspired visual reference board

**Pass date:** 14 October 2026
**Purpose:** guide the Phase 2 1v1 presentation without downloading or embedding proprietary Roblox assets.

This is a text reference board rather than a shipped image collage. Public thumbnails and videos vary by map, update, camera, and creator settings, so observations are tagged by confidence. No screenshot, extracted texture, mesh, or Creator Store model is used as a runtime asset.

## Reference set

| Reference | What is visually useful | Confidence / implementation decision |
| --- | --- | --- |
| [Official RIVALS experience page](https://www.roblox.com/games/17625359962/RIVALS) | Confirms the first-person duel context and the broad competitive framing. | High for product context, not art measurements. Keep the interface focused on the duel rather than a general lobby. |
| [Arena map page and gallery](https://robloxrivals.fandom.com/wiki/Arena) | Compact clean grid, light blocky surfaces, angled cover, short sightlines, and limited decoration. | Medium for the broad map language. Preserve original modular geometry and readable hard silhouettes. |
| [Mirrored map documentation](https://robloxrivals.fandom.com/wiki/Maps) | Identical opposing spawn areas, no special hazards on Arena, ramps at both ends. | Medium for layout motifs. Use symmetry and let positioning/movement, not random map hazards, decide the duel. |
| [Arena map table / thumbnail](https://roblox.fandom.com/wiki/Nosniy_Games/RIVALS#Maps) | Arena is presented as a separate small map from Big Arena and other maps. | Medium-low due thumbnail scale. Use only as a silhouette cross-check. |
| [Public Arena 1v1 video](https://www.youtube.com/watch?v=8Pq9xksXz4s) | First-person outdoor framing, bright sky, low-detail cover silhouettes, and readable central approaches. | Low-medium because capture settings are unknown. Supports bright atmosphere and restrained effects. |
| [Movement / Arena guide](https://www.youtube.com/watch?v=MOArCefQnD4) | Ramps, cover, head-glitches, slide-canceling, wall glides, and ramp jumps are visually meaningful actions. | Medium for interaction emphasis. Keep cover and ramps visually uncluttered and collision-aligned. |
| [Creator Store Arena reference](https://create.roblox.com/store/asset/96977958390524/Rivals-Arena-pack) | Public listing metadata suggests a deliberately low-poly/modular vocabulary. | Medium for vocabulary only. Not downloaded or embedded because provenance and runtime rights are not established. |
| [Public settings guide](https://pixeltwelve.com/articles/roblox-rivals-best-settings-crosshair-fps) | Community recommendations cluster around approximately 90–105 FOV, small static high-contrast crosshairs, camera shake off, and readable padded HUD. | Low-medium: recommendations, not official defaults. Browser starts at 96 FOV with an outlined cyan crosshair and restrained camera response. |
| [Crosshair guidance](https://gameboost.com/blog/roblox-rivals-best-crosshair) | Competitive crosshair advice emphasizes a compact, high-contrast reticle that survives bright arenas. | Low-medium. Keep the existing crosshair compact; add explicit hit marker rather than a large reticle. |
| [Roblox Creator Hub units](https://create.roblox.com/docs/physics/units) | First-party documentation states 1 stud is conventionally 28 cm, but games must keep a consistent interpretation. | High for general units, not Arena scale. Continue to call browser values “world units,” not verified RIVALS studs. |

## Visual language extracted

### Environment

- Clean, low-poly, mostly planar geometry with a small number of strong cover silhouettes.
- Light gray/white cover against a blue-gray floor and trim; cyan accents are useful for orientation but should not become neon decoration.
- Bright outdoor sky and cool atmospheric depth; shadows should explain ramps and cover without obscuring the target.
- Mirrored spawn approaches and readable central cover are more important than props or texture detail.

### Character and weapon presentation

- Original blocky opponent silhouette is preferable to an unlicensed avatar asset.
- Use a compact first-person weapon silhouette with a small muzzle flash, not a screen-filling animated model.
- Weapon movement should be subtle: low-amplitude bob, restrained recoil, and a clear muzzle/impact signal.
- Hit feedback should be immediate but short-lived: hit marker, damage flash, and small world impact effect.

### HUD / menu

- Keep the crosshair small and high contrast.
- Prefer compact top-center round score, bottom-right health/ammo, and a short event banner over dashboard-sized panels.
- Difficulty must be visible and explainable; it must not imply extra bot health or damage.
- Countdown, round summary, rematch, and return-to-menu states should be legible over the bright map.

## Decisions made in Phase 2

1. Added an original procedural blocky bot avatar and two original procedural weapon silhouettes; no external assets are required.
2. Added a compact first-to-three-round score HUD, countdown, health/ammo state, hit marker, damage flash, and round/match summary.
3. Kept `96°` as the browser baseline because it sits inside the low-confidence public duel range; it remains adjustable.
4. Kept camera shake off and made recoil a small, configurable camera kick rather than a persistent shake.
5. Added only cheap geometry and short-lived impact effects. No ambient occlusion or post-processing stack was added without a measured performance need.

## Open visual uncertainties

- No public reference provides exact RGB values, Roblox material assignments, lightmap/shadow settings, avatar proportions, weapon transforms, HUD pixel coordinates, or camera transform.
- Public settings articles are community recommendations and sometimes conflict; they are not treated as shipped game defaults.
- The browser renderer and Roblox lighting pipeline differ. The implementation targets the broad visual language and sightline clarity, not pixel identity.
