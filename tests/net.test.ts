/**
 * End-to-end: a real server process, two real WebSocket clients.
 * This is the "two browsers can play a full match" acceptance test in headless
 * form: it exercises the actual server entry point, room matching, the 20 Hz
 * snapshot stream, input handling and the reconnect window.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg, Snapshot } from '../src/shared/protocol.ts';

const PORT = 3210 + Math.floor(Math.random() * 200);
const URL = `ws://127.0.0.1:${PORT}/ws`;
let server: ChildProcess;

interface Client {
  ws: WebSocket;
  inbox: ServerMsg[];
  you: number;
  token: string;
  snapshots: Snapshot[];
}

function waitFor(cond: () => boolean, timeoutMs = 8000, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (cond()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout: ${label}`));
      setTimeout(tick, 30);
    };
    tick();
  });
}

function connect(name: string, mode: 'duel' | 'practice', token = ''): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const client: Client = { ws, inbox: [], you: -1, token: '', snapshots: [] };
    ws.on('open', () => {
      const hello: ClientMsg = { t: 'hello', name, mode, token: token || undefined };
      ws.send(JSON.stringify(hello));
    });
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg;
      client.inbox.push(msg);
      if (msg.t === 'welcome') {
        client.you = msg.you;
        client.token = msg.token;
      }
      if (msg.t === 'snap') client.snapshots.push(msg.snap);
    });
    ws.on('error', reject);
    waitFor(() => client.you >= 0, 8000, `welcome for ${name}`)
      .then(() => resolve(client))
      .catch(reject);
  });
}

const send = (c: Client, msg: ClientMsg): void => c.ws.send(JSON.stringify(msg));

describe('websocket duel', () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ['src/server/index.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    server.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    server.stderr?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    // Production mode needs a dist; dev mode serves the app but boots the same
    // authority. The socket path is what matters here.
    await waitFor(() => out.includes('server on'), 20000, 'server boot');
  }, 40000);

  afterAll(() => {
    server?.kill('SIGKILL');
  });

  it('pairs two clients, streams snapshots and agrees on the score', async () => {
    const a = await connect('ALPHA', 'duel');
    expect(a.you).toBe(0);
    const b = await connect('BETA', 'duel');
    expect(b.you).toBe(1);
    expect(a.token).not.toBe(b.token);

    await waitFor(() => a.snapshots.length > 3 && b.snapshots.length > 3, 8000, 'snapshots');
    await waitFor(() => a.snapshots.some((s) => s.match.phase === 'live'), 8000, 'live match');

    // Server simulates our input, not just echoes it.
    const start = a.snapshots[a.snapshots.length - 1].players[0].pos;
    for (let i = 0; i < 40; i++) {
      send(a, { t: 'input', frame: { seq: i + 1, keys: 1, yaw: 0, pitch: 0 } });
      await new Promise((r) => setTimeout(r, 16));
    }
    await waitFor(() => {
      const last = a.snapshots[a.snapshots.length - 1];
      const p = last.players[0].pos;
      return Math.hypot(p.x - start.x, p.z - start.z) > 0.8;
    }, 4000, 'server-side movement');

    const sa = a.snapshots[a.snapshots.length - 1];
    const sb = b.snapshots[b.snapshots.length - 1];
    expect(sa.match.scores).toEqual(sb.match.scores);
    expect(sa.match.phase).toBe('live');

    // Pings come back with the server clock.
    send(a, { t: 'ping', id: 7, c: 1 });
    await waitFor(() => a.inbox.some((m) => m.t === 'pong' && m.id === 7), 3000, 'pong');

    a.ws.close();
    b.ws.close();
  }, 30000);

  it('resumes a duel after a reconnect inside the window', async () => {
    const a = await connect('GAMMA', 'duel');
    const b = await connect('DELTA', 'duel');
    await waitFor(() => a.snapshots.some((s) => s.match.phase === 'live'), 8000, 'live match');
    const token = b.token;
    b.ws.close();
    await waitFor(() => a.inbox.some((m) => m.t === 'opponentLeft'), 6000, 'opponentLeft');
    const c = await connect('DELTA', 'duel', token);
    expect(c.you).toBe(1);
    await waitFor(() => a.inbox.some((m) => m.t === 'opponentBack'), 6000, 'opponentBack');
    const welcome = c.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    expect(welcome.reconnected).toBe(true);
    c.ws.close();
    a.ws.close();
  }, 30000);

  it('starts a practice room with a bot that moves on its own', async () => {
    const p = await connect('SOLO', 'practice');
    await waitFor(() => p.snapshots.length > 4, 8000, 'practice snapshots');
    const first = p.snapshots[0].players[1].pos;
    await new Promise((r) => setTimeout(r, 2500));
    const last = p.snapshots[p.snapshots.length - 1].players[1].pos;
    expect(Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z)).toBeGreaterThan(0.5);
    p.ws.close();
  }, 30000);
});
