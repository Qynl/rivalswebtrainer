// Optional endurance validation: npm run test:soak -- --minutes 10
// Requires the dev preview and a Playwright Chromium (or BROWSER_EXECUTABLE).
import { chromium } from "@playwright/test";
const arg = process.argv.indexOf("--minutes"),
  minutes = arg < 0 ? 10 : Number(process.argv[arg + 1]);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120)
  throw new Error("Choose 0–120 minutes");
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(process.env.ARENA_URL || "http://localhost:5173");
await page.waitForFunction(() => window.__arena?.state === "lobby");
await page.click("#range-button");
await page.waitForFunction(() => document.pointerLockElement !== null);
await page.evaluate(() => {
  const g = window.__arena;
  g.frame = () => {};
  g.renderer.setPixelRatio(0.5);
  g.renderer.shadowMap.enabled = false;
  g.audio.play = () => {};
  g.audio.noiseHit = () => {};
  g.world.build("blockout");
});
const start = Date.now(),
  deadline = start + minutes * 60000;
let batches = 0,
  frames = 0,
  samples = [];
console.log(
  JSON.stringify({ event: "started", utc: new Date().toISOString(), minutes }),
);
try {
  while (Date.now() < deadline) {
    const report = await page.evaluate(
      async ({ batch }) => {
        const { WEAPONS } = await import("/src/data.js");
        const g = window.__arena;
        let frames = 0;
        for (const [id, w] of Object.entries(WEAPONS)) {
          g.state = "playing";
          g.range = true;
          g.player.alive = true;
          g.player.health = 100;
          g.player.x = ((batch % 3) - 1) * 5;
          g.player.z = 18;
          g.player.y = 0;
          g.player.vy = 0;
          g.player.vx = 0;
          g.player.vz = 0;
          g.loadout[w.slot] = id;
          g.ammunition[w.slot] = { mag: w.mag, reserve: w.reserve || 100 };
          g.equip(w.slot);
          g.cooldown = 0;
          g.blindTime = 0;
          g.keys.clear();
          g.keys.add(batch % 2 ? "KeyW" : "KeyD");
          for (let i = 0; i < 90; i++) {
            if (i % 30 === 0) {
              g.slide();
              if (i === 30) g.jump();
            }
            if (w.type === "bow") {
              g.bowCharge = 1.2;
              g.bowRelease = i % 40 === 0;
            } else if (i % 8 === 0) g.trigger = true;
            g.mouseDown = w.type === "auto" || w.type === "flame";
            if (w.type === "heal") g.player.health = 35;
            g.simulate(1 / 60);
            g.updateCamera(1 / 60);
            frames++;
            for (const entity of g.entities)
              if (
                ![
                  entity.x,
                  entity.y,
                  entity.z,
                  entity.vx,
                  entity.vy,
                  entity.vz,
                  entity.health,
                ].every(Number.isFinite)
              )
                throw new Error("Nonfinite entity state: " + id);
          }
          g.keys.clear();
          g.mouseDown = false;
          g.renderer.autoClear = true;
          g.renderer.render(g.scene, g.camera);
          g.renderer.autoClear = false;
          g.renderer.clearDepth();
          g.renderer.render(g.weaponScene, g.weaponCamera);
          g.renderer.getContext().finish();
        }
        return {
          frames,
          geometries: g.renderer.info.memory.geometries,
          textures: g.renderer.info.memory.textures,
          programs: g.renderer.info.programs.length,
          effects: g.effects.length,
          projectiles: g.projectiles.length,
          heap: performance.memory?.usedJSHeapSize,
        };
      },
      { batch: batches },
    );
    batches++;
    frames += report.frames;
    samples.push(report);
    if (
      report.geometries > 500 ||
      report.textures > 100 ||
      report.programs > 120
    )
      throw new Error(
        "GPU resources grew beyond safety threshold: " + JSON.stringify(report),
      );
    console.log(
      JSON.stringify({
        event: "batch",
        batches,
        elapsedSeconds: Math.round((Date.now() - start) / 1000),
        ...report,
      }),
    );
    if (errors.length) throw new Error(errors.join("\n"));
  }
  console.log(
    JSON.stringify({
      event: "passed",
      utc: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - start) / 1000),
      batches,
      frames,
      last: samples.at(-1),
      errors,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "failed",
      utc: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - start) / 1000),
      batches,
      frames,
      last: samples.at(-1),
      error: error.message,
      errors,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
