import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCharacter } from "../src/world.js";
import { updateBotWeapon } from "../src/bot-visuals.js";
import { presentRagdoll, ragdollFloorHeight } from "../src/gloves/ragdoll.js";
function actor(id = "glove_default") {
  const e = {
    model: createCharacter(1, "KIT", { unarmed: true }),
    alive: true,
    activeWeapon: id,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    ragdollTime: 0.7,
    ragdollGeneration: 1,
  };
  updateBotWeapon(e.model, e, 0);
  return e;
}
test("ragdolls retain the original actor kit, boots, carrier, skin and team material instead of switching to a generic puppet", () => {
  const e = actor();
  const armor = e.model.parts.armorMaterial;
  presentRagdoll({ clock: 1 }, e, 1 / 120);
  const rig = e.model.gloveRagdoll;
  assert.equal(rig.chest.name, "ragdoll-kit-torso");
  assert.ok(rig.ends.some((e) => e.mesh.name === "ragdoll-kit-leftFoot"));
  assert.equal(rig.constraints.filter((c) => c.detailed).length, 8);
  let sameArmor = false;
  rig.chest.traverse((o) => {
    if (o.material === armor) sameArmor = true;
  });
  assert.equal(sameArmor, true);
  assert.equal(e.model.parts.torso.parent.visible, false);
});
test("the existing glove follows the ragdoll hand and restores its socket/pose without creating a duplicate model", () => {
  const e = actor();
  const socket = e.model.parts.onlineSocket,
    glove = socket.userData.weapon,
    position = glove.position.clone(),
    scale = glove.scale.clone();
  const g = { clock: 1 };
  presentRagdoll(g, e, 1 / 120);
  const rig = e.model.gloveRagdoll;
  assert.equal(rig.grips.length, 1);
  assert.equal(glove.parent, rig.root);
  assert.equal(socket.userData.weapon, glove);
  for (let i = 0; i < 60; i++) {
    g.clock += 1 / 120;
    presentRagdoll(g, e, 1 / 120);
  }
  assert.ok(glove.matrix.elements.every(Number.isFinite));
  e.ragdollTime = 0;
  presentRagdoll(g, e, 1 / 120);
  assert.equal(glove.parent, socket);
  assert.ok(glove.position.equals(position));
  assert.ok(glove.scale.equals(scale));
  assert.equal(rig.grips.length, 0);
});
test("Dual uses both physical ragdoll hands and restores its mirrored child hierarchy on recovery", () => {
  const e = actor("glove_dual"),
    primary = e.model.parts.onlineSocket.userData.weapon,
    secondary = primary.userData.secondGlove;
  presentRagdoll({ clock: 1 }, e, 1 / 120);
  const rig = e.model.gloveRagdoll;
  assert.equal(rig.grips.length, 2);
  assert.equal(secondary.parent, rig.root);
  assert.notEqual(primary.position.x, secondary.position.x);
  e.ragdollTime = 0;
  presentRagdoll({ clock: 2 }, e, 1 / 120);
  assert.equal(secondary.parent, primary);
  assert.equal(secondary.scale.x, -1);
});
test("ragdoll recovery preserves previously hidden child visibility", () => {
  const e = actor();
  const child = new THREE.Group();
  child.visible = false;
  e.model.group.add(child);
  presentRagdoll({ clock: 1 }, e, 1 / 120);
  e.ragdollTime = 0;
  presentRagdoll({ clock: 2 }, e, 1 / 120);
  assert.equal(child.visible, false);
});
test("cosmetic ragdoll floor support follows elevated slabs and ramps, rather than falling through them toward world zero", () => {
  const slab = { minX: -3, maxX: 3, minZ: -3, maxZ: 3, minY: 0, maxY: 3.4 };
  const e = actor();
  e.y = 3.4;
  assert.ok(
    Math.abs(
      ragdollFloorHeight([slab], e, new THREE.Vector3(0, 0.4, 0)) - 0.07,
    ) < 1e-9,
  );
  const ramp = {
    minX: -3,
    maxX: 3,
    minZ: -3,
    maxZ: 3,
    minY: 0,
    maxY: 3,
    ramp: { axis: "z", rise: 3, direction: 1 },
  };
  e.y = 1.5;
  assert.ok(
    Math.abs(
      ragdollFloorHeight([ramp], e, new THREE.Vector3(0, 0.4, 0)) - 0.07,
    ) < 1e-9,
  );
  e.y = 3.4;
  for (let i = 0; i < 100; i++)
    presentRagdoll({ clock: i / 120, world: { boxes: [slab] } }, e, 1 / 120);
  assert.ok(e.model.gloveRagdoll.nodes.every((n) => n.p.y >= 0.0699));
  assert.equal(e.y, 3.4);
});

test("impact direction changes the physical-looking limb reaction without changing gameplay velocity", () => {
  const a = actor(),
    b = actor();
  a.vx = 20;
  b.vx = -20;
  a.vy = b.vy = 5;
  presentRagdoll({ clock: 1 }, a, 1 / 120);
  presentRagdoll({ clock: 1 }, b, 1 / 120);
  assert.notEqual(
    a.model.gloveRagdoll.nodes[5].p.x,
    b.model.gloveRagdoll.nodes[5].p.x,
  );
  assert.equal(a.vx, 20);
  assert.equal(b.vx, -20);
  assert.equal(a.vy, 5);
});

test("oversized Dual palms stay above an elevated floor rather than vanishing beneath it", () => {
  const e = actor("glove_dual");
  e.y = 3.4;
  const slab = { minX: -3, maxX: 3, minZ: -3, maxZ: 3, minY: 0, maxY: 3.4 };
  for (let i = 0; i < 90; i++)
    presentRagdoll({ clock: i / 120, world: { boxes: [slab] } }, e, 1 / 120);
  e.model.group.updateMatrixWorld(true);
  for (const grip of e.model.gloveRagdoll.grips) {
    const bounds = new THREE.Box3().setFromObject(
      grip.weapon.userData.gloveRig.wrist,
      true,
    );
    assert.ok(bounds.min.y >= 3.38, `palm below platform: ${bounds.min.y}`);
  }
});
