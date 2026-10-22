/**
 * Game server: static/Vite host + WebSocket authority on one port.
 *
 * One port matters: the browser preview proxies a single port, so the game
 * page and its socket must live together (path `/ws`).
 *
 * The loop is a fixed 60 Hz accumulator. Rendering rate never influences the
 * simulation, and neither does network jitter: inputs are queued and consumed
 * one per tick.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ARENA } from '../shared/arena.ts';
import { DT } from '../shared/constants.ts';
import { initRapier, Physics } from '../shared/physics.ts';
import type { ClientMsg } from '../shared/protocol.ts';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEV = process.env.NODE_ENV !== 'production';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');

const rooms: Set<Room> = new Set();
const destroyedAt = new Map<Room, number>();

interface Client {
  room: Room;
  slot: number;
  alive: boolean;
}

const socketMeta = new WeakMap<WebSocket, Client>();

function newRoom(mode: 'duel' | 'practice'): Room {
  const room = new Room(mode, new Physics(ARENA));
  rooms.add(room);
  return room;
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleHello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>): void {
  if (socketMeta.has(ws)) return;
  const name = (msg.name ?? 'PLAYER').toString().slice(0, 14);
  // 1. Reclaim a warmed seat.
  if (msg.token) {
    for (const room of rooms) {
      if (room.dead) continue;
      const slot = room.reconnect(ws, msg.token, name, msg.look);
      if (slot !== null) {
        socketMeta.set(ws, { room, slot, alive: true });
        return;
      }
    }
  }
  // 2. Practice always gets a fresh room with a bot.
  if (msg.mode === 'practice') {
    const room = newRoom('practice');
    const slot = room.join(ws, name, msg.look);
    if (slot === null) {
      send(ws, { t: 'error', text: 'ROOM FULL' });
      return;
    }
    socketMeta.set(ws, { room, slot, alive: true });
    return;
  }
  // 3. Duel: fill an open seat, otherwise open a room and wait.
  for (const room of rooms) {
    if (room.dead || room.mode !== 'duel' || room.waiting === false) continue;
    // The joiner's kit matters too: without this the second player always wore
    // the default rifle to their opponent's eyes.
    if (room.join(ws, name, msg.look) !== null) {
      const idx = room.sockets.indexOf(ws);
      socketMeta.set(ws, { room, slot: idx >= 0 ? idx : 0, alive: true });
      return;
    }
  }
  const room = newRoom('duel');
  const slot = room.join(ws, name, msg.look);
  if (slot === null) {
    send(ws, { t: 'error', text: 'COULD NOT SEAT PLAYER' });
    return;
  }
  socketMeta.set(ws, { room, slot, alive: true });
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: Buffer) => {
    if (data.length > 8192) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString()) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      handleHello(ws, msg);
      return;
    }
    const meta = socketMeta.get(ws);
    if (!meta || meta.room.dead) return;
    if (msg.t === 'input') {
      // A simple rate guard: a client cannot queue 1000 frames a second.
      if (typeof msg.frame?.seq !== 'number') return;
    }
    meta.room.receive(meta.slot, msg);
  });
  ws.on('close', () => {
    const meta = socketMeta.get(ws);
    if (!meta) return;
    meta.alive = false;
    meta.room.disconnect(meta.slot, Date.now());
  });
  ws.on('error', () => {
    const meta = socketMeta.get(ws);
    if (meta) meta.room.disconnect(meta.slot, Date.now());
  });
});

async function main(): Promise<void> {
  await initRapier();

  type Middleware = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;
  let viteMiddlewares: Middleware | null = null;
  if (DEV) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      root: ROOT,
      appType: 'spa',
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        host: HOST,
      },
    });
    viteMiddlewares = vite.middlewares as unknown as Middleware;
  }

  const httpServer = createServer(async (req, res) => {
    const mw = viteMiddlewares;
    if (mw) {
      mw(req, res, () => {
        res.statusCode = 404;
        res.end('not found');
      });
      return;
    }
    try {
      const url = (req.url ?? '/').split('?')[0];
      const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
      let file = join(DIST, safe === '/' ? 'index.html' : safe);
      if (!extname(file)) file = join(DIST, 'index.html');
      const body = await readFile(file);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      res.statusCode = 200;
      res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch {
      // SPA fallback: unknown routes get the app shell, and nothing else.
      try {
        const body = await readFile(join(DIST, 'index.html'));
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(body);
      } catch {
        res.statusCode = 500;
        res.end('build missing: run npm run build');
      }
    }
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  httpServer.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`GLINT & GRAPPLE server on http://${HOST}:${PORT} (${DEV ? 'dev' : 'prod'})`);
  });

  // Fixed-step authority. setTimeout(4) keeps the accumulator tight on hosts
  // that quantise setInterval, and the catch-up is capped so a stalled event
  // loop cannot teleport the match forward.
  let last = Date.now();
  let acc = 0;
  const pump = (): void => {
    const now = Date.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    let steps = 0;
    while (acc >= DT && steps < 8) {
      for (const room of rooms) room.update(now);
      acc -= DT;
      steps++;
    }
    if (acc > DT * 8) acc = 0;
    // Retire finished rooms after a short grace so the final 'over' lands.
    for (const room of rooms) {
      if (!room.dead) continue;
      if (!destroyedAt.has(room)) destroyedAt.set(room, now);
      const since = now - (destroyedAt.get(room) ?? now);
      if (since > 2500) {
        for (const ws of room.sockets) {
          if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'match over');
        }
        rooms.delete(room);
        destroyedAt.delete(room);
      }
    }
    setTimeout(pump, 4);
  };
  pump();
}

void main();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
