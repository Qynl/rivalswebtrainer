# Glove conversion

## Scope

The user's explicit match choice was **keep the rounds**. The public entry point now renders `src/gloves/GloveApp.jsx`: a glove collection, persistent milestone progression, one equipped glove, the existing arenas and 1v1–3v3 first-to-five rounds. There is no public gun/loadout wizard. Existing movement and inversion fixes are preserved.

`src/gloves/catalog.js` defines nine glove identities and this game's balance. `src/data.js` retains the legacy `WEAPONS` export for historical firearm-specific tooling/tests and adds `COMBAT_ITEMS` for the runtime. A canonical four-element internal inventory preserves existing wire/ammunition plumbing; only its glove at index zero is equippable. The other indices are compatibility placeholders, **not an accessible secondary arsenal**.

## Authority and hit timing

`src/gloves/combat.js` is shared by the local engine and `server/match.js`, including the browser-hosted worker. An accepted swing starts a cooldown and delayed contact. At contact the authority checks a live opposing target, distance, a facing cone, current protection and solid line of sight. One target is hit, except Bull's maximum three. Remote inputs cannot specify damage, target, hit confirmation or position. Existing bounded server rewind is used for multiplayer melee contact.

An impact changes health through the existing round engine, assigns horizontal/vertical velocity, cancels pending attacks/slides/jump buffers and enters a temporary ragdoll/recovery state. The capsule moves under the shared horizontal/vertical collision solver; control resumes automatically. Brief recovery protection prevents repeated hits while down. Mouse yaw and pitch are not rewritten by recoil or a ragdoll.

Glove states use otherwise-unused glove-mode snapshot timers: `dash` = ragdoll, `deflect` = stone, `heal` = chill, `throw` = Default speed burst, `dashCooldown` = ability cooldown. Legacy firearm meanings are unchanged outside glove mode. The protocol/snapshot version was bumped so old clients cannot silently interpret these as gun actions. Reliable combat events carry launches/ability destinations; snapshots also restore status/velocity after dropped presentation updates. Progress comes from a monotonic confirmed-hit counter, not disposable visual events. The final snapshot settles the final slap **before** results are created.

## Progression and limitations

Each confirmed direct slap grants one persistent slap, including practice. Starting at zero, Default is available; milestone unlocks are automatic and do not spend the total. Invalid profiles, impossible selected gloves and malformed counts are sanitized. Offline receipts and online match/hit counters deduplicate rewards. No reward is granted for whiffs, abilities, allies, blocked targets or repeated snapshots.

Profiles are local browser data; private/blocked storage falls back to session progress. They are not accounts, cloud saves or cheat-proof currency. With no user-deployed database/login backend, the authority must accept the sanitized starting profile claimed on joining. It then checks each requested glove against that baseline plus **authority-owned** confirmed hits. Editing local site storage is outside this casual system's security guarantee.

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

## Validation

Focused tests cover rig construction, profile sanitization/persistence, exact-once reward receipts, contact windups, damage/launch, enemies/LOS/range, passive effects, stone immunity, speed burst, wall-safe Flash, Swapper, recovery, articulated rig reuse, compact status/ID encoding, locked/hidden inventory restrictions, authority input execution and final-snapshot reward settlement.

Browser coverage uses actual mouse/key controls for hits and instant long slides, real landed hits to earn/equip/reload Diamond, locked collection and inversion settings, a narrow viewport, preparation glove selection, actual AI navigation/combat in the Foundry team arena, and a **static-only real WebRTC match with browser-worker authority**. Its test-only local PeerJS signaling is not an external deployment verification or a promise of connectivity through every NAT/firewall.

### Verified conversion results

- **556/556 unit tests passed**, including 16 focused glove regressions.
- **8/8 focused browser scenarios passed** in the final clean run (2.1 minutes), including real input/slide cancellation, glove unlock/persistence, a narrow layout, between-round selection, actual arena AI, production disconnected reload, and static-only real WebRTC combat.
- Production build passed, including the browser authority worker and versioned offline cache.
- In the recorded real-RTC run both peers received the same 126-health post-hit states and replicated launch/recovery state; each player had one authority-confirmed hit and one saved slap. This used local test signaling, not a public-network latency benchmark.
- In the AI test, real Foundry simulation first hits occurred at 4.308 simulated seconds in 1v1 and 1.892 simulated seconds in 2v2. Both reached eliminations and multiple round scores. These are accelerated simulation checks, not claims of wall-clock endurance testing.

Earlier test iterations caught an overly short/random-target team-AI assertion, a missing local Chromium executable setting and the final-hit settlement edge case; the results above refer to the subsequent clean complete runs. No external published-site deployment was verified.
