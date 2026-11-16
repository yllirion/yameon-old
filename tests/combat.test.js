import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../core/data/weapons.js';
import { apply, ramDamage, mustShutdown, massPlan } from '../core/engine.js';
import { missileCuts, volleyTurns, stretchOf, shotPreview } from '../core/attack.js';
import { armorRoll } from '../core/damage.js';
import { makeRng } from '../core/rng.js';
import { applyDamageFaces } from '../core/damage.js';
import { makeMech } from '../core/state.js';
import { destroyMech } from '../core/damage.js';
import { at, game, mech, playWith } from './helpers.js';

const duel = (extraA = {}, extraB = {}, opts = {}) =>
  game([mech('a1', 1, 'medium', 6, 8, { weapons: ['laser_l', 'ac5', 'lrm10', 'srm4', 'gauss'], ...extraA }),
        mech('b1', 2, 'medium', 9, 8, { facing: 3, ...extraB })], opts);
const fireRaw = (s, weaponId, pipIds, targetId = 'b1') => apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId, targetId, pipIds });
// FIRE pauses for fire correction when spare dice of the weapon's color remain; tests resolve it unless they want to hold.
const fire = (s, weaponId, pipIds, targetId = 'b1') => {
  const r = fireRaw(s, weaponId, pipIds, targetId);
  if (!r.ok || !r.state.activation.attack) return r;
  const f = apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 });
  return { ...f, events: [...r.events, ...f.events] };
};

test('armor die: starred faces are voided by armor crits', () => {
  const m = makeMech({ id: 'x', owner: 1, cls: 'assault', pos: at(8, 8) });
  const sum = (crit) => { m.crits.armor = crit; const r = makeRng(5); let t = 0; for (let i = 0; i < 600; i++) t += armorRoll(r, m, false).sum; return t; };
  assert.ok(sum(0) > sum(1) && sum(1) > sum(2));
});

test('laser: costs a laser pip, heat = face values, armor then decision window', () => {
  let s = duel({}, { armorClass: 0 });                       // no armor dice → damage always goes through
  s = playWith(s, apply, 1, 'a1', ['laser', 'laser', 'ballistic']);
  assert.equal(fire(s, 'w0', ['d2']).ok, false);             // wrong color
  const r = fire(s, 'w0', ['d0']);
  assert.ok(r.ok, r.error);
  const atk = r.events.find((e) => e.type === 'attack');
  assert.equal(atk.damage, 3);                               // 3 energy dice = 3 damage
  assert.equal(r.state.activation.heat.weapons, atk.rolls.energy.reduce((a, b) => a + b, 0));
  assert.equal(r.state.pending.type, 'DEFENDER_DECISION');
  assert.equal(r.state.pending.dice, 3);
  assert.equal(apply(r.state, { type: 'END_ACTIVATION', player: 1 }).ok, false);   // must resolve first
});

test('defender can eject before the damage dice; or take the damage', () => {
  let s = duel({}, { armorClass: 0 });
  s = playWith(s, apply, 1, 'a1', ['laser']);
  const r = fire(s, 'w0', ['d0']);
  assert.equal(apply(r.state, { type: 'RESOLVE_DECISION', player: 1, choice: 'take' }).ok, false); // not your decision
  const ej = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'eject' });
  assert.ok(['disabled', 'destroyed'].includes(ej.state.mechs.b1.status));   // damage is still rolled: not enough → disabled, enough → destroyed
  assert.equal(ej.state.mechs.b1.pilotEjected, true);
  assert.equal(ej.state.winner, 1);
  const take = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
  assert.equal(take.events.filter((e) => e.type === 'damage_die').length >= 1, true);
  assert.equal(take.state.pending, null);
});

test('range, arc and LOS validation', () => {
  let s = duel({}, { armorClass: 0 }); s = playWith(s, apply, 1, 'a1', ['missile', 'laser', 'ballistic', 'ballistic']);
  assert.match(fire(s, 'w2', ['d0']).error, /out of range/);                     // LRM at distance 3 (min 6)
  const behind = duel({ facing: 3 }); const sb = playWith(behind, apply, 1, 'a1', ['laser']);
  assert.match(fire(sb, 'w0', ['d0']).error, /front arc/);
  const walled = duel({}, { armorClass: 0 }, { map: { terrain: [{ col: 7, row: 8, type: 'cliff' }] } });
  const sw = playWith(walled, apply, 1, 'a1', ['laser']);
  assert.match(fire(sw, 'w0', ['d0']).error, /blocked/);
});

test('LRM works at 6–9 hexes and evade absorbs its damage', () => {
  let s = game([mech('a1', 1, 'medium', 4, 8, { weapons: ['lrm20'] }), mech('b1', 2, 'medium', 10, 8, { facing: 3, armorClass: 0 })]);
  s = playWith(s, apply, 1, 'a1', ['missile']);
  s.mechs.b1.virtualEvade = 2;
  const r = fire(s, 'w0', ['d0']);
  assert.ok(r.ok, r.error);
  const atk = r.events.find((e) => e.type === 'attack');
  assert.equal(atk.virtualEvade, 2); assert.equal(atk.dist, 6);
  const raw = atk.rolls.missile.reduce((a, f) => a + (f.srm ? 0 : f.dmg), 0);
  assert.equal(atk.damage, raw);                                                  // per weapon the raw sum; evade is taken off the whole volley
  const cut = r.events.find((e) => e.type === 'evade_cut');
  assert.equal(cut.tokens, 2); assert.equal(cut.cut, Math.min(raw, 2));
});

test('evade tokens are subtracted ONCE from the summed LRM damage of the volley (4 LRM10: 3+4+2+2, evade 2 + virtual 1 → 8)', () => {
  const shots = [3, 4, 2, 2].map((dmg) => ({ sub: 'lrm', dmg, evFlat: 3, evIgnored: 0 }));
  assert.equal(missileCuts({ targetId: 't', ams: {} }, shots), 3);
  assert.equal(missileCuts({ targetId: 't', ams: {} }, shots.map((x, i) => ({ ...x, evIgnored: i === 0 ? 1 : 0 }))), 2);   // one corrected die ignores one token
  assert.equal(missileCuts({ targetId: 't', ams: {} }, [{ sub: 'lrm', dmg: 1, evFlat: 3, evIgnored: 0 }]), 1);              // cannot go below zero
  assert.equal(missileCuts({ targetId: 't', ams: {} }, [{ sub: 'srm', dmg: 5, evFlat: 0, evIgnored: 0 }]), 0);              // close SRM: no evade cut
});

