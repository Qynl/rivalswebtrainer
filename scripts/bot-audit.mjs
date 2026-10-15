// Controlled full-body screenshots of the real NPC action rigs.
// BROWSER_EXECUTABLE=/path/to/chromium node scripts/bot-audit.mjs /tmp/bot-audit
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.argv[2] || "/tmp/bot-audit");
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
const page = await browser.newPage({ viewport: { width: 960, height: 720 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.ARENA_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  await page.evaluate(() => {
    const g = window.__arena;
    g.audio.volume = 0;
    g.world.build("blockout");
    g.renderer.setPixelRatio(1);
    g.resize();
    const bot = g.entities.find((e) => e.model);
    for (const e of g.entities) if (e.model) e.model.group.visible = e === bot;
    g.auditBot = bot;
    document.getElementById("hud").classList.add("hidden");
    document.getElementById("round-banner").classList.add("hidden");
  });
  for (const pose of [
    "scythe-dash",
    "katana-guard",
    "knife-swing",
    "slide",
    "fists-air",
  ]) {
    await page.evaluate((pose) => {
      const g = window.__arena,
        e = g.auditBot;
      Object.assign(g.player, { x: 11.5, y: 0, z: 11 });
      Object.assign(e, {
        x: 14.5,
        y: 0,
        z: 8,
        vy: 0,
        vx: 0,
        vz: 0,
        height: 1.9,
        yaw: Math.PI * 0.75,
        grounded: true,
        seed: 0.5,
        visible: true,
        targetEntity: g.player,
        activeWeapon: "rifle",
        meleeId: "scythe",
        reload: 0,
        slideTime: 0,
        sliding: 0,
        swingTime: 0,
        quickMeleeTime: 0,
        deflectTime: 0,
        guardFlash: 0,
        dashTime: 0,
        lastShotAt: -10,
      });
      if (pose === "scythe-dash")
        Object.assign(e, {
          dashTime: 0.15,
          quickMeleeTime: 0.25,
          grounded: false,
          vx: -20,
          vz: 20,
        });
      if (pose === "katana-guard")
        Object.assign(e, {
          meleeId: "katana",
          deflectTime: 1,
          quickMeleeTime: 1,
          guardFlash: 0.1,
        });
      if (pose === "knife-swing")
        Object.assign(e, {
          meleeId: "knife",
          activeWeapon: "knife",
          swingTime: 0.14,
        });
      if (pose === "slide")
        Object.assign(e, {
          slideTime: 0.2,
          sliding: 0.2,
          height: 1.15,
          vx: -12,
          vz: 12,
        });
      if (pose === "fists-air")
        Object.assign(e, {
          meleeId: "fists",
          activeWeapon: "fists",
          grounded: false,
          y: 1.1,
          vy: 8,
          vx: -8,
          vz: 8,
        });
      g.clock = 10;
      for (let i = 0; i < 80; i++) g.animateBot(e, 1 / 60);
      g.camera.position.set(11.5, 1.6 + e.y * 0.5, 11);
      g.camera.lookAt(e.x, e.y + 0.95, e.z);
      g.camera.fov = 55;
      g.camera.updateProjectionMatrix();
      g.renderer.autoClear = true;
      g.renderWorld();
      const gl = g.renderer.getContext();
      gl.finish();
      if (gl.getError()) throw Error("NPC shader error: " + pose);
    }, pose);
    await page.screenshot({ path: resolve(output, pose + ".png") });
  }
  console.log(JSON.stringify({ output, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
