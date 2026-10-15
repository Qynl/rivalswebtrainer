import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as THREE from "three";
import { ArenaWorld } from "../src/world.js";
import { ARENA, HALF_COVER, HALF_WINDOWS } from "../src/arena-layout.js";
import { EXTRA_COURTS } from "../src/map-layouts.js";
import { addElevations } from "../src/elevation-layout.js";
// Exact shared primitive geometry, no DOM, textures, WebGL, or client geometry claims.
export function createServerWorld(id = "blockout") {
  const layout = id === "blockout" ? ARENA : EXTRA_COURTS[id];
  if (!layout) throw Error("Unsupported online map");
  const world = {
    boxes: [],
    solidMeshes: [],
    group: new THREE.Group(),
    blockMaterial: new THREE.MeshBasicMaterial(),
    layout,
    spawns: { 0: [], 1: [] },
    bounds: {
      minX: -layout.width / 2 + 0.44,
      maxX: layout.width / 2 - 0.44,
      minZ: -layout.depth / 2 + 0.44,
      maxZ: layout.depth / 2 - 0.44,
    },
  };
  world.box = (x, y, z, w, h, d, color, solid = true) => {
    const mesh = new THREE.Mesh(
      w >= 0.7 && h >= 0.7 && d >= 0.7
        ? new RoundedBoxGeometry(w, h, d, 1, 0.045)
        : new THREE.BoxGeometry(w, h, d),
      world.blockMaterial,
    );
    mesh.position.set(x, y, z);
    world.group.add(mesh);
    if (solid) {
      world.boxes.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: y - h / 2,
        maxY: y + h / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
      world.solidMeshes.push(mesh);
    }
    return mesh;
  };
  for (const name of ["concrete", "windowCover", "ramp"])
    world[name] = ArenaWorld.prototype[name].bind(world);
  const { width: w, depth: d, wallHeight: h, wallThickness: t } = layout;
  world.box(0, -0.1, 0, w, 0.2, d, 0, false);
  world.solidMeshes.push(world.group.children.at(-1));
  for (const side of [-1, 1]) {
    world.concrete((side * (w + t)) / 2, 0, t, h, d + t * 2);
    world.concrete(0, (side * (d + t)) / 2, w + t * 2, h, t);
    for (const b of layout.cover || HALF_COVER)
      world.concrete(b.x * side, b.z * side, b.w, b.h, b.d, b.angle);
    for (const b of layout.windows || HALF_WINDOWS)
      world.windowCover(b.x * side, b.z * side, b.w, b.h, b.d, b.axis);
    world.ramp(
      -layout.rampX * side,
      -layout.rampZ * side,
      layout.rampWidth,
      layout.rampLength,
      layout.rampRise,
      -side,
    );
    world.concrete(
      -layout.rampX * side,
      -layout.platformZ * side,
      layout.rampWidth,
      layout.rampRise,
      layout.platformLength,
    );
    world.boxes.at(-1).walkable = true;
    const team = side > 0 ? 0 : 1;
    world.spawns[team] = [0, -layout.spawnSpread, layout.spawnSpread].map(
      (x) => ({ x: x * side, z: side * layout.spawnZ }),
    );
  }
  addElevations(world, layout, { dress: false });
  world.group.updateMatrixWorld(true);
  world.dispose = () => {
    world.group.traverse((o) => o.geometry?.dispose());
    world.blockMaterial.dispose();
  };
  return world;
}