test('mass activation: 2 laser pips fire 3 lasers, 1 heat for the unpaid one; weapons fire once', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['laser_s', 'laser_s', 'laser_s'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3, armorClass: 3 })]);
  s = playWith(s, apply, 1, 'a1', ['laser', 'laser']);
  s = apply(s, { type: 'MASS_ACTIVATE', player: 1, color: 'laser', pipIds: ['d0', 'd1'] }).state;
  assert.equal(s.activation.heat.weapons, 1);
  let r = fire(s, 'w0', []); assert.ok(r.ok, r.error);
  if (r.state.pending) r.state.pending = null;                                       // skip the decision window
  assert.equal(fire(r.state, 'w0', []).ok, false);                                   // already fired
  r = fire(r.state, 'w1', []); assert.ok(r.ok, r.error);
});

test('gauss and PPC cannot be mass-activated; they need both colors', () => {
  let s = duel({ weapons: ['gauss', 'mppc'] }); s = playWith(s, apply, 1, 'a1', ['ballistic', 'ballistic', 'laser']);
  assert.equal(fire(s, 'w0', ['d0']).ok, false);
  assert.ok(fire(s, 'w0', ['d0', 'd1']).ok);
  const p = fire(s, 'w1', ['d0', 'd2']); assert.ok(p.ok, p.error);
  if (!p.events.find((e) => e.type === 'attack').miss) assert.equal(p.state.mechs.b1.anchor, 1);
});

test('ram: damage = class difference (≥0), unblockable, once per activation', () => {
  let s = game([mech('a1', 1, 'heavy', 6, 8, { speed: 'X' }), mech('b1', 2, 'light', 7, 8)]);
  s.turn = { rank: 3, player: 1 };
  s = playWith(s, apply, 1, 'a1', ['move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1'] }).state;
  const r = apply(s, { type: 'RAM', player: 1, targetId: 'b1' });
  assert.ok(r.ok, r.error);
  assert.equal(r.events.find((e) => e.type === 'ram').damage, 2);                    // 3 - 1
  assert.equal(r.state.pending.dice, 2);
});

test('destroyed mech leaves a wreck (cover) and detonates into neighbours', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['laser_l'] }), mech('b1', 2, 'light', 8, 8, { facing: 3, armorClass: 0 }), mech('b2', 2, 'light', 9, 8, { facing: 3 })]);
  s.turn = { rank: 2, player: 1 };
  s.mechs.b1.damage = 3;                                                             // one more point kills a light mech
  s = playWith(s, apply, 1, 'a1', ['laser']);
  let r = fire(s, 'w0', ['d0']); assert.ok(r.ok, r.error);
  // a crit no longer adds damage, so killing needs a "hit" face: look for a seed where one of the 3 dice is a hit
  let killed = null;
  for (let seed = 1; seed < 200 && !killed; seed++) {
    const probe = structuredClone(r.state); probe.rngState = seed;
    const x = apply(probe, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
    if (x.state.mechs.b1.status === 'destroyed') killed = x;
  }
  assert.ok(killed, 'some seed must destroy the mech');
  assert.equal(killed.state.map.cells[`${at(8, 8).q},8`].cover, 1);
  assert.ok(killed.events.some((e) => e.type === 'detonation_hit' && e.targetId === 'b2'));
});

