# Slap Arena — Offline + Multiplayer

A fan-made, **glove-only, first-to-five round fighter**, built with React, Vite and Three.js. Inspired by Slap Battles glove identities and abilities, with original models, animation, sounds and arena-specific tuning. Not an official Roblox product; no extracted Roblox assets or code.

## Play

Requires Node.js 20.19+ or 22.12+, a desktop WebGL browser, mouse and keyboard.

```sh
npm ci
npm run dev
```

Open the printed Vite address (normally port **5173**). Choose **1v1, 2v2 or 3v3**, an arena and bot difficulty, then **Enter the Arena**. All other players in offline matches are bots. Matches retain **150 health, five-second preparation countdowns, team elimination and first to five rounds**; this is not a continuous FFA conversion.

Choose **Practice** to learn timing against moving targets. Choose **Multiplayer** to create/join a browser-hosted room with an invite link/code, select an unlocked glove, ready up and start. No accounts, gameplay backend deployment, manual ICE exchange or visitor configuration are required. The host must keep the game open. Network/firewall and public signaling availability can still prevent connections; see [network limits](docs/multiplayer.md).

An embedded preview needs pointer-lock permission. If capture is blocked, open the preview in a separate tab.

## Controls

| Input                    | Action                                            |
| ------------------------ | ------------------------------------------------- |
| WASD / mouse             | Move / look                                       |
| Left mouse (tap or hold) | Slap                                              |
| E, F or right mouse      | Equipped glove's active ability                   |
| Space                    | Jump; cancels a slide                             |
| C, Shift or Control      | Immediate long slide                              |
| Mouse wheel              | Zoom out to third person / back into first person |
| V                        | Toggle first person / third person                |
| M during preparation     | Choose **one** unlocked glove                     |
| Escape                   | Pause/settings/leave; online matches continue     |

There are no accessible guns, ammo, reloads, throwable utilities or four-slot loadout selection in glove matches. Number keys and weapon-wheel requests cannot equip hidden compatibility slots. The old firearm catalog remains internal to support earlier engine/network regression tests.

Settings preserve sensitivity, FOV, volume, vertical mouse inversion, performance mode, optional motion/FOV effects and FPS display. The previously restored movement constants and immediate **1.5-second, no-cooldown slides** remain unchanged; see [movement provenance](docs/movement-restoration.md).

## Gloves & progression

**24 unlockable gloves.** Search by name/ability, filter by availability or playstyle, and sort by cost/name. Unlock notifications and per-glove progress bars make the next milestone visible.

**One slap earned per confirmed direct melee hit** against a live enemy, including practice targets (**Dual grants two**). Whiffs, walls, allies, protected/recovering targets, repeated event delivery and ability-only effects do not award slaps. Reaching a milestone permanently makes that glove selectable: unlocking/equipping **does not spend your total**.

| Glove     | Slaps | This implementation                                                                        |
| --------- | ----: | ------------------------------------------------------------------------------------------ |
| Default   |     0 | **Fart Blast**: forward launch even from rest, then boosted speed; gas trail; clears chill |
| Diamond   |    15 | **The Stone Age**: temporary immovable, slap-proof rock form                               |
| Extended  |    30 | **Reach**: longer handle/reach; lower damage, shorter ragdoll                              |
| Dual      |    40 | **Double Slaps**: two modeled hands, wider two-target sweep, double earned slaps           |
| Brick     |    65 | **Litter Trap**: visible, jumpable enemy trip hazards; no ability damage/rewards           |
| Snow      |    85 | **Slow enemies**: five seconds of reduced movement and jumping                             |
| Acrobat   |   110 | **Roll**: committed forward dodge, clears falling velocity; stable camera                  |
| Pull      |   125 | **Haul**: reversed horizontal knockback                                                    |
| Flash     |   175 | **Teleportation**: forward blink, swept against walls                                      |
| Spring    |   250 | **Boing**: higher jumps without replacing normal air steering                              |
| Swapper   |   350 | **Swap Position**: aimed, visible enemy position exchange                                  |
| Bull      |   475 | **Hard Hitter**: slow windup, heavy launch; up to three enemies per swing                  |
| Dice      |   585 | **Random Power**: authority-rolled damage and launch; six balanced outcomes                |
| Ghost     |   666 | **Invisibility**: 3.2 seconds hidden from enemies; attacks reveal you                      |
| Thanos    |   795 | **Time Reversal**: mark a point, then return safely; no healing                            |
| Stun      |   870 | **EMP**: grounded, nearby enemies briefly ragdoll; jumping avoids it                       |
| Za Hando  | 1,000 | **Erasure Pull**: pull visible nearby enemies inward                                       |
| Magnet    | 1,125 | **Massless Magnetism**: rush toward the nearest visible standing enemy                     |
| Anchor    | 1,350 | **Dock**: place a marker that redirects your slap knockback toward it                      |
| Space     | 1,500 | **Zero-G**: timed upward lift and reduced gravity; not permanent flight                    |
| Boomerang | 1,625 | **Schlep**: outward slap, then a delayed stronger return impulse                           |
| Speedrun  | 1,750 | **Speedrun**: faster running and chill resistance, with lighter hits                       |
| Golden    | 2,500 | **Powerup**: three seconds of protection, speed and enhanced slap power                    |
| Reverse   | 5,500 | **Opposite Day**: reflect incoming slaps; two active reflectors cancel                     |

