import {
  wheelZoom,
  cameraBoomFraction,
  updateOrbitCamera,
} from "../src/gloves/camera.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLOVE_ROSTER } from "../src/gloves/catalog.js";
import { createGloveModel, animateGlove } from "../src/gloves/model.js";
import { slapPose, gloveMotion } from "../src/gloves/motion.js";
import {
  GloveFX,
  GLOVE_FX_LIMITS,
  gloveAbilitySound,
} from "../src/gloves/fx.js";
import { weaponDisplayBounds } from "../src/weapon-preview.js";

test("slap contact is aligned with authority windup for every glove, and settles exactly to rest", () => {
  for (const g of GLOVE_ROSTER) {
    assert.equal(slapPose(0, g.windup).strike, 0);
    assert.equal(slapPose(g.windup, g.windup).strike, 1);
    assert.equal(slapPose(g.windup, g.windup).wind, 0);
    assert.equal(slapPose(g.windup + 0.5, g.windup).strike, 0);
  }
});
test("forehand/backhand and heavy motion are distinct without discontinuous position resets", () => {
  const a = gloveMotion("default", 0.095, 0.095, 1),
    b = gloveMotion("default", 0.095, 0.095, 2),
    heavy = gloveMotion("bull", 0.38, 0.38, 1);
  assert.notEqual(a.rz, b.rz);
  assert.ok(Math.abs(heavy.x) > Math.abs(a.x));
  for (const key of ["default", "dual", "bull"])
    for (const seq of [1, 2]) {
      const p = gloveMotion(key, 0, 0.095, seq);
      assert.equal(p.x, 0);
      assert.equal(p.z, 0);
      for (let i = 0; i < 150; i++)
        assert.ok(
          Object.values(gloveMotion(key, i / 240, 0.095, seq)).every(
            Number.isFinite,
          ),
        );
    }
});
test("all 24 gloves have owned PBR finishes and three-joint articulated digits, without changing the five-finger rig contract", () => {
  for (const g of GLOVE_ROSTER) {
    const m = createGloveModel(g.id),
      rig = m.userData.gloveRig;
    assert.equal(rig.fingers.length, 5);
    assert.ok(rig.main.isMeshPhysicalMaterial);
    assert.equal(rig.main.roughnessMap.image.width, 32);
    for (const digit of rig.fingers.slice(0, 4))
      assert.equal(digit.userData.phalanges.length, 2);
    let released = 0;
    rig.main.roughnessMap.addEventListener("dispose", () => released++);
    rig.main.dispose();
    assert.equal(released, 1);
  }
});
test("motion ribbons are excluded from preview bounds, hidden at rest, and disabled by reduced motion", () => {
  const m = createGloveModel("glove_default");
  animateGlove(m, { gloveSwingAge: 10 });
  const initial = weaponDisplayBounds(m).clone();
  animateGlove(m, { gloveSwingAge: 10 });
  assert.equal(m.userData.gloveRig.sweep.visible, false);
  assert.deepEqual(
    weaponDisplayBounds(m).getSize(new THREE.Vector3()).toArray(),
    initial.getSize(new THREE.Vector3()).toArray(),
  );
  animateGlove(m, { gloveSwingAge: 0.095, shake: true });
  assert.equal(m.userData.gloveRig.sweep.visible, true);
  animateGlove(m, { gloveSwingAge: 0.095, shake: false });
  assert.equal(m.userData.gloveRig.sweep.visible, false);
  animateGlove(m, { gloveSwingAge: 10 });
  assert.equal(m.userData.gloveRig.sweep.visible, false);
});
test("glove animation is analytic and non-accumulating, and never writes into camera/input state", () => {
  const m = createGloveModel("glove_dual"),
    state = {
      gloveSwingAge: 0.12,
      gloveSequence: 2,
      time: 3,
      gloveGold: 1,
      yaw: 0.2,
      pitch: 0.4,
    };
  animateGlove(m, state);
  const position = m.position.clone(),
    rotation = m.rotation.clone();
  for (let i = 0; i < 100; i++) animateGlove(m, state);
  assert.ok(m.position.equals(position));
  assert.deepEqual(m.rotation.toArray(), rotation.toArray());
  assert.equal(state.yaw, 0.2);
  assert.equal(state.pitch, 0.4);
});
test("pooled shockwaves and impact streaks remain fixed-size under sustained hits, expire, reset and dispose", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene),
    p = new THREE.Vector3(1, 1, 1),
    camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 1000; i++) fx.hit(p, "#e5b96f", i % 2 === 0);
  assert.equal(scene.children.length, 3);
  assert.equal(fx.rings.states.length, GLOVE_FX_LIMITS.rings);
  assert.equal(fx.rays.states.length, GLOVE_FX_LIMITS.rays);
  fx.update(0.01, camera);
  assert.ok(fx.rings.mesh.instanceMatrix.array.every(Number.isFinite));
  fx.update(1, camera);
  assert.ok(fx.rings.states.every((s) => s.life === 0));
  assert.ok(fx.rays.states.every((s) => s.life === 0));
  fx.hit(p, "white");
  fx.update(0.02, camera);
  fx.clear();
  assert.ok(fx.rings.progress.array.every((t) => t === 1));
  fx.dispose();
  assert.equal(scene.children.length, 0);
});
test("every active ability has finite bounded cosmetic cues, with LOS/mechanics remaining outside the effects layer", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene);
  for (const g of GLOVE_ROSTER.filter((g) => g.activation === "active")) {
    fx.ability({
      glove: g.id,
      position: [0, 1, 0],
      targetDestination: [2, 0, 2],
    });
    fx.update(0.02, new THREE.PerspectiveCamera());
    assert.ok(fx.rings.mesh.instanceMatrix.array.every(Number.isFinite));
    fx.clear();
  }
  fx.dispose();
});

