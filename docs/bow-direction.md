# Bow body-plane correction

The earlier handedness/direction fix did not resolve the user's complaint about the **curved body/limbs**. Its limb backbone still swept sideways by 10 cm between the riser and cams. This made the body twisted relative to the arrow/string plane; the previous orientation tests did not check that geometry.

## Current correction

- Upper and lower limb backbones now curve only in the vertical/fore-aft plane. They no longer bend laterally across the grip. Their tips sweep toward the archer, not toward the target.
- Riser, pivot bushings, grip and cams share the same lateral axis, within 1 cm of the arrow/string. The sight and its bracket follow the riser; the support hand and world-held operator wrist follow the actual grip.
- This is a change to the shared model geometry, **not** another whole-weapon flip. The existing left-hold/right-draw orientation, pulling-hand rotation and limb/cam/string animation remain intact.
- Arrow direction stays local **negative Z**. Arrow speed, damage, charge duration, gravity, release/re-nocking, camera aim, self-immunity and RPG/Knife combos are unchanged.

## Validation

- 280 Node tests pass. The added regression samples the actual TubeGeometry curve, checks that it does not sweep sideways, checks body/grip/cam/arrow alignment, and verifies that the resting string clears the middle of each limb.
- Five focused Chromium tests passed together: Bow rest/full-draw/ADS and actual arrow release/re-nocking, loadout/input flow, explosive-launch/Knife trickshots, operator rendering and all 26 weapon models. The Bow browser test additionally checks the real loaded limb curves, so an old laterally bent model fails even if its arrow still flies forward.
- Rest, full-draw and ADS screenshots were inspected. Production build passes. Software WebGL validation is not a hardware frame-rate measurement.
