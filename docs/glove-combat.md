# Glove combat and 24-glove expansion

## Scope

The user's explicit match choice was **keep the rounds**. The public entry point now renders `src/gloves/GloveApp.jsx`: a glove collection, persistent milestone progression, one equipped glove, the existing arenas and 1v1–3v3 first-to-five rounds. There is no public gun/loadout wizard. Existing movement and inversion fixes are preserved.

`src/gloves/catalog.js` defines 24 glove identities (nine preserved plus fifteen appended) and this game's balance. `src/data.js` retains the legacy `WEAPONS` export for historical firearm-specific tooling/tests and adds `COMBAT_ITEMS` for the runtime. A canonical four-element internal inventory preserves existing wire/ammunition plumbing; only its glove at index zero is equippable. The other indices are compatibility placeholders, **not an accessible secondary arsenal**.

## Authority and hit timing

`src/gloves/combat.js` is shared by the local engine and `server/match.js`, including the browser-hosted worker. An accepted swing starts a cooldown and delayed contact. At contact the authority checks a live opposing target, distance, a facing cone, current protection and solid line of sight. One target is hit, except Dual’s maximum two and Bull’s maximum three. Remote inputs cannot specify damage, target, hit confirmation or position. Existing bounded server rewind is used for multiplayer melee contact.

An impact changes health through the existing round engine, assigns horizontal/vertical velocity, cancels pending attacks/slides/jump buffers and enters a temporary ragdoll/recovery state. The capsule moves under the shared horizontal/vertical collision solver; control resumes automatically. Brief recovery protection prevents repeated hits while down. Mouse yaw and pitch are not rewritten by recoil or a ragdoll.

Glove states use otherwise-unused glove-mode snapshot timers, interpreted centrally by `src/gloves/states.js`: `dash` = ragdoll, `deflect` = stone, `heal` = chill, `throw` = movement burst/roll/rush, `dashCooldown` = ability cooldown, `reload` = invisibility, `blind` = Golden, `paint` = Reverse, `quickMelee` = low gravity, `deflectCooldown` = mark lifetime. Clients clear the corresponding legacy reload/flash/melee/utility presentation fields so these cannot accidentally activate firearm effects.

Handshake protocol **5** prevents older catalogs/clients joining silently. Glove snapshot **version 4** adds a mark-present flag, three float32 marker coordinates and an authority-earned-slap uint16 to each player: **113 bytes/player**, versus 98 in retained version 3. An ordinary six-player glove frame is **701 bytes**, versus 611 for legacy firearm frames. The 23-byte header, projectile format and 19-byte zone format are unchanged; brick adds zone kind 3. Legacy version-3 firearm encoding/decoding and existing weapon IDs remain unchanged. The original nine glove IDs retain their original insertion order; the collection and bot tiers use the separate cost-sorted `GLOVE_ROSTER`.

Reliable events carry confirmed hits, launches, Dice outcomes, ability destinations and the Boomerang return impulse. Full snapshots recover timers, marks and trap lifetimes after lost presentation events. Progress comes from monotonic `stats.slaps`, with `stats.hits` retained as the actual contact count; older test/legacy states fall back to hits. The final snapshot settles rewards **before** results are created. Reflected slaps credit the defender; two active Reverse users cancel without recursion or rewards. No second reward is issued for a delayed Boomerang impulse.

## Progression and limitations

Each confirmed direct slap grants one persistent slap, including practice; Dual grants two. Starting at zero, Default is available; milestone unlocks are automatic and do not spend the total. Invalid profiles, impossible selected gloves and malformed counts are sanitized. Offline receipts and online match/hit counters deduplicate rewards. No reward is granted for whiffs, abilities, allies, blocked targets or repeated snapshots.

Profiles are local browser data; private/blocked storage falls back to session progress. They are not accounts, cloud saves or cheat-proof currency. With no user-deployed database/login backend, the authority must accept the sanitized starting profile claimed on joining. It then checks each requested glove against that baseline plus **authority-owned** earned slaps (including the Dual bonus). Editing local site storage is outside this casual system's security guarantee.

## Animation, audio and ragdolls

