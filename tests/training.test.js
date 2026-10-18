import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrainingAnalytics,
  recordTrainingAction,
  recordTrainingContact,
} from "../src/training-analytics.js";
import {
  addTrainingRun,
  createTrainingExport,
  createDrillResult,
  findPersonalBest,
  formatDrillTime,
  getTrainingTrend,
  mergeTrainingHistory,
  parseTrainingImport,
  getDrillMetric,
  getDrillScore,
  getTrainingDrill,
  sanitizeTrainingHistory,
  TRAINING_DRILLS,
  TRAINING_EXPORT_FORMAT,
  TRAINING_RULES_VERSION,
} from "../src/training.js";

const rifleLoadout = ["rifle", "pistol", "fists", "grenade"];
const sniperLoadout = ["sniper", "revolver", "knife", "smoke"];
const run = (drillId, stats, loadout = rifleLoadout, endedAt = "2026-10-17T12:00:00.000Z") =>
  createDrillResult(drillId, stats, loadout, endedAt);

test("four 60-second drills have unique IDs and real target/scoring definitions", () => {
  assert.equal(TRAINING_DRILLS.length, 4);
  assert.equal(new Set(TRAINING_DRILLS.map((drill) => drill.id)).size, 4);
  for (const drill of TRAINING_DRILLS) {
    assert.equal(drill.duration, 60);
    assert.ok(drill.targetCount >= 3);
    assert.ok(drill.targetSpeed > 0);
    assert.ok(drill.respawnDelay > 0);
    assert.ok(drill.title.length > 0);
    assert.ok(drill.description.length > 0);
  }
  assert.equal(getTrainingDrill("unknown"), null);
});

test("drill scoring uses its declared metric and handles zero or malformed stats", () => {
  assert.equal(getDrillScore("tracking", { hits: 12.8 }), 12);
  assert.equal(getDrillScore("precision", { headshots: 7 }), 7);
  assert.equal(getDrillScore("clears", { kills: 5 }), 5);
  assert.equal(
    getDrillScore("move-connect", {
      analytics: { weapons: [{ movingHitActions: 3 }, { movingHitActions: 2 }] },
    }),
    5,
  );
  assert.equal(getDrillScore("move-connect", {}), 0);
  assert.equal(getDrillMetric("accuracy", { hits: 3, shots: 8 }), 38);
  assert.equal(getDrillMetric("accuracy", { hits: 0, shots: 0 }), 0);
  assert.equal(getDrillMetric("accuracy", { hits: 4, shots: 5 }), 80);
  assert.equal(getDrillScore("not-a-drill", { hits: 99 }), 0);
  assert.equal(getDrillScore("tracking", { hits: Infinity }), 0);
  assert.equal(getDrillScore("tracking", { hits: 1e100 }), 1_000_000);
  assert.equal(
    getDrillMetric("movingHits", {
      analytics: { weapons: [{ movingHitActions: 1e100 }, { movingHitActions: 1e100 }] },
    }),
    1_000_000,
  );
});

test("move-and-connect scores unique moving actions with a hit, and recomputes safely on load", () => {
  const analytics = createTrainingAnalytics(rifleLoadout),
    action = { id: 1, weaponId: "rifle", hit: false, head: false, moving: true };
  recordTrainingAction(analytics, "rifle", { moving: true });
  recordTrainingContact(analytics, "rifle", {
    kind: "direct",
    distance: 9,
    action,
  });
  recordTrainingAction(analytics, "rifle", { moving: false });
  const result = createDrillResult(
    "move-connect",
    { shots: 2, hits: 2 },
    rifleLoadout,
    "2026-10-18T12:00:00.000Z",
    { analytics },
  );
  assert.equal(result.score, 1);
  assert.equal(result.scoreLabel, "MOVE HITS");
  assert.equal(result.analytics.weapons[0].movingHitActions, 1);
  assert.equal(sanitizeTrainingHistory([{ ...result, score: 999 }])[0].score, 1);
});

test("run summaries freeze accurate counts, derived rates and an independent loadout copy", () => {
  const loadout = [...rifleLoadout];
  const result = run("precision", {
    shots: 12.9,
    hits: 8,
    headshots: 5,
    kills: 2,
  }, loadout);
  loadout[0] = "shotgun";
  assert.deepEqual(result.loadout, rifleLoadout);
  assert.equal(result.score, 5);
  assert.equal(result.scoreLabel, "HEAD TAGS");
  assert.equal(result.accuracy, 67);
  assert.equal(result.headshotRate, 63);
  assert.equal(result.shots, 12);
  assert.equal(result.kills, 2);
  assert.equal(result.endedAt, "2026-10-17T12:00:00.000Z");
  assert.equal(run("tracking", { shots: 0, hits: 5 }).accuracy, 0);
  assert.equal(run("precision", { hits: 0, headshots: 3 }).headshotRate, 0);
  assert.equal(createDrillResult("unknown", {}, rifleLoadout), null);
});

