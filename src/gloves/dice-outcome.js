// Cosmetic state from accepted authority hits only. The existing reliable event
// already carries its roll; no prediction, RNG, extra damage or rewards here.
export function recordDiceOutcome(g, event, source) {
  if (
    !source ||
    g.headless ||
    event.glove !== "glove_dice" ||
    !(event.direct ?? event.earned) ||
    !Number.isInteger(event.roll) ||
    event.roll < 1 ||
    event.roll > 6
  )
    return false;
  if (
    event.round !== undefined &&
    g.round !== undefined &&
    event.round !== g.round
  )
    return false;
  source.diceRoll = event.roll;
  source.diceRollAt = g.clock;
  return true;
}
