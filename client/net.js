// Network layer of the client. When the page is served by server.js, Socket.IO is available and the game
// runs in a room; otherwise (file://, the single-file build, ?local) connect() resolves to null and the client stays hot-seat.
const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

function loadIo() {
  return new Promise((resolve) => {
    if (globalThis.io) return resolve(globalThis.io);
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.onload = () => resolve(globalThis.io ?? null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
}

// handlers: { joined(msg), update(msg), undone(msg), reset(msg), presence(players), status(online) }
export async function connect(handlers) {
  const q = new URLSearchParams(location.search);
  if (!location.protocol.startsWith('http') || q.has('local')) return null;
  const io = await loadIo();
  if (!io) return null;

  let room = q.get('room');
  if (!room) { room = rnd(6); q.set('room', room); history.replaceState(null, '', `${location.pathname}?${q}`); }
  // sessionStorage: a reload keeps the seat, a second tab is a second player (handy for testing alone)
  let token = null;
  try { token = sessionStorage.getItem('mm.token'); if (!token) sessionStorage.setItem('mm.token', (token = rnd(24))); } catch (_) { token = rnd(24); }

  const socket = io();
  const net = { room, seat: 0, online: false, players: [], link: location.href };
  const ack = (cb) => (r) => cb?.(r ?? { ok: false, error: 'no answer' });
  net.action = (a, cb) => socket.timeout(8000).emit('action', a, (err, r) => ack(cb)(err ? { ok: false, error: 'сервер не отвечает' } : r));
  net.undo = (cb) => socket.timeout(8000).emit('undo', (err, r) => ack(cb)(err ? { ok: false, error: 'сервер не отвечает' } : r));
  net.newGame = (cb) => socket.timeout(8000).emit('newGame', (err, r) => ack(cb)(err ? { ok: false, error: 'сервер не отвечает' } : r));

  socket.on('connect', () => {                 // also fires after every reconnect: the server sends the whole state again
    socket.emit('join', { room, token }, (r) => {
      if (!r?.ok) { handlers.status?.(false, r?.error); return; }
      net.seat = r.seat; net.online = true; net.players = r.players;
      handlers.joined(r);
    });
  });
  socket.on('disconnect', () => { net.online = false; handlers.status?.(false); });
  socket.on('update', (m) => { net.players = m.players; handlers.update(m); });
  socket.on('undone', (m) => { net.players = m.players; handlers.undone(m); });
  socket.on('reset', (m) => { net.players = m.players; handlers.reset(m); });
  socket.on('presence', (p) => { net.players = p; handlers.presence?.(p); });
  return net;
}
