// MetalMadness network server: static files + Socket.IO rooms.
//   npm start  →  http://localhost:3000/   (PORT / HOST env vars override)
// The server is the only place where the real game state lives. Clients send actions,
// the server runs them through the same pure core (`apply`) and broadcasts the result.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { Game } from './core/game.js';
import { newGameState } from './client/scenario.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const STATIC = ['/client/', '/core/'];                 // the only folders that are served
const SEATS = [1, 2];
const LOG_LIMIT = 2000, ROOM_TTL = 6 * 60 * 60 * 1000;
const ROOM_RE = /^[A-Za-z0-9_-]{1,40}$/, TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

// What clients see: the same JSON state, but without the RNG, so nobody can pre-compute the dice
// with a local dry run. Legality checks on the client do not depend on the RNG value.
export const publicState = (s) => ({ ...s, seed: 0, rngState: 0 });

function newRoom() {
  return { game: new Game(newGameState()), log: [], seats: {}, online: {}, touched: Date.now() };   // seats: seat → token, online: seat → socket count
}

export function startServer({ port = 3000, host = undefined } = {}) {
  const rooms = new Map();

  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/') { res.writeHead(302, { location: '/client/' + url.search }).end(); return; }
      const p = normalize(decodeURIComponent(url.pathname));
      if (p.includes('..') || !STATIC.some((d) => p.startsWith(d))) throw new Error('forbidden');
      const f = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
      res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(await readFile(f));
    } catch { res.writeHead(404).end('not found'); }
  });
  const io = new Server(http);

  const snapshot = (room) => ({ state: publicState(room.game.state), undo: room.game.history.length, players: SEATS.map((s) => ({ seat: s, taken: !!room.seats[s], online: (room.online[s] ?? 0) > 0 })) });
  const presence = (id, room) => io.to(id).emit('presence', snapshot(room).players);

  io.on('connection', (socket) => {
    let roomId = null, room = null, seat = 0;

    socket.on('join', (msg, cb) => {
      if (typeof cb !== 'function') return;
      if (room) return cb({ ok: false, error: 'already joined' });
      const id = msg?.room, token = msg?.token;
      if (!ROOM_RE.test(id ?? '') || !TOKEN_RE.test(token ?? '')) return cb({ ok: false, error: 'bad room or token' });
      if (!rooms.has(id)) rooms.set(id, newRoom());
      roomId = id; room = rooms.get(id);
      // a returning player gets the old seat back; a newcomer takes a free seat, or the seat of a player who has left
      seat = SEATS.find((s) => room.seats[s] === token)
        ?? SEATS.find((s) => !room.seats[s])
        ?? SEATS.find((s) => !(room.online[s] > 0))
        ?? 0;                                            // 0 = spectator
      if (seat) { room.seats[seat] = token; room.online[seat] = (room.online[seat] ?? 0) + 1; }
      room.touched = Date.now();
      socket.join(id);
      cb({ ok: true, seat, log: room.log, ...snapshot(room) });
      presence(id, room);
    });

    socket.on('action', (a, cb) => {
      if (typeof cb !== 'function') return;
      if (!room) return cb({ ok: false, error: 'not in a room' });
      if (!seat) return cb({ ok: false, error: 'spectators cannot act' });
      if (!a || typeof a !== 'object' || typeof a.type !== 'string') return cb({ ok: false, error: 'bad action' });
      let r;
      try { r = room.game.dispatch({ ...a, player: seat }); }      // the seat comes from the connection, never from the message
      catch (e) { console.error('action failed', a, e); return cb({ ok: false, error: 'bad action' }); }
      if (!r.ok) return cb({ ok: false, error: r.error });
      room.touched = Date.now();
      room.log.push({ type: a.type, by: seat, events: r.events });
      if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
      cb({ ok: true });
      io.to(roomId).emit('update', { type: a.type, by: seat, events: r.events, ...snapshot(room) });
    });

    // Undo follows the hot-seat rule (Game): back to the last action that rolled dice; only the player whose turn it is may undo.
    socket.on('undo', (cb) => {
      if (typeof cb !== 'function') return;
      const s = room?.game.state;
      if (!room || !seat) return cb({ ok: false, error: 'not a player' });
      if (!room.game.canUndo() || s.pending || s.turn.player !== seat) return cb({ ok: false, error: 'nothing to undo' });
      room.game.undo(); room.log.pop(); room.touched = Date.now();
      cb({ ok: true });
      io.to(roomId).emit('undone', { by: seat, ...snapshot(room) });
    });

    socket.on('newGame', (cb) => {
      if (typeof cb !== 'function') return;
      if (!room || !seat) return cb({ ok: false, error: 'not a player' });
      room.game = new Game(newGameState()); room.log = []; room.touched = Date.now();
      cb({ ok: true });
      io.to(roomId).emit('reset', { by: seat, ...snapshot(room) });
    });

    socket.on('disconnect', () => {
      if (!room) return;
      if (seat) room.online[seat] = Math.max(0, (room.online[seat] ?? 1) - 1);
      presence(roomId, room);
    });
  });

  const sweep = setInterval(() => {                      // forget rooms nobody has touched for a long time
    for (const [id, r] of rooms) if (Date.now() - r.touched > ROOM_TTL && !SEATS.some((s) => r.online[s] > 0)) rooms.delete(id);
  }, 10 * 60 * 1000);
  sweep.unref();

  return new Promise((resolve) => http.listen(port, host, () => resolve({
    port: http.address().port, rooms,
    close: () => new Promise((done) => { clearInterval(sweep); io.close(() => done()); }),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startServer({ port: +(process.env.PORT ?? 3000), host: process.env.HOST });
  console.log(`MetalMadness: http://localhost:${port}/`);
}