The original procedural glove rigs have five independently articulated digits and identity-specific geometry: crystal facets, an extension handle, snowflake, reversed Pull palm, lightning, coil, swap ring and reinforced Bull knuckles. First-person windup, sweep, follow-through and recovery are distinct from firearm recoil; third-person hands use matching timing and the existing arm IK. Confirmed hits have synthesized swish/impact audio, a short expanding ring, bounded particle bursts, markers and projected damage numbers. Ability effects are not accepted as evidence of a hit.

`src/gloves/ragdoll.js` maintains a reusable 15-node visual ragdoll per affected character, with segment and cross-body distance constraints, substeps, gravity, damping, bounded displacement and a gameplay-driven pelvis. It restores the original character on recovery and stays beneath its disposal hierarchy. This is **jointed cosmetic physics over an authoritative colliding body**, not a server simulation of fifteen separately colliding hitboxes. Limb-ground contact is cosmetic; the gameplay capsule handles real arena collisions. Diamond has an original faceted stone shell. No Roblox mesh, texture or audio was downloaded.

## Research and deliberate adaptations

Research was checked during the October 17, 2026 conversion. Public wiki pages contain historical changes and occasionally disagree; we did not treat old fan guides as current specifications.

- Default's **Fart Blast is a speed burst**, not an offensive radial blast. This implementation clears chill, supplies forward acceleration and a short boosted run window. Reference: [1](https://roblox-slap-battles.fandom.com/wiki/Default).
- Diamond's source ability is an indefinite, toggled stationary protected rock form. Here it lasts **2.5 seconds** with a cooldown to avoid indefinite first-to-five round stalling. Reference: [4](https://roblox-slap-battles.fandom.com/wiki/Diamond).
- The current reduced-price roster supports Default 0, Diamond 15, Snow 85, Pull 125, Flash 175 and Spring 250. Some glove indexes still list Extended at 25; the individual/current game-mode material lists **30**, which this implementation uses. References: [3](https://roblox-slap-battles.fandom.com/wiki/Gloves), [11](https://roblox-slap-battles.fandom.com/wiki/Glove_Game). Individual glove pages: https://roblox-slap-battles.fandom.com/wiki/Extended, https://roblox-slap-battles.fandom.com/wiki/Snow, https://roblox-slap-battles.fandom.com/wiki/Flash, https://roblox-slap-battles.fandom.com/wiki/Spring.
- Pull's Haul and reversed glove identity are references for the inward launch and reversed palm. Reference: [10](https://roblox-slap-battles.fandom.com/wiki/Pull).
- Swapper costs 350 and exchanges positions. This implementation requires aim, a clear sightline, safe occupancy and a 20-metre range, rather than importing the original game's much larger stud-scale range. Reference: [8](https://roblox-slap-battles.fandom.com/wiki/Swapper).
- Bull costs 475; **Hard Hitter** has a slow slap and can hit up to three players. Here the longer tell, 38 damage and stronger launch are balanced against 150-health team rounds. Reference: [3](https://roblox-slap-battles.fandom.com/wiki/Bull).

Snow's slow and Spring's higher jumps are passive; Extended increases real reach. Flash is a forward blink swept against collision at 0.15-metre intervals, so a clear destination beyond a wall is not enough. This game's metre-scale reach, health damage, jump/launch speeds, cooldowns, form durations and model styling are original adaptations. Masteries, badges, premium gloves, copyrighted Roblox assets and a complete Slap Battles recreation are not claimed.

## Fifteen additional mechanics and collection polish

The roster is now **24**, retaining all old IDs, unlock costs and `slap-arena-profile-v1` saves. The UI has name/ability/description search, unlocked/locked filters, four playstyle categories, cost/name sorting, an empty-state reset, unlock progress bars, milestone notifications and responsive rows. The preparation picker remains one glove. The HUD distinguishes hidden/protected/reflecting/low-gravity states, shows Dice results, and projects the local user's Dock/return marker with a separate return hint. Other users' markers are not presented as waypoints; this is a presentation rule, not a claim that client-visible snapshot data is secret from developer tools.

Original geometry adds the second articulated Dual hand, studded Brick plate/trap, Acrobat straps, pip-covered Dice, ethereal Ghost face, five-gem gauntlet, EMP capacitors, striped Erasure cuff, horseshoe magnet, nautical anchor, orbital rings, V-shaped Boomerang, finger coils, gold crown and opposing Reverse arrows. Protected/reflecting/floating opponents have a bounded reusable status ring. Ghost hides the entire opponent hierarchy including its name, while allies remain visible. Slapping reveals the user; taking a hit does not make invisibility invulnerability. Bots stop tracking distant invisible opponents, and Magnet cannot automatically target them.

All active mechanics are executed in shared authority code, not just menus:

| Addition / reference                                                                     | Arena implementation and deliberate differences                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Dual](https://roblox-slap-battles.fandom.com/wiki/Dual), 40                             | Real second hand, wider cone, up to two targets, two earned slaps per confirmed target. Does not hit the same target twice in one contact.                                                                                                                              |
| [Brick](https://roblox-slap-battles.fandom.com/wiki/Brick), 65                           | Ground placement behind the player, 0.4s arming, 9s lifetime, maximum four per owner, 5s cooldown. Visible to everyone; only grounded opponents trip. No health damage or slap income. Placement checks geometry/bounds; round cleanup and zone snapshots remove traps. |
| [Acrobat](https://roblox-slap-battles.fandom.com/wiki/Acrobat), **110 local adaptation** | Source unlock is favoriting the Roblox game, not a slap cost. Here a local milestone unlocks a 0.5s fixed-direction dodge/roll and fall-speed reset, with a 5s cooldown. Camera aim does not tumble. No invulnerability or external favorite verification.              |
| [Dice / RNG](https://roblox-slap-battles.fandom.com/wiki/RNG), 585                       | Six balanced authority-only outcomes: 16–36 damage and 10.1–25.6 horizontal launch. Not the original broad random 5–100 power range. The rolled value is carried by the hit event and shown to the attacker.                                                            |
| [Ghost](https://roblox-slap-battles.fandom.com/wiki/Ghost), 666                          | 3.2s invisibility, 16s cooldown; direct slap input reveals you. Remains hittable.                                                                                                                                                                                       |
| [Thanos](https://roblox-slap-battles.fandom.com/wiki/Thanos), 795                        | Mark, 0.4s recast gate, then collision-validated return within 12s. Return or expiration starts a 14s cooldown. No health/status rewind, and no cast while ragdolled.                                                                                                   |
| [Stun](https://roblox-slap-battles.fandom.com/wiki/Stun), 870                            | 5.8m LOS pulse, grounded opponents only, 1.1s ragdoll, 13s cooldown. Jumping avoids it. No damage or earning; direct slaps can hit stunned victims.                                                                                                                     |
| [Za Hando](https://roblox-slap-battles.fandom.com/wiki/Za_Hando), 1,000                  | Pull visible enemies within 9m toward the caster; 14s cooldown. Excludes allies/protected targets; no damage or earnings.                                                                                                                                               |
| [Magnet](https://roblox-slap-battles.fandom.com/wiki/Magnet), 1,125                      | Rush **the user toward an enemy**, not pull the enemy or teleport. Nearest valid standing, visible enemy within 14m; 0.55s committed burst, 9s cooldown. Normal wall collision remains authoritative. Invalid target consumes no cooldown.                              |
| [Anchor](https://roblox-slap-battles.fandom.com/wiki/Anchor), 1,350                      | The source page explicitly says victims travel **toward** the anchor. Here Dock sets a 10s marker; subsequent direct slaps redirect horizontal launch toward it. 4s re-placement cooldown.                                                                              |
| [Space](https://roblox-slap-battles.fandom.com/wiki/Space), 1,500                        | Upward lift plus 2.6s at 28% normal gravity, 13s cooldown. Same player/bot/ragdoll compensation, collision and normal air steering; not flight.                                                                                                                         |
| [Boomerang](https://roblox-slap-battles.fandom.com/wiki/Boomerang), 1,625                | Initial 15-power launch, then a 24-power return toward the caster after 0.28s. A stronger adapted return, not the source's exact double-power balance. No second damage or currency; reliable return impulse and snapshot velocity recovery.                            |
| [Speedrun](https://roblox-slap-battles.fandom.com/wiki/Speedrun), 1,750                  | 1.4× running, lighter 18-damage/11-power slaps, 85% movement while chilled versus normal 55%. Existing slide duration, jump and camera constants remain unchanged.                                                                                                      |
| [Golden](https://roblox-slap-battles.fandom.com/wiki/Golden), 2,500                      | Shortened to 3s protection, 1.15× speed, 1.25× damage and 1.3× power; 24s cooldown. Protection rejects real damage and incoming slap/ability impacts; no forced screen blinding.                                                                                        |
| [Reverse](https://roblox-slap-battles.fandom.com/wiki/Reverse), 5,500                    | Shortened 2s reflection, 15s cooldown. Reflects direct melee damage and launch back to the attacker, credits the defender, and cancels Reverse-vs-Reverse. Does not claim to reflect every source-game ability.                                                         |

These timings and damage values are round-specific adaptations, not a recreation of all original mastery/badge interactions. No movement baseline, slide timing, inversion behavior, team structure or starting health was replaced.

## Validation

Focused tests cover rig construction, profile sanitization/persistence, exact-once reward receipts, contact windups, damage/launch, enemies/LOS/range, passive effects, stone immunity, speed burst, wall-safe Flash, Swapper, recovery, articulated rig reuse, compact status/ID encoding, locked/hidden inventory restrictions, authority input execution and final-snapshot reward settlement.

Browser coverage uses actual mouse/key controls for hits and instant long slides, real landed hits to earn/equip/reload Diamond, locked collection and inversion settings, a narrow viewport, preparation glove selection, actual AI navigation/combat in the Foundry team arena, and a **static-only real WebRTC match with browser-worker authority**. Its test-only local PeerJS signaling is not an external deployment verification or a promise of connectivity through every NAT/firewall.

### Previously verified nine-glove conversion (baseline)

- **556/556 unit tests passed**, including 16 focused glove regressions.
- **8/8 focused browser scenarios passed** in the final clean run (2.1 minutes), including real input/slide cancellation, glove unlock/persistence, a narrow layout, between-round selection, actual arena AI, production disconnected reload, and static-only real WebRTC combat.
- Production build passed, including the browser authority worker and versioned offline cache.
- In the recorded real-RTC run both peers received the same 126-health post-hit states and replicated launch/recovery state; each player had one authority-confirmed hit and one saved slap. This used local test signaling, not a public-network latency benchmark.
- In the AI test, real Foundry simulation first hits occurred at 4.308 simulated seconds in 1v1 and 1.892 simulated seconds in 2v2. Both reached eliminations and multiple round scores. These are accelerated simulation checks, not claims of wall-clock endurance testing.

Earlier test iterations caught an overly short/random-target team-AI assertion, a missing local Chromium executable setting and the final-hit settlement edge case; the results above refer to the subsequent clean complete runs. No external published-site deployment was verified.

### Expansion validation

Expansion-specific units cover all new mechanics, authority-only ability branches, every Dice outcome, Dual bonus accounting, reflection credit/recursion, collision-safe marks, trap placement/jump/ally/cap/expiry behavior, low-gravity expiry, protection, and full version-4 state/zone/earned-count round trips. Browser additions exercise collection controls, all first-person rigs, actual E input and camera stability, every glove's bot combat/ability conditions, and additional static-only RTC status/marker/trap/visibility replication.

Final clean expansion validation:

- **595/595 full unit tests passed**, including **55 glove-specific tests** (39 new regressions over the original sixteen).
- **14/14 focused browser scenarios passed together** in the final clean run (4.0 minutes), including all 24 rendered rigs, every glove’s bot combat, real E input without camera rotation, collection controls, original movement/unlock/preparation tests, disconnected production reload and three real-RTC scenarios.
- **Production build passed**, including the worker and offline cache. `git diff --check` was clean.
- Both RTC peers observed the same 126-health direct-hit states and one earned slap each. Additional RTC cases verified quantized Thanos marks and safe return, Golden protection without fake flash/reload presentation, visible five-mesh Brick traps, and interpolated Ghost invisibility. Signaling was test-local; no public deployment/connectivity guarantee is implied.
- All 24 bot fixtures landed real damaging/launching slaps; every active glove activated under its actual eligibility conditions. The arena regression simulates **110 seconds**, covering the real 90-second round limit instead of incorrectly requiring a random 2v2 elimination within 65 seconds. It still requires early contacts, actual zero-health eliminations, launch speed and round progression. In the final run the duel reached score `[0,5]` and teams `[0,4]`.
- Snapshot-recovery regressions also verify Space’s initial lift and correct low-gravity impulse aging when a presentation event is missing or delayed.

Historical conversion totals above are preserved only as baseline provenance, not added to these totals. No external published-site deployment was verified.
