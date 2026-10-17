// Same deterministic wishes/checkpoints used to record the historical fixture.
export function movementReplay(accelerate, fps, speed) {
  const body = { x: 0, z: 0, vx: 0, vz: 0, grounded: true },
    samples = [];
  const marks = new Set([
    Math.ceil(fps / 4),
    Math.ceil(fps / 2),
    fps,
    fps + Math.ceil(fps / 5),
    fps + Math.ceil(fps * 0.4),
    fps * 2,
  ]);
  for (let i = 0; i < fps * 2; i++) {
    if (i === fps)
      Object.assign(body, {
        grounded: false,
        vx: 14,
        vz: 0,
        airCarrySpeed: 14,
      });
    const t = i / fps;
    const wish =
      t < 0.35
        ? { x: 1, z: 0 }
        : t < 0.7
          ? { x: -1, z: 0 }
          : t < 1
            ? { x: 0, z: 0 }
            : t < 1.2
              ? { x: 0, z: 1 }
              : t < 1.6
                ? { x: -1, z: 0 }
                : { x: 1, z: 0 };
    accelerate(body, wish, speed, 1 / fps);
    body.x += body.vx / fps;
    body.z += body.vz / fps;
    if (marks.has(i + 1))
      samples.push({
        tick: i + 1,
        x: body.x,
        z: body.z,
        vx: body.vx,
        vz: body.vz,
      });
  }
  return samples;
}