test('crits are only crits: no damage point; 3 identical crits disable (no explosion); cooling crit locks a token', () => {
  const s = duel();
  const m = s.mechs.b1;
  const faces = { crit_control: 'control', crit_armor: 'armor', crit_cooling: 'cooling' };
  const seen = new Set();
  for (let seed = 1; seed < 400 && seen.size < 3; seed++) {
    const probe = structuredClone(s); probe.rngState = seed;
    const r = apply({ ...probe, pending: { type: 'DEFENDER_DECISION', player: 2, targetId: 'b1', dice: 1, sourceId: 'a1', options: ['take', 'eject'] } },
      { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
    const die = r.events.find((e) => e.type === 'damage_die').face;
    if (die === 'hit') continue;
    seen.add(die);
    const mm = r.state.mechs.b1, sys = faces[die];
    assert.equal(mm.crits[sys], 1); assert.equal(mm.damage, 0);
    if (sys === 'cooling') assert.equal(mm.overheat, 1);
  }
  assert.equal(seen.size, 3);
  // third identical crit → disabled, not destroyed
  m.crits.control = 2;
  for (let seed = 1; seed < 400; seed++) {
    const probe = structuredClone(s); probe.rngState = seed;
    probe.pending = { type: 'DEFENDER_DECISION', player: 2, targetId: 'b1', dice: 1, sourceId: 'a1', options: ['take', 'eject'] };
    probe.mechs.b1.crits.control = 2;
    const r = apply(probe, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
    if (r.events.find((e) => e.type === 'damage_die').face === 'crit_control') {
      assert.equal(r.state.mechs.b1.status, 'disabled'); assert.equal(r.state.mechs.b1.damage, 0);
      assert.ok(!r.events.some((e) => e.type === 'destroyed'));
      return;
    }
  }
  assert.fail('never rolled a control crit');
});

test('state in, state out: apply never mutates its input', () => {
  const s = duel(); const before = JSON.stringify(s);
  apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' });
  assert.equal(JSON.stringify(s), before);
});

test('fire correction: reroll a weapon die / ignore evade with extra dice of the same color', () => {
  let s = duel({ weapons: ['ac5'] });                                      // distance 3 = medium
  s = playWith(s, apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic', 'laser']);
  let r = fireRaw(s, 'w0', ['d0']); assert.ok(r.ok, r.error);
  assert.ok(r.state.activation.attack, 'paused: spare ballistic dice exist');
  assert.equal(apply(r.state, { type: 'END_ACTIVATION', player: 1 }).ok, false);   // must finish the attack first
  assert.equal(apply(r.state, { type: 'MOVE_STEP', player: 1, to: at(7, 8) }).ok, false);
  const held = structuredClone(r.state); held.activation.attack.shots[0].rolls.ballistic = [1, 3];   // a "**" face → miss at medium
  assert.equal(apply(held, { type: 'CORRECT', player: 1, mode: 'reroll', group: 'ballistic', index: 0, pipIds: ['d3'] }).ok, false); // laser die: wrong color
  const c1 = apply(held, { type: 'CORRECT', player: 1, mode: 'reroll', group: 'ballistic', index: 0, pipIds: ['d1'] });
  assert.ok(c1.ok, c1.error); assert.equal(c1.state.activation.pool[1].spent, true);
  assert.equal(c1.usedRng, true);
  // evade stretches effective range: virtual evade 3 → distance 6 = long; a "***" face misses there
  const ev = structuredClone(held); ev.mechs.b1.virtualEvade = 3; ev.activation.attack.shots[0].rolls.ballistic = [2, 3];
  assert.ok(apply(ev, { type: 'RESOLVE_ATTACK', player: 1 }).events.find((e) => e.type === 'attack').miss);
  const ig = apply(ev, { type: 'CORRECT', player: 1, mode: 'ignoreEvade', pipIds: ['d1'] });   // → effective distance 5 = medium
  assert.ok(!apply(ig.state, { type: 'RESOLVE_ATTACK', player: 1 }).events.find((e) => e.type === 'attack').miss);
});

test('no spare dice of the weapon color → the attack resolves immediately', () => {
  let s = duel({ weapons: ['ac5'] }); s = playWith(s, apply, 1, 'a1', ['ballistic', 'laser']);
  const r = fireRaw(s, 'w0', ['d0']);
  assert.ok(r.ok); assert.equal(r.state.activation.attack, null);
  assert.ok(r.events.some((e) => e.type === 'attack'));
});

test('volley: several weapons at one target, dice kept per weapon, one armor roll', () => {
  let s = duel({ weapons: ['srm2', 'srm2', 'srm6'] }, { armorClass: 0 });
  s = playWith(s, apply, 1, 'a1', ['missile', 'missile', 'missile']);
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', targetId: 'b1', weapons: [
    { weaponId: 'w0', pipIds: ['d0'] }, { weaponId: 'w1', pipIds: ['d1'] }, { weaponId: 'w2', pipIds: ['d2'] }] });
  assert.ok(r.ok, r.error);
  const A = r.state.activation.attack;
  if (A) assert.deepEqual(A.shots.map((x) => x.rolls.missile.length), [1, 1, 3]);
  const done = A ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }) : r;
  assert.equal(done.events.filter((e) => e.type === 'attack').length, 3);
  assert.equal(r.state.activation.fired.length, 3);
  assert.equal(apply(s, { type: 'FIRE', player: 1, mechId: 'a1', targetId: 'b1', weapons: [{ weaponId: 'w0', pipIds: ['d0'] }, { weaponId: 'w0', pipIds: ['d1'] }] }).ok, false);
});

test('plasma cutter: damage equals the heat rolled', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['plasma_h'] }), mech('b1', 2, 'medium', 7, 8, { facing: 3, armorClass: 0 })]);
  s = playWith(s, apply, 1, 'a1', ['laser']);
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] });
  const f = r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }) : r;
  const ev = [...r.events, ...f.events].find((e) => e.type === 'attack');
  assert.equal(ev.damage, ev.heat); assert.equal(ev.heat, ev.rolls.energy.reduce((a, b) => a + b, 0));
});

test('LRM arcs over obstacles in the middle; laser does not', () => {
  const map = { terrain: [{ col: 9, row: 8, type: 'cliff' }] };
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['lrm10', 'laser_l'] }), mech('b1', 2, 'medium', 13, 8, { facing: 3 })], { map });
  s = playWith(s, apply, 1, 'a1', ['missile', 'laser']);
  assert.ok(apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] }).ok);
  assert.equal(apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w1', targetId: 'b1', pipIds: ['d1'] }).ok, false);
  const near = structuredClone(s); near.map = game([mech('a1', 1, 'medium', 6, 8), mech('b1', 2, 'medium', 13, 8)], { map: { terrain: [{ col: 7, row: 8, type: 'cliff' }] } }).map;
  assert.equal(apply(near, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] }).ok, false); // first hex is a cliff
});

test('cover on the line stretches ballistic range', () => {
  const run = (cover) => {
    let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })], { map: { terrain: cover ? [{ col: 8, row: 8, type: 'plain', cover }] : [] } });
    s = playWith(s, apply, 1, 'a1', ['ballistic']);
    const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] });
    return [...r.events, ...(r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events : [])].find((e) => e.type === 'attack').band;
  };
  assert.equal(run(0), 'medium'); assert.equal(run(3), 'long');
});

test('a mech on the line of fire is cover of its own size', () => {
  const g = (cls) => playWith(game([mech('a1', 1, 'light', 6, 8, { weapons: ['laser_l', 'ac5'] }), mech('c1', 2, cls, 8, 8), mech('b1', 2, 'medium', 10, 8, { facing: 3 })]), apply, 1, 'a1', ['laser', 'ballistic']);
  const f = (s, w, d) => apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: w, targetId: 'b1', pipIds: [d] });
  assert.equal(f(g('heavy'), 'w0', 'd0').ok, false);   // heavy in front of a medium target: no laser shot
  assert.equal(f(g('light'), 'w0', 'd0').ok, true);
  const ev = (r) => [...r.events, ...(r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events : [])].find((e) => e.type === 'attack');
  assert.equal(ev(f(g('assault'), 'w1', 'd1')).band, 'long');   // dist 4 + cover 4
});

