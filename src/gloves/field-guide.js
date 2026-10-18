// Small, truthful matchup hints, not invented win rates or numerical ratings.
export const GLOVE_GUIDE = Object.freeze(
  Object.fromEntries(
    Object.entries({
      default: [
        "Use the burst to close a gap or escape chill, then place a real slap.",
        "Let the initial burst pass; punish the recovery instead of chasing it.",
      ],
      diamond: [
        "Block a visible attack, then E-exit when it is safe to fight again.",
        "Wait out the rock and space for its exit; the stone cannot chase you.",
      ],
      extended: [
        "Keep enemies at the distant tip and place deliberate slow swings.",
        "Rush under the handle, move sideways or jump above the tip.",
      ],
      dual: [
        "Separate your hands across two opponents; each confirmed target earns two slaps.",
        "Avoid lining up with a teammate inside the same wide sweep.",
      ],
      brick: [
        "Build an escape lane behind you and draw a grounded pursuer into it.",
        "Watch the arming brick and jump over it; allies do not trigger it.",
      ],
      snow: [
        "Land a slap to control the chase while the five-second chill lasts.",
        "Use cover or mobility; Default clears chill and Speedrun resists it.",
      ],
      acrobat: [
        "Hold WASD with E for a side, backward or diagonal roll; aim stays independent.",
        "Bait the committed direction. A roll is movement, not invulnerability.",
      ],
      pull: [
        "Pull an opponent out of a good position, then reposition before they recover.",
        "Prepare for an inward launch rather than backing into another enemy.",
      ],
      flash: [
        "Aim a clear route and blink past danger; blocked blinks keep their cooldown.",
        "Watch the arrival and punish after the blink; walls still stop it.",
      ],
      spring: [
        "Use higher jumps to change height and challenge narrow horizontal attacks.",
        "Track the landing rather than trying to slap the top of the jump.",
      ],
      swapper: [
        "Center a visible opponent and check the swap cue before committing.",
        "Break sight or leave the reticle. Hidden and protected targets cannot be selected.",
      ],
      bull: [
        "Space for the long tell; a lined-up heavy slap can catch three enemies.",
        "Step outside the slow swing, then punish its long recovery.",
      ],
      dice: [
        "React to the accepted roll: high rolls launch harder, low rolls need spacing.",
        "Do not assume every hit has the same launch; watch the actual outcome.",
      ],
      ghost: [
        "Use invisibility to approach or reposition; your attack reveals you.",
        "Watch the activation and nearby movement. Invisibility does not block a slap.",
      ],
      thanos: [
        "Mark a safe retreat before engaging, then return before the mark expires.",
        "Pressure the known fight position; a return restores position, not health.",
      ],
      stun: [
        "Charge EMP when grounded opponents cannot safely interrupt you.",
        "Jump during the visible warning or break line of sight before release.",
      ],
      za_hando: [
        "Point the lane before E; stay committed until the pull releases.",
        "Sidestep the narrow lane, get inside its near gap or interrupt the caster.",
      ],
      magnet: [
        "Face your intended enemy and check the rush cue. Rush yourself into slap range.",
        "Dodge sideways or use a wall; the rush neither teleports nor homes around cover.",
      ],
      anchor: [
        "Place Dock before the fight; position so the marker redirects victims where you want.",
        "Consider the marker direction, not just the attacker, when planning your escape.",
      ],
      space: [
        "Use low gravity to change routes; E can restore gravity early after rearm.",
        "Track the glide and pressure its landing. Low gravity is not protection.",
      ],
      boomerang: [
        "Expect the stronger return after the first hit and space for that second motion.",
        "The delayed return changes velocity but is not a second damaging slap.",
      ],
      speedrun: [
        "Use constant speed to choose fights; lighter slaps reward good spacing.",
        "Hold a useful angle rather than racing directly after the faster glove.",
      ],
      golden: [
        "Spend the short protected window taking space and landing stronger launches.",
        "Back off for three seconds, then punish the long ability cooldown.",
      ],
      reverse: [
        "Time reflection against an actual swing; do not spend it too early.",
        "Wait out the two-second reflection; mutual Reverse cancels without rewards.",
      ],
    }).map(([key, [play, counter]]) => [key, Object.freeze({ play, counter })]),
  ),
);