Progress and selection are stored in `slap-arena-profile-v1` in this browser/origin. They survive reloads, but are not cloud-synced. Clearing site data clears progress. If storage is blocked, progress is session-only. This is a **casual local progression system, not an anti-cheat-secure economy**: joining profiles are self-reported. The match authority validates glove selection against that starting total plus its own confirmed earned-slap count, and exclusively resolves damage, hit tests, abilities and launches.

See [implementation, balancing adaptations, research and validation](docs/glove-combat.md). Costs follow the referenced reduced-price roster; Extended uses 30 rather than the stale 25 shown by some index pages. Acrobat uses a **local 110-slap milestone**, not the source game’s external favorite requirement. Our damage, world-space reach, cooldowns, form durations and jump strength are adaptations, not claims of exact Roblox values.

## Combat

- A visible windup, contact window and recovery; camera-facing cone/range tests, line of sight and enemy validation. Bull has a longer tell; Extended has genuine extra reach.
- Confirmed damage, real authoritative horizontal/vertical knockback, brief recovery protection, wall collision and automatic recovery. No ability or swing-animation event can manufacture damage.
- Rounded, articulated five-finger glove rigs with original textile/PBR finishes, contact-aligned windup/strike/recovery, alternating wrist poses, sweep ribbons and differentiated heavy hits. The collection preview supports dragging or arrow-key rotation.
- Wheel zoom and **V** switch between first person and a full-body, animated shoulder view. The camera retracts around walls/floors (including rotated cover); zoom never changes hit origins or rotates aim. First person remains the initial view; the chosen distance stays through rounds during this game session.
- Distinct synthesized ability sound families, teleport departure/arrival rings, expanding EMP and inward pull waves, status auras, icy impact mist and Default’s drifting gas trail. Small activation notices confirm actual abilities; area-effect notices count authority-confirmed affected enemies, not invented hits.
- Bounded pooled impacts and particles, genuine hit confirmation and projected damage numbers. Cosmetic effects never resolve damage or mint progression.
- Fifteen-node, constrained articulated **visual ragdolls**, driven by the collision-resolved gameplay body. Limbs do not become separate authoritative damage hitboxes. A separate rock mesh represents Diamond's protected form.
- Bots navigate the actual arenas, close distance, strafe, slap with windups, use abilities, jump to elevated opponents and get knocked down. They do not fire invisible guns. Their glove tier follows your selected glove rather than giving beginners arbitrary late-game equipment.
- Both browser-hosted WebRTC and optional dedicated matches share the same combat implementation. Protocol **5**, glove snapshot format **4** (legacy firearm format **3** remains supported); both players must refresh and create a fresh lobby after updating.

## Production / offline

```sh
npm run build
npm run preview
```

Production includes a versioned service worker that precaches the game. Visit once online and allow caching to complete; subsequent visits work offline in the same browser/origin. Service workers require HTTPS or localhost. Offline play makes no gameplay network requests. Multiplayer discovery/connectivity still requires networking.

The default multiplayer needs **no dedicated server**. The optional development/dedicated server supports same-origin WebSocket fallback and native Geckos when installed; see [multiplayer documentation](docs/multiplayer.md). Browser-facing requests are relative, and preview servers bind to `0.0.0.0` and accept Arena preview hosts.

## Checks

```sh
npm test                 # Full engine, rendering-data, movement and network unit suite
npm run build            # Production + worker bundle and offline cache
npm run test:gloves      # Build + glove unit suite + focused browser/real-RTC tests
```

The browser command requires Playwright-compatible Chromium (`BROWSER_EXECUTABLE` can point to an installed binary). The focused suite includes a real static-site, browser-worker-hosted WebRTC match using local test signaling; the test signaling override is not a user deployment requirement. Synthetic scripts do not benchmark public Internet latency or GPU frame rates.

Historical gun-specific browser scenarios in `tests/` describe the previous UI/arsenal and are not current menu acceptance tests. Their unit-level foundations remain covered by `npm test`. Current glove UI/combat/network coverage lives in `tests/gloves*.spec.js` and `tests/gloves.test.js`.