test('MG: virtual evade counts twice for range; damage per die is capped by the target armor crits', () => {
  const shoot = (crits, face) => {
    let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['mg'] }), mech('b1', 2, 'medium', 8, 8, { facing: 3, armorClass: 0 })]);
    s.mechs.b1.virtualEvade = 2; s.mechs.b1.evade = 1; s.mechs.b1.crits.armor = crits;
    s = playWith(s, apply, 1, 'a1', ['ballistic', 'ballistic']);
    const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] });
    r.state.activation.attack.shots[0].rolls.ballistic = [face];
    return apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events.find((e) => e.type === 'attack');
  };
  const e = shoot(0, 4);                                   // 2 damage face, intact armor → capped to 1
  assert.equal(e.band, 'long');                            // 2 + 1 evade + 2×2 virtual = 7
  assert.ok(e.damage <= 1);
  assert.equal(shoot(1, 5).damage <= 2, true);
});

test('damage: hits first, then every crit is recorded even after the mech is disabled', () => {
  const s = game([mech('a1', 1, 'medium', 6, 8), mech('b1', 2, 'medium', 9, 8)]);
  const m = s.mechs.b1; m.damage = 3; m.crits = { control: 1, armor: 1, cooling: 1 };
  const faces = [2, 3, 4, 2, 3, 4];                      // control, armor, cooling ×2
  const events = []; applyDamageFaces(s, makeRng(1), events, m, faces);
  assert.deepEqual(m.crits, { control: 3, armor: 3, cooling: 3 });
  assert.equal(m.status, 'disabled'); assert.equal(m.damage, 3);
  const h = structuredClone(s.mechs.b1); h.status = 'active'; h.damage = 3; h.crits = { control: 2, armor: 0, cooling: 0 };
  s.mechs.b1 = h; applyDamageFaces(s, makeRng(1), [], h, [2, 0, 0, 0]);   // control crit listed before three hits
  assert.equal(h.status, 'destroyed');                   // 3 + 3 hits > 4 durability
  assert.equal(h.crits.control, 3);                      // the crit still counted
});

test('terrain armor also applies along the line of fire', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['laser_l'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })],
    { map: { terrain: [{ col: 7, row: 8, type: 'rock' }, { col: 8, row: 8, type: 'rock' }] } });
  s = playWith(s, apply, 1, 'a1', ['laser']);
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] });
  const ev = [...r.events, ...(r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events : [])].find((e) => e.type === 'armor');
  assert.ok(ev, 'a hit must reach the armor roll'); assert.equal(ev.bonusArmor, 2);
});

test('ballistic shot is impossible when evade pushes the effective range past the maximum', () => {
  const run = (evade) => {
    const s = game([mech('a1', 1, 'medium', 3, 8, { weapons: ['ac5', 'laser_l'] }), mech('b1', 2, 'medium', 11, 8, { facing: 3 })]); // distance 8
    s.mechs.b1.evade = evade;
    const p = playWith(s, apply, 1, 'a1', ['ballistic', 'laser']);
    return ['w0', 'w1'].map((w, i) => apply(p, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: w, targetId: 'b1', pipIds: [`d${i}`] }).ok);
  };
  assert.deepEqual(run(1), [true, true]);      // 8 + 1 = 9
  assert.deepEqual(run(2), [false, true]);     // 8 + 2 = 10 > 9; the laser ignores evade
});

test('buildings can be shot: 4 damage in one attack collapses them into rocks or fire', () => {
  const mk = () => playWith(game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac10'] }), mech('b1', 2, 'medium', 14, 8, { facing: 3 })], { map: { terrain: [{ col: 8, row: 8, type: 'building' }] } }), apply, 1, 'a1', ['ballistic']);
  const hex = at(8, 8);
  let hit = false;
  for (let seed = 1; seed < 40 && !hit; seed++) {
    const s = mk(); s.rngState = seed;
    const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetHex: hex, pipIds: ['d0'] });
    assert.ok(r.ok, r.error);
    const ev = [...r.events, ...(r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events : [])].find((e) => e.type === 'building_hit');
    assert.ok(ev);
    if (ev.destroyed) { hit = true; assert.ok(['fire', 'rock'].includes(ev.becomes)); assert.ok(ev.damage >= 4); }
    else assert.ok(ev.damage < 4);
  }
  assert.ok(hit, 'AC10 should flatten a building for some seed');
  assert.equal(apply(mk(), { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetHex: at(9, 8), pipIds: ['d0'] }).ok, false); // no building there
});

test('deep water: lasers lose 2 range per overheat token of the target (water: 1)', () => {
  const run = (type, oh) => {
    let s = game([mech('a1', 1, 'medium', 2, 8, { weapons: ['laser_l'] }), mech('b1', 2, 'medium', 10, 8, { facing: 3 })], { map: { terrain: [{ col: 10, row: 8, type }] } });
    s.mechs.b1.overheat = oh; s = playWith(s, apply, 1, 'a1', ['laser']);
    return apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d0'] }).ok;   // distance 8
  };
  assert.equal(run('deepWater', 0), true); assert.equal(run('deepWater', 1), false);   // 9 − 2 = 7 < 8
  assert.equal(run('water', 1), true); assert.equal(run('water', 2), false);           // 9 − 2 = 7 < 8
});

test('ram: every extra action raises the attacker class by 1 (light + 4 extra vs assault → 1 damage, never above the own class)', () => {
  assert.equal(ramDamage(1, 4, 3), 0); assert.equal(ramDamage(1, 4, 4), 1); assert.equal(ramDamage(1, 4, 8), 1);
  assert.equal(ramDamage(2, 4, 2), 0); assert.equal(ramDamage(2, 4, 3), 1); assert.equal(ramDamage(4, 1, 0), 3); assert.equal(ramDamage(4, 1, 5), 4);
});

