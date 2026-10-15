# Secondary expansion and shared handling

Three original sidearms expand the secondary slot from three to six choices (26 total weapons). They are available in the regular loadout, four-step pre-match picker, previews, range and authoritative online lobbies.

| Weapon | Role | Damage / head multiplier | Ammo | Timing |
| --- | --- | --- | --- | --- |
| Revolver | Deliberate precision | 45 / 1.75× | 6 + 36 | 0.42 s shot recovery, 1.6 s reload |
| Burst Pistol | Controlled medium-range bursts | 14 / 1.5× per round | 18 + 90 | 3 shots, 65 ms spacing, 0.36 s post-burst recovery, 1.25 s reload |
| Dual Pistols | Sustained close-range pressure | 15 / 1.5× | 24 shared + 96 | Hold LMB to alternate, 0.14 s recovery, 1.65 s reload |

These are trainer balance values, not claims of exact Roblox weapon statistics. Revolver takes two headshots against a full-health 150-HP opponent. No new one-shot frontal Knife or automatic backstab rule is introduced.

## Models and feel

- Revolver has a machined long barrel, exposed six-chamber fluted cylinder, brass cartridge bases, textured grip panels, open iron sights, a moving hammer and a cylinder that indexes during firing and swings outward during reload.
- Burst Pistol has its own compact receiver, slide serrations, extended moving magazine and an open reflex frame with a small dot instead of a solid plate obstructing the target.
- Dual Pistols have two independent gun assemblies, slides, magazines, flashes and hands. Shot selection happens before tracer/ejection placement. The active gun recoils around its grip, with its flash attached to the same assembly; both magazines extract during reload. Empty slides lock until the reload rack. ADS preserves a clear central aim line between the guns.
- Each new gun has an authored icon and viewmodel-only impulse/ADS profile. Revolver and Burst Pistol have distinct procedural shot sounds. Existing spatial voice cleanup applies to them.
- Static detail remains batched. Full FPS models use 21 / 19 / 29 meshes respectively. Render updates reuse geometry; no external models, textures or runtime downloads were added.

## General improvements

- A secondary draw takes 0.14 seconds; other slots retain a 0.22-second equip. Switching to your backup no longer inherits a primary's long remaining firing delay.
- Per-slot next-ready timestamps preserve the original weapon's recovery when switching back. This prevents quick swapping from bypassing firing intervals, including melee recovery. Knife F and normal Knife hits share that melee recovery, so alternating the two cannot bypass it. Server and client use the same rule.
- Burst size/spacing can be authored per weapon. An empty partial burst cancels its remaining shots and starts a normal reload instead of counting phantom rounds or making the burst counter negative. Existing Burst Rifle behavior is retained.
- Low/empty ammunition changes the existing ammo numeral to amber/red; no additional HUD panel is added.
- Sniper's description no longer falsely promises a one-headshot elimination with its existing 100-head-damage balance.
- Self-immunity, explosive launch impulses, Knife F facing/range/LOS rules, movement, maps, bots and offline caching remain intact.

## Multiplayer compatibility

Network protocol negotiation is version 2. The client, health endpoint and development-server reuse check share `PROTOCOL`. New IDs append to the roster, preserving existing weapon indices. A spare player-flags bit carries the authoritative active dual-pistol barrel without increasing the ordinary 587-byte 3v3 snapshot. Deploy client/server together; old clients are asked to reload. Remote operators hold the same detailed sidearms, with a separate left-hand grip for Dual Pistols.

## Checks

- 276 passing Node tests, including new role/loadout/model/ADS/resource bounds, dual barrel/slide/magazine synchronization, empty-slide recovery, Revolver cylinder behavior, old weapon-index preservation, per-slot cooldown protection and authoritative exact/partial burst tests.
- A new real-picker browser scenario checks six visible secondary options and saved selection, then fires/reloads/renders each new weapon, verifies centered ADS and clear hands, and checks WebGL errors. All-weapon rendering and authoritative smoke tests now enumerate all 26 weapons.
- The full 28-case browser run passed 27 cases; the new picker case initially timed out because pointer-lock loss legitimately paused its match. Its fixture now accepts a deployed paused match, then uses deterministic simulation and explicit renders. The corrected picker plus controls, two-client multiplayer, Flame, collision consistency and trickshots passed together (7/7), giving passing results for all 28 cases across runs. The production build passes. Browser graphics here use software WebGL; they are not a hardware FPS benchmark. Multiplayer checks use the functioning WebSocket fallback; native geckos UDP is not claimed as validated.
