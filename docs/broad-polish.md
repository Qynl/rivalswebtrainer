# Broader presentation pass

This pass builds on the map/arsenal work rather than changing the combat rules.
It covers environment materials, floor navigation, operators, first-person hands,
weapon/environment interaction, bullet travel and compact HUD feedback.

## Maps and materials

Legacy Hangar/Rooftops/Compound props still contained unmapped lavender colours.
Those beams, container roofs/ribs and mechanical parts now use restrained steel,
slate and warm freight colours. `surfaceFinish` distinguishes rough concrete,
painted/brushed metal and sawn crate boards; all textures are generated offline.

Every combat map and the Range gains mirrored staging-sector floor stencils and
subtle boundary hazard markings. The three ramp courts also get ground-level
`UPPER / RAMP ACCESS` arrows at the real ramp approaches. These are paint on the
existing ground slab, not new obstacles, extra HUD panels or luminous lane clutter.
One cached atlas/material adds **one merged batch** per map. Collision geometry,
spawn points and navigation remain unchanged; see [the map report](map-art.md).

## Characters and first-person hands

- Three deterministic cosmetic operator finishes: Striker, Recon and Sentinel.
  They are **not** classes; equipment, HP, hitboxes and damage are unchanged.
- Names choose a stable cloth/ceramic combination and two-digit callsign. Team
  teal/copper remains consistent across every kit.
- Front/back woven-style identity patches, carrier bindings, fasteners, a radio
  fascia and an actual curved communication cable add close-range detail.
- Articulated gloves gain back plates, stitching and cuff binding across the full
  first-person arsenal. Existing hand pivots, corrected Bow orientation and ADS
  calibration are retained.
- Callsign DataTextures belong to their character materials and use the existing
  `disposeVisual` cleanup, alongside the existing textile texture.

## Weapon wall-ready pose

`WeaponClearance` reuses a short raycaster, scratch vectors and result array. It
checks the actual collision-only meshes at the eye/gun-side edge, including real
window openings and rotated cover, at 20 samples/second in normal use.

Near a wall, firearms smoothly lower and pull inward instead of looking rigidly
embedded in concrete. This only changes the held model. It does not redirect
mouse aim, change player positions, block shooting, or change projectile/damage
rules. ADS fully removes the offset; reload/inspect/action poses take priority.
Bow, melee and quick utility keep their existing presentation. The motion-off
setting disables the new wall-ready motion as well. Sampling resets on a map,
weapon or clock change so a stale proximity result cannot leak into a new round.

## Bullet trails

One-pixel WebGL line segments are replaced by a bounded pool of **64 indexed
camera-facing ribbons**. Each uses four vertices/six indices with persistent
endpoint, partner, colour and opacity buffers. Tapered ends, soft edges and a
brighter core make short moving trails legible without drawing full-length lasers.

The shader clips crossing segments before perspective division; behind-camera
shots cannot produce a giant screen flash. Depth testing remains enabled, custom
weapon colours remain supported, and clearing/disposal keep the same four combat
FX resource owners. No per-shot meshes/materials or extra scene lights are created.

## Compact HUD

Immediate HP remains authoritative. A small delayed damage chip inside the
existing health bar shows recent loss, catches up exponentially, and resets on
healing/new player/clock resets. Low-health styling is static rather than flashing.

A thin magazine-capacity underline fits inside the existing ammo display. It uses
the actual weapon magazine capacity, hides for melee/utility/infinite magazines,
and honours reduced-motion CSS. No extra screen panels were added.

## Validation

- **466 unit tests passed**, including 14 new tests for ribbon ownership/invalid
  endpoints, geometry-aware clearance/window edges/cache reset, four actual gun
  wall/ADS poses, damage-chip timing, ammo capacity, kit identities and finishes.
- **23 browser scenarios passed (7.0 minutes)**: the new GPU/live wall/HUD/kit
  tests, all-map collision/navigation/resource regression, controlled movement,
  firing/reload/impact mechanisms, all 17 gun-only raster/ADS and loadout framing
  checks, all 26 model renders, offline startup, React combat, explosive/Knife
  trickshots and four real PeerJS scenarios including six-client 3v3.
- Production build and `git diff --check` passed.
- Real seven-map overview/eye-level audit completed without JavaScript/WebGL
  errors; screenshots remain outside Git.
- Pixel test: visible ribbon changed **92 pixels** at 480×320; the same trail
  behind a solid wall changed **0**, near-plane crossing changed **606**, and a
  fully behind-camera trail changed **0**. WebGL error was zero.
- Real three-kit operator renders were inspected, including rifle/IK grips.
- The map regression confirmed identical collision boxes, spawns, collision-mesh
  counts, navigation paths and spawn-ray distances. After two full seven-map
  rebuild cycles, GPU counts remained **155 geometries / 37 textures**, with
  **107 registered materials / 19 world textures**, also unchanged.

No claims of universal hardware FPS, zero network latency or identical appearance
to another game's proprietary assets are made. Movement tuning and backend-free
PeerJS hosting are retained. A separately published static site needs its updated
frontend/assets republished; a Git push is not a verified public deployment.
