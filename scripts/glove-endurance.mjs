// Real elapsed-time randomized authority endurance, not simulated-time claims.
// npm run test:glove-endurance -- --hours 6 --seed 20261017
import { Match } from "../server/match.js";
import { NavGrid } from "../src/physics.js";
import { GLOVE_ROSTER, gloveLoadout } from "../src/gloves/catalog.js";
import { cleanInput } from "../src/net/protocol.js";
import { encodeSnapshot, decodeSnapshot } from "../src/net/snapshot-codec.js";
import { performance } from "node:perf_hooks";
import {
  mkdir,
  writeFile,
  appendFile,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const maps = ["blockout", "foundry", "courtyard"];
export function random(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
export function exerciseEpoch(seed, epoch = 0, ticks = 4800) {
  const rng = random(seed),
    count = [2, 4, 6][epoch % 3],
    map = maps[epoch % 3];
  const members = new Map(
    Array.from({ length: count }, (_, i) => [
      "p" + i,
      {
        id: "p" + i,
        team: i % 2,
        name: "FUZZ " + i,
        lastAction: 0,
        loadout: gloveLoadout(GLOVE_ROSTER[(epoch * count + i) % 24].id),
        stats: {
          shots: 0,
          hits: 0,
          slaps: 0,
          kills: 0,
          deaths: 0,
          headshots: 0,
        },
      },
    ]),
  );
  const match = new Match({ map, members });
  match.world.nav = new NavGrid(match.world.boxes, 48, 1.5);
  let assertions = 0,
    snapshots = 0,
    actions = 0,
    completedTicks = 0;
  const seen = new Set();
  const check = (condition, message) => {
    assert.ok(
      condition,
      `${message} [seed=${seed}, epoch=${epoch}, tick=${completedTicks}]`,
    );
    assertions++;
  };
  try {
    for (let tick = 0; tick < ticks && match.phase !== "finished"; tick++) {
      completedTicks++;
      if (tick % 4 === 0)
        for (const [id, g] of match.contexts) {
          g.gloveRandom = rng;
          seen.add(g.loadout[0]);
          const p = g.player,
            target = match.entities
              .filter((e) => e.alive && e.team !== p.team)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - p.x, a.z - p.z) -
                  Math.hypot(b.x - p.x, b.z - p.z),
              )[0];
          let yaw = g.yaw,
            distance = 100;
          if (target) {
            distance = Math.hypot(target.x - p.x, target.z - p.z);
            let goal = target;
            if (distance > 3.1 && !g.hasLOS(g.eye(p), g.eye(target)))
              goal =
                match.world.nav
                  .path(p, target)
                  .find((v) => Math.hypot(v.x - p.x, v.z - p.z) > 0.5) ||
                target;
            yaw = Math.atan2(-(goal.x - p.x), -(goal.z - p.z));
          }
          const action = [];
          if (rng() < 0.035) action.push({ id: ++actions, type: "ability" });
          if (rng() < 0.015) action.push({ id: ++actions, type: "jump" });
          if (rng() < 0.012) action.push({ id: ++actions, type: "slide" });
          if (rng() < 0.005) action.push({ id: ++actions, type: "slot3" });
          match.input(
            id,
            cleanInput({
              seq: tick + 1,
              yaw,
              pitch: (rng() - 0.5) * 0.1,
              keys: distance > 2.3 ? 1 : rng() < 0.2 ? 2 : 0,
              fire: distance < 3.2,
              aim: false,
              paused: false,
              actions: action,
            }),
          );
        }
      match.step(1 / 120);
      if (tick % 60 === 0) {
        const snap = match.snapshot(),
          decoded = decodeSnapshot(
            encodeSnapshot(snap),
            new Map(snap.players.map((p) => [p.index, p])),
          );
        snapshots++;
        check(decoded.players.length === count, "snapshot actor count");
        for (const p of snap.players) {
          for (const key of [
            "x",
            "y",
            "z",
            "vx",
            "vy",
            "vz",
            "health",
            "dash",
            "throw",
            "reload",
            "blind",
            "paint",
            "quickMelee",
          ])
            check(Number.isFinite(p[key]), "finite " + key);
          check(p.health >= 0 && p.health <= 150, "bounded health");
          check(
            Math.abs(p.x) < 1000 &&
              Math.abs(p.z) < 1000 &&
              Math.abs(p.y) < 1000,
            "bounded position",
          );
          check(
            (p.stats.slaps || 0) >= p.stats.hits &&
              (p.stats.slaps || 0) <= p.stats.hits * 2,
            "genuine one/two-slap accounting",
          );
          check(
            p.slot === 0 &&
              JSON.stringify(p.loadout) ===
                JSON.stringify(gloveLoadout(p.weapon)),
            "no hidden equipment",
          );
        }
        for (const e of match.events)
          if (["gloveAbility", "gloveHit", "gloveDenied"].includes(e.type))
            check(
              Number.isSafeInteger(e.round) &&
                e.round > 0 &&
                e.round <= match.round,
              "authority event round identity",
            );
        check(
          snap.projectiles.length === 0,
          "glove match cannot spawn firearm projectiles",
        );
        check(snap.zones.length <= count * 4, "bounded glove traps");
      }
    }
    return {
      seed,
      epoch,
      map,
      players: count,
      ticks: completedTicks,
      simulatedSeconds: completedTicks / 120,
      assertions,
      snapshots,
      actions,
      gloves: [...seen],
      hits: [...members.values()].reduce((s, p) => s + p.stats.hits, 0),
      rounds: match.round,
    };
  } finally {
    match.dispose();
  }
}
async function sourceDigest() {
  const hash = createHash("sha256");
  async function visit(dir) {
    for (const d of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = dir + "/" + d.name;
      if (d.isDirectory()) await visit(p);
      else {
        hash.update(p);
        hash.update(await readFile(p));
      }
    }
  }
  await visit("src");
  await visit("server");
  return hash.digest("hex");
}
export async function main(argv = process.argv.slice(2)) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i < 0 ? fallback : argv[i + 1];
  };
  const hours = Number(get("--hours", 6)),
    seed = Number(get("--seed", 20261017));
  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    !Number.isInteger(seed)
  )
    throw Error("Use --hours >0 and <=24, and an integer --seed");
  const dir = resolve(get("--output", "validation-runs/glove-endurance"));
  await mkdir(dir, { recursive: true });
  const start = performance.now(),
    startedAt = new Date().toISOString(),
    duration = hours * 3600000,
    digest = await sourceDigest();
  const summary = {
    status: "running",
    startedAt,
    requestedHours: hours,
    sourceSHA256: digest,
    seed,
    elapsedSeconds: 0,
    epochs: 0,
    ticks: 0,
    assertions: 0,
    snapshots: 0,
    hits: 0,
    gloves: [],
    maps: [],
  };
  let nextLog = 0;
  const write = async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      dir + "/summary.tmp",
      JSON.stringify(summary, null, 2) + "\n",
    );
    await rename(dir + "/summary.tmp", dir + "/summary.json");
  };
  console.log(JSON.stringify({ event: "started", ...summary }));
  await write();
  try {
    while (performance.now() - start < duration) {
      const result = exerciseEpoch(
        (seed + Math.imul(summary.epochs, 2654435761)) >>> 0,
        summary.epochs,
      );
      summary.epochs++;
      for (const key of ["ticks", "assertions", "snapshots", "hits"])
        summary[key] += result[key];
      summary.gloves = [...new Set([...summary.gloves, ...result.gloves])];
      summary.maps = [...new Set([...summary.maps, result.map])];
      summary.elapsedSeconds = (performance.now() - start) / 1000;
      summary.memoryBytes = process.memoryUsage();
      await appendFile(dir + "/epochs.jsonl", JSON.stringify(result) + "\n");
      await write();
      if (summary.elapsedSeconds >= nextLog) {
        console.log(JSON.stringify({ event: "progress", ...summary }));
        nextLog = summary.elapsedSeconds + 60;
      }
      // Yield between actual simulation batches; no timer waits or artificial idle.
      await new Promise((resolve) => setImmediate(resolve));
    }
    summary.elapsedSeconds = (performance.now() - start) / 1000;
    assert.ok(summary.elapsedSeconds >= hours * 3600);
    assert.equal(summary.gloves.length, 24);
    assert.equal(summary.maps.length, 3);
    assert.ok(summary.hits > 0);
    summary.sourceAtEndSHA256 = await sourceDigest();
    summary.status = "passed";
    summary.finishedAt = new Date().toISOString();
    await write();
    console.log(JSON.stringify({ event: "passed", ...summary }));
  } catch (e) {
    summary.status = "failed";
    summary.error = e.stack;
    summary.elapsedSeconds = (performance.now() - start) / 1000;
    summary.finishedAt = new Date().toISOString();
    await write();
    console.error(JSON.stringify(summary));
    throw e;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
