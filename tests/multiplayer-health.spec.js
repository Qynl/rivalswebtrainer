import { test, expect } from "@playwright/test";
test("HTML instead of API JSON explains missing backend and RETRY reconnects to the real server", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => (window.__arena.frame = () => {}));
  await page.route("**/api/health", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html>SPA fallback</html>",
    }),
  );
  await page.click("#multiplayer-button");
  const error = page.locator(".mp-error");
  await expect(error).toContainText("web page instead of the multiplayer API");
  await expect(error).not.toContainText("Unexpected token");
  await page.unroute("**/api/health");
  await page.getByRole("button", { name: "RETRY ↗" }).click();
  await expect(page.locator(".mp-connection")).toContainText("WEBSOCKET", {
    timeout: 15000,
  });
  expect(errors).toEqual([]);
});
