import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrainingAnalytics,
  getTrainingAnalyticsRows,
  recordTrainingAction,
  recordTrainingContact,
  sanitizeTrainingAnalytics,
  TRAINING_ANALYTICS_VERSION,
} from "../src/training-analytics.js";

const loadout = ["rifle", "pistol", "knife", "grenade"];

test("training analytics count firing context separately from target contacts", () => {
  const analytics = createTrainingAnalytics(loadout);
  assert.equal(recordTrainingAction(analytics, "rifle", { aiming: true }), true);
  assert.equal(recordTrainingAction(analytics, "rifle", { moving: true }), true);
  assert.equal(
    recordTrainingContact(analytics, "rifle", {
      kind: "direct",
      head: true,
      distance: 14.5,
      damage: 21.45,
    }),
    true,
  );
  const rifle = getTrainingAnalyticsRows(analytics)[0];
  assert.equal(rifle.actions, 2);
  assert.equal(rifle.aimedActions, 1);
  assert.equal(rifle.movingActions, 1);
  assert.equal(rifle.directContacts, 1);
  assert.equal(rifle.headContacts, 1);
  assert.equal(rifle.averageDistance, 14.5);
  assert.equal(rifle.aimedPercent, 50);
  assert.equal(rifle.movingPercent, 50);
  assert.equal(rifle.damage, 21.45);
});

test("one linked action gets at most one hit/head event across multiple pellet contacts", () => {
  const analytics = createTrainingAnalytics(["shotgun"]),
    action = {
      id: 1,
      weaponId: "shotgun",
      hit: false,
      head: false,
      aiming: true,
      moving: true,
    };
  recordTrainingAction(analytics, "shotgun");
  recordTrainingContact(analytics, "shotgun", {
    kind: "direct",
    distance: 5,
    action,
  });
  recordTrainingContact(analytics, "shotgun", {
    kind: "direct",
    head: true,
    distance: 5.2,
    action,
  });
  recordTrainingContact(analytics, "shotgun", {
    kind: "direct",
    head: true,
    distance: 5.4,
    action,
  });
  const [row] = getTrainingAnalyticsRows(analytics);
  assert.deepEqual(
    [
      row.actions,
      row.hitActions,
      row.headHitActions,
      row.aimedHitActions,
      row.movingHitActions,
      row.directContacts,
      row.headContacts,
    ],
    [1, 1, 1, 1, 1, 3, 2],
  );
  assert.equal(action.hit, true);
  assert.equal(action.head, true);
});

test("splash and area-effect contacts stay distinct from direct head contacts", () => {
  const analytics = createTrainingAnalytics(["grenade", "molotov", "flame"]);
  recordTrainingContact(analytics, "grenade", {
    kind: "splash",
    damage: 34,
  });
  recordTrainingContact(analytics, "molotov", { kind: "area", damage: 8 });
  recordTrainingContact(analytics, "flame", { kind: "area", damage: 2 });
  recordTrainingContact(analytics, "flame", { kind: "direct", damage: 15 });
  const rows = getTrainingAnalyticsRows(analytics);
  assert.deepEqual(rows.map((row) => row.actionLabel), ["USES", "USES", "FIRE PULSES"]);
  assert.deepEqual(
    rows.map((row) => [
      row.directContacts,
      row.headContacts,
      row.splashContacts,
      row.areaTicks,
      row.totalContacts,
    ]),
    [
      [0, 0, 1, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 0, 0, 1, 2],
    ],
  );
});

test("analytics reject unknown events and sanitize imported counters to the loadout", () => {
  const analytics = createTrainingAnalytics(loadout);
  assert.equal(recordTrainingAction(analytics, "not-a-weapon"), false);
  assert.equal(recordTrainingContact(analytics, "rifle", { kind: "telepathy" }), false);
  const clean = sanitizeTrainingAnalytics(
    {
      version: TRAINING_ANALYTICS_VERSION,
      weapons: [
        {
          weaponId: "rifle",
          actions: 10,
          hitActions: 15,
          headHitActions: 9,
          aimedHitActions: 20,
          movingHitActions: 20,
          aimedActions: 100,
          movingActions: -1,
          directContacts: 3,
          headContacts: 9,
          splashContacts: Infinity,
          areaTicks: 2.8,
          damage: 12,
          distanceTotal: 90,
          distanceSamples: 0,
        },
        { weaponId: "unknown", actions: 999 },
      ],
    },
    loadout,
  );
  assert.equal(clean.version, TRAINING_ANALYTICS_VERSION);
  assert.equal(clean.weapons.length, 4);
  assert.deepEqual(clean.weapons[0], {
    weaponId: "rifle",
    actions: 10,
    hitActions: 10,
    headHitActions: 3,
    aimedHitActions: 10,
    movingHitActions: 0,
    aimedActions: 10,
    movingActions: 0,
    directContacts: 3,
    headContacts: 3,
    splashContacts: 0,
    areaTicks: 2,
    damage: 12,
    distanceTotal: 0,
    distanceSamples: 0,
  });
  assert.equal(clean.weapons[1].actions, 0);
  assert.equal(sanitizeTrainingAnalytics({ version: 99, weapons: [] }, loadout), null);
  assert.equal(sanitizeTrainingAnalytics(null, loadout), null);
});

test("analytics require bounded sampled distances and expose no accuracy fiction", () => {
  const clean = sanitizeTrainingAnalytics(
    {
      version: 1,
      weapons: [
        {
          weaponId: "rifle",
          actions: 0,
          aimedActions: 0,
          movingActions: 0,
          directContacts: 3,
          headContacts: 1,
          splashContacts: 0,
          areaTicks: 0,
          damage: 10,
          distanceTotal: 18,
          distanceSamples: 2,
        },
      ],
    },
    loadout,
  );
  const rifle = getTrainingAnalyticsRows(clean)[0];
  assert.equal(clean.version, TRAINING_ANALYTICS_VERSION);
  assert.equal(rifle.hitActions, 0);
  assert.equal(rifle.aimedHitActions, 0);
  assert.equal(rifle.movingHitActions, 0);
  assert.equal(rifle.averageDistance, 9);
  assert.equal(rifle.aimedPercent, null);
  assert.equal(rifle.movingPercent, null);
  assert.equal("accuracy" in rifle, false);
});
