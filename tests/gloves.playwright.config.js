import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "gloves.spec.js",
    "gloves-expanded.spec.js",
    "gloves-peer.spec.js",
    "controlled-movement.spec.js",
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1000, height: 800 },
    headless: true,
    launchOptions: {
      executablePath: process.env.BROWSER_EXECUTABLE,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  reporter: "list",
});
