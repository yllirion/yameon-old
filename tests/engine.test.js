import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Game } from '../core/engine.js';
import { neighbor } from '../core/hex.js';
import { at, game, mech, playWith } from './helpers.js';

test('round order: smallest class first; more mechs goes first; tie → player 1', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8), mech('b2', 2, 'light', 11, 6)]);
  assert.deepEqual(s.turn, { rank: 1, player: 2 });        // only the light mech exists
  s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)]);
  assert.deepEqual(s.turn, { rank: 2, player: 1 });        // tie
  s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8), mech('b2', 2, 'medium', 11, 6)]);
  assert.equal(s.turn.player, 2);                          // 2 vs 1
});

test('activations alternate, leftovers finish the class, then new round', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8), mech('b2', 2, 'medium', 11, 6)]);
  const order = [];
  for (let i = 0; i < 6; i++) {
    const id = Object.values(s.mechs).find((m) => m.owner === s.turn.player && !m.activated && m.status === 'active').id;
    order.push(id);
    s = playWith(s, apply, s.turn.player, id, []);
    const r = apply(s, { type: 'END_ACTIVATION', player: s.turn.player });
    assert.ok(r.ok, r.error); s = r.state;
  }
  assert.deepEqual(order.slice(0, 3).map((x) => x[0]), ['b', 'a', 'b']);
  assert.equal(s.round, 3);
});

test('wrong player / wrong class are rejected', () => {
  const s = game([mech('a1', 1, 'heavy', 5, 8), mech('b1', 2, 'light', 11, 8)]);
  assert.equal(apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).ok, false);
  assert.equal(apply(s, { type: 'ACTIVATE', player: 2, mechId: 'b1' }).ok, true);
});

test('pilot roll: 6 dice, evade is face === die index, deterministic per seed', () => {
  const s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)]);
  const r1 = apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' });
  const r2 = apply(r1.state, { type: 'ROLL_PILOT', player: 1 });
  const r3 = apply(r1.state, { type: 'ROLL_PILOT', player: 1 });
  assert.deepEqual(r2.state, r3.state);
  const pool = r2.state.activation.pool;
  assert.equal(pool.length, 6);
  const faces = ['laser', 'ballistic', 'missile', 'jumpjet', 'move', 'move'];
  pool.forEach((p) => assert.ok(faces.includes(p.color)));
  assert.equal(r2.state.activation.initialEvade, pool.filter((p) => p.evade).length);
});

test('overheat tokens and cooling crit shrink the pilot roll; control crit forces a discard', () => {
  const s0 = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)]);
  s0.mechs.a1.overheat = 3; s0.mechs.a1.crits.cooling = 1; s0.mechs.a1.crits.control = 1;
  let r = apply(apply(s0, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).state, { type: 'ROLL_PILOT', player: 1 });
  assert.equal(r.state.activation.pool.length, 2);            // 6 - 3 tokens - 1 cooling crit
  assert.equal(r.state.activation.phase, 'DISCARD');          // control crit: drop 1 of the 2
  assert.equal(apply(r.state, { type: 'DISCARD_DICE', player: 1, dieIds: ['d0', 'd1'] }).ok, false);
  r = apply(r.state, { type: 'DISCARD_DICE', player: 1, dieIds: ['d0'] });
  assert.equal(r.state.activation.phase, 'PLAY');
  const s1 = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)]); s1.mechs.a1.overheat = 2;
  const q = apply(apply(s1, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).state, { type: 'ROLL_PILOT', player: 1 });
  assert.equal(q.state.activation.pool.length, 4); assert.equal(q.state.activation.phase, 'PLAY');
});

