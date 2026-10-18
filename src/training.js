import { WEAPONS } from "./data.js";
import { sanitizeTrainingAnalytics } from "./training-analytics.js";

export const TRAINING_RULES_VERSION = 1;
export const TRAINING_EXPORT_FORMAT = "rivals-training-history";
export const TRAINING_IMPORT_MAX_BYTES = 1_000_000;
const RUN_LIMIT = 50;
const MAX_IMPORT_BYTES = TRAINING_IMPORT_MAX_BYTES;
const MAX_IMPORT_RUNS = 500;
const MAX_RUN_COUNT = 1_000_000;

const definitions = [
  {
    id: "tracking",
    title: "Track the strafe",
    category: "TRACKING",
    rulesVersion: TRAINING_RULES_VERSION,
    duration: 60,
    targetCount: 5,
    targetSpeed: 1.45,
    respawnDelay: 1.2,
    scoreStat: "hits",
    scoreLabel: "HITS",
    secondaryStat: "headshots",
    secondaryLabel: "HEAD TAGS",
    description:
      "Stay with five fast-moving targets. Keep your crosshair attached through each lateral change.",
    coaching:
      "Smooth, small corrections beat frantic over-steering. Try one run ADS and one from the hip.",
  },
  {
    id: "precision",
    title: "Headshot discipline",
    category: "PRECISION",
    rulesVersion: TRAINING_RULES_VERSION,
    duration: 60,
    targetCount: 3,
    targetSpeed: 0.62,
    respawnDelay: 1.2,
    scoreStat: "headshots",
    scoreLabel: "HEAD TAGS",
    secondaryStat: "hits",
    secondaryLabel: "HITS",
    description:
      "Three slower targets give you room to settle. Score head tags, not hurried body shots.",
    coaching:
      "Place the reticle at head height before you fire. Compare head tags with total hits after the run.",
  },
  {
    id: "move-connect",
    title: "Move and connect",
    category: "MOVEMENT",
    rulesVersion: TRAINING_RULES_VERSION,
    duration: 60,
    targetCount: 5,
    targetSpeed: 1.05,
    respawnDelay: 1.2,
    scoreStat: "movingHits",
    scoreLabel: "MOVE HITS",
    secondaryStat: "hits",
    secondaryLabel: "ALL HITS",
    description:
      "Keep moving through each engagement. Score one point when an action fired while moving makes at least one target contact.",
    coaching:
      "Strafe with intention, then settle your crosshair through the shot. Multiple pellets and ongoing damage still count as one connected action.",
  },
  {
    id: "clears",
    title: "Target clear sprint",
    category: "SPEED",
    rulesVersion: TRAINING_RULES_VERSION,
    duration: 60,
    targetCount: 5,
    targetSpeed: 1.05,
    respawnDelay: 0.55,
    scoreStat: "kills",
    scoreLabel: "ELIMS",
    secondaryStat: "accuracy",
    secondaryLabel: "ACCURACY",
    description:
      "Clear the lane and acquire the next respawn quickly. Every eliminated target returns for another pass.",
    coaching:
      "Keep your movement decisive between targets; do not spend a whole magazine correcting one miss.",
  },
];

export const TRAINING_DRILLS = Object.freeze(
  definitions.map((definition) => Object.freeze(definition)),
);

const drillsById = new Map(TRAINING_DRILLS.map((drill) => [drill.id, drill]));

export function getTrainingDrill(id) {
  return drillsById.get(id) || null;
}

function count(value) {
  return Number.isFinite(value)
    ? Math.min(MAX_RUN_COUNT, Math.max(0, Math.floor(value)))
    : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0
    ? Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))
    : 0;
}

function validRunId(value) {
  return typeof value === "string" && /^[a-z0-9_-]{8,96}$/i.test(value);
}

