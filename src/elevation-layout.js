// Geometry and server collision use these same authored second-storey pieces.
export function addElevations(world, layout, { dress = true } = {}) {
  for (const deck of layout.galleries || []) {
    const mesh = world.box(
      deck.x,
      deck.h / 2,
      deck.z,
      deck.w,
      deck.h,
      deck.d,
      0x989fa1,
    );
    if (world.blockMaterial) mesh.material = world.blockMaterial;
    world.boxes.at(-1).walkable = true;
    for (const z of [-4.8, 4.8]) {
      const cover = world.box(
        deck.x + Math.sign(deck.x) * (deck.w / 2 - 0.7),
        deck.h + 0.55,
        z,
        1.4,
        1.1,
        2.4,
        0x989fa1,
      );
      if (world.blockMaterial) cover.material = world.blockMaterial;
    }
    const accessLength = 5.2;
    for (const side of [-1, 1])
      world.ramp(
        deck.x,
        deck.z + side * (deck.d / 2 + accessLength / 2),
        deck.w,
        accessLength,
        deck.h,
        -side,
      );
    if (dress) {
      // Low coping is cosmetic only and never pretends to be a blocking rail.
      for (const side of [-1, 1]) {
        world.box(
          deck.x + side * (deck.w / 2 - 0.12),
          deck.h + 0.025,
          deck.z,
          0.14,
          0.05,
          deck.d,
          0x526c78,
          false,
        );
        for (const z of [-6, 0, 6])
          world.box(
            deck.x + side * (deck.w / 2 - 0.12),
            deck.h * 0.5,
            z,
            0.035,
            deck.h,
            0.08,
            0x6c7a80,
            false,
          );
      }
      world.box(
        deck.x,
        deck.h + 0.018,
        0,
        deck.w - 0.5,
        0.025,
        0.15,
        0xb39269,
        false,
      );
    }
  }
}