test("personal bests are separated by drill and exact four-slot loadout", () => {
  const history = [
    run("tracking", { hits: 23, shots: 40 }, rifleLoadout, "2026-10-17T12:03:00Z"),
    run("tracking", { hits: 31, shots: 50 }, sniperLoadout, "2026-10-17T12:02:00Z"),
    run("precision", { headshots: 12, hits: 20 }, rifleLoadout, "2026-10-17T12:01:00Z"),
    run("tracking", { hits: 19, shots: 35 }, rifleLoadout, "2026-10-17T12:00:00Z"),
  ];
  assert.equal(findPersonalBest(history, "tracking", rifleLoadout).score, 23);
  assert.equal(findPersonalBest(history, "tracking", sniperLoadout).score, 31);
  assert.equal(findPersonalBest(history, "precision", rifleLoadout).score, 12);
  assert.equal(findPersonalBest(history, "clears", rifleLoadout), null);
  assert.equal(findPersonalBest(history, "tracking", ["rifle"]), null);
});

test("stored runs are validated, recomputed and capped rather than trusting cached scores", () => {
  const valid = run("clears", { kills: 4, hits: 10, shots: 12 });
  const sanitized = sanitizeTrainingHistory([
    { ...valid, score: 999999 },
    { ...valid, drillId: "unknown" },
    { ...valid, loadout: ["rifle"] },
    { ...valid, loadout: ["rifle", "unknown", "fists", "grenade"] },
    { ...valid, endedAt: "yesterday-ish" },
    null,
  ]);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].score, 4);
  assert.equal(sanitized[0].accuracy, 83);
  assert.equal(sanitizeTrainingHistory({}).length, 0);

  const many = Array.from({ length: 60 }, (_, i) =>
    run("tracking", { hits: i, shots: i + 1 }, rifleLoadout, new Date(2026, 0, 1, 0, i).toISOString()),
  );
  assert.equal(sanitizeTrainingHistory(many).length, 50);
  assert.equal(addTrainingRun(many, valid).length, 50);
  assert.equal(addTrainingRun(many, null).length, 50);
});

test("drill clocks format as non-negative whole seconds", () => {
  assert.equal(formatDrillTime(60), "1:00");
  assert.equal(formatDrillTime(9.8), "0:09");
  assert.equal(formatDrillTime(-10), "0:00");
  assert.equal(formatDrillTime(NaN), "0:00");
});

test("rule versions migrate legacy runs but never compare them to a different ruleset", () => {
  const current = run("tracking", { hits: 12, shots: 20 }),
    legacy = { ...current };
  delete legacy.rulesVersion;
  delete legacy.id;
  const migrated = sanitizeTrainingHistory([legacy])[0];
  assert.equal(TRAINING_RULES_VERSION, 1);
  assert.equal(migrated.rulesVersion, 1);
  assert.match(migrated.id, /^legacy-/);
  assert.equal(findPersonalBest([legacy], "tracking", rifleLoadout).score, 12);

  const oldRules = {
    ...current,
    id: "old-run-0001",
    rulesVersion: 2,
    score: 77,
    scoreLabel: "OLD UNITS",
  };
  const sanitizedOld = sanitizeTrainingHistory([oldRules])[0];
  assert.equal(sanitizedOld.score, 77);
  assert.equal(sanitizedOld.scoreLabel, "OLD UNITS");
  assert.equal(findPersonalBest([oldRules], "tracking", rifleLoadout), null);
});

test("exports use a versioned envelope and imports round-trip only validated local records", () => {
  const first = run("tracking", { shots: 20, hits: 11 }, rifleLoadout, "2026-10-17T12:02:00Z"),
    second = run("precision", { shots: 12, hits: 8, headshots: 5 }, sniperLoadout, "2026-10-17T12:01:00Z"),
    exported = createTrainingExport([first, second], "2026-10-18T09:00:00Z");
  assert.equal(exported.format, TRAINING_EXPORT_FORMAT);
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.exportedAt, "2026-10-18T09:00:00.000Z");
  const imported = parseTrainingImport(JSON.stringify(exported));
  assert.equal(imported.ok, true);
  assert.equal(imported.dropped, 0);
  assert.deepEqual(imported.runs.map(({ id, drillId, score }) => [id, drillId, score]), [
    [first.id, "tracking", 11],
    [second.id, "precision", 5],
  ]);
});