function createRunId() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function legacyRunId(drillId, endedAt, loadout, stats) {
  const input = JSON.stringify([
    drillId,
    endedAt,
    loadout,
    stats.shots,
    stats.hits,
    stats.headshots,
    stats.kills,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++)
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `legacy-${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function getDrillMetric(stat, stats = {}) {
  if (stat === "accuracy") return ratio(count(stats.hits), count(stats.shots));
  if (stat === "movingHits")
    return Array.isArray(stats.analytics?.weapons)
      ? count(stats.analytics.weapons.reduce((sum, row) => sum + count(row.movingHitActions), 0))
      : 0;
  return ["shots", "hits", "headshots", "kills"].includes(stat)
    ? count(stats[stat])
    : 0;
}

export function getDrillScore(drillId, stats = {}) {
  const drill = getTrainingDrill(drillId);
  return drill ? getDrillMetric(drill.scoreStat, stats) : 0;
}

export function createDrillResult(
  drillId,
  stats = {},
  loadout = [],
  endedAt = new Date(),
  options = {},
) {
  const drill = getTrainingDrill(drillId);
  if (!drill) return null;
  const date = endedAt instanceof Date ? endedAt : new Date(endedAt);
  const ended = Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString();
  const safeLoadout = Array.isArray(loadout)
    ? loadout.slice(0, 4).map(String)
    : [];
  const result = {
    id: validRunId(options.id) ? options.id : createRunId(),
    drillId,
    rulesVersion:
      Number.isSafeInteger(options.rulesVersion) && options.rulesVersion > 0
        ? options.rulesVersion
        : drill.rulesVersion,
    endedAt: ended,
    loadout: safeLoadout,
    shots: count(stats.shots),
    hits: count(stats.hits),
    headshots: count(stats.headshots),
    kills: count(stats.kills),
    analytics: sanitizeTrainingAnalytics(options.analytics, safeLoadout),
  };
  result.accuracy = ratio(result.hits, result.shots);
  result.headshotRate = ratio(result.headshots, result.hits);
  result.score = getDrillScore(drillId, result);
  result.scoreLabel = drill.scoreLabel;
  return result;
}

function validLoadout(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item, slot) => WEAPONS[item]?.slot === slot)
  );
}

export function sanitizeTrainingHistory(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const row of value) {
    const drill = row && getTrainingDrill(row.drillId);
    if (
      !drill ||
      !validLoadout(row.loadout) ||
      !Number.isFinite(new Date(row.endedAt).getTime())
    )
      continue;
    const rulesVersion = row.rulesVersion === undefined ? 1 : row.rulesVersion;
    if (!Number.isSafeInteger(rulesVersion) || rulesVersion < 1 || rulesVersion > 1000)
      continue;
    const run = createDrillResult(
      row.drillId,
      row,
      row.loadout,
      row.endedAt,
      {
        id: validRunId(row.id)
          ? row.id
          : legacyRunId(row.drillId, row.endedAt, row.loadout, row),
        rulesVersion,
        analytics: row.analytics,
      },
    );
    if (rulesVersion !== drill.rulesVersion) {
      run.score = count(row.score);
      run.scoreLabel =
        typeof row.scoreLabel === "string" && row.scoreLabel.length <= 24
          ? row.scoreLabel
          : "LEGACY SCORE";
    }
    result.push(run);
    if (result.length >= RUN_LIMIT) break;
  }
  return result;
}

export function findPersonalBest(history, drillId, loadout) {
  const drill = getTrainingDrill(drillId);
  if (!drill || !validLoadout(loadout)) return null;
  const expected = JSON.stringify(loadout);
  let best = null;
  for (const run of sanitizeTrainingHistory(history)) {
    if (
      run.drillId !== drillId ||
      run.rulesVersion !== drill.rulesVersion ||
      JSON.stringify(run.loadout) !== expected
    )
      continue;
    if (!best || run.score > best.score) best = run;
  }
  return best;
}

export function getTrainingTrend(history, drillId, loadout, limit = 5) {
  const drill = getTrainingDrill(drillId);
  if (!drill || !validLoadout(loadout))
    return { scores: [], count: 0, average: null, best: null, delta: null };
  const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(RUN_LIMIT, Math.floor(limit)))
      : 5,
    expected = JSON.stringify(loadout),
    runs = sanitizeTrainingHistory(history)
      .filter(
        (run) =>
          run.drillId === drillId &&
          run.rulesVersion === drill.rulesVersion &&
          JSON.stringify(run.loadout) === expected,
      )
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .slice(0, safeLimit)
      .reverse(),
    scores = runs.map((run) => run.score),
    average =
      scores.length > 0
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
        : null;
  return {
    scores,
    count: scores.length,
    average,
    best: scores.length ? Math.max(...scores) : null,
    delta: scores.length >= 3 ? scores.at(-1) - scores[0] : null,
  };
}

export function addTrainingRun(history, result) {
  if (!result) return sanitizeTrainingHistory(history);
  const safeResult = createDrillResult(
    result.drillId,
    result,
    result.loadout,
    result.endedAt,
    {
      id: result.id,
      rulesVersion: result.rulesVersion,
      analytics: result.analytics,
    },
  );
  const drill = getTrainingDrill(result.drillId);
  if (
    !safeResult ||
    !validLoadout(safeResult.loadout) ||
    safeResult.rulesVersion !== drill.rulesVersion
  )
    return sanitizeTrainingHistory(history);
  return mergeTrainingHistory(history, [safeResult]);
}

export function mergeTrainingHistory(current, incoming) {
  const merged = [],
    seen = new Set();
  for (const run of [
    ...sanitizeTrainingHistory(current),
    ...sanitizeTrainingHistory(incoming),
  ]) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    merged.push(run);
  }
  return merged
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || a.id.localeCompare(b.id))
    .slice(0, RUN_LIMIT);
}

export function createTrainingExport(history, exportedAt = new Date()) {
  const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  return {
    format: TRAINING_EXPORT_FORMAT,
    schemaVersion: 1,
    exportedAt: Number.isFinite(date.getTime())
      ? date.toISOString()
      : new Date().toISOString(),
    runs: sanitizeTrainingHistory(history),
  };
}

export function parseTrainingImport(input) {
  let payload;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_IMPORT_BYTES)
      return { ok: false, error: "That file is too large to import (1 MB maximum)." };
    try {
      payload = JSON.parse(input);
    } catch {
      return { ok: false, error: "This is not valid training-history JSON." };
    }
  } else {
    let encoded;
    try {
      encoded = JSON.stringify(input);
    } catch {
      return { ok: false, error: "This training-history payload could not be read." };
    }
    if (typeof encoded !== "string")
      return { ok: false, error: "This is not valid training-history JSON." };
    if (new TextEncoder().encode(encoded).byteLength > MAX_IMPORT_BYTES)
      return { ok: false, error: "That file is too large to import (1 MB maximum)." };
    try {
      payload = JSON.parse(encoded);
    } catch {
      return { ok: false, error: "This is not valid training-history JSON." };
    }
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.format !== TRAINING_EXPORT_FORMAT ||
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.runs)
  )
    return { ok: false, error: "This file is not a supported Rivals training export." };
  if (payload.runs.length > MAX_IMPORT_RUNS)
    return { ok: false, error: "This export contains too many records." };
  const runs = sanitizeTrainingHistory(
    payload.runs.slice().sort((a, b) => {
      const aTime = Number.isFinite(new Date(a?.endedAt).getTime())
          ? new Date(a.endedAt).getTime()
          : -Infinity,
        bTime = Number.isFinite(new Date(b?.endedAt).getTime())
          ? new Date(b.endedAt).getTime()
          : -Infinity;
      return bTime - aTime;
    }),
  );
  if (payload.runs.length > 0 && runs.length === 0)
    return { ok: false, error: "No valid training records were found in this file." };
  return {
    ok: true,
    runs,
    dropped: payload.runs.length - runs.length,
  };
}

export function formatDrillTime(seconds) {
  const total = count(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
