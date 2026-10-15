// Dev-preview visual audit. Screenshots are written outside Git by default.
// BROWSER_EXECUTABLE=/path/to/chromium npm run audit:visual -- /tmp/arena-visuals
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.argv[2] || "/tmp/arena-visuals");
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
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
  });
  await page.click("#play-button");
  for (let i = 0; i < 4; i++) await page.click("#setup-next");
  await page.evaluate(() => {
    const g = window.__arena;
    g.state = "playing";
    g.range = true;
    g.clock = 10;
    Object.assign(g.player, { x: 0, y: 0, z: 14.3, vx: 0, vy: 0, vz: 0 });
    g.yaw = 0;
    g.pitch = 0;
    g.renderPrevious = null;
    for (const id of ["lobby", "pause", "round-banner"])
      document.getElementById(id).classList.add("hidden");
    const bot = g.entities.find((e) => e.model);
    for (const e of g.entities) if (e.model) e.model.group.visible = e === bot;
    Object.assign(bot, {
      x: 4.5,
      y: 0,
      z: 0.5,
      yaw: Math.PI,
      vx: 0,
      vz: 0,
      targetEntity: g.player,
      visible: true,
      lastShotAt: 0,
    });
    for (let i = 0; i < 40; i++) g.animateBot(bot, 1 / 60);
  });
  const draw = async (id, pose = "rest") => {
    await page.evaluate(
      async ({ id, pose }) => {
        const { WEAPONS } = await import("/src/data.js"),
          g = window.__arena,
          w = WEAPONS[id];
        g.slot = -1;
        g.loadout[w.slot] = id;
        g.ammunition[w.slot] = { mag: w.mag, reserve: w.reserve };
        g.equip(w.slot);
        g.switchTime = 0;
        g.reloadTime = pose === "reload" ? 1 : 0;
        g.reloadTotal = 2;
        g.swingTime = pose === "slash" ? 0.14 : 0;
        g.deflectTime = pose === "guard" ? 1 : 0;
        g.kick = 0;
        g.aiming = pose === "ads";
        g.events.tick(g);
        for (let i = 0; i < 40; i++) g.updateCamera(1 / 60);
        g.world.atmosphere.update(20, false);
        g.renderer.autoClear = true;
        g.renderWorld();
        g.renderer.autoClear = false;
        g.renderer.clearDepth();
        g.renderer.render(g.weaponScene, g.weaponCamera);
        g.renderer.getContext().finish();
        if (g.renderer.getContext().getError())
          throw new Error("WebGL error on " + id);
      },
      { id, pose },
    );
    await page.screenshot({
      path: resolve(output, `${id}-${pose}.png`),
      timeout: 60000,
    });
  };
  for (const id of [
    "rifle",
    "scythe",
    "katana",
    "knife",
    "fists",
    "rpg",
    "grenade",
    "molotov",
    "sniper",
  ])
    await draw(id);
  await draw("rifle", "ads");
  await draw("pistol", "ads");
  await draw("rifle", "reload");
  await draw("katana", "guard");
  const report = await page.evaluate(() => ({
    staticArena: window.__arena.world.staticStats,
    gpuObjects: window.__arena.renderer.info.memory,
  }));
  console.log(JSON.stringify({ output, errors, ...report }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
