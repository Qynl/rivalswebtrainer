import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/shared/arena.ts';
import { MATCH, PLAYER } from '../src/shared/constants.ts';
import { initRapier, Physics } from '../src/shared/physics.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';
import { updateEye, type PlayerState } from '../src/shared/sim.ts';
import { Room } from '../src/server/room.ts';
import type { WebSocket } from 'ws';

interface FakeSocket {
  ws: WebSocket;
  inbox: ServerMsg[];
}

function fake(): FakeSocket {
  const inbox: ServerMsg[] = [];
  const ws = {
    readyState: 1,
    send: (raw: string) => {
      inbox.push(JSON.parse(raw) as ServerMsg);
    },
    close: () => undefined,
  } as unknown as WebSocket;
  return { ws, inbox };
}

async function makeRoom(mode: 'duel' | 'practice') {
  await initRapier();
  return new Room(mode, new Physics(ARENA));
}

const DT = 1 / 60;

function advance(room: Room, ticks: number, startNow = 1000): void {
  for (let i = 0; i < ticks; i++) room.update(startNow + i * DT * 1000);
}

function aimAt(p: PlayerState, target: { x: number; y: number; z: number }): void {
  updateEye(p);
  const dx = target.x - p.eye.x;
  const dy = target.y - p.eye.y;
  const dz = target.z - p.eye.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  p.look = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
}

function shootAt(room: Room, slot: 0 | 1, target: { x: number; y: number; z: number }, opts: { origin?: { x: number; y: number; z: number }; dir?: { x: number; y: number; z: number } } = {}) {
  const p = room.inspect().players[slot];
  aimAt(p, target);
  const eye = { ...p.eye };
  const dir = opts.dir ?? {
    x: (target.x - eye.x) / 40,
    y: (target.y - eye.y) / 40,
    z: (target.z - eye.z) / 40,
  };
  room.forceShot(slot, { seq: 1, origin: opts.origin ?? eye, dir, scoped: true, aimTime: room.inspect().time });
}

const CHEST = (p: PlayerState) => ({ x: p.pos.x, y: p.pos.y + PLAYER.hitYOffset, z: p.pos.z });

