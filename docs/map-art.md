# Map/environment visual pass

This pass improves the six combat maps and the practice Range without resizing
courts, adding gameplay obstacles, moving spawns or changing movement/weapon rules.

## What changed

- **Concrete Arena:** a stepped architectural campus outside the tall perimeter,
  restrained blue-grey wall courses, high facility lettering and fine cover seams.
- **Foundry:** twin industrial tanks, banded stacks and service gantries beyond the
  court; warm industrial daylight and amber maintenance markings.
- **Courtyard:** layered low-poly trees and pergolas outside the existing walls,
  sage-green accents and softer warm stone/daylight. No new foliage in shooting lanes.
- **Compound:** service panels, roof-fan guards and container end-door detailing,
  plus textured concrete underfoot instead of a flat-colour floor.
- **Rooftops:** detailed static fan blades/concentric guards on the actual existing
  HVAC caps, side service grilles, exterior aerials and a cooler city daylight profile.
- **Hangar:** exterior industrial landmarks, container end-door/service details,
  textured floor and warmer freight-facility accents.
- **Range:** the same material, perimeter and lighting polish, retaining all targets.

Every map has its own coordinated directional light, hemisphere ground fill, sky
horizon/zenith and fog colour. The procedural sun direction now matches the actual
shadow-casting sun. These are world-light changes, **not** screen colour filters;
weapon-scene lighting and existing ADS/model framing remain unchanged. No new
point lights, per-frame geometry or external image downloads were introduced.

Concrete slab joints and form-tie marks are derivative-antialiased in world space.
The old baked dark grid/holes were removed from the texture to avoid doubled seams.
Fine aggregate, roughness and bump detail remain subtle rather than covering the
combat field in noisy grime. Existing AO, bloom and performance-mode bypass remain.

## Geometry, batching and ownership

All in-bounds additions are paint or flush surface detail on existing solids.
Substantial new silhouettes live outside the court. Dressing is not added to
`boxes`, `solidMeshes` or the navigation grid, and does not become fake cover.

| Map | Added source meshes | Added merged batches |
| --- | ---: | ---: |
| Concrete Arena | 188 | 4 |
| Foundry | 120 | 5 |
| Courtyard | 160 | 3 |
| Compound | 78 | 5 |
| Rooftops | 66 | 5 |
| Hangar | 114 | 6 |
| Range | 44 | 4 |

These are the new `map-architecture` group only, not total scene draw calls or
hardware FPS claims. Substantial exterior geometry casts shadows; flush paint
never casts shadows. One shared generated maintenance atlas serves fans/grilles,
while facility lettering uses one small cached texture per map. Materials live in
`world.materials`, textures in `graphics.textures`, so normal world cleanup owns
them. Merged/transient geometries are disposed on map changes.

## Validation

- **452 unit tests passed**, including 16 new map-art tests for batching, finite
  geometry, exterior silhouette placement, collision isolation, cached resource
  reuse, coordinated lighting and safe fallback profiles.
- **15 browser scenarios passed (5.4 minutes)**, covering map art, Arena routes,
  controlled movement, weapon/operator rendering, offline startup, React combat,
  performance-mode rendering and four real PeerJS multiplayer scenarios including
  six-client 3v3.
- Production build passed.
- Real Chromium screenshot audit rendered all seven maps from overview and spawn
  eye height with **no JavaScript/WebGL errors**. Screenshots were inspected; they
  remain outside Git.
- Separate pre/post audit fingerprints confirmed **identical collision boxes and
  spawns on all seven maps**.
- The browser map-art regression compares dressing-disabled/enabled builds of each
  map: collision boxes, spawn data, collision mesh count, navigation path and
  spawn-ray hit distances must match. Repeated seven-map rebuilds verify cached
  material/texture ownership stays stable. An additional strengthened rerun
  confirmed actual renderer memory stayed at **154 geometries / 34 textures**
  before and after two full seven-map cycles (106 registered materials and 16
  cached world textures, also unchanged). These are resource counts, not bytes.
- Arena movement/collision regression still verifies protected spawns, connected
  lanes and both real ramp/gallery routes.

Reproduce screenshots and fingerprints with:

```sh
npm run audit:maps -- /tmp/map-art
```

For a system Chromium installation, set `BROWSER_EXECUTABLE` if necessary. Use
`ARENA_URL` to target a different running preview. Screenshots intentionally omit
the HUD and use frozen cameras; this is an art/collision audit, not an FPS benchmark.

The live development preview updates normally. A separately published static site
requires republishing the updated frontend/assets; pushing code alone does not
verify a public deployment. No backend configuration was added.
