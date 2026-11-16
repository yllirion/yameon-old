import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../core/engine.js';
import { at, game, mech, playWith } from './helpers.js';

const duel = (a = {}, b = {}, more = [], opts = {}) =>
  game([mech('a1', 1, 'medium', 6, 8, { facing: 0, ...a }), mech('b1', 2, 'medium', 9, 8, { facing: 3, armorClass: 0, ...b }), ...more], opts);
const fire = (s, weaponId, pipIds, extra = {}) => apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId, targetId: 'b1', pipIds, ...extra });

test('MASC: one chosen move die = 2 movement actions, 1 heat, once per activation', () => {
  let s = playWith(game([mech('a1', 1, 'medium', 6, 8, { speed: '1', equipment: { masc: true } }), mech('b1', 2, 'medium', 14, 8, { facing: 3 })]), apply, 1, 'a1', ['move', 'move', 'laser']);
  assert.equal(apply(s, { type: 'USE_MASC', player: 1, pipIds: ['d2'] }).ok, false);           // only a move die
  const m = apply(s, { type: 'USE_MASC', player: 1, pipIds: ['d0'] }); assert.ok(m.ok, m.error);
  assert.equal(m.state.activation.heat.equipment, 1);
  assert.equal(m.state.activation.moveSpent, 0); assert.equal(m.state.activation.movePips, 0); // not a plain commit
  const total = (st) => { let t = st, n = 0; while (apply(t, { type: 'MOVE_STEP', player: 1, to: at(7 + n, 8) }).ok && n < 6) { t = apply(t, { type: 'MOVE_STEP', player: 1, to: at(7 + n, 8) }).state; n++; } return n; };
  assert.equal(total(m.state), 2);                                                             // 2 flat actions
  const both = apply(m.state, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d1'] }).state;        // another move die, speed '1' → 1 more
  assert.equal(total(both), 3);
  assert.equal(apply(m.state, { type: 'USE_MASC', player: 1, pipIds: ['d1'] }).ok, false);      // once
  assert.equal(apply(playWith(duel({}), apply, 1, 'a1', ['move']), { type: 'USE_MASC', player: 1, pipIds: ['d0'] }).ok, false); // no MASC installed
});

test('CC: own CC converts any die for a correction; once per activation; no extra heat', () => {
  let s = playWith(duel({ weapons: ['ac5'], equipment: { cc: true } }), apply, 1, 'a1', ['ballistic', 'laser', 'jumpjet']);
  const r = fire(s, 'w0', ['d0']); assert.ok(r.ok, r.error);
  assert.ok(r.state.activation.attack, 'paused: CC can still correct');
  const noCc = apply(r.state, { type: 'CORRECT', player: 1, mode: 'ignoreEvade', pipIds: ['d1'] });
  assert.equal(noCc.ok, false);                                                        // wrong color without naming a CC
  const c = apply(r.state, { type: 'CORRECT', player: 1, mode: 'reroll', group: 'ballistic', index: 0, pipIds: ['d1'], cc: 'a1' });
  assert.ok(c.ok, c.error); assert.equal(c.state.activation.heat.equipment, 0);
  assert.equal(apply(c.state, { type: 'CORRECT', player: 1, mode: 'ignoreEvade', pipIds: ['d2'], cc: 'a1' }).ok, false); // used up
});

test('CC: an allied CC that sees the target costs the active mech 1 heat; blocked line → refused', () => {
  const ally = (terrain = []) => duel({ weapons: ['ac5'] }, {}, [mech('a2', 1, 'medium', 6, 10, { equipment: { cc: true } })], { map: { terrain } });
  let s = playWith(ally(), apply, 1, 'a1', ['ballistic', 'laser']);
  let r = fire(s, 'w0', ['d0']); assert.ok(r.state.activation.attack);
  const c = apply(r.state, { type: 'CORRECT', player: 1, mode: 'ignoreEvade', pipIds: ['d1'], cc: 'a2' });
  assert.ok(c.ok, c.error); assert.equal(c.state.activation.heat.equipment, 1);
  s = playWith(ally([{ col: 7, row: 9, type: 'cliff' }, { col: 8, row: 9, type: 'cliff' }, { col: 8, row: 10, type: 'cliff' }, { col: 7, row: 10, type: 'cliff' }]), apply, 1, 'a1', ['ballistic', 'laser']);
  r = fire(s, 'w0', ['d0']);
  assert.equal(r.state.activation.attack, null, 'ally cannot see the target → nothing to correct with → resolved at once');
});

test('TC: one die of any color can pay for one weapon activation, once per activation', () => {
  let s = playWith(duel({ weapons: ['ac5', 'laser_m'], equipment: { tc: true } }), apply, 1, 'a1', ['move', 'move', 'laser']);
  assert.equal(fire(s, 'w0', ['d0']).ok, false);                                       // wrong color without TC
  const r = fire(s, 'w0', ['d0'], { useTC: true }); assert.ok(r.ok, r.error);
  assert.equal(r.state.activation.tcUsed, true);
  if (r.state.pending) r.state.pending = null;
  assert.equal(apply(r.state, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w1', targetId: 'b1', pipIds: ['d1'], useTC: true }).ok, false); // already used
  const noTc = playWith(duel({ weapons: ['ac5'] }), apply, 1, 'a1', ['move']);
  assert.equal(fire(noTc, 'w0', ['d0'], { useTC: true }).ok, false);
});

test('TC: attacker may reroll one damage die after the defender takes the damage', () => {
  let s = playWith(duel({ weapons: ['laser_l'], equipment: { tc: true } }), apply, 1, 'a1', ['laser']);
  let r = fire(s, 'w0', ['d0']);
  assert.equal(r.state.pending.type, 'DEFENDER_DECISION');
  r = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' }); assert.ok(r.ok, r.error);
  assert.equal(r.state.pending.type, 'TC_REROLL'); assert.equal(r.state.pending.player, 1);
  assert.equal(r.state.mechs.b1.damage, 0, 'nothing is applied until the attacker decides');
  const keep = apply(r.state, { type: 'RESOLVE_DECISION', player: 1, choice: 'keep' });
  assert.equal(keep.state.activation.tcUsed, false);
  assert.ok(keep.events.some((e) => e.type === 'damage_die'));
  const rr = apply(r.state, { type: 'RESOLVE_DECISION', player: 1, choice: 'reroll:0' });
  assert.equal(rr.state.activation.tcUsed, true); assert.ok(rr.events.some((e) => e.type === 'tc_reroll'));
});

test('melee: fist 1 / sword 2 / axe 3 movement actions and as many ballistic dice; no pilot die, no correction, no heat', () => {
  for (const [weapon, cost, dice] of [['fist', 1, 1], ['sword', 2, 2], ['axe', 3, 3]]) {
    let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: [weapon], speed: 'X' }), mech('b1', 2, 'medium', 7, 8, { facing: 3, armorClass: 0 })]);
    s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move', 'move']);
    assert.equal(fire(s, 'w0', []).ok, false, `${weapon}: no movement actions yet`);
    s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: Array.from({ length: cost }, (_, i) => `d${i}`) }).state;
    const r = fire(s, 'w0', []); assert.ok(r.ok, r.error);
    assert.equal(r.state.activation.moveSpent, cost);
    assert.equal(r.state.activation.attack, null);
    assert.equal(r.state.activation.heat.weapons, 0);
    assert.equal(r.events.find((e) => e.type === 'attack').faces.ballistic.length, dice);
  }
});

