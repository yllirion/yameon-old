import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../core/engine.js';
import { correctionsLeft } from '../core/attack.js';
import { DAMAGE_DIE } from '../core/data/dice.js';
import { WEAPONS } from '../core/data/weapons.js';
import { neighbor } from '../core/hex.js';
import { at, game, mech, playWith } from './helpers.js';

const duel = (a = {}, b = {}) =>
  game([mech('a1', 1, 'medium', 6, 8, { facing: 0, ...a }), mech('b1', 2, 'medium', 9, 8, { facing: 3, armorClass: 0, ...b })]);
const fire = (s, weaponId, pipIds) => apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId, targetId: 'b1', pipIds });
const corr = (s, pipIds, extra = {}) => apply(s, { type: 'CORRECT', player: 1, mode: 'ignoreEvade', pipIds, ...extra });

test('Gauss: a correction costs a PAIR of ballistic dice', () => {
  let s = playWith(duel({ weapons: ['gauss'] }), apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic', 'ballistic', 'ballistic']);
  const r = fire(s, 'w0', ['d0', 'd1']); assert.ok(r.ok, r.error);
  assert.ok(r.state.activation.attack, 'paused: 3 ballistic dice left = one more pair');
  assert.equal(correctionsLeft(r.state, r.state.activation, r.state.mechs.a1, r.state.mechs.b1, WEAPONS.gauss), 1);
  assert.equal(corr(r.state, ['d2']).ok, false);                       // one die is not enough
  const c = corr(r.state, ['d2', 'd3']); assert.ok(c.ok, c.error);
  assert.deepEqual(c.state.activation.pool.map((p) => p.spent), [true, true, true, true, false]);
  assert.equal(correctionsLeft(c.state, c.state.activation, c.state.mechs.a1, c.state.mechs.b1, WEAPONS.gauss), 0);
  assert.equal(corr(c.state, ['d4']).ok, false);
});

test('Gauss with only one spare ballistic die: nothing to correct with → resolves at once', () => {
  const s = playWith(duel({ weapons: ['gauss'] }), apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic']);
  const r = fire(s, 'w0', ['d0', 'd1']);
  assert.equal(r.state.activation.attack, null);
});

test('PPC: a correction costs laser + ballistic, a wrong color is refused without CC', () => {
  const s = playWith(duel({ weapons: ['mppc'] }), apply, 1, 'a1', ['laser', 'ballistic', 'laser', 'ballistic', 'move']);
  const r = fire(s, 'w0', ['d0', 'd1']); assert.ok(r.ok, r.error);
  assert.ok(r.state.activation.attack);
  assert.equal(corr(r.state, ['d2', 'd4']).ok, false);                 // laser + move: not the right pair
  assert.equal(corr(r.state, ['d3', 'd2']).ok, true);                  // order does not matter
});

test('CC can stand in for ONE die of the pair, once per activation; two wrong dice are refused', () => {
  const s = playWith(duel({ weapons: ['gauss'], equipment: { cc: true } }), apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic', 'laser', 'move']);
  const r = fire(s, 'w0', ['d0', 'd1']); assert.ok(r.ok, r.error);
  const st = r.state;
  assert.equal(correctionsLeft(st, st.activation, st.mechs.a1, st.mechs.b1, WEAPONS.gauss), 1);
  assert.equal(corr(st, ['d3', 'd4'], { cc: 'a1' }).ok, false);        // two wrong dice
  assert.equal(corr(st, ['d2', 'd3']).ok, false);                      // one wrong die but no CC named
  const c = corr(st, ['d2', 'd3'], { cc: 'a1' }); assert.ok(c.ok, c.error);
  assert.equal(c.state.activation.ccUsed, true); assert.equal(c.state.activation.heat.equipment, 0);
  assert.equal(corr(c.state, ['d4', 'd2'], { cc: 'a1' }).ok, false);   // CC already used (and d2 is spent)
});

test('single-die weapons keep costing one die per correction', () => {
  const s = playWith(duel({ weapons: ['ac5'] }), apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic']);
  const r = fire(s, 'w0', ['d0']);
  assert.equal(correctionsLeft(r.state, r.state.activation, r.state.mechs.a1, r.state.mechs.b1, WEAPONS.ac5), 2);
});

test('JUMP: one jump jet unit = one jump (jumpjet die, 2 heat, +1 virtual evade); JJ-II is not two jets', () => {
  let s = playWith(game([mech('a1', 1, 'medium', 6, 8, { equipment: { jumpjets: 1 } }), mech('b1', 2, 'medium', 13, 8, { facing: 3 })],
    { map: { terrain: [{ col: 6, row: 9, type: 'building' }] } }), apply, 1, 'a1', ['jumpjet', 'jumpjet', 'move']);
  const to = neighbor(s.mechs.a1.pos, 0);
  assert.equal(apply(s, { type: 'JUMP', player: 1, pipIds: ['d2'], to }).ok, false);          // move die cannot jump
  assert.equal(apply(s, { type: 'JUMP', player: 1, pipIds: ['d0'], to: neighbor(to, 0) }).ok, false);   // two hexes away
  const r = apply(s, { type: 'JUMP', player: 1, pipIds: ['d0'], to, turn: 1 }); assert.ok(r.ok, r.error);
  assert.deepEqual(r.state.mechs.a1.pos, to); assert.equal(r.state.mechs.a1.facing, 1);
  assert.equal(r.state.mechs.a1.virtualEvade, 1); assert.equal(r.state.activation.heat.jumps, 2);
  assert.equal(apply(r.state, { type: 'JUMP', player: 1, pipIds: ['d1'], to: neighbor(to, 0) }).ok, false); // only one unit
  const two = playWith(game([mech('a1', 1, 'medium', 6, 8, { equipment: { jumpjets: 2 } }), mech('b1', 2, 'medium', 13, 8, { facing: 3 })]), apply, 1, 'a1', ['jumpjet', 'jumpjet']);
  const j1 = apply(two, { type: 'JUMP', player: 1, pipIds: ['d0'], to }); assert.ok(j1.ok, j1.error);
  assert.ok(apply(j1.state, { type: 'JUMP', player: 1, pipIds: ['d1'], to: neighbor(to, 0) }).ok);
});

test('events carry the face indices the client draws: armor dice and damage dice', () => {
  const s = playWith(duel({ weapons: ['laser_l'] }, { armorClass: 5, facing: 0 }), apply, 1, 'a1', ['laser']);
  const r = fire(s, 'w0', ['d0']);
  const armor = r.events.find((e) => e.type === 'armor');
  assert.equal(armor.rear, true); assert.equal(armor.faces.length, 2); assert.equal(armor.rolls.length, 2);   // rear = 2 armor dice
  assert.ok(armor.faces.every((i) => i >= 0 && i < 6));
  if (armor.through > 0) {
    const t = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
    for (const e of t.events.filter((x) => x.type === 'damage_die')) assert.equal(e.face, DAMAGE_DIE[e.idx]);
  }
  const front = playWith(duel({ weapons: ['laser_l'] }, { armorClass: 4 }), apply, 1, 'a1', ['laser']);
  assert.equal(fire(front, 'w0', ['d0']).events.find((e) => e.type === 'armor').faces.length, 4);
});
