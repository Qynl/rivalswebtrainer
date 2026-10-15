# Tighter, taller Arena rebuild

## What changed

The user's priority was an Arena that is physically smaller and much taller, not another camera/FOV trick. This pass changes the actual meshes, collision, spawns, ramps and navigation together. It remains an original reference-inspired reconstruction, not verified Roblox measurements or an exact copy.

| Geometry | Before | Now |
| --- | ---: | ---: |
| Court width | 32 | 26 |
| Court depth | 42 | 32 |
| Court footprint | 1,344 | 832 |
| Perimeter wall height | 19.2 | 24 |
| Main diagonal cover height | 4.6 | 6.6 |
| Side cover height | 4.1 | 5.8 |
| Main spawn window tower height | 3.8 | 6.2 |
| Centre window tower height | 4.4 | 6.6 |
| Ramp/platform elevation | 4.4 | 6.2 |

That is **38.1% less floor area**, **25% taller perimeter walls**, approximately **43.5% taller main diagonal cover** and **40.9% higher ramp summits**. Player dimensions and gameplay movement/FOV settings are unchanged.

`src/arena-layout.js` is now the shared definition of the footprint, cover, window towers, ramp banks, platforms and spawn spacing. The two halves remain 180-degree mirrors. All six spawns were repositioned; the main spawn pair has no immediate eye-height line of sight through the middle.

## Playability and overall improvements

- Narrower, shorter lanes with taller cover silhouettes; central and flank routes remain open to full-size standing actors.
- Window cutouts retain the existing physical jump-through clearance. Raising the tower does not close the opening or create a fake visual door.
- Real continuous ramps climb to 6.2-high decks. Each deck starts exactly where the ramp ends and extends to the rear wall, avoiding a narrow falling pocket behind it.
- **Steep summit transition fix:** the standing capsule overlaps a flat platform's lip until its centre moves one radius downhill. The ramp solver now allows that accumulated descent at the summit after standing clearance succeeds. This prevents a false airborne fall on the steeper ramp without magnetising actual airborne jumps to it or increasing normal step-up height.
- **Reachable platform navigation:** explicitly marked ramp decks contribute their support height to the navigation grid. Obstructions are checked relative to that support height, including overhead solids. Tall side faces remain inaccessible; routes must enter through the ramp's low end.
- Sparse architectural height courses and coping make the increased perimeter/cover height easier to read. These details are non-colliding and batched, not additional obstacles or individual draw calls for every seam.
- **Lobby camera correction:** the old outside-the-walls orbit would hide the new court behind its taller perimeter. The Arena overview now stays inside the enclosure and above interior cover. Other maps retain their existing overview. This changes the lobby camera only, not the player's combat FOV.
- Existing quick-melee semantics, player movement, weapon models, melee bots, compact HUD and offline operation remain intact. The Arena card description now calls out the compact court/towering cover.

## Validation

- **148/148 Node tests passed.** Four new tests cover the steep summit join, reachable elevated platform, overhead obstruction/airborne non-snap, and the inside-enclosure lobby camera. Existing footprint assertions were updated to the new exact dimensions and strengthened with deck-to-ramp/deck-to-wall continuity checks.
- **13/13 browser tests passed**, including the new physical route audit and all existing full-match, loadout, controls, melee abilities, movement, graphics, 23-weapon and production-offline tests.
- **Nine physical spawn-to-spawn route traversals:** all completed, zero invalid/penetrating positions, route endpoints within 0.51 units of the intended spawn.
- **Both summit routes:** fully walked through the actual collision/vertical solver to y=6.2, with no invalid positions. This is not merely a nonempty A* result.
- **Actual player ramp traversal:** zero airborne frames both uphill and downhill at the test's 60 Hz update rate. Maximum upward increment was approximately 0.371 units, below the 0.4 step threshold. The actual window jump-through check also passed.
- **Accelerated two-minute 3v3 simulation on the smaller Arena:** all five bots navigate and fight; zero non-finite/below-floor/out-of-bounds states. Autonomous dash, slide, slide-jump, Fists double-jump, melee equips/swings/hits and rifle shots are still asserted. This is simulated time with damage replaced by a hit counter, not an endurance or hardware FPS benchmark.
- Production build and whitespace validation pass.

## Visual audit

`npm run audit:arena -- /tmp/arena-scale` captures the actual lobby overview, standing spawn view, central crossing, ramp summit view and court overview using real WebGL rendering. Output stays outside Git. It checks browser and GL errors, records bounds/spawns and inspects the same scene used for gameplay. `BROWSER_EXECUTABLE` and `ARENA_URL` overrides are supported.

The main static court is still merged into **6 batches** with **38 retained collision-ray meshes**; architectural/wayfinding dressing is merged into **2 batches**. This is a batching count, not a claim that the complete game renders in eight draws or at a particular FPS.

## Remaining limits

Dimensions and proportions are reconstruction estimates. Global bot routing is still a single-support-height grid, not a full multilayer rooftop/parkour planner. These changes make the existing raised ramp decks accessible; they do not claim human-level high-ground strategy or planned trick routes across every cover roof. Skyline, Hangar and Range footprints are intentionally unchanged.
