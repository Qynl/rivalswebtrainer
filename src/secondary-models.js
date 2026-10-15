import * as THREE from "three";
import { rememberPart } from "./animation.js";
// Original sidearm silhouettes. Attachments keep their own transforms for live cycling/reloads.
export function buildSecondary(
  g,
  id,
  { box, cyl, tube, material, dark, steel, silver, grip, hand, sights, hands },
) {
  const brass = material(0xc4a46a, 0.7, 0.35),
    optic = material(0x8fe5d0, 0.2, 0.3);
  if (id === "revolver") {
    box(0.24, -0.17, -0.61, 0.12, 0.14, 0.24, steel);
    box(0.24, -0.105, -0.79, 0.1, 0.055, 0.43, steel);
    cyl(0.24, -0.16, -0.87, 0.035, 0.29, steel);
    cyl(0.24, -0.16, -1.025, 0.039, 0.025, dark);
    cyl(0.24, -0.16, -1.042, 0.021, 0.008, dark);
    box(0.24, -0.34, -0.48, 0.105, 0.23, 0.13, grip).rotation.x = -0.3;
    for (const side of [-1, 1]) {
      box(
        0.24 + side * 0.054,
        -0.335,
        -0.475,
        0.012,
        0.16,
        0.09,
        material(0x715848, 0.05, 0.8),
      ).rotation.x = -0.3;
      for (let i = 0; i < 4; i++)
        box(
          0.24 + side * 0.062,
          -0.29 - i * 0.025,
          -0.47,
          0.005,
          0.007,
          0.075,
          dark,
        );
      cyl(0.24 + side * 0.065, -0.22, -0.49, 0.011, 0.008, silver, "x");
    }
    tube(
      [
        [0.24, -0.22, -0.64],
        [0.24, -0.3, -0.64],
        [0.24, -0.31, -0.53],
        [0.24, -0.23, -0.5],
      ],
      0.01,
      steel,
    );
    const drum = new THREE.Group();
    drum.position.set(0.24, -0.16, -0.64);
    g.add(drum);
    g.userData.revolverCylinder = rememberPart(drum);
    cyl(0, 0, 0, 0.087, 0.19, dark, "z", drum);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        x = Math.cos(a) * 0.061,
        y = Math.sin(a) * 0.061;
      cyl(x, y, 0, 0.026, 0.198, steel, "z", drum);
      cyl(x, y, 0.105, 0.018, 0.012, brass, "z", drum);
      cyl(x, y, -0.103, 0.017, 0.008, dark, "z", drum);
    }
    const hammer = box(0.24, -0.088, -0.455, 0.027, 0.055, 0.035, dark);
    g.userData.hammer = rememberPart(hammer);
    sights(-0.986, -0.48);
    g.userData.muzzleZ = -1.06;
    if (hands) {
      hand(0.24, -0.37, -0.45);
      hand(0.16, -0.39, -0.51);
    }
  } else if (id === "burstpistol") {
    const slide = box(0.24, -0.15, -0.66, 0.125, 0.115, 0.36, steel);
    g.userData.bolt = rememberPart(slide);
    box(0.24, -0.228, -0.65, 0.12, 0.04, 0.32, dark);
    box(0.24, -0.34, -0.51, 0.1, 0.22, 0.13, grip).rotation.x = -0.2;
    cyl(0.24, -0.16, -0.865, 0.026, 0.09, silver);
    cyl(0.24, -0.16, -0.914, 0.028, 0.017, dark);
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const v = box(
          0.24 + side * 0.063,
          -0.147,
          -0.55 - i * 0.016,
          0.008,
          0.072,
          0.006,
          dark,
        );
        v.position.sub(slide.position);
        slide.add(v);
      }
    const mag = box(0.24, -0.445, -0.49, 0.087, 0.22, 0.115, dark);
    g.userData.magazine = rememberPart(mag);
    box(0, -0.115, 0, 0.105, 0.025, 0.13, silver, mag);
    tube(
      [
        [0.24, -0.24, -0.69],
        [0.24, -0.31, -0.68],
        [0.24, -0.31, -0.54],
      ],
      0.009,
      dark,
    );
    // An actual open reflex frame, rather than a solid plate over the target.
    for (const x of [0.205, 0.275])
      box(x, -0.039, -0.57, 0.009, 0.075, 0.022, dark);
    box(0.24, -0.003, -0.57, 0.079, 0.009, 0.022, dark);
    box(0.24, -0.075, -0.57, 0.079, 0.012, 0.03, dark);
    box(0.24, -0.031, -0.58, 0.006, 0.006, 0.005, optic);
    g.userData.adsPoint = new THREE.Vector3(0.24, -0.031, -0.58);
    g.userData.muzzleZ = -0.94;
    if (hands) {
      hand(0.24, -0.38, -0.48);
      hand(0.16, -0.38, -0.57);
    }
  } else {
    g.userData.bolts = [];
    g.userData.magazines = [];
    g.userData.dualGuns = [];
    for (const side of [1, -1]) {
      const gun = new THREE.Group();
      gun.position.x = side * 0.24;
      g.add(gun);
      g.userData.dualGuns.push(rememberPart(gun));
      const slide = box(
        0,
        -0.15,
        -0.66,
        0.11,
        0.105,
        0.32,
        side === 1 ? steel : material(0x778b94, 0.6, 0.35),
        gun,
      );
      g.userData.bolts.push(rememberPart(slide));
      box(0, -0.218, -0.63, 0.105, 0.035, 0.29, dark, gun);
      box(0, -0.33, -0.52, 0.095, 0.21, 0.125, grip, gun).rotation.x = -0.2;
      cyl(0, -0.16, -0.84, 0.025, 0.065, silver, "z", gun);
      cyl(0, -0.16, -0.875, 0.027, 0.012, dark, "z", gun);
      const mag = box(0, -0.415, -0.5, 0.08, 0.17, 0.11, dark, gun);
      g.userData.magazines.push(rememberPart(mag));
      box(0, -0.09, 0, 0.1, 0.025, 0.125, silver, mag);
      for (let i = 0; i < 5; i++) {
        const d = box(
          side * 0.057,
          -0.145,
          -0.55 - i * 0.013,
          0.007,
          0.063,
          0.006,
          dark,
          gun,
        );
        d.position.sub(slide.position);
        slide.add(d);
      }
      for (const x of [-0.02, 0.02]) {
        const d = box(x, -0.084, -0.52, 0.008, 0.027, 0.028, dark, gun);
        d.position.sub(slide.position);
        slide.add(d);
      }
      box(0, -0.083, -0.79, 0.008, 0.009, 0.01, optic, gun);
      const guard = tube(
        [
          [side * 0.24, -0.24, -0.67],
          [side * 0.24, -0.3, -0.65],
          [side * 0.24, -0.3, -0.53],
        ],
        0.009,
        dark,
      );
      gun.add(guard);
      guard.position.x = -side * 0.24;
      // Recoil pivots at the grip, not at the camera; the whole gun stays in the hand.
      const offset = new THREE.Vector3(0, 0.34, 0.5);
      for (const child of gun.children) {
        child.position.add(offset);
        child.userData.restPosition?.add(offset);
      }
      gun.position.y = -0.34;
      gun.position.z = -0.5;
      rememberPart(gun);
      if (hands) hand(side * 0.24, -0.375, -0.48);
    }
    g.userData.bolt = g.userData.bolts[0];
    g.userData.adsPoint = new THREE.Vector3(0, -0.035, -0.58);
    g.userData.muzzleZ = -0.9;
  }
  g.userData.secondaryRevision = "sidearms-v1";
}