describe('room: authority, kills and reconnect', () => {
  it('resolves a shot on the server and reports the same score to both', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'ALPHA');
    room.join(b.ws, 'BETA');
    advance(room, 120);
    const { players, match } = room.inspect();
    expect(match.phase).toBe('live');
    room.teleport(0, { x: 20, y: 78, z: 0 });
    room.teleport(1, { x: 20, y: 78, z: -40 });
    players[0].scoped = true;
    players[0].scopeT = 1;
    players[1].alive = true;
    shootAt(room, 0, CHEST(players[1]));
    room.update(9000);

    expect(match.scores[0]).toBe(1);
    expect(players[1].alive).toBe(false);
    const shot = a.inbox.find((m) => m.t === 'shot') as Extract<ServerMsg, { t: 'shot' }> | undefined;
    expect(shot?.hit).toBe(true);
    // The opponent sees the tracer too: nothing about a shot is hidden.
    const seenByB = b.inbox.find((m) => m.t === 'shot') as Extract<ServerMsg, { t: 'shot' }> | undefined;
    expect(seenByB?.origin).toEqual(shot?.origin);
    expect(seenByB?.end).toEqual(shot?.end);
    const kill = a.inbox.find((m) => m.t === 'kill') as Extract<ServerMsg, { t: 'kill' }> | undefined;
    expect(kill?.event.victim).toBe(1);
    advance(room, 6, 9100);
    const snapB = b.inbox.filter((m) => m.t === 'snap').pop() as Extract<ServerMsg, { t: 'snap' }>;
    expect(snapB.snap.match.scores).toEqual([1, 0]);
  });

  it('ignores a spoofed origin and enforces the bolt cycle', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A');
    room.join(b.ws, 'B');
    advance(room, 120);
    const { players, match } = room.inspect();
    room.teleport(0, { x: 20, y: 78, z: 0 });
    room.teleport(1, { x: 20, y: 78, z: -40 });
    players[0].scoped = true;
    players[0].scopeT = 1;
    players[1].alive = true;
    const eye = { ...players[0].eye };
    const target = CHEST(players[1]);
    const dir = { x: 0, y: (target.y - eye.y) / 40, z: -1 };
    aimAt(players[0], target);
    // Origin 30 m off the body: rejected outright, and it must not eat the bolt.
    room.forceShot(0, { seq: 1, origin: { x: eye.x + 30, y: eye.y, z: eye.z }, dir, scoped: true, aimTime: room.inspect().time });
    room.update(9100);
    expect(match.scores[0]).toBe(0);
    expect(players[0].fireCooldown).toBe(0);

    // Legal shot kills.
    players[0].scoped = true;
    players[0].scopeT = 1;
    shootAt(room, 0, CHEST(players[1]));
    room.update(9200);
    expect(match.scores[0]).toBe(1);

    // A second shot on the same tick with the bolt still cycling is refused.
    const victim = players[1];
    victim.alive = true;
    room.teleport(1, { x: 20, y: 78, z: -40 });
    room.forceShot(0, { seq: 3, origin: eye, dir, scoped: true, aimTime: room.inspect().time });
    room.update(9216);
    expect(match.scores[0]).toBe(1);
  });

  it('never lets a scoped client pick its own shot direction', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A');
    room.join(b.ws, 'B');
    advance(room, 120);
    const { players, match } = room.inspect();
    room.teleport(0, { x: 20, y: 78, z: 0 });
    room.teleport(1, { x: 40, y: 78, z: 0 });
    players[0].scoped = true;
    players[0].scopeT = 1;
    players[1].alive = true;
    // Look straight down -Z (away from the target) and claim a hit on +X.
    players[0].yaw = 0;
    players[0].pitch = 0;
    room.forceShot(0, {
      seq: 1,
      origin: { ...players[0].eye },
      dir: { x: 1, y: 0, z: 0 },
      scoped: true,
      aimTime: room.inspect().time,
    });
    room.update(9300);
    expect(match.scores[0]).toBe(0);
    expect(players[0].fireCooldown).toBeGreaterThan(0); // the bogus shot still cycled the bolt
    players[0].fireCooldown = 0;
    players[0].scoped = true;
    players[0].scopeT = 1;
    shootAt(room, 0, CHEST(players[1]));
    room.update(9400);
    expect(match.scores[0]).toBe(1);
  });

  it('respawns a dead player with spawn protection', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A');
    room.join(b.ws, 'B');
    advance(room, 120);
    const { players } = room.inspect();
    room.teleport(0, { x: 20, y: 78, z: 0 });
    room.teleport(1, { x: 20, y: 78, z: -40 });
    players[0].scoped = true;
    players[0].scopeT = 1;
    players[1].alive = true;
    shootAt(room, 0, CHEST(players[1]));
    room.update(9500);
    expect(players[1].alive).toBe(false);
    advance(room, Math.ceil(MATCH.respawnDelay / DT) + 4, 9600);
    expect(players[1].alive).toBe(true);
    expect(players[1].protect).toBeGreaterThan(0);
  });

  it('holds a seat through a reconnect, then forfeits cleanly', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'ALPHA');
    room.join(b.ws, 'BETA');
    advance(room, 120, 1000);
    const welcome = a.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    expect(welcome.token.length).toBeGreaterThan(8);

    room.disconnect(0, 5000);
    expect(b.inbox.some((m) => m.t === 'opponentLeft')).toBe(true);
    const c = fake();
    expect(room.reconnect(c.ws, welcome.token, 'ALPHA')).toBe(0);
    expect(c.inbox.some((m) => m.t === 'welcome' && m.reconnected)).toBe(true);
    expect(b.inbox.some((m) => m.t === 'opponentBack')).toBe(true);
    expect(room.dead).toBe(false);

    // Disappear for longer than the window: opponent wins.
    room.disconnect(0, 20000);
    room.update(20000 + MATCH.reconnectWindow * 1000 + 500);
    expect(room.inspect().match.phase).toBe('over');
    expect(room.inspect().match.phase).toBe('over');
    expect(room.inspect().match.winner).toBe(1);
    expect(room.dead).toBe(true);
  });

  it('rewinds the target for lag compensation (100 ms of movement still hits)', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A');
    room.join(b.ws, 'B');
    advance(room, 120);
    const { players, match } = room.inspect();
    room.teleport(0, { x: 20, y: 78, z: 0 });
    room.teleport(1, { x: 20, y: 78, z: -40 });
    players[0].scoped = true;
    players[0].scopeT = 1;
    players[1].alive = true;
    const oldTarget = { x: 20, y: 78 + PLAYER.hitYOffset, z: -40 };
    const shotTime = room.inspect().time;
    // The target drops for 20 ticks: the client that fired "now" is aiming at
    // stale information. The server must rewind to what they saw.
    advance(room, 20, 9700);
    expect(players[1].pos.y).toBeLessThan(77);

    // Shooting the stale position without rewinding must miss.
    players[0].fireCooldown = 0;
    players[0].scoped = true;
    players[0].scopeT = 1;
    shootAt(room, 0, oldTarget);
    room.update(9800);
    expect(match.scores[0]).toBe(0);

    // Same shot, with the client's real aim time: a hit.
    players[0].fireCooldown = 0;
    players[0].scoped = true;
    players[0].scopeT = 1;
    const p = room.inspect().players[0];
    aimAt(p, oldTarget);
    room.forceShot(0, {
      seq: 9,
      origin: { ...p.eye },
      dir: { x: 0, y: 0, z: -1 },
      scoped: true,
      aimTime: shotTime + 0.02,
    });
    room.update(9900);
    expect(match.scores[0]).toBe(1);
  });

  it('drives the practice bot through the same input pipeline', async () => {
    const room = await makeRoom('practice');
    const a = fake();
    room.join(a.ws, 'PLAYER');
    const { players } = room.inspect();
    const start = { ...players[1].pos };
    let moved = 0;
    for (let i = 0; i < 360; i++) {
      room.update(1000 + i * 16);
      moved = Math.max(moved, Math.hypot(players[1].pos.x - start.x, players[1].pos.z - start.z));
    }
    expect(moved).toBeGreaterThan(4);
    expect(a.inbox.length).toBeGreaterThan(5);
    expect(a.inbox.some((m) => m.t === 'snap')).toBe(true);
  });

  it('kills a player who falls into the void and credits the opponent', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A');
    room.join(b.ws, 'B');
    advance(room, 120);
    const { players, match } = room.inspect();
    players[0].alive = true;
    players[1].alive = true;
    room.teleport(0, { x: 0, y: 60, z: 0 });
    room.teleport(1, { x: 0, y: MATCH.voidY - 6, z: 0 });
    room.update(9600);
    expect(match.scores[0]).toBe(1);
    expect(match.lastKill?.cause).toBe('void');
  });

  it('drains a burst of input instead of queueing it forever', async () => {
    // A 60 Hz stream arrives in clumps on any real network. Consuming one frame
    // per tick leaves the rest queued, which is permanent input latency for
    // that seat (and was the joiner's "always a step behind" feeling).
    const room = await makeRoom('practice');
    const a = fake();
    room.join(a.ws, 'A');
    advance(room, 10, 1000);
    const before = room.inspect().players[0].pos.z;
    for (let seq = 1; seq <= 12; seq++) {
      room.setInput(0, { seq, keys: 0, yaw: 0, pitch: 0 });
    }
    // Three ticks must consume the surplus, not one frame per tick. Snapshots
    // stream at 20 Hz, so the ack the client sees is what proves it.
    a.inbox.length = 0;
    room.update(1300);
    room.update(1300 + 1000 / 60);
    room.update(1300 + 2000 / 60);
    const inboxAcks: number[] = [];
    for (const m of a.inbox) {
      if (m.t === 'snap') inboxAcks.push(m.snap.ack);
    }
    expect(inboxAcks.length).toBeGreaterThan(0);
    expect(Math.max(...inboxAcks)).toBeGreaterThanOrEqual(4);
    // And the player still moved like a player, not like a teleport.
    expect(Math.abs(room.inspect().players[0].pos.z - before)).toBeLessThan(0.5);
  });

  it('carries the joiner\'s cosmetics to the opponent, and refuses invented ids', async () => {
    const room = await makeRoom('duel');
    const a = fake();
    const b = fake();
    room.join(a.ws, 'A', { gun: 'aurum', grapple: 'gilded', effect: 'nova' });
    room.join(b.ws, 'B', { gun: 'not-a-skin', grapple: '../../etc/passwd', effect: 'bloom' });
    advance(room, 6, 1000);
    const snap = [...b.inbox].reverse().find((m) => m.t === 'snap') as Extract<ServerMsg, { t: 'snap' }>;
    expect(snap.snap.players[0].look.gun).toBe('aurum');
    expect(snap.snap.players[0].look.grapple).toBe('gilded');
    // The second seat's junk falls back to the issue kit rather than through.
    const snapA = [...a.inbox].reverse().find((m) => m.t === 'snap') as Extract<ServerMsg, { t: 'snap' }>;
    expect(snapA.snap.players[1].look.gun).toBe('service');
    expect(snapA.snap.players[1].look.effect).toBe('bloom');
  });
});