test('ram: class difference + extra actions, capped by the attacker class; jumpjet ram pays dice', () => {
  const setup = (aCls, bCls, pool, eq = {}) => { const g0 = game([mech('a1', 1, aCls, 6, 8, { equipment: eq, speed: 'X' }), mech('b1', 2, bCls, 7, 8, { facing: 3 })]); g0.turn = { rank: { light: 1, medium: 2, heavy: 3, assault: 4 }[aCls], player: 1 }; return playWith(g0, apply, 1, 'a1', pool); };
  let s = setup('assault', 'light', ['move', 'move', 'move', 'move', 'move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'] }).state;
  const ram = (st, extra) => apply(st, { type: 'RAM', player: 1, targetId: 'b1', extraActions: extra });
  assert.equal(ram(s, 0).events.find((e) => e.type === 'ram').damage, 3);      // 4 − 1
  assert.equal(ram(s, 3).events.find((e) => e.type === 'ram').damage, 4);      // capped by class 4
  assert.equal(ram(ram(s, 0).state, 0).ok, false);                               // once per activation
  let l = setup('light', 'medium', ['move', 'move', 'move', 'move', 'move']);
  l = apply(l, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1', 'd2', 'd3', 'd4'] }).state;
  assert.equal(ram(l, 0).ok, false);                                             // light into medium: 0 damage → a ram is not allowed
  assert.equal(ram(l, 1).ok, false);                                             // 1 + 1 − 2 = 0: still nothing
  assert.equal(ram(l, 3).events.find((e) => e.type === 'ram').damage, 1);      // capped by class 1
  let j = setup('medium', 'medium', ['jumpjet', 'jumpjet', 'jumpjet', 'move'], { jumpjets: 2 });
  assert.equal(apply(j, { type: 'RAM', player: 1, targetId: 'b1', via: 'jump', extraActions: 1, pipIds: ['d0', 'd1', 'd2'] }).ok, true);    // jets limit jumps, not the dice paid for a ram
  assert.equal(apply(setup('medium', 'medium', ['jumpjet', 'jumpjet']), { type: 'RAM', player: 1, targetId: 'b1', via: 'jump', pipIds: ['d0', 'd1'] }).ok, false);   // no jets at all
  assert.equal(apply(j, { type: 'RAM', player: 1, targetId: 'b1', via: 'jump', pipIds: ['d0', 'd1'] }).ok, false);   // medium into medium: 0 damage
  const h = setup('heavy', 'medium', ['jumpjet', 'jumpjet', 'jumpjet', 'move'], { jumpjets: 2 });
  const jr = apply(h, { type: 'RAM', player: 1, targetId: 'b1', via: 'jump', pipIds: ['d0', 'd1'] }); assert.ok(jr.ok, jr.error);
  assert.equal(jr.state.activation.heat.jumps, 4); assert.equal(jr.events.find((e) => e.type === 'ram').damage, 1);
});

test('jump in place: no movement, still 2 heat, virtual evade and a free turn; jets used set the radius that ignores cover', () => {
  const mk = () => { const s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5'], equipment: { jumpjets: 2 } }), mech('b1', 2, 'medium', 11, 8, { facing: 3 })], { map: { terrain: [{ col: 8, row: 8, type: 'plain', cover: 3 }] } });
    return playWith(s, apply, 1, 'a1', ['jumpjet', 'ballistic', 'jumpjet']); };
  const s = mk(), pos = s.mechs.a1.pos;
  const j = apply(s, { type: 'JUMP', player: 1, to: pos, turn: 1, pipIds: ['d0'] }); assert.ok(j.ok, j.error);
  assert.deepEqual(j.state.mechs.a1.pos, pos); assert.equal(j.state.mechs.a1.facing, 1);
  assert.equal(j.state.activation.heat.jumps, 2); assert.equal(j.state.mechs.a1.virtualEvade, 1);
  // cover 3 at distance 2 from the attacker, target at distance 5: a plain shot is stretched (5 + 3 = 8 → long), after 2 jumps it is not
  const band = (st) => { st.mechs.a1.facing = 0; const r = apply(st, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: 'w0', targetId: 'b1', pipIds: ['d1'] });
    return [...r.events, ...(r.state.activation.attack ? apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 }).events : [])].find((e) => e.type === 'attack').band; };
  assert.equal(band(structuredClone(s)), 'long');
  let t = apply(s, { type: 'JUMP', player: 1, to: pos, pipIds: ['d0'] }).state; t = apply(t, { type: 'JUMP', player: 1, to: pos, pipIds: ['d2'] }).state;
  assert.equal(band(t), 'medium');
});

