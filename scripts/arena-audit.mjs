// Real rendered scale/sightline audit. Images are intentionally outside Git.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.argv[2] || "/tmp/arena-scale-audit");
await mkdir(output, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.ARENA_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.renderer.setPixelRatio(1);
    g.resize();
    for (const id of ["lobby", "hud", "round-banner"])
      document.getElementById(id).classList.add("hidden");
  });
  await page.evaluate(() => {
    const g = window.__arena;
    g.renderer.autoClear = true;
    g.renderWorld();
    g.renderer.getContext().finish();
  });
  await page.screenshot({ path: resolve(output, "lobby-overview.png") });
  const views = [
    {
      name: "spawn-eye-height",
      position: [0, 1.66, 17.3],
      target: [0, 1.66, 0],
      fov: 95,
    },
    {
      name: "central-crossing",
      position: [0, 1.66, 5],
      target: [0, 2, 0],
      fov: 95,
    },
    {
      name: "ramp-summit",
      position: [10.5, 6.06, 17.8],
      target: [0, 3, 0],
      fov: 95,
    },
    {
      name: "court-overview",
      position: [0, 22, 14],
      target: [0, 2, -3],
      fov: 80,
    },
  ];
  for (const view of views) {
    await page.evaluate((v) => {
      const g = window.__arena;
      g.camera.position.fromArray(v.position);
      g.camera.lookAt(...v.target);
      g.camera.fov = v.fov;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      const gl = g.renderer.getContext();
      gl.finish();
      if (gl.getError()) throw Error("Arena GL error: " + v.name);
    }, view);
    await page.screenshot({ path: resolve(output, view.name + ".png") });
  }
  const report = await page.evaluate(() => {
    const g = window.__arena;
    return {
      bounds: g.world.bounds,
      spawns: g.world.spawns,
      staticStats: g.world.staticStats,
      dressing:
        g.world.group.getObjectByName("arena-wayfinding").userData.batching,
      gpu: g.renderer.info.memory,
    };
  });
  console.log(JSON.stringify({ output, errors, ...report }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
