import * as THREE from "three";
export function presentGloveStates(g, e) {
  if (!e.model) return;
  const group = e.model.group,
    enemy = e.team !== g.player?.team;
  group.visible = !(e.ghostTime > 0 && enemy);
  if (!group.visible) return;
  let aura = e.model.gloveAura;
  if (!aura && (e.goldTime > 0 || e.reverseTime > 0 || e.spaceTime > 0)) {
    aura = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.024, 6, 32),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.8,
        color: "#f5cd65",
        depthWrite: false,
      }),
    );
    aura.position.y = 0.85;
    aura.name = "glove-status-aura";
    group.add(aura);
    e.model.gloveAura = aura;
  }
  if (aura) {
    aura.visible = e.goldTime > 0 || e.reverseTime > 0 || e.spaceTime > 0;
    aura.material.color.set(
      e.goldTime > 0 ? "#f5cd65" : e.reverseTime > 0 ? "#c8dc83" : "#a4a0f4",
    );
    aura.rotation.set(Math.PI / 2, 0, g.clock * 2);
  }
  if (e.activeWeapon === "glove_acrobat" && e.boostTime > 0) {
    const phase = Math.max(0, Math.min(1, 1 - e.boostTime / 0.5));
    if (e.model.parts.upperBody)
      e.model.parts.upperBody.rotation.x -= Math.sin(phase * Math.PI) * 1.1;
  }
}