test('mass activation: 2 ballistic dice fire 3 AC5 for +1 heat', () => {
  let s = playWith(game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5', 'ac5', 'ac5'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })]), apply, 1, 'a1', ['ballistic', 'ballistic']);
  const m = apply(s, { type: 'MASS_ACTIVATE', player: 1, color: 'ballistic', pipIds: ['d0', 'd1'] }); assert.ok(m.ok, m.error);
  assert.equal(m.state.activation.heat.weapons, 1);
  const f = apply(m.state, { type: 'FIRE', player: 1, mechId: 'a1', targetId: 'b1', weapons: [{ weaponId: 'w0', pipIds: [] }, { weaponId: 'w1', pipIds: [] }, { weaponId: 'w2', pipIds: [] }] });
  assert.ok(f.ok, f.error);
});

// ---- AMS and target turning (AC10/AC20, LRM)
import { amsReduction, amsSources } from '../core/ams.js';
import { BALLISTIC_DIE } from '../core/data/dice.js';
test('AMS: own AMS fire 1 die vs SRM and 2 vs LRM; allies (LRM only) adjacent to the target or near the line add one die per AMS', () => {
  const s = game([mech('a1', 1, 'medium', 3, 8), mech('b1', 2, 'medium', 9, 8, { equipment: { ams: 1 } }), mech('b2', 2, 'light', 8, 9, { equipment: { ams: 2 } }), mech('b3', 2, 'light', 9, 3, { equipment: { ams: 1 } })]);
  const lrm = amsSources(s, s.mechs.a1, s.mechs.b1, 'lrm'), srm = amsSources(s, s.mechs.a1, s.mechs.b1, 'srm');
  assert.deepEqual(lrm.map((x) => [x.mechId, x.dice, x.devices]), [['b1', 2, 1], ['b2', 2, 2]]);   // b3 is far away
  assert.deepEqual(srm.map((x) => [x.mechId, x.dice]), [['b1', 1]]);   // allies help against LRM only
  assert.equal(amsReduction({ dice: [0, 1, 2, 3, 4, 5] }), 0 + 0 + 0 + 1 + 2 + 3);   // ** and *** faces are misses
});
const faceOf = (pred) => BALLISTIC_DIE.findIndex(pred);
test('AC10 always (and AC20 twice) lets the attacker turn the target after the damage; 4+ steps = 180° and unblockable damage', () => {
  let s = duel({ weapons: ['ac10'] }, {}); s = playWith(s, apply, 1, 'a1', ['ballistic', 'ballistic'], {});
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: s.mechs.a1.weapons[0].id, targetId: 'b1', pipIds: ['d0'] });
  assert.ok(r.ok, r.error);
  const A = r.state.activation.attack; A.shots[0].rolls.ballistic = [4, 4, 4];            // no miss marks
  let f = apply(r.state, { type: 'RESOLVE_ATTACK', player: 1 });
  while (f.ok && f.state.pending?.type === 'DEFENDER_DECISION') f = apply(f.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
  assert.ok(f.ok, f.error);
  assert.equal(f.state.pending.type, 'TURN_TARGET');
  assert.equal(f.state.pending.player, 1);
  assert.deepEqual(f.state.pending.options, ['none', 'L:1', 'R:1']);
  const before = f.state.mechs.b1.facing;
  const t = apply(f.state, { type: 'RESOLVE_DECISION', player: 1, choice: 'R:1' });
  assert.equal(t.state.mechs.b1.facing, (before + 1) % 6);
  assert.equal(t.state.pending, null);
});
test('LRM turn: (0-damage + 2 SRM faces) / (class + AMS) steps, rounded down', () => {
  let s = duel({ weapons: ['lrm15'] }, {}); s = playWith(s, apply, 1, 'a1', ['missile', 'missile'], {});
  s.mechs.b1.pos = at(12, 8);
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', weaponId: s.mechs.a1.weapons[0].id, targetId: 'b1', pipIds: ['d0'] });
  assert.ok(r.ok, r.error);
  r.state.activation.attack.shots[0].rolls.missile = [0, 1, 2, 3, 4, 5];                 // 0, 0, 2srm, 2srm, 2, 3 → 4 values
  r.state.activation.attack.ams = {};
  const run = (st) => { let f = apply(st, { type: 'RESOLVE_ATTACK', player: 1 }); while (f.ok && f.state.pending?.type === 'DEFENDER_DECISION') f = apply(f.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' }); return f; };
  const f = run(r.state);
  assert.equal(f.state.pending?.turns, 2, 'medium (class 2): 4 / 2 = 2 steps');
  const g = structuredClone(r.state); g.activation.attack.shots[0].amsDevices = 2;
  assert.equal(run(g).state.pending?.turns, 1, 'with 2 AMS the rating is 4: 4 / 4 = 1');
});

test('AMS rolls once per volley and cuts the summed LRM damage', () => {
  let s = duel({ weapons: ['lrm10', 'lrm10'] }, { equipment: { ams: 1 } }); s = playWith(s, apply, 1, 'a1', ['missile', 'missile', 'missile'], {});
  s.mechs.b1.pos = at(13, 8);
  const [w1, w2] = s.mechs.a1.weapons.map((w) => w.id);
  const r = apply(s, { type: 'FIRE', player: 1, mechId: 'a1', targets: undefined, volley: undefined, weapons: [{ weaponId: w1, pipIds: ['d0'] }, { weaponId: w2, pipIds: ['d1'] }], targetId: 'b1' });
  assert.ok(r.ok, r.error);
  const A = r.state.activation.attack;
  assert.equal(A.ams.lrm.dice.length, 2, 'one AMS = 2 dice against the whole LRM volley, not per weapon');
  A.shots.forEach((sh) => { sh.rolls.missile = [5, 5]; });          // 6 damage per weapon, 12 in total
  A.ams.lrm.dice = [5, 3];                                          // 3 + 1 = 4 cut
  const v = volleyDamage(r.state, r.state.activation);
  assert.equal(v.dmg, 12 - 4 - (evasion(r.state)));
});
import { volleyDamage } from '../core/attack.js';
const evasion = (s) => { const t = s.mechs.b1; return (t.evade ?? 0) + (t.virtualEvade ?? 0); };

test('shooting past a nearer enemy gives +1 armor only if that enemy is VISIBLE (a rock between hides it)', async () => {
  const { armorBonusOf } = await import('../core/attack.js'), { checkLine } = await import('../core/los.js');
  const mk = (terrain) => game([mech('a1', 1, 'medium', 4, 8), mech('n1', 2, 'light', 7, 8, { facing: 3 }), mech('t1', 2, 'medium', 11, 8, { facing: 3 })], { map: { terrain } });
  const bonus = (s) => armorBonusOf(s, s.mechs.a1, s.mechs.t1, checkLine(s, s.mechs.a1.pos, s.mechs.t1.pos)).parts.some((p) => p.where === 'nearer');
  assert.equal(bonus(mk([])), true);                                                   // visible nearer enemy → bonus
  assert.equal(bonus(mk([{ col: 5, row: 8, type: 'cliff' }, { col: 6, row: 8, type: 'cliff' }])), false);   // hidden behind cliffs → no bonus
});

test('FIRE pays by itself: 3 AC5 with 3 ballistic dice → no heat; with 2 dice → automatic mass activation, +1 heat; with 1 die → impossible', () => {
  const run = (dice) => { const s = playWith(game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5', 'ac5', 'ac5'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })]), apply, 1, 'a1', dice);
    const weapons = ['w0', 'w1', 'w2'].map((weaponId, i) => ({ weaponId, pipIds: [`d${i}`].filter((id) => dice[+id[1]]) }));
    return apply(s, { type: 'FIRE', player: 1, targetId: 'b1', weapons }); };
  const three = run(['ballistic', 'ballistic', 'ballistic']); assert.ok(three.ok, three.error); assert.ok(!three.events.some((e) => e.type === 'mass_activation'));
  const two = run(['ballistic', 'ballistic']); assert.ok(two.ok, two.error); assert.equal(two.state.activation.heat.weapons - three.state.activation.heat.weapons, 1);   // the only difference: the mass-activation penalty
  assert.ok(two.events.some((e) => e.type === 'mass_activation'));
  assert.equal(run(['ballistic']).ok, false);
});

test('JJ: a jumper next to a cliff shoots over it (cliff near the jumper does not block); without a jump the same shot is blocked', () => {
  const mk = () => game([mech('a1', 1, 'medium', 5, 8, { weapons: ['gauss'], equipment: { jumpjets: 1 } }), mech('b1', 2, 'medium', 7, 8, { facing: 3 })], { map: { terrain: [{ col: 6, row: 8, type: 'cliff' }] } });
  let s = playWith(mk(), apply, 1, 'a1', ['ballistic', 'ballistic', 'jumpjet']);
  const shot = (st) => apply(st, { type: 'FIRE', player: 1, targetId: 'b1', weapons: [{ weaponId: 'w0', pipIds: ['d0', 'd1'] }] });
  assert.equal(shot(s).ok, false);
  const j = apply(s, { type: 'JUMP', player: 1, to: s.mechs.a1.pos, pipIds: ['d2'] }); assert.ok(j.ok, j.error);
  const r = shot(j.state); assert.ok(r.ok, r.error);
});

test('LRM turn points of the whole volley are summed and divided once (one "0" + one "2 SRM" on a medium mech → 1 step)', () => {
  const med = { cls: 'medium' }, shot = (turnPts) => ({ sub: 'lrm', turns: 0, turnPts, amsDevices: 0 });
  assert.equal(volleyTurns(med, [shot(1), shot(1)]), 1);                       // 1 + 1 = 2, class 2 → 1 step (per-shot rounding would give 0)
  assert.equal(volleyTurns(med, [shot(1), shot(1), shot(1)]), 1);              // 3 / 2 → 1
  assert.equal(volleyTurns(med, [shot(1)]), 0);
  assert.equal(volleyTurns(med, [shot(2), shot(2), { sub: 'ac', turns: 1, turnPts: 0 }]), 3);   // 4 / 2 = 2, plus 1 from an AC10 hit
  assert.equal(volleyTurns(med, [{ ...shot(2), amsDevices: 2 }, shot(2)].map((x) => ({ ...x, amsDevices: 2 }))), 1);   // 4 / (2 + 2)
});

test('ram: attacker TC never rerolls the damage dice of a ram', () => {
  let s = game([mech('a1', 1, 'heavy', 6, 8, { speed: 'X', equipment: { tc: true } }), mech('b1', 2, 'light', 7, 8)]);
  s.turn = { rank: 3, player: 1 };
  s = playWith(s, apply, 1, 'a1', ['move', 'move']);
  s = apply(s, { type: 'COMMIT_MOVE', player: 1, pipIds: ['d0', 'd1'] }).state;
  s = apply(s, { type: 'RAM', player: 1, targetId: 'b1' }).state;
  const r = apply(s, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' });
  assert.ok(r.ok, r.error);
  assert.notEqual(r.state.pending?.type, 'TC_REROLL');
});

test('compact coolers + 5 overheat: no die would be left, so only the emergency shutdown is possible', () => {
  const s = game([mech('a1', 1, 'medium', 6, 8, { coolers: 'compact' }), mech('b1', 2, 'medium', 9, 8)]);
  const m = s.mechs.a1;
  assert.equal(mustShutdown(m), false);
  m.overheat = 4; assert.equal(mustShutdown(m), false);                    // 2 dice rolled, 1 dropped → 1 left
  m.overheat = 5; assert.equal(mustShutdown(m), true);
  s.turn = { rank: 2, player: 1 };
  let r = apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' }); assert.ok(r.ok, r.error);
  assert.equal(apply(r.state, { type: 'ROLL_PILOT', player: 1, mechId: 'a1' }).ok, false);
  assert.ok(apply(r.state, { type: 'EMERGENCY_SHUTDOWN', player: 1, mechId: 'a1' }).ok);
  m.coolers = 'standard'; assert.equal(mustShutdown(m), false);            // without compact coolers a single die remains → rolling is allowed
});

test('activation in fire: the log says the mech is activated first, the overheat token comes after', () => {
  const s = game([mech('a1', 1, 'medium', 6, 8), mech('b1', 2, 'medium', 9, 8)]);
  s.map.cells[`${at(6, 8).q},${at(6, 8).r}`].terrain = 'fire'; s.turn = { rank: 2, player: 1 };
  const r = apply(s, { type: 'ACTIVATE', player: 1, mechId: 'a1' });
  assert.ok(r.ok, r.error);
  const types = r.events.map((e) => e.type);
  assert.ok(types.indexOf('activation_started') < types.indexOf('overheat_token'));
  assert.equal(r.state.mechs.a1.overheat, 1);
});

test('GA: every active mech in the radius (source and enemies too) gets anchor; the source gets overheat = radius', () => {
  let s = game([mech('a1', 1, 'medium', 6, 8, { equipment: { ga: true } }), mech('a2', 1, 'light', 7, 8), mech('b1', 2, 'medium', 12, 8)]);
  s.turn = { rank: 2, player: 1 };
  s = playWith(s, apply, 1, 'a1', ['move']);
  assert.equal(apply(s, { type: 'USE_GA', player: 1, radius: 0 }).ok, false);
  assert.equal(apply(s, { type: 'USE_GA', player: 1, radius: 9 }).ok, false);
  const r = apply(s, { type: 'USE_GA', player: 1, radius: 2 });
  assert.ok(r.ok, r.error);
  assert.deepEqual([r.state.mechs.a1.anchor, r.state.mechs.a2.anchor, r.state.mechs.b1.anchor], [1, 1, 0]);
  assert.equal(r.state.mechs.a1.overheat, 2);
  assert.equal(apply(r.state, { type: 'USE_GA', player: 1, radius: 1 }).ok, false);     // once per activation
  assert.equal(apply(playWith(game([mech('a1', 1, 'medium', 6, 8), mech('b1', 2, 'medium', 12, 8)]), apply, 1, 'a1', ['move']), { type: 'USE_GA', player: 1, radius: 1 }).ok, false);   // no GA installed
});

test('OS: the defender decides before the armor roll (+1 armor, +1 overheat), once per enemy activation', () => {
  const base = () => playWith(duel({ weapons: ['laser_l', 'laser_m'] }, { equipment: { os: true } }), apply, 1, 'a1', ['laser', 'laser']);
  let r = fire(base(), 'w0', ['d0']);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.pending.type, 'OS_DECISION'); assert.equal(r.state.pending.player, 2);
  assert.equal(apply(r.state, { type: 'END_ACTIVATION', player: 1 }).ok, false);          // blocked until the defender answers
  const used = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'use' });
  assert.ok(used.ok, used.error);
  assert.equal(used.state.mechs.b1.overheat, 1);
  assert.equal(used.events.find((e) => e.type === 'armor').bonusArmor, 1);
  assert.ok(used.events.some((e) => e.type === 'os_used'));
  const second = used.state.pending ? apply(used.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'take' }).state : used.state;
  assert.notEqual(fire(second, 'w1', ['d1']).state.pending?.type, 'OS_DECISION');          // already used during this activation
  const skip = apply(r.state, { type: 'RESOLVE_DECISION', player: 2, choice: 'skip' });
  assert.equal(skip.state.mechs.b1.overheat, 0); assert.equal(skip.events.find((e) => e.type === 'armor').bonusArmor, 0);
});

