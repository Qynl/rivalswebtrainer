// Real map renders and collision fingerprints. Output stays outside Git.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.argv[2] || "/tmp/map-art";
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
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(process.env.ARENA_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    for (const id of ["lobby", "hud", "round-banner"])
      document.getElementById(id)?.classList.add("hidden");
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(960, 640, false);
    g.camera.aspect = 1.5;
    g.presentation?.resize();
    for (const e of g.entities) if (e.model) e.model.group.visible = false;
  });
  const report = {};
  for (const id of [
    "blockout",
    "foundry",
    "courtyard",
    "compound",
    "rooftops",
    "hangar",
    "range",
  ]) {
    report[id] = await page.evaluate((id) => {
      const g = window.__arena,
        w = g.world;
      w.build(id);
      const width = w.layout?.width || 48,
        depth = w.layout?.depth || 48;
      g.camera.position.set(-width * 0.32, width * 0.38, depth * 0.48);
      g.camera.lookAt(0, 1, 0);
      g.camera.fov = 65;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      const gl = g.renderer.getContext();
      gl.finish();
      return {
        boxes: JSON.stringify(w.boxes),
        spawns: w.spawns,
        glError: gl.getError(),
        details: w.group.getObjectByName("map-architecture")?.userData,
      };
    }, id);
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `${output}/${id}-overview.png` });
    await page.evaluate(() => {
      const g = window.__arena,
        p = g.world.spawns[0][0];
      g.camera.position.set(p.x, 1.66, p.z - 0.3);
      g.camera.lookAt(0, 2, -8);
      g.camera.fov = 85;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      g.renderer.getContext().finish();
    });
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `${output}/${id}-eye.png` });
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ maps: report, errors }, null, 2),
  );
  console.log(JSON.stringify({ output, errors, maps: Object.keys(report) }));
  if (errors.length || Object.values(report).some((r) => r.glError))
    throw Error("Map render errors");
} finally {
  await browser.close();
}
