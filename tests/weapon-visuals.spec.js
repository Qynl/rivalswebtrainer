import { test, expect } from "@playwright/test";
import { measureWeaponPresence } from "../scripts/weapon-presence-harness.js";
test.use({ viewport: { width: 960, height: 720 } });
// Actual pre-upgrade 384x288 transparent gun-only raster counts, same camera,
// neutral pose and hidden hands. Ratios allow rasterizer edge differences.
const previous = {
  rifle: 5871,
  shotgun: 4913,
  sniper: 6858,
  burst: 6074,
  smg: 5902,
  rpg: 11117,
  bow: 3456,
  minigun: 13353,
  paintball: 7581,
  launcher: 6275,
  flame: 8378,
  pistol: 4669,
  uzi: 5743,
  shorty: 4766,
  revolver: 5249,
  burstpistol: 4844,
  dualpistols: 7232,
};
test("all 17 guns visibly render larger, Sniper has real screen presence, and larger ADS never covers aim with hands", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#range-button");
  const report = await page.evaluate(measureWeaponPresence);
  expect(Object.keys(report.guns)).toHaveLength(17);
  for (const [id, gun] of Object.entries(report.guns)) {
    expect(gun.pixels, id).toBeGreaterThan(previous[id] * 1.03);
    expect(gun.fraction, id).toBeLessThan(0.22);
    expect(gun.adsError, id).toBeLessThan(0.001);
    expect(gun.handHits, id).toBe(0);
  }
  expect(report.guns.sniper.pixels).toBeGreaterThan(previous.sniper * 1.7);
  expect(report.guns.sniper.width).toBeGreaterThan(125);
  expect(report.guns.sniper.scopeHidden).toBe(true);
  expect(report.guns.rifle.pixels).toBeGreaterThan(previous.rifle * 1.3);
  expect(report.glError).toBe(0);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ arsenalPresence: report.guns }));
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: "/tmp/sniper-arsenal-v3.png" });
});

test("the real loadout picker fits every upgraded gun without hidden FX shrinking the preview", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.__arena?.state === "lobby");
  await page.evaluate(() => {
    window.__arena.frame = () => {};
  });
  await page.click("#play-button");
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((r) => r.name.includes("/src/weapon-preview.js")),
  );
  await page.evaluate(async () => {
    // Use the exact module loaded by the picker, including any Vite HMR query.
    const resource = performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/src/weapon-preview.js"))
      .at(-1);
    const { WeaponPreview, weaponDisplayBounds } = await import(resource.name);
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const original = WeaponPreview.prototype.show;
    WeaponPreview.prototype.show = function (id) {
      original.call(this, id);
      const b = weaponDisplayBounds(this.model);
      let max = 0;
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(this.camera);
            max = Math.max(max, Math.abs(p.x), Math.abs(p.y));
          }
      window.__gunCard = {
        id,
        max,
        gl: this.renderer.getContext().getError(),
        revision: this.model.children[0].userData.visualRevision,
      };
    };
  });
  const groups = await page.evaluate(async () => {
    const { WEAPONS } = await import("/src/data.js");
    return [0, 1].map((slot) =>
      Object.entries(WEAPONS)
        .filter(([, w]) => w.slot === slot)
        .map(([id]) => id),
    );
  });
  // The default rifle has already rendered; select it last so its effect reruns.
  groups[0].push(groups[0].shift());
  for (const [slot, ids] of groups.entries()) {
    if (slot) await page.click("#setup-next");
    for (const id of ids) {
      await page.click(`[data-pick-weapon="${id}"]`);
      await page.waitForFunction(
        (expected) => window.__gunCard?.id === expected,
        id,
        { timeout: 10000 },
      );
      const card = await page.evaluate(() => window.__gunCard);
      expect(card.max, id).toBeLessThan(1);
      expect(card.gl, id).toBe(0);
      expect(card.revision, id).toBe("arsenal-v3");
    }
  }
  expect(errors).toEqual([]);
});
