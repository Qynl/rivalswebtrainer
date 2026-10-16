import { measureWeaponPresence } from "./weapon-presence-harness.js";
// Dev-server audit: actual gun-only rendered pixels, not an assumed scale multiplier.
// BROWSER_EXECUTABLE=/path/to/chromium node scripts/audit-weapon-presence.mjs /tmp/guns
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const output = process.argv[2] || "/tmp/gun-presence";
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
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.ARENA_URL || "http://localhost:5173");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  const report = await page.evaluate(measureWeaponPresence);
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: output + ".png" });
  await writeFile(
    output + ".json",
    JSON.stringify({ ...report, errors }, null, 2),
  );
  console.log(JSON.stringify(report));
  if (errors.length || report.glError) throw Error(JSON.stringify(errors));
} finally {
  await browser.close();
}
