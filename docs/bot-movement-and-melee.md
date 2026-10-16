# Physical bot movement and melee

## Scope

Replace rifle-only movement with local, deliberate player-like actions. Existing visible-target priority, reaction resets, last-known-position navigation, cover plans and teammate separation remain in place. No extra HUD is added. Range targets still do not fight.

Each combat bot has a rifle and one melee: Scythe, Katana, Fists or Knife, selected by roster index and rotated between rounds. The player loadout is not changed. A 3v3 roster includes all four melee styles; a 1v1 opponent changes styles between rounds rather than secretly owning every ability.

## Implemented actions

- **Scythe dash:** real horizontal 28-unit/s impulse, 0.24-second dash and 3-second cooldown. Preserves airborne carry; swept body collision removes blocked speed. Used for clear combat gap closes, defensive movement and clear traversal segments. It is not a teleport.
- **Katana guard:** 1.1-second guard with 3.5-second cooldown. Chosen after perception/reaction when observed enemy shooting or damage pressure warrants it. Uses the game's real frontal ray reflection, changes reflected-shot ownership, and still permits rear hits, melee and explosives. It is not activated by bullet contact.
- **Quick secondary:** dash/guard from rifle stance displays the melee temporarily without equipping it permanently, spending rifle ammo or starting a slash. Fists/Knife do not gain an invented F ability.
- **Slides and slide-jumps:** player slide boost, 0.27-second duration, 0.72-second slide cooldown, real 1.15-unit low body, steering and queued jump cancellation after approximately 0.10–0.14 seconds. The jump uses player impulse/slope launch and retains horizontal momentum. Bots deliberately space out their mobility chains rather than input-spamming every available frame.
- **Fists movement:** equip Fists on longer unseen routes, chain a slide-jump into an apex double-jump while actually holding Fists, then return to rifle when engaging at range. A hidden opponent's current elevation does not trigger a double-jump.
- **Close-fire jumps:** reaction-gated physical dodges between close-range swings when under visible shooting pressure, not the old random-jump/cosmetic-slide flag.
- **Melee combat:** switch delay, visible swing, 0.12-second committed windup and weapon-specific cooldown. Resolve the nearest valid enemy against current range, committed facing cone and current line of sight at impact. Moving away, stepping behind cover or killing the attacker can prevent the hit. Knife uses directional backstabs; one victim per swing.
- **Rifle restrictions:** no shots during switch, swing, guard, quick-secondary window or reload. Weapon selection runs before firing so a new ability cannot also fire a rifle in that tick. Ammo is granted only when reload completes; switching to melee cancels an unfinished rifle reload without a free magazine.

Movement uses the same acceleration, air steering, slide steering, swept body solver and vertical support solver as the player. Clearance probes include body width, rotated slabs, ramps and map bounds, not only a thin visibility ray. Low ceilings suppress queued standing jumps; the body and pose stay low until standing fits. Global A* remains a ground-grid route planner.

## Visible/audio feedback

Third-person bots cache a world-sized detailed melee model under the character's existing weapon rig. Rifle/muzzle visibility follows the actual active/quick weapon state. Katana is held forward across the face, Scythe has a readable full-body silhouette, Knife strikes forward, and Fists use the actual character hands. Hand IK follows the weapon socket rather than leaving a floating prop. Models are owned and disposed by the normal character lifecycle; repeated abilities do not rebuild them.

Slides lower/lean the upper body, bend the knees and reposition the belt instead of scaling the entire character. Gun/head pitch compensates for body lean. Guard contacts flash the blade. Action cues use the existing capped spatial-audio system. There are no new always-on status panels.

## Validation

- **144/144 Node tests**: existing controls, combat, movement, rendering, audio and rigging tests plus 20 new bot tests. New coverage includes dash impulse/cooldown, quick-secondary semantics, no invented Fists/Knife ability, capsule/rotated-wall/bounds probes, collision momentum removal, physical slide-jump, low-ceiling stance, equipped-only extra jump, switch/windup locks, perception/reaction, current cone/range/LOS, death interruption, backstab facing, actual frontal reflection/rear hits, cached models, reload cancellation and hidden-elevation fairness.
- **12/12 browser tests** including the existing full game, controls, locomotion, 23-weapon rendering and production disconnected reload checks.
- **Accelerated two-minute 3v3 Arena simulation:** all five bots keep navigating; no non-finite positions, below-floor states or map escapes. Assertions require autonomous dash, slide, slide-jump, Fists double-jump, melee switching/swings/hits and rifle shots, plus all four melee archetypes. Damage is replaced with a hit counter in this test so actors stay alive for navigation coverage. This is simulated time, not an endurance/FPS claim; action counts vary with random tactical decisions.
- **Controlled real-Arena combat scenarios:** planner-selected quick Scythe dash at 28 units/s with rifle/ammo intact; planner-selected quick Katana guard reflecting an actual bullet without taking damage; an equipped-Fists slide-jump/double-jump chain with a physical low body; and a switched Knife swing causing actual damage. All four retain real WebGL rendering and check for browser/GL errors.
- **Five rendered full-body pose captures:** Scythe dash, Katana guard, Knife swing, slide and airborne Fists. Inspected and adjusted blade placement so guards and strikes are forward of the body rather than buried inside it. The controlled pose audit reports no browser/GL errors.
- Production build and whitespace validation pass.

Run the pose audit against preview port 5173:

```sh
npm run audit:bots -- /tmp/bot-poses
```

`BROWSER_EXECUTABLE` and `ARENA_URL` can override the browser binary and local preview URL. Output screenshots stay outside Git. The audit is deliberately paused and is not a hardware FPS benchmark.

## Limits

These are purpose-built local behavior rules, not learned human/RIVALS gameplay or an exact recreation. Rifle remains the bots' only ranged weapon; no new utility or 23-weapon bot switching system is claimed. Bots do not plan sophisticated rooftop trick routes. Melee damage and weapon dimensions retain this original trainer's approximate balance. Improvements here do not establish a hardware performance number.


Current movement tuning supersedes this pass's original speed/launch figures: bots now share the capped ramp assistance, lower jump impulse and smaller slide boost described in [controlled movement](controlled-movement.md). Difficulty movement speeds were reduced proportionally; aim, reaction time and tactical behavior are unchanged.
