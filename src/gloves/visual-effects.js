import { createStatusRig, animateStatusRig } from "./status-rig.js";
export function presentGloveStates(g, e) {
  if (!e.model) return;
  const group = e.model.group,
    enemy = e.team !== g.player?.team;
  group.visible = !(e.ghostTime > 0 && enemy);
  if (!group.visible) return;
  let aura = e.model.gloveAura;
  if (!aura && (e.goldTime > 0 || e.reverseTime > 0 || e.spaceTime > 0)) {
    aura = e.model.gloveAura = createStatusRig();
    group.add(aura);
  }
  if (aura) animateStatusRig(aura, e, g.clock);
  if (e.activeWeapon === "glove_acrobat" && e.boostTime > 0) {
    const phase = Math.max(0, Math.min(1, 1 - e.boostTime / 0.5));
    if (e.model.parts.upperBody)
      e.model.parts.upperBody.rotation.x -= Math.sin(phase * Math.PI) * 1.1;
  }
}