test('blind: a detonation blinds the neighbours; −2 maximum range per token; one token is lost at the end of the own activation', () => {
  const s = game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5'], blind: 0 }), mech('b1', 2, 'light', 8, 8, { facing: 3, armorClass: 0 }), mech('b2', 2, 'light', 9, 8, { facing: 3 })]);
  s.turn = { rank: 2, player: 1 };
  s.mechs.b1.damage = 3;
  const m = s.mechs.b2; m.blind = 0;
  s.mechs.b1.damage = 99;
  const ev = []; destroyForTest(s, ev);
  assert.ok(ev.some((e) => e.type === 'blind' && e.mechId === 'b2'));
  assert.equal(s.mechs.b2.blind, 1);
});

test('blind: range penalty and loss at the end of the activation', () => {
  let s = playWith(duel({ weapons: ['ac5'] , blind: 2 }, {}), apply, 1, 'a1', ['ballistic', 'ballistic']);
  assert.equal(fireRaw(s, 'w0', ['d0']).ok, true);                                          // distance 3 ≤ 9 − 4 = 5
  s = playWith(game([mech('a1', 1, 'medium', 6, 8, { weapons: ['ac5'], blind: 3 }), mech('b1', 2, 'medium', 12, 8, { facing: 3 })]), apply, 1, 'a1', ['ballistic']);
  assert.equal(fireRaw(s, 'w0', ['d0']).ok, false);                                          // distance 6 > 9 − 6 = 3
  let t = game([mech('a1', 1, 'medium', 6, 8, { blind: 2 }), mech('b1', 2, 'medium', 12, 8)]);
  t = playWith(t, apply, 1, 'a1', ['move']);
  const e = apply(t, { type: 'END_ACTIVATION', player: 1 });
  assert.ok(e.ok, e.error); assert.equal(e.state.mechs.a1.blind, 1);
});

