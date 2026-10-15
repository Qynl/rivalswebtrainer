# Forward-facing Bow correction

The earlier Bow looked backwards in the supplied first-person screenshot: its limb tips swept toward the target and its right-side grip/draw pose read incorrectly. This correction changes the actual shared model/rig, not the projectile aim or camera.

- Left hand holds the bow on the left; the right hand pulls the string, with its forearm angled back toward the right shoulder. Hip yaw points inward toward the crosshair.
- Limb tips/cams now sweep toward the archer, behind the riser. The string nock stays behind those tips; the arrowhead stays ahead of the riser and points along local **negative Z** throughout draw.
- String endpoints and cams are calculated from the real animated limb-tip transform. This removes the previous guessed endpoint positions and keeps all axes attached through rest, partial draw and full draw.
- The sight has a connected mounting bracket; pivot bushings are attached to the limbs instead of appearing as floating ovals in front of them.
- World-held Bows use the same facing; operator wrists target the actual left-grip and right-pull coordinates.
- Arrow speed, damage, 0.8-second charge, gravity, release/re-nocking and mouse aim are unchanged. Self-immunity and RPG/Knife combos remain intact.
- The existing low-ammo color no longer warns on a completely full one-round Bow/RPG magazine.

Validation: 279 Node tests pass. Three new unit regressions cover facing/handedness, exact limb/cam/string linkage across draw, forward arrow geometry, material validity, clear ADS and world wrist alignment. Five real Chromium checks passed together, including rest/full-draw/ADS screenshots, actual forward arrow release/re-nocking, the existing loadout/Bow input flow, trickshots and all 26 rendered weapon models. The updated production build passes. Screenshots are inspection artifacts in `/tmp`, not committed assets. Software WebGL checks establish correctness, not a representative device frame rate.
