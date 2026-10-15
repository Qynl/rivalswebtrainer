// Regenerate the lossless startup lighting asset using the original GPU path.
// Requires a running dev preview and the same optional BROWSER_EXECUTABLE as tests.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage();
  await page.goto(
    (process.env.ARENA_URL || "http://localhost:5173") +
      "/?rebuild-environment=1",
  );
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  const data = await page.evaluate(() => {
    const g = window.__arena,
      t = g.environmentMap,
      values = new Uint16Array(t.width * t.height * 4);
    g.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, values);
    return { width: t.width, height: t.height, values: Array.from(values) };
  });
  const count = data.values.length,
    encoded = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    const d = (data.values[i] - (i < 4 ? 0 : data.values[i - 4])) & 65535;
    encoded[i] = d & 255;
    encoded[count + i] = d >> 8;
  }
  const packed = gzipSync(encoded, { level: 9 });
  await writeFile(
    new URL("../src/assets/studio-environment.bin", import.meta.url),
    packed,
  );
  console.log(
    JSON.stringify({
      width: data.width,
      height: data.height,
      packedBytes: packed.length,
    }),
  );
} finally {
  await browser.close();
}