test('FIRE `only`: mass activation is judged on the dice the player set aside', () => {
  const s = playWith(duel({ weapons: ['ac5', 'ac5', 'ac5'] }), apply, 1, 'a1', ['ballistic', 'ballistic', 'ballistic', 'ballistic']);
  const m = s.mechs.a1, act = s.activation, list = ['w0', 'w1', 'w2'].map((weaponId) => ({ weaponId }));
  assert.equal(massPlan(m, act, list).length, 0);                                           // 4 dice for 3 weapons → no mass activation
  assert.equal(massPlan(m, act, list, ['d0', 'd1']).length, 1);                             // two set aside → mass activation over them
});

function destroyForTest(s, ev) { destroyMech(s, makeRng(3), ev, s.mechs.b1); }

test('fire on the line: +1 virtual evade and −1 laser range for EACH fire hex', () => {
  const s = game([mech('a1', 1, 'medium', 3, 8, { weapons: ['laser_l'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })]);
  const info = (k) => { for (let c = 4; c < 4 + k; c++) s.map.cells[`${at(c, 8).q},${at(c, 8).r}`].terrain = 'fire'; return shotPreview(s, s.mechs.a1, s.mechs.b1, WEAPONS.laser_l); };
  const w = { sub: null, dice: { ballistic: 1 }, kind: 'ranged' };
  for (const n of [0, 1, 3]) assert.equal(stretchOf(s.mechs.b1, w, 5, n, 0).virt, n);
  const base = shotPreview(s, s.mechs.a1, s.mechs.b1, WEAPONS.laser_l).maxRange;
  assert.equal(info(3).maxRange, base - 3);
});

test('a target standing in fire gets +1 virtual evade against non-laser shots (and lasers keep their range)', () => {
  const s = game([mech('a1', 1, 'medium', 3, 8, { weapons: ['lrm20'] }), mech('b1', 2, 'medium', 9, 8, { facing: 3 })]);
  const lrm = WEAPONS.lrm20, laser = WEAPONS.laser_l;
  const cold = shotPreview(s, s.mechs.a1, s.mechs.b1, lrm);
  s.map.cells[`${at(9, 8).q},${at(9, 8).r}`].terrain = 'fire';
  const hot = shotPreview(s, s.mechs.a1, s.mechs.b1, lrm);
  assert.equal(hot.eff - cold.eff, 0);                                              // missiles: effective range is not stretched, the cut is
  assert.ok(hot.notes.some((n) => n.includes('цель стоит в огне')));
  assert.equal(shotPreview(s, s.mechs.a1, s.mechs.b1, laser).maxRange, laser.maxRange);
});

test('target in fire: the fired shot carries +1 virtual evade', () => {
  const s0 = playWith(duel({ weapons: ['ac5'] }), apply, 1, 'a1', ['ballistic']);
  s0.holdAttack = true; const b = s0.mechs.b1; s0.map.cells[`${b.pos.q},${b.pos.r}`].terrain = 'fire';
  const r = fireRaw(s0, 'w0', ['d0']);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.activation.attack.shots[0].fireHexes, 1);
});
