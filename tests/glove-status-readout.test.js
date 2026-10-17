import test from "node:test";
import assert from "node:assert/strict";
import { gloveStatusReadout } from "../src/gloves/status-readout.js";
test("status readouts follow actual remaining timers and never manufacture a cosmetic duration", () => {
  const body = { alive: true, goldTime: 3 };
  assert.deepEqual(gloveStatusReadout(body, "golden"), {
    label: "POWERUP",
    remaining: 3,
  });
  body.goldTime = 1.23;
  assert.deepEqual(gloveStatusReadout(body, "golden"), {
    label: "POWERUP",
    remaining: 1.3,
  });
  body.goldTime = 1e-9;
  assert.deepEqual(gloveStatusReadout(body, "golden"), {
    label: "POWERUP",
    remaining: 0.1,
  });
  body.goldTime = 0;
  assert.deepEqual(gloveStatusReadout(body, "golden"), {
    label: "",
    remaining: 0,
  });
  assert.equal(
    gloveStatusReadout({ goldTime: 0.1 + 0.2 }, "golden").remaining,
    0.3,
  );
});
test("existing protection/recovery/status priority is retained, with no hidden state or health mutation", () => {
  const body = {
    stoneTime: 2.5,
    ragdollTime: 0.7,
    goldTime: 3,
    reverseTime: 2,
    ghostTime: 3.2,
    spaceTime: 2.6,
    chillTime: 5,
    boostTime: 1.35,
  };
  const before = { ...body };
  for (const [field, label] of [
    ["stoneTime", "STONE FORM"],
    ["ragdollTime", "RAGDOLL"],
    ["goldTime", "POWERUP"],
    ["reverseTime", "REFLECTING"],
    ["ghostTime", "HIDDEN"],
    ["spaceTime", "ZERO-G"],
    ["chillTime", "CHILLED"],
  ]) {
    assert.equal(gloveStatusReadout(body, "default").label, label);
    body[field] = 0;
  }
  assert.equal(gloveStatusReadout(body, "default").label, "BOOSTING");
  assert.equal(before.goldTime, 3);
});
test("only the three genuine timed movement abilities gain active rush labels", () => {
  for (const [key, label] of [
    ["default", "BOOSTING"],
    ["acrobat", "DODGE ROLL"],
    ["magnet", "MAGNET RUSH"],
  ])
    assert.deepEqual(gloveStatusReadout({ boostTime: 0.49 }, key), {
      label,
      remaining: 0.5,
    });
  for (const key of [
    "speedrun",
    "golden",
    "spring",
    "toString",
    "__proto__",
    undefined,
  ])
    assert.deepEqual(gloveStatusReadout({ boostTime: 1 }, key), {
      label: "",
      remaining: 0,
    });
});
test("dead, absent, expired and nonfinite status state cannot leave a positive countdown", () => {
  for (const body of [
    null,
    { alive: false, goldTime: 3 },
    { goldTime: NaN, boostTime: Infinity },
    { stoneTime: -1, ragdollTime: 0 },
    { goldTime: Infinity },
  ])
    assert.deepEqual(gloveStatusReadout(body, "default"), {
      label: "",
      remaining: 0,
    });
  const body = Object.freeze({ alive: true, chillTime: 4.45, health: 125 });
  assert.deepEqual(gloveStatusReadout(body, "snow"), {
    label: "CHILLED",
    remaining: 4.5,
  });
  assert.equal(body.health, 125);
});

test("ability availability does not mistake a full cooldown track for permission to cast", async () => {
  const { gloveAbilityReadout } =
      await import("../src/gloves/status-readout.js"),
    glove = { key: "default", activation: "active", abilityCooldown: 7 },
    body = { alive: true, abilityCooldown: 0 };
  for (const [patch, phase, label] of [
    [{}, "countdown", "PREP"],
    [{}, "roundend", "WAIT"],
    [{}, "paused", "WAIT"],
    [{ alive: false }, "playing", "OUT"],
    [{ ragdollTime: 0.4 }, "playing", "RECOVER"],
    [{ stoneTime: 1 }, "playing", "STONE"],
    [{}, "playing", "READY"],
  ])
    assert.equal(
      gloveAbilityReadout({ ...body, ...patch }, glove, phase).label,
      label,
    );
  assert.deepEqual(
    gloveAbilityReadout({ ...body, abilityCooldown: 3.5 }, glove, "playing"),
    { label: "3.5s", progress: 0.5 },
  );
  assert.equal(
    gloveAbilityReadout({ ...body, abilityCooldown: 0.001 }, glove, "playing")
      .label,
    "0.1s",
  );
  assert.equal(
    gloveAbilityReadout(
      { ...body, abilityCooldown: Infinity },
      glove,
      "playing",
    ).label,
    "WAIT",
  );
  assert.deepEqual(
    gloveAbilityReadout(body, { activation: "passive" }, "countdown"),
    { label: "PASSIVE", progress: 1 },
  );
});
test("Thanos has an honest short rearm track, then RETURN, then its full actual cooldown", async () => {
  const { gloveAbilityReadout } =
      await import("../src/gloves/status-readout.js"),
    glove = { key: "thanos", activation: "active", abilityCooldown: 14 },
    body = { alive: true, markTime: 12, abilityCooldown: 0.4 };
  const original = { ...body };
  assert.deepEqual(gloveAbilityReadout(body, glove, "playing"), {
    label: "0.4s",
    progress: 0,
  });
  assert.deepEqual(body, original);
  body.abilityCooldown = 0.2;
  assert.deepEqual(gloveAbilityReadout(body, glove, "playing"), {
    label: "0.2s",
    progress: 0.5,
  });
  body.abilityCooldown = 0;
  assert.equal(gloveAbilityReadout(body, glove, "playing").label, "RETURN");
  body.markTime = 0;
  body.abilityCooldown = 14;
  assert.deepEqual(gloveAbilityReadout(body, glove, "playing"), {
    label: "14.0s",
    progress: 0,
  });
});
