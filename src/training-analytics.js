import { WEAPONS } from "./data.js";

export const TRAINING_ANALYTICS_VERSION = 2;
const LEGACY_ANALYTICS_VERSION = 1;
const MAX_COUNT = 1_000_000;
const MAX_DAMAGE = 100_000_000;
const MAX_DISTANCE = 1_000_000;
const emptyWeapon = (weaponId) => ({
  weaponId,
  actions: 0,
  hitActions: 0,
  headHitActions: 0,
  aimedHitActions: 0,
  movingHitActions: 0,
  aimedActions: 0,
  movingActions: 0,
  directContacts: 0,
  headContacts: 0,
  splashContacts: 0,
  areaTicks: 0,
  damage: 0,
  distanceTotal: 0,
  distanceSamples: 0,
});

function safeCount(value, max = MAX_COUNT) {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

function safeTotal(value, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
}

function rowFor(analytics, weaponId) {
  if (
    analytics?.version !== TRAINING_ANALYTICS_VERSION ||
    !WEAPONS[weaponId] ||
    !Array.isArray(analytics.weapons)
  )
    return null;
  return analytics.weapons.find((row) => row?.weaponId === weaponId) || null;
}

export function createTrainingAnalytics(loadout) {
  return {
    version: TRAINING_ANALYTICS_VERSION,
    weapons: Array.isArray(loadout)
      ? loadout.filter((id) => WEAPONS[id]).map(emptyWeapon)
      : [],
  };
}

/** Count one game firing/attack event, not an aim score or an individual pellet. */
export function recordTrainingAction(analytics, weaponId, context = {}) {
  const row = rowFor(analytics, weaponId);
  if (!row) return false;
  row.actions = safeCount(row.actions + 1);
  if (context.aiming) row.aimedActions = safeCount(row.aimedActions + 1);
  if (context.moving) row.movingActions = safeCount(row.movingActions + 1);
  return true;
}

/**
 * Record an observed consequence. Direct pellet contacts are intentionally kept
 * separate from attack actions; splash and continuing area ticks have their own
 * counters so they cannot masquerade as ordinary aim accuracy.
 */
export function recordTrainingContact(analytics, weaponId, outcome = {}) {
  const row = rowFor(analytics, weaponId);
  if (!row) return false;
  const kind = outcome.kind || "direct";
  if (kind === "direct") {
    row.directContacts = safeCount(row.directContacts + 1);
    if (outcome.head) row.headContacts = safeCount(row.headContacts + 1);
    if (Number.isFinite(outcome.distance) && outcome.distance >= 0) {
      row.distanceTotal = safeTotal(row.distanceTotal + outcome.distance, MAX_DISTANCE);
      row.distanceSamples = safeCount(row.distanceSamples + 1);
    }
  } else if (kind === "splash") {
    row.splashContacts = safeCount(row.splashContacts + 1);
  } else if (kind === "area") {
    row.areaTicks = safeCount(row.areaTicks + 1);
  } else {
    return false;
  }
  const action = outcome.action;
  if (action?.weaponId === weaponId && Number.isSafeInteger(action.id)) {
    if (!action.hit) {
      row.hitActions = safeCount(row.hitActions + 1);
      if (action.aiming)
        row.aimedHitActions = safeCount(row.aimedHitActions + 1);
      if (action.moving)
        row.movingHitActions = safeCount(row.movingHitActions + 1);
      action.hit = true;
    }
    if (kind === "direct" && outcome.head && !action.head) {
      row.headHitActions = safeCount(row.headHitActions + 1);
      action.head = true;
    }
  }
  if (Number.isFinite(outcome.damage) && outcome.damage > 0)
    row.damage = safeTotal(row.damage + outcome.damage, MAX_DAMAGE);
  return true;
}

export function sanitizeTrainingAnalytics(value, loadout) {
  if (
    !value ||
    ![LEGACY_ANALYTICS_VERSION, TRAINING_ANALYTICS_VERSION].includes(value.version) ||
    !Array.isArray(value.weapons) ||
    !Array.isArray(loadout)
  )
    return null;
  const source = new Map(
    value.weapons
      .filter((row) => row && typeof row.weaponId === "string")
      .map((row) => [row.weaponId, row]),
  );
  return {
    version: TRAINING_ANALYTICS_VERSION,
    weapons: loadout.filter((id) => WEAPONS[id]).map((id) => {
      const input = source.get(id) || {},
        row = emptyWeapon(id);
      row.actions = safeCount(input.actions);
      row.hitActions = Math.min(row.actions, safeCount(input.hitActions));
      row.aimedActions = Math.min(row.actions, safeCount(input.aimedActions));
      row.movingActions = Math.min(row.actions, safeCount(input.movingActions));
      row.directContacts = safeCount(input.directContacts);
      row.headContacts = Math.min(row.directContacts, safeCount(input.headContacts));
      row.headHitActions = Math.min(
        row.hitActions,
        row.headContacts,
        safeCount(input.headHitActions),
      );
      row.aimedHitActions = Math.min(
        row.hitActions,
        row.aimedActions,
        safeCount(input.aimedHitActions),
      );
      row.movingHitActions = Math.min(
        row.hitActions,
        row.movingActions,
        safeCount(input.movingHitActions),
      );
      row.splashContacts = safeCount(input.splashContacts);
      row.areaTicks = safeCount(input.areaTicks);
      row.damage = safeTotal(input.damage, MAX_DAMAGE);
      row.distanceTotal = safeTotal(input.distanceTotal, MAX_DISTANCE);
      row.distanceSamples = Math.min(row.directContacts, safeCount(input.distanceSamples));
      if (row.distanceSamples === 0) row.distanceTotal = 0;
      return row;
    }),
  };
}

export function getTrainingAnalyticsRows(analytics) {
  if (analytics?.version !== TRAINING_ANALYTICS_VERSION || !Array.isArray(analytics.weapons))
    return [];
  return analytics.weapons.filter((row) => WEAPONS[row.weaponId]).map((row) => ({
    ...row,
    actionLabel:
      WEAPONS[row.weaponId].type === "melee"
        ? "ATTACKS"
        : WEAPONS[row.weaponId].type === "flame"
          ? "FIRE PULSES"
          : WEAPONS[row.weaponId].type === "bow"
            ? "ARROWS"
            : WEAPONS[row.weaponId].slot === 3
              ? WEAPONS[row.weaponId].type === "heal"
                ? "HEALS"
                : "USES"
              : "FIRE EVENTS",
    totalContacts: row.directContacts + row.splashContacts + row.areaTicks,
    averageDistance:
      row.distanceSamples > 0 ? row.distanceTotal / row.distanceSamples : null,
    aimedPercent:
      row.actions > 0 ? Math.round((row.aimedActions / row.actions) * 100) : null,
    movingPercent:
      row.actions > 0 ? Math.round((row.movingActions / row.actions) * 100) : null,
  }));
}