test("imports reject malformed, unsupported, oversized, and excessive payloads", () => {
  assert.equal(parseTrainingImport("{").ok, false);
  assert.equal(parseTrainingImport("x".repeat(1_000_001)).ok, false);
  assert.equal(
    parseTrainingImport({
      format: TRAINING_EXPORT_FORMAT,
      schemaVersion: 1,
      runs: [],
      extra: "x".repeat(1_000_001),
    }).ok,
    false,
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(parseTrainingImport(cyclic).ok, false);
  assert.equal(parseTrainingImport({ format: "other", schemaVersion: 1, runs: [] }).ok, false);
  assert.equal(
    parseTrainingImport({ format: TRAINING_EXPORT_FORMAT, schemaVersion: 2, runs: [] }).ok,
    false,
  );
  assert.equal(
    parseTrainingImport({ format: TRAINING_EXPORT_FORMAT, schemaVersion: 1, runs: Array(501).fill({}) }).ok,
    false,
  );
  const noValidRows = parseTrainingImport({
    format: TRAINING_EXPORT_FORMAT,
    schemaVersion: 1,
    runs: [{ drillId: "missing", loadout: [], endedAt: "invalid" }],
  });
  assert.equal(noValidRows.ok, false);
});

test("history merge is newest-first, duplicate-aware, bounded, and preserves local IDs", () => {
  const shared = run("tracking", { shots: 5, hits: 4 }, rifleLoadout, "2026-10-17T12:00:00Z"),
    local = run("precision", { headshots: 6 }, sniperLoadout, "2026-10-17T12:01:00Z"),
    incoming = run("clears", { kills: 7 }, sniperLoadout, "2026-10-17T12:03:00Z");
  const merged = mergeTrainingHistory([shared, local], [shared, incoming]);
  assert.deepEqual(merged.map((entry) => entry.id), [incoming.id, local.id, shared.id]);
  assert.equal(mergeTrainingHistory(merged, merged).length, 3);
  const many = Array.from({ length: 55 }, (_, i) =>
    run("tracking", { hits: i, shots: i + 1 }, rifleLoadout, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
  );
  assert.equal(mergeTrainingHistory(many, [incoming]).length, 50);
  assert.equal(mergeTrainingHistory(many, [incoming])[0].id, incoming.id);
});

test("recent trends use only the exact drill, rules version, and loadout", () => {
  const history = [
    run("tracking", { hits: 15 }, rifleLoadout, "2026-10-17T12:04:00Z"),
    run("tracking", { hits: 31 }, sniperLoadout, "2026-10-17T12:03:00Z"),
    run("tracking", { hits: 14 }, rifleLoadout, "2026-10-17T12:02:00Z"),
    run("tracking", { hits: 12 }, rifleLoadout, "2026-10-17T12:01:00Z"),
    run("tracking", { hits: 10 }, rifleLoadout, "2026-10-17T12:00:00Z"),
  ];
  const trend = getTrainingTrend(history, "tracking", rifleLoadout, 3);
  assert.deepEqual(trend, {
    scores: [12, 14, 15],
    count: 3,
    average: 13.7,
    best: 15,
    delta: 3,
  });
  assert.equal(getTrainingTrend(history, "tracking", sniperLoadout).count, 1);
  assert.deepEqual(getTrainingTrend(history, "clears", rifleLoadout), {
    scores: [],
    count: 0,
    average: null,
    best: null,
    delta: null,
  });
});

test("imports keep the newest 50 valid records even when the file order is arbitrary", () => {
  const runs = Array.from({ length: 60 }, (_, i) =>
      run(
        "tracking",
        { hits: i, shots: 60 },
        rifleLoadout,
        new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      ),
    ).reverse(),
    imported = parseTrainingImport({
      format: TRAINING_EXPORT_FORMAT,
      schemaVersion: 1,
      runs: [{ drillId: "bad", endedAt: "bad", loadout: [] }, ...runs],
    });
  assert.equal(imported.ok, true);
  assert.equal(imported.runs.length, 50);
  assert.equal(imported.runs[0].score, 59);
  assert.equal(imported.runs.at(-1).score, 10);
  assert.equal(imported.dropped, 11);
});
