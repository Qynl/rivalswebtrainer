import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MultiplayerSession } from "../src/net/session.js";
import { SnapshotBuffer } from "../src/net/protocol.js";
import { setup } from "./helpers/match.js";

test("paused joining client uses authoritative phase and never retains countdown 1", () => {
  const { m } = setup();
  try {
    const first = m.snapshot(),
      self = first.players[0],
      banners = [];
    let updates = 0;
    const g = {
      state: "paused",
      previousState: "countdown",
      clock: 10,
      player: { ...self },
      loadout: [...self.loadout],
      config: {},
      slot: self.slot,
      entities: [],
      events: {
        banner: (_, title) => banners.push(title),
        update: () => updates++,
      },
      audio: { play: () => {} },
    };
    const s = Object.create(MultiplayerSession.prototype);
    Object.assign(s, {
      game: g,
      id: self.id,
      round: first.round,
      authoritativePhase: "countdown",
      authoritativeRound: first.round,
      latest: { time: -1 },
      entities: new Map([[self.id, g.player]]),
      actions: [],
      client: { rtt: 0 },
      buffer: new SnapshotBuffer(),
      correction: new THREE.Vector3(),
      confirmShot() {},
      syncProjectiles() {},
      syncZones() {},
      processEvents() {},
    });
    s.receive({ ...first, time: 1, phase: "countdown", countdown: 0.8 });
    assert.equal(banners.at(-1), "1");
    s.receive({
      ...first,
      time: 2,
      phase: "playing",
      countdown: 0,
      roundTime: 89,
    });
    assert.equal(banners.at(-1), "FIGHT.");
    assert.equal(g.state, "paused");
    assert.equal(g.previousState, "playing");
    assert.equal(g.roundTime, 89);
    assert.equal(updates, 2);
    s.receive({ ...first, time: 1.9, phase: "countdown", countdown: 0.05 });
    assert.equal(banners.at(-1), "FIGHT.");
    assert.equal(s.latest.time, 2);
    assert.equal(updates, 2);
  } finally {
    m.dispose();
  }
});
test("adaptive state interpolation maintains a smooth clock and bounded history under loss and arrival jitter", () => {
  const b = new SnapshotBuffer(0.06, { adaptive: true });
  let previous = -Infinity;
  for (let i = 0; i < 2400; i++) {
    const t = i / 120;
    if (i % 6 === 0 && i % 30 !== 0) {
      const jitter = Math.sin(i * 0.17) * 0.012;
      b.push(
        {
          time: t,
          players: [
            {
              id: "p",
              x: t,
              y: 0,
              z: 0,
              vx: 1,
              vy: 0,
              vz: 0,
              alive: true,
              grounded: true,
              yaw: 0,
            },
          ],
        },
        100 + t + jitter,
      );
    }
    const state = b.sample(100 + t)?.[0];
    if (state) {
      assert.ok(Number.isFinite(state.x));
      assert.ok(state.x >= previous - 0.025, "large interpolation rewind");
      previous = state.x;
    }
    assert.ok(b.frames.length <= 32);
    assert.ok(b.delay >= 0.055 && b.delay <= 0.12);
  }
  assert.ok(b.delay < 0.09);
  b.clear();
  assert.equal(b.clockOffset, null);
  assert.equal(b.frames.length, 0);
});