test('side-front step: turn first (1) then step (1); anchor adds 1 per part; virtual evade +1 with anchor', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8, { speed: 'X' }), mech('b1', 2, 'medium', 13, 8)]);
  s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move', 'move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2', 'd3', 'd4'] }).state;
  const pos = s.mechs.a1.pos;
  const side = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 1) });
  assert.ok(side.ok, side.error); assert.equal(side.state.activation.moveSpent, 2); assert.equal(side.state.mechs.a1.facing, 1);
  const free = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 0), turn: 1 });   // free 60° turn after the step
  assert.equal(free.state.activation.moveSpent, 1); assert.equal(free.state.mechs.a1.facing, 1);
  const ahead = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 0) });
  assert.equal(ahead.state.activation.moveSpent, 1);
  s.mechs.a1.anchor = 1;
  assert.equal(apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 1) }).state.activation.moveSpent, 4); // (turn 1+1) + (step 1+1)
  assert.equal(apply(s, { type: 'VIRTUAL_EVADE', player: 1 }).state.activation.moveSpent, 3);
});

test('fire hex: starting the activation there gives an overheat token', () => {
  const s0 = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)], { map: { terrain: [{ col: 5, row: 8, type: 'fire' }] } });
  assert.equal(apply(s0, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).state.mechs.a1.overheat, 1);
});

test('movement: commit pips, step, turn, costs, heat', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8, { speed: '2+' }), mech('b1', 2, 'medium', 13, 8)],
    { map: { terrain: [{ col: 7, row: 8, type: 'mud' }] } });
  s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move', 'laser']);
  const step = (to, turn = 0) => apply(s, { type: 'MOVE_STEP', player: 1, to, turn });
  assert.equal(step(at(6, 8)).ok, false, 'no movement actions yet');
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2'] }).state; // 3 pips → 3+2 = 5 actions
  let r = step(at(6, 8)); assert.ok(r.ok, r.error); s = r.state;                       // 1
  r = step(at(7, 8)); assert.ok(r.ok, r.error); s = r.state;                           // mud: 2
  assert.equal(s.activation.moveSpent, 3);
  assert.equal(apply(s, { type: 'MOVE_STEP', player: 1, to: at(6, 8) }).ok, false); // back step costs 3, only 2 actions left
});

test('backward step costs 3 and sideways steps are refused', () => {
  let s = game([mech('a1', 1, 'medium', 8, 8, { speed: 'X' }), mech('b1', 2, 'medium', 13, 8)]);
  s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2'] }).state;      // X: 3 actions
  const back = apply(s, { type: 'MOVE_STEP', player: 1, to: at(7, 8) });                    // behind a facing-east mech
  assert.ok(back.ok); assert.equal(back.state.activation.moveSpent, 3);
  const pos = s.mechs.a1.pos;
  const side = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 2) });             // rear-left side: not allowed
  assert.equal(side.ok, false);
  const fwd = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(pos, 1) });              // front-right: turn + step
  assert.ok(fwd.ok, fwd.error); assert.equal(fwd.state.mechs.a1.facing, 1);
});

test('heat control: move heat, capacity, tokens, cooling', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8, { speed: 'X', coolers: 'standard' }), mech('b1', 2, 'medium', 13, 8)]);
  s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2', 'd3'] }).state; // 4 move pips → 2 heat
  s.activation.initialEvade = 1;                                                              // +1 uncontrolled → 3 heat
  const r = apply(s, { type: 'END_ACTIVATION', player: 1 });
  const hc = r.events.find((e) => e.type === 'heat_control');
  assert.equal(hc.generated, 3); assert.equal(hc.capacity, 2); assert.equal(hc.tokensAdded, 1);
  assert.equal(r.state.mechs.a1.overheat, 1);
});

test('double coolers remove 2 tokens; cooling crit locks a token; water cools extra', () => {
  const base = () => game([mech('a1', 1, 'medium', 5, 8, { coolers: 'double' }), mech('b1', 2, 'medium', 13, 8)],
    { map: { terrain: [{ col: 5, row: 8, type: 'water' }] } });
  let s = base(); s.mechs.a1.overheat = 4;
  s = playWith(s, apply, 1, 'a1', []);
  let r = apply(s, { type: 'END_ACTIVATION', player: 1 });
  assert.equal(r.state.mechs.a1.overheat, 1);            // 4 -2 (double) -1 (water)
  s = base(); s.mechs.a1.overheat = 1; s.mechs.a1.crits.cooling = 1;
  s = playWith(s, apply, 1, 'a1', []);
  r = apply(s, { type: 'END_ACTIVATION', player: 1 });
  assert.equal(r.state.mechs.a1.overheat, 1);            // locked token stays
});

