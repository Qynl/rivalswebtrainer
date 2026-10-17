// Real wall-clock GPU/resource endurance. Synthetic status/FX probes supplement
// real offline simulation; this is NOT a six-hour human-play or FPS claim.
import { chromium } from "@playwright/test";
import { GLOVE_ROSTER } from "../src/gloves/catalog.js";
import {
  mkdir,
  writeFile,
  appendFile,
  rename,
  readFile,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const hours = Number(arg("--hours", 6));
if (!Number.isFinite(hours) || hours <= 0 || hours > 24)
  throw Error("Choose 0–24 hours");
const output = resolve(arg("--output", "validation-runs/glove-render"));
await mkdir(output, { recursive: true });
async function digest() {
  const hash = createHash("sha256");
  async function visit(dir) {
    for (const d of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = dir + "/" + d.name;
      if (d.isDirectory()) await visit(path);
      else {
        hash.update(path);
        hash.update(await readFile(path));
      }
    }
  }
  await visit("src");
  await visit("server");
  return hash.digest("hex");
}
const errors = [],
  seen = new Set(),
  maps = new Set();
const summary = {
  status: "starting",
  requestedHours: hours,
  sourceSHA256: await digest(),
  startedAt: new Date().toISOString(),
  elapsedSeconds: 0,
  probes: 0,
  frames: 0,
  simulationTicks: 0,
};
async function save() {
  await writeFile(
    resolve(output, "summary.tmp"),
    JSON.stringify(
      { ...summary, gloves: [...seen], maps: [...maps], errors },
      null,
      2,
    ),
  );
  await rename(resolve(output, "summary.tmp"), resolve(output, "summary.json"));
}
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-precise-memory-info",
  ],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    /shader|WebGLProgram|context lost/i.test(m.text())
  )
    errors.push(m.text());
});
const started = performance.now();
try {
  await page.goto(process.env.ARENA_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    const g = window.__arena;
    g.frame = () => {};
    g.audio.volume = 0;
    g.audio.clearSpatial?.();
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(640, 480, false);
    g.camera.aspect = 640 / 480;
    g.camera.updateProjectionMatrix();
    g.weaponCamera.aspect = 640 / 480;
    g.weaponCamera.updateProjectionMatrix();
    window.__renderSoakBaseline = localStorage.getItem("slap-arena-profile-v1");
    g.start({
      ...g.config,
      mode: 1,
      difficulty: "hard",
      map: "blockout",
      range: true,
      testDrive: true,
      capture: false,
      loadout: ["glove_default", "pistol", "knife", "grenade"],
    });
  });
  summary.status = "running";
  await save();
  console.log(JSON.stringify({ event: "started", ...summary }));
  while (performance.now() - started < hours * 3600000) {
    const report = await page.evaluate(
      async ({ index, GLOVE_ROSTER }) => {
        const g = window.__arena;
        const glove = GLOVE_ROSTER[index % GLOVE_ROSTER.length];
        const map = ["blockout", "foundry", "courtyard"][
          Math.floor(index / GLOVE_ROSTER.length) % 3
        ];
        if (index % GLOVE_ROSTER.length === 0) {
          g.world.build(map);
          g.startRound();
          g.testDrive = true;
          const spawn = g.world.spawns[0][0];
          Object.assign(g.player, { x: spawn.x, z: spawn.z, y: spawn.y || 0 });
          g.player.vx = g.player.vy = g.player.vz = 0;
        }
        g.state = "playing";
        g.player.alive = true;
        g.player.health = 150;
        g.loadout = [glove.id, "pistol", "knife", "grenade"];
        g.player.activeWeapon = glove.id;
        g.slot = -1;
        g.equip(0);
        g.player.abilityCooldown = 0;
        g.player.ragdollTime = 0;
        g.player.stoneTime = 0;
        g.cameraZoom = index % 2 ? 4 : 0;
        g.keys.clear();
        g.keys.add(index % 2 ? "KeyD" : "KeyW");
        const casts = g.meleeAbility();
        // Deliberately probe cast presentation even when the genuine ability
        // correctly denies this geometry. These poses never award contact.
        if (glove.activation === "active") g.player.gloveCastTime = g.clock;
        if (g.entities[1]) g.entities[1].activeWeapon = glove.id;
        let frames = 0;
        for (let tick = 0; tick < 120; tick++) {
          g.mouseDown = tick > 50;
          if (tick === 24) g.slide();
          if (tick === 48) g.jump();
          g.simulate(1 / 120);
          g.updateCamera(1 / 120);
          for (const e of g.entities)
            if (
              ![e.x, e.y, e.z, e.vx, e.vy, e.vz, e.health].every(
                Number.isFinite,
              )
            )
              throw Error("Nonfinite entity: " + glove.id);
          if (tick % 12 === 0) {
            g.player.goldTime = index % 3 === 0 ? 1 : 0;
            g.player.reverseTime = index % 3 === 1 ? 1 : 0;
            g.player.spaceTime = index % 3 === 2 ? 1 : 0;
            g.updateCamera(1 / 120);
            g.world.atmosphere.update(g.clock, g.settings.performance);
            g.renderer.autoClear = true;
            g.renderWorld();
            if (!g.thirdPerson) {
              g.renderer.autoClear = false;
              g.renderer.clearDepth();
              g.renderer.render(g.weaponScene, g.weaponCamera);
            }
            g.renderer.getContext().finish();
            frames++;
            await new Promise(requestAnimationFrame);
          }
        }
        g.keys.clear();
        g.mouseDown = false;
        g.events.tick(g);
        const gl = g.renderer.getContext();
        if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
          throw Error("GPU error: " + glove.id);
        if (
          localStorage.getItem("slap-arena-profile-v1") !==
          window.__renderSoakBaseline
        )
          throw Error("Test Drive modified saved profile");
        let finite = true;
        g.scene.traverse((o) => {
          if (o.isMesh && !o.matrixWorld.elements.every(Number.isFinite))
            finite = false;
        });
        if (!finite) throw Error("Nonfinite world transform: " + glove.id);
        return {
          glove: glove.id,
          map,
          frames,
          simulationTicks: 120,
          cast: !!casts,
          geometries: g.renderer.info.memory.geometries,
          textures: g.renderer.info.memory.textures,
          programs: g.renderer.info.programs.length,
          effects: g.effects.length,
          heapBytes: performance.memory?.usedJSHeapSize,
          hits: g.matchStats.hits,
        };
      },
      { index: summary.probes, GLOVE_ROSTER },
    );
    seen.add(report.glove);
    maps.add(report.map);
    summary.probes++;
    summary.frames += report.frames;
    summary.simulationTicks += report.simulationTicks;
    summary.elapsedSeconds = (performance.now() - started) / 1000;
    summary.last = report;
    await appendFile(
      resolve(output, "probes.jsonl"),
      JSON.stringify({ ...report, elapsedSeconds: summary.elapsedSeconds }) +
        "\n",
    );
    if (
      report.geometries > 2500 ||
      report.textures > 250 ||
      report.programs > 150 ||
      report.effects > 500
    )
      throw Error(
        "GPU/effect safety limit exceeded: " + JSON.stringify(report),
      );
    if (errors.length) throw Error(errors.join("\n"));
    await save();
    if (summary.probes % 24 === 0)
      console.log(JSON.stringify({ event: "progress", ...summary }));
  }
  if (seen.size !== 24 || maps.size !== 3)
    throw Error("Insufficient full-roster/arena coverage");
  summary.status = "passed";
} catch (e) {
  summary.status = "failed";
  summary.error = e.stack;
  process.exitCode = 1;
} finally {
  summary.elapsedSeconds = (performance.now() - started) / 1000;
  summary.finishedAt = new Date().toISOString();
  summary.sourceAtEndSHA256 = await digest();
  await save();
  console.log(JSON.stringify({ event: summary.status, ...summary }));
  await browser.close();
}