test("mouse wheel smoothly spans first person to a bounded third-person boom without changing the glove", () => {
  assert.equal(wheelZoom(0, -100), 0);
  assert.equal(wheelZoom(0, 100), 1.2);
  let zoom = 0;
  for (let i = 0; i < 100; i++) zoom = wheelZoom(zoom, 100);
  assert.equal(zoom, 12);
  for (let i = 0; i < 100; i++) zoom = wheelZoom(zoom, -100);
  assert.equal(zoom, 0);
  assert.equal(wheelZoom(6, NaN), 6);
  assert.equal(wheelZoom(6, 0), 6);
});
test("camera boom stops at walls, floors, parallel segments and rotated solids", () => {
  const o = new THREE.Vector3(0, 1.66, 0),
    d = new THREE.Vector3(0, 1.66, 6);
  const wall = { minX: -2, maxX: 2, minY: 0, maxY: 4, minZ: 2, maxZ: 3 };
  assert.equal(cameraBoomFraction(o, d, []), 1);
  const t = cameraBoomFraction(o, d, [wall]);
  assert.ok(t > 0.25 && t < 0.3);
  assert.equal(cameraBoomFraction(o, d, [{ ...wall, minX: 3, maxX: 4 }]), 1);
  assert.ok(
    cameraBoomFraction(o, new THREE.Vector3(0, -3, 6), [
      { minX: -20, maxX: 20, minY: -2, maxY: 0, minZ: -20, maxZ: 20 },
    ]) < 0.4,
  );
  const rotated = {
    ...wall,
    cx: 0,
    cz: 2.5,
    halfX: 3,
    halfZ: 0.2,
    angle: Math.PI / 4,
  };
  assert.ok(cameraBoomFraction(o, d, [rotated]) < 0.5);
});
test("zoom changes only presentation, returns exactly to the eyes and never rotates aim", () => {
  const g = {
      camera: new THREE.PerspectiveCamera(),
      world: { boxes: [] },
      cameraZoom: 6,
      yaw: 0.7,
      pitch: 0.2,
    },
    eye = new THREE.Vector3(2, 1.66, 3);
  g.camera.rotation.set(0.2, 0.7, 0, "YXZ");
  const rotation = g.camera.rotation.toArray();
  updateOrbitCamera(g, eye, 1 / 60);
  assert.equal(g.thirdPerson, true);
  assert.ok(g.camera.position.distanceTo(eye) > 5);
  assert.deepEqual(g.camera.rotation.toArray(), rotation);
  assert.equal(g.yaw, 0.7);
  assert.equal(g.pitch, 0.2);
  g.cameraZoom = 0;
  for (let i = 0; i < 120; i++) updateOrbitCamera(g, eye, 1 / 60);
  assert.equal(g.thirdPerson, false);
  assert.ok(g.camera.position.equals(eye));
});
test("wall restriction does not reset requested zoom; stepping away restores third person", () => {
  const eye = new THREE.Vector3(0, 1.66, 0),
    g = {
      camera: new THREE.PerspectiveCamera(),
      world: {
        boxes: [{ minX: -2, maxX: 2, minY: 0, maxY: 4, minZ: 0.4, maxZ: 1 }],
      },
      cameraZoom: 6,
      yaw: 0,
      pitch: 0,
    };
  updateOrbitCamera(g, eye, 1 / 60);
  assert.equal(g.thirdPerson, false);
  assert.ok(g.camera.position.z < 0.4);
  assert.equal(g.cameraZoom, 6);
  g.world.boxes = [];
  updateOrbitCamera(g, eye, 1 / 60);
  assert.equal(g.thirdPerson, true);
});
test("gas puffs drift, remain bounded, expire, and are presentation only; ability sound families are distinct", () => {
  const scene = new THREE.Scene(),
    fx = new GloveFX(scene),
    p = new THREE.Vector3();
  for (let i = 0; i < 100; i++) fx.gas(p, 0.4, 16);
  assert.equal(fx.puffs.states.length, 64);
  fx.update(0.1, new THREE.PerspectiveCamera());
  assert.ok(fx.puffs.mesh.instanceMatrix.array.every(Number.isFinite));
  fx.update(2);
  assert.ok(fx.puffs.states.every((s) => s.life === 0));
  fx.clear();
  assert.ok(fx.puffs.progress.array.every((x) => x === 1));
  fx.dispose();
  assert.equal(scene.children.length, 0);
  const families = new Set(
    GLOVE_ROSTER.filter((g) => g.activation === "active").map((g) =>
      gloveAbilitySound(g.key),
    ),
  );
  assert.ok(families.size >= 7);
});