test('minor activity gives virtual evade; emergency shutdown does not', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 13, 8)]);
  let r = apply(playWith(s, apply, 1, 'a1', []), { type: 'END_ACTIVATION', player: 1 });
  assert.equal(r.state.mechs.a1.virtualEvade, 1);
  s = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 13, 8)]); s.mechs.a1.overheat = 2;
  r = apply(apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).state, { type: 'EMERGENCY_SHUTDOWN', player: 1 });
  assert.ok(r.ok); assert.equal(r.state.mechs.a1.virtualEvade, 0); assert.equal(r.state.mechs.a1.overheat, 0);
});

test('class abilities: light swap, medium any→choice, triple conversion', () => {
  let s = game([mech('a1', 1, 'light', 5, 8), mech('b1', 2, 'light', 13, 8)]);
  s = playWith(s, apply, 1, 'a1', ['laser', 'ballistic', 'missile', 'jumpjet', 'move', 'move']);
  for (const id of ['d0', 'd1', 'd2']) { const r = apply(s, { type: 'CONVERT', player: 1, kind: 'toMove', pipIds: [id], to: 'move' }); assert.ok(r.ok, r.error); s = r.state; }
  assert.equal(apply(s, { type: 'CONVERT', player: 1, kind: 'toMove', pipIds: ['d3'], to: 'move' }).ok, false);   // only 3 swaps, and jumpjet isn't swappable
  const r = apply(s, { type: 'CONVERT', player: 1, kind: 'triple', pipIds: ['d3', 'd4', 'd5'], to: 'laser' });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.activation.pool.filter((p) => !p.spent && p.color === 'laser').length >= 1, true);
});

test('undo works until dice are rolled', () => {
  const g = new Game(game([mech('a1', 1, 'medium', 5, 8, { speed: 'X' }), mech('b1', 2, 'medium', 13, 8)]));
  g.dispatch({ type: 'ACTIVATE', player: 1, mechId: 'a1' });
  assert.ok(g.canUndo());
  g.dispatch({ type: 'ROLL_PILOT', player: 1 });
  assert.equal(g.canUndo(), false);                       // roll is a barrier
  g.state.activation.pool.forEach((p) => (p.color = 'move'));
  g.dispatch({ type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1'] });
  g.dispatch({ type: 'MOVE_STEP', player: 1, to: at(6, 8) });
  assert.deepEqual(g.state.mechs.a1.pos, at(6, 8));
  g.undo();
  assert.deepEqual(g.state.mechs.a1.pos, at(5, 8));
});

test('activation records the route and the starting facing', () => {
  let s = game([mech('a1', 1, 'medium', 5, 8, { speed: 'X' }), mech('b1', 2, 'medium', 13, 8)]);
  s = playWith(s, apply, 1, 'a1', ['move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1'] }).state;
  s = apply(s, { type: 'MOVE_STEP', player: 1, to: neighbor(s.mechs.a1.pos, 0) }).state;
  assert.equal(s.activation.route.length, 2); assert.equal(s.activation.startFacing, 0);
});

test('a discarded die keeps its evade; converting a die into its own color is refused', () => {
  const s0 = game([mech('a1', 1, 'medium', 5, 8), mech('b1', 2, 'medium', 11, 8)]); s0.mechs.a1.crits.control = 1;
  let s = apply(apply(s0, { type: 'ACTIVATE', player: 1, mechId: 'a1' }).state, { type: 'ROLL_PILOT', player: 1 }).state;
  s.activation.pool = ['laser', 'ballistic', 'move', 'move', 'move', 'move'].map((color, i) => ({ id: `d${i}`, die: i, color, evade: i === 0, spent: false, origin: 'roll' }));
  const r = apply(s, { type: 'DISCARD_DICE', player: 1, dieIds: ['d0'] });
  assert.equal(r.state.mechs.a1.evade, 1);                              // laser die dropped, its evade stays
  assert.equal(apply(r.state, { type: 'CONVERT', player: 1, kind: 'any1', to: 'move', pipIds: ['d2'] }).ok, false);
});
