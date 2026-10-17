import test from "node:test";
import assert from "node:assert/strict";
import { acceptsGameplayKeys } from "../src/gameplay-keys.js";
test("pause/settings/selection and lobby/results never steal native keyboard navigation", () => {
  for (const state of ["lobby", "paused", "results"])
    assert.equal(
      acceptsGameplayKeys({ state }, { target: { tagName: "BODY" } }),
      false,
    );
  assert.equal(
    acceptsGameplayKeys(
      { state: "countdown", selectingLoadout: true },
      { target: { tagName: "BODY" } },
    ),
    false,
  );
});
test("editable controls and buttons keep Tab, Space and arrows even when match phase is live", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON"])
    assert.equal(
      acceptsGameplayKeys({ state: "playing" }, { target: { tagName } }),
      false,
    );
  assert.equal(
    acceptsGameplayKeys(
      { state: "playing" },
      { target: { isContentEditable: true } },
    ),
    false,
  );
  assert.equal(
    acceptsGameplayKeys(
      { state: "playing" },
      { target: { closest: () => ({}) } },
    ),
    false,
  );
});
test("captured gameplay keeps normal movement/scoreboard/spectator keys in active phases", () => {
  for (const state of ["playing", "countdown", "roundend"])
    assert.equal(
      acceptsGameplayKeys({ state }, { target: { tagName: "CANVAS" } }),
      true,
    );
});