test('melee: one action short is refused; anchor makes it cost one more; evade never turns an adjacent hit into a miss', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['sword'], speed: 'X' }), mech('b1', 2, 'medium', 7, 8, { facing: 3, armorClass: 0 })]);
  s = playWith(s, apply, 1, 'a1', ['move', 'move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1'] }).state;
  s.mechs.a1.anchor = 1;                                                                // sword 2 + anchor 1 = 3 > 2 available
  assert.equal(fire(s, 'w0', []).ok, false);
  s.mechs.a1.anchor = 0; s.mechs.b1.virtualEvade = 5;                                   // lots of evade would push a ballistic shot to "long"
  for (let seed = 1; seed < 60; seed++) {
    const p = structuredClone(s); p.rngState = seed;
    const e = fire(p, 'w0', []).events.find((x) => x.type === 'attack');
    assert.equal(e.band, 'short'); assert.equal(e.miss, false);
  }
});

test('conversions: a light mech converts three weapon dice to move in one action; TC changes one weapon die once', () => {
  let s = playWith(game([mech('a1', 1, 'light', 6, 8, { equipment: { tc: true } }), mech('b1', 2, 'medium', 14, 8, { facing: 3 })]), apply, 1, 'a1', ['laser', 'ballistic', 'missile', 'laser']);
  const r = apply(s, { type: 'CONVERT', player: 1, kind: 'toMove', to: 'move', pipIds: ['d0', 'd1', 'd2'] });
  assert.ok(r.ok, r.error);
  assert.equal(r.state.activation.pool.filter((p) => p.color === 'move' && !p.spent).length, 3);
  assert.equal(apply(r.state, { type: 'CONVERT', player: 1, kind: 'toMove', to: 'move', pipIds: ['d3'] }).ok, false); // limit 3 used up
  assert.equal(apply(s, { type: 'CONVERT', player: 1, kind: 'toMove', to: 'move', pipIds: ['d0', 'd1'] }).ok, true);  // partial is fine
  const t = apply(s, { type: 'CONVERT', player: 1, kind: 'tc', to: 'missile', pipIds: ['d0'] }); assert.ok(t.ok, t.error);
  assert.equal(t.state.activation.tcUsed, true);
  assert.equal(apply(t.state, { type: 'CONVERT', player: 1, kind: 'tc', to: 'laser', pipIds: ['d1'] }).ok, false);   // once per activation
  assert.equal(apply(s, { type: 'CONVERT', player: 1, kind: 'tc', to: 'move', pipIds: ['d0'] }).ok, false);          // weapon values only
});
