// Compare controller behaviour to a local Git baseline without changing branches.
// node scripts/movement-audit.mjs [baseline-commit]
import { execFileSync } from "node:child_process";
import * as current from "../src/movement.js";
const baseline = process.argv[2] || "d40fdb1";
function baselineFile(path) {
  try {
    return execFileSync("git", ["show", `${baseline}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    console.error(
      `Cannot read ${path} from local baseline ${baseline}. Fetch its history or pass another local revision.`,
    );
    process.exit(1);
  }
}
const moduleURL = (source) =>
  "data:text/javascript," + encodeURIComponent(source);
// Keep gravity/clamp from that revision too, rather than silently mixing in
// current physics constants. Baseline physics is a standalone pure module.
const physicsURL = moduleURL(baselineFile("src/physics.js"));
const source = baselineFile("src/movement.js").replace(
  /(["'])\.\/physics\.js\1/g,
  () => JSON.stringify(physicsURL),
);
const previous = await import(moduleURL(source));
const dt = 1 / 600,
  body = () => ({ vx: 0, vz: 0, grounded: true });
function metrics(module) {
  const { MOVEMENT: m, accelerate, steerSlide } = module;
  const timeTo = (p, wish, done) => {
    let steps = 0;
    while (!done(p) && steps < 6000) {
      accelerate(p, wish, m.runSpeed, dt);
      steps++;
    }
    return Number((steps * dt).toFixed(4));
  };
  const start = timeTo(
      body(),
      { x: 1, z: 0 },
      (p) => p.vx >= m.runSpeed - 0.0001,
    ),
    brakeBody = body();
  brakeBody.vx = m.runSpeed;
  const stop = timeTo(brakeBody, { x: 0, z: 0 }, (p) => p.vx <= 0.0001),
    reverseBody = body();
  reverseBody.vx = m.runSpeed;
  const reverse = timeTo(
    reverseBody,
    { x: -1, z: 0 },
    (p) => p.vx <= -0.99 * m.runSpeed,
  );
  const airborne = body();
  airborne.grounded = false;
  airborne.vx = 14;
  let lateral = 0,
    maxLateral = 0;
  for (let i = 0; i < 240; i++) {
    accelerate(airborne, { x: -1, z: 0 }, m.runSpeed, dt);
    lateral += airborne.vz * dt;
    maxLateral = Math.max(maxLateral, Math.abs(lateral));
  }
  const slide = {
    ...body(),
    vx: Math.max(
      m.slideMinSpeed,
      Math.min(m.slideMaxSpeed, m.runSpeed + m.slideBoost),
    ),
  };
  let travel = 0;
  for (let t = 0; t < m.slideDuration - 1e-9; t += dt) {
    const step = Math.min(dt, m.slideDuration - t);
    steerSlide(slide, { x: 1, z: 0 }, step);
    travel += slide.vx * step;
  }
  return {
    runSpeed: m.runSpeed,
    fullRunSeconds: start,
    stopSeconds: stop,
    groundReverseSeconds: reverse,
    airReverseSideDrift: Number(maxLateral.toFixed(4)),
    slideSeconds: m.slideDuration,
    flatSlideTravel: Number(travel.toFixed(4)),
  };
}
console.log(
  JSON.stringify(
    {
      baseline,
      previous: metrics(previous),
      current: metrics(current),
      notes:
        "600 Hz controller sampling in trainer units; not a hardware-FPS or Roblox-measurement claim.",
    },
    null,
    2,
  ),
);
