import * as THREE from "three";
export function presentGloveStates(g, e) {
  if (!e.model) return;
  const group = e.model.group,
    enemy = e.team !== g.player?.team;
  group.visible = !(e.ghostTime > 0 && enemy);
  if (!group.visible) return;
  let aura = e.model.gloveAura;
  if (!aura && (e.goldTime > 0 || e.reverseTime > 0 || e.spaceTime > 0)) {
    aura = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.58 + i * 0.045, 0.015, 5, 36, Math.PI * 1.4),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.48,
          color: "#f5cd65",
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      arc.rotation.set(Math.PI / 2 + i * 0.38, i * 0.8, i * 2.1);
      aura.add(arc);
    }
    aura.position.y = 0.85;
    aura.name = "glove-status-aura";
    group.add(aura);
    e.model.gloveAura = aura;
  }
  if (aura) {
    aura.visible = e.goldTime > 0 || e.reverseTime > 0 || e.spaceTime > 0;
    const color =
      e.goldTime > 0 ? "#f5cd65" : e.reverseTime > 0 ? "#c8dc83" : "#a4a0f4";
    aura.children.forEach((arc, i) => {
      arc.material.color.set(color);
      arc.rotation.z = g.clock * (i % 2 ? -1 : 1) * (1.2 + i * 0.3) + i * 2.1;
      arc.material.opacity = 0.32 + Math.sin(g.clock * 3 + i) * 0.1;
    });
    aura.rotation.y = g.clock * 0.35;
  }
  if (e.activeWeapon === "glove_acrobat" && e.boostTime > 0) {
    const phase = Math.max(0, Math.min(1, 1 - e.boostTime / 0.5));
    if (e.model.parts.upperBody)
      e.model.parts.upperBody.rotation.x -= Math.sin(phase * Math.PI) * 1.1;
  }
}
