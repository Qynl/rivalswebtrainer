// Reuse only the currently attached, collision-ready map. Explicit world.build
// remains a force-rebuild API; no inactive maps or extra GPU resources are kept.
export function ensureWorldMap(world, id = "blockout") {
  if (world.mapId === id && world.nav && world.group?.children.length)
    return false;
  world.build(id);
  return true;
}
