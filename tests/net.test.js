import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startServer } from '../server.js';
import { apply } from '../core/engine.js';

const emit = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const next = (s, ev) => new Promise((res) => s.once(ev, res));
const client = (port) => new Promise((res) => { const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true }); s.on('connect', () => res(s)); });
const firstMech = (state) => Object.values(state.mechs).find((m) => m.owner === state.turn.player && !m.activated && m.status === 'active'
  && apply(state, { type: 'ACTIVATE', player: state.turn.player, mechId: m.id }).ok);

test('two players share one room; the server owns turns, dice and undo', async () => {
  const srv = await startServer({ port: 0 });
  const a = await client(srv.port), b = await client(srv.port), c = await client(srv.port);
  try {
    const ja = await emit(a, 'join', { room: 'r1', token: 'token-aaaaaaaa' });
    const jb = await emit(b, 'join', { room: 'r1', token: 'token-bbbbbbbb' });
    const jc = await emit(c, 'join', { room: 'r1', token: 'token-cccccccc' });
    assert.deepEqual([ja.seat, jb.seat, jc.seat], [1, 2, 0], 'seats: 1, 2, then spectators');
    assert.equal(ja.state.rngState, 0, 'rng is hidden from clients');
    assert.equal(ja.state.seed, 0);
    assert.notEqual(srv.rooms.get('r1').game.state.rngState, 0, 'the server keeps the real rng');

    const turn = ja.state.turn.player, [cur, other] = turn === 1 ? [a, b] : [b, a];
    const mech = firstMech(ja.state);

    // the seat comes from the connection: a forged `player` field does not help the other side
    const forged = await emit(other, 'action', { type: 'ACTIVATE', mechId: mech.id, player: turn });
    assert.equal(forged.ok, false);
    assert.equal((await emit(c, 'action', { type: 'ACTIVATE', mechId: mech.id })).ok, false, 'spectators cannot act');
    assert.equal((await emit(cur, 'action', null)).ok, false);
    assert.equal((await emit(cur, 'action', { type: 'NO_SUCH' })).ok, false);

    // a valid action reaches everybody in the room
    let seen = [next(a, 'update'), next(b, 'update'), next(c, 'update')];
    assert.equal((await emit(cur, 'action', { type: 'ACTIVATE', mechId: mech.id })).ok, true);
    let ups = await Promise.all(seen);
    for (const u of ups) { assert.equal(u.state.activation.mechId, mech.id); assert.equal(u.by, turn); assert.equal(u.state.rngState, 0); }
    assert.equal(ups[0].undo, 1, 'activation used no dice, so it can be undone');

    // undo: only the player whose turn it is
    assert.equal((await emit(other, 'undo')).ok, false);
    seen = [next(a, 'undone'), next(b, 'undone')];
    assert.equal((await emit(cur, 'undo')).ok, true);
    ups = await Promise.all(seen);
    assert.equal(ups[0].state.activation, null);
    assert.equal(ups[1].undo, 0);

    // dice are rolled on the server; after a roll there is nothing to undo
    seen = [next(other, 'update')];
    await emit(cur, 'action', { type: 'ACTIVATE', mechId: mech.id });
    await Promise.all(seen);
    seen = [next(other, 'update')];
    const roll = await emit(cur, 'action', { type: 'ROLL_PILOT' });
    if (roll.ok) {
      const [u] = await Promise.all(seen);
      assert.ok(u.events.some((e) => e.type === 'pilot_roll'));
      assert.equal(u.undo, 0);
      assert.equal(u.state.rngState, 0);
    }
    assert.equal((await emit(cur, 'undo')).ok, roll.ok ? false : true);

    // reconnect: same token → same seat, whole state and log again
    const before = srv.rooms.get('r1').log.length;
    cur.disconnect();
    const again = await client(srv.port);
    const jr = await emit(again, 'join', { room: 'r1', token: turn === 1 ? 'token-aaaaaaaa' : 'token-bbbbbbbb' });
    assert.equal(jr.seat, turn);
    assert.equal(jr.log.length, before);
    assert.equal(jr.state.activation.mechId, mech.id);

    // rooms are independent
    const d = await client(srv.port);
    const jd = await emit(d, 'join', { room: 'r2', token: 'token-dddddddd' });
    assert.equal(jd.seat, 1);
    assert.equal(jd.state.activation, null);
    assert.equal((await emit(d, 'join', { room: '../x', token: 'token-dddddddd' })).ok, false);

    // new game resets the room for both
    seen = [next(other, 'reset')];
    assert.equal((await emit(again, 'newGame')).ok, true);
    const [rs] = await Promise.all(seen);
    assert.equal(rs.state.activation, null);
    assert.equal(srv.rooms.get('r1').log.length, 0);
    again.disconnect(); d.disconnect();
  } finally {
    a.disconnect(); b.disconnect(); c.disconnect();
    await srv.close();
  }
});

test('static files: only client/ and core/ are served', async () => {
  const srv = await startServer({ port: 0 });
  try {
    const get = (p) => fetch(`http://localhost:${srv.port}${p}`, { redirect: 'manual' });
    assert.equal((await get('/')).status, 302);
    assert.equal((await get('/client/')).status, 200);
    assert.equal((await get('/core/engine.js')).status, 200);
    assert.equal((await get('/server.js')).status, 404);
    assert.equal((await get('/package.json')).status, 404);
    assert.equal((await get('/client/..%2Fserver.js')).status, 404);
    assert.equal((await get('/socket.io/socket.io.js')).status, 200);
  } finally { await srv.close(); }
});
