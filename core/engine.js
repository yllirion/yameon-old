import { ccSources, correctionsLeft, finishAttack, startAttack, validateAttack } from './attack.js';
import { CLASSES } from './data/classes.js';
import { PILOT_FACES } from './data/dice.js';
import { TERRAIN } from './data/terrain.js';
import { applyDamageFaces, beginDamage, destroyMech, resolveHit, rollDamageDice } from './damage.js';
import { RuleError, fail } from './errors.js';
import { addOverheat, heatControl } from './heat.js';
import { distance, neighbor, mod6 } from './hex.js';
import { actionsAvailable, cannotOccupy, planStep, enterCost } from './movement.js';
import { makeRng } from './rng.js';
import { RULES } from './rules.js';
import { activeMechs, advanceTurn, startRound } from './round.js';
import { buildingId, createMap, getCell, makeMech, mechAt, rankOf, targetOf } from './state.js';
import { WEAPONS } from './data/weapons.js';

export { Game } from './game.js';

// ---------------------------------------------------------------- setup
export function createGame({ seed = 1, map = {}, mechs = [] } = {}) {
  const s = { seed, rngState: seed >>> 0, map: createMap(map), mechs: {}, players: [], round: 1, turn: null, activation: null, pending: null, winner: null };
  for (const spec of mechs) {
    const m = makeMech(spec);
    const why = cannotOccupy(s, m, m.pos);
    if (why) throw new Error(`cannot place ${m.id}: ${why}`);
    if (mechAt(s, m.pos)) throw new Error(`cannot place ${m.id}: hex is occupied`);
    s.mechs[m.id] = m;
  }
  s.players = [...new Set(mechs.map((m) => m.owner))].sort((a, b) => a - b);
  startRound(s);
  return s;
}

// ---------------------------------------------------------------- helpers
const mechById = (s, id) => s.mechs[id] ?? fail(`unknown mech ${id}`);
function inActivation(s, a, phases) {
  const act = s.activation ?? fail('no activation in progress');
  if (a.player !== s.turn.player) fail('not your turn');
  if (phases && ![].concat(phases).includes(act.phase)) fail(`wrong phase ${act.phase}`);
  return { act, m: s.mechs[act.mechId] };
}
function takePips(act, ids = [], colors) {
  const seen = new Set(), picked = [];
  for (const id of ids) {
    const p = act.pool.find((x) => x.id === id);
    if (!p || p.spent || seen.has(id)) fail(`pip ${id} is not available`);
    seen.add(id); picked.push(p);
  }
  if (colors) {
    const need = [...colors];
    for (const p of picked) { const i = need.indexOf(p.color); if (i < 0) fail(`unexpected pip color ${p.color}`); need.splice(i, 1); }
    if (need.length) fail(`need pips: ${need.join(', ')}`);
  }
  return picked;
}
// TC: one die of any color may pay for one required color of a weapon activation.
function takePipsWild(act, ids, colors) {
  const picked = takePips(act, ids);
  if (picked.length !== colors.length) fail(`need ${colors.length} dice`);
  const need = [...colors]; let wild = 0;
  for (const p of picked) { const i = need.indexOf(p.color); if (i < 0) wild++; else need.splice(i, 1); }
  if (wild > 1) fail('TC changes the type of only one attack action');
  return picked;
}
const spend = (picked) => picked.forEach((p) => (p.spent = true));
const newPipId = (act) => `c${act.nextPip++}`;

// ---------------------------------------------------------------- activation flow
function activate({ s, a, events }) {
  if (s.activation) fail('another activation is in progress');
  if (a.player !== s.turn.player) fail('not your turn');
  const m = mechById(s, a.mechId);
  if (m.owner !== a.player) fail('not your mech');
  if (m.status !== 'active' || m.activated) fail('mech cannot activate');
  if (rankOf(m) !== s.turn.rank) fail('wrong class: smallest class goes first');
  m.evade = 0; m.virtualEvade = 0;                 // temporary evade is removed at the start of activation
  s.activation = {
    mechId: m.id, phase: 'ROLL', pool: [], nextPip: 0, initialEvade: 0, mustDiscard: 0,
    startPos: { ...m.pos }, startFacing: m.facing, route: [{ ...m.pos }],
    conv: {}, movePips: 0, moveSpent: 0, jumpsUsed: 0, vevadeMove: false, ramUsed: false,
    fired: [], mass: {}, attack: null, attacked: false, masc: false, mascBonus: 0, tcUsed: false, ccUsed: false, shutdown: false,
    heat: { weapons: 0, jumps: 0, equipment: 0 }, gaUsed: false, osUsed: [],
  };
  events.push({ type: 'activation_started', mechId: m.id });
  if (TERRAIN[getCell(s.map, m.pos).terrain].fire) { m.overheat++; events.push({ type: 'overheat_token', mechId: m.id, why: 'start_in_fire' }); }   // logged AFTER the activation itself
}

// dice rolled / dice that must be dropped after the roll (control crit, compact coolers); no die left to play → only emergency shutdown makes sense
const pilotRoll = (m) => { const n = Math.max(0, RULES.pilotDice - m.overheat - m.crits.cooling); return { n, drop: Math.min(n, m.crits.control + (m.coolers === 'compact' ? 1 : 0)) }; };
export const mustShutdown = (m) => m.forcedShutdown || (() => { const r = pilotRoll(m); return r.n - r.drop <= 0; })();
function rollPilot({ s, rng, a, events }) {
  const { act, m } = inActivation(s, a, 'ROLL');
  if (mustShutdown(m)) fail('overheated: emergency shutdown is required');
  const n = pilotRoll(m).n;   // each overheat token / cooling crit removes a die from the roll
  act.pool = Array.from({ length: n }, (_, die) => {
    const face = rng.int(6);
    return { id: `d${die}`, die, color: PILOT_FACES[face], evade: face === die, spent: false, origin: 'roll' };
  });
  act.initialEvade = act.pool.filter((p) => p.evade).length;
  act.mustDiscard = Math.min(act.pool.length,
    m.crits.control + (m.coolers === 'compact' ? 1 : 0)); // control crit / compact coolers: the player chooses which die to drop
  events.push({ type: 'pilot_roll', mechId: m.id, dice: act.pool.map((p) => ({ id: p.id, color: p.color, evade: p.evade })), mustDiscard: act.mustDiscard });
  if (act.mustDiscard > 0) act.phase = 'DISCARD'; else finalizeRoll(m, act);
}

function discardDice({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'DISCARD');
  const ids = a.dieIds ?? [];
  if (ids.length !== act.mustDiscard) fail(`must discard exactly ${act.mustDiscard} dice`);
  const picked = takePips(act, ids);
  picked.forEach((p) => { p.spent = true; p.discarded = true; });
  events.push({ type: 'dice_discarded', mechId: m.id, ids });
  finalizeRoll(m, act);
}

function finalizeRoll(m, act) {
  const cap = CLASSES[m.cls].abilities.maxStoredEvade ?? Infinity; // heavy 1, assault 0
  const usable = act.pool.filter((p) => p.evade && (RULES.discardedDiceStoreEvade || !p.discarded)).length;
  m.evade = Math.min(cap, usable);
  act.phase = 'PLAY';
}

export const CONVERSIONS = {
  triple:   { n: 3 },                                                                  // any class
  any1:     { n: 1, limit: 'anyToChoice' },                                            // Medium
  pair:     { n: 2, limit: 'pairToChoice' },                                           // Heavy
  toMove:   { n: 1, limit: 'swapToMove', from: ['laser', 'ballistic', 'missile'], to: ['move'] },       // Light
  fromMove: { n: 1, limit: 'swapFromMove', from: ['move'], to: ['laser', 'ballistic', 'missile'] },     // Assault
  tc:       { n: 1, equipment: 'tc', from: ['laser', 'ballistic', 'missile'], to: ['laser', 'ballistic', 'missile'] }, // TC: once per activation
};
// CONVERT converts k groups of c.n pips in one action (pipIds.length = k * c.n), e.g. a light mech turning three weapon dice into
// three move dice at once. Every group counts against the class limit.
function convert({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const c = CONVERSIONS[a.kind] ?? fail('unknown conversion');
  if (!['laser', 'ballistic', 'missile', 'jumpjet', 'move'].includes(a.to)) fail('bad target color');
  if (c.to && !c.to.includes(a.to)) fail('this conversion cannot produce that color');
  const len = (a.pipIds ?? []).length;
  if (!len || len % c.n) fail(`needs a multiple of ${c.n} pip(s)`);
  const times = len / c.n;
  if (c.equipment) {                       // TC: once per activation, shares the flag with the other TC functions
    if (!m.equipment[c.equipment] || act.tcUsed) fail('TC is not available');
    act.tcUsed = true;
  }
  if (c.limit) {
    const cap = CLASSES[m.cls].abilities[c.limit] ?? 0;
    if ((act.conv[c.limit] ?? 0) + times > cap) fail('conversion not available (class ability exhausted)');
    act.conv[c.limit] = (act.conv[c.limit] ?? 0) + times;
  }
  const picked = takePips(act, a.pipIds);
  if (c.from && !picked.every((p) => c.from.includes(p.color))) fail('wrong source color');
  if (c.n === 1 && picked[0].color === a.to) fail('conversion must change the value');
  spend(picked);
  for (let i = 0; i < times; i++) {
    const pip = { id: newPipId(act), color: a.to, evade: false, spent: false, origin: 'converted' };
    act.pool.push(pip);
    events.push({ type: 'converted', mechId: m.id, kind: a.kind, to: a.to, newPip: pip.id });
  }
}

function emergencyShutdown({ s, rng, a, events }) {
  const { act, m } = inActivation(s, a, 'ROLL');
  act.shutdown = true; m.forcedShutdown = false;
  events.push({ type: 'emergency_shutdown', mechId: m.id });
  finishActivation(s, rng, events);
}

function endActivation({ s, rng, a, events }) {
  const { m } = inActivation(s, a, 'PLAY');
  if (mechAt(s, m.pos, m.id)) fail('must end the activation on a free hex');
  finishActivation(s, rng, events);
}

function finishActivation(s, rng, events) {
  const act = s.activation, m = s.mechs[act.mechId];
  if (!act.attacked && !act.shutdown && m.status === 'active') m.virtualEvade += 1; // "minor activity" bonus
  if (m.status === 'active') heatControl(s, rng, events, m, act);
  m.anchor = Math.max(0, m.anchor - 1);
  if (m.blind > 0) { m.blind--; events.push({ type: 'blind_lost', mechId: m.id, left: m.blind }); }   // one blind token is lost at the end of the mech's own activation
  m.activated = true;
  s.activation = null;
  events.push({ type: 'activation_ended', mechId: m.id });
  checkWinner(s, events);
  if (!s.winner) advanceTurn(s, events);
}

// ---------------------------------------------------------------- movement
function commitMove({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const picked = takePips(act, a.pipIds, (a.pipIds ?? []).map(() => 'move'));
  if (!picked.length) fail('no pips given');
  spend(picked); act.movePips += picked.length;
  events.push({ type: 'move_committed', mechId: m.id, pips: picked.length, actionsAvailable: actionsAvailable(m, act) });
}
// MASC: one chosen move die becomes 2 movement actions (instead of its normal value) for 1 heat; once per activation.
function useMasc({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  if (!m.equipment.masc) fail('no MASC on this mech');
  if (act.masc) fail('MASC is already used this activation');
  const picked = takePips(act, a.pipIds, ['move']);
  spend(picked); act.masc = true; act.mascBonus = 2; act.heat.equipment += 1;
  events.push({ type: 'masc', mechId: m.id, actions: 2, actionsAvailable: actionsAvailable(m, act) });
}
// GA: the player picks a radius; every active mech within it (the source included) gets an anchor token, the source gets overheat = radius.
function useGa({ s, rng, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  if (!m.equipment.ga) fail('no GA on this mech');
  if (act.gaUsed) fail('GA is already used this activation');
  const r = a.radius;
  if (!Number.isInteger(r) || r < 1 || r > RULES.gaMaxRadius) fail(`GA radius must be 1..${RULES.gaMaxRadius}`);
  const hit = Object.values(s.mechs).filter((t) => t.status === 'active' && distance(m.pos, t.pos) <= r);
  hit.forEach((t) => { t.anchor++; });
  act.gaUsed = true;
  events.push({ type: 'ga_used', mechId: m.id, radius: r, affected: hit.map((t) => t.id) });
  if (RULES.gaOverheatTokens) { events.push({ type: 'overheat_token', mechId: m.id, why: 'ga', n: r }); addOverheat(s, rng, events, m, r); } else act.heat.equipment += r;
}
function pay(act, m, cost) {
  if (actionsAvailable(m, act) < cost) fail(`not enough movement actions (need ${cost}, have ${actionsAvailable(m, act)})`);
  act.moveSpent += cost;
}
function moveStep({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const plan = planStep(s, m, a.to);
  pay(act, m, plan.cost);
  if (![-1, 0, 1].includes(a.turn ?? 0)) fail('turn must be -1, 0 or 1');
  if (plan.back && a.turn) fail('no turning after a back step');
  m.pos = { q: a.to.q, r: a.to.r }; m.facing = mod6(plan.newFacing + (a.turn ?? 0));   // one free 60° turn after the step
  if (TERRAIN[getCell(s.map, m.pos).terrain].fire) { m.overheat++; events.push({ type: 'overheat_token', mechId: m.id, why: 'enter_fire' }); }
  act.route.push({ ...m.pos });
  events.push({ type: 'moved', mechId: m.id, to: m.pos, facing: m.facing, cost: plan.cost });
}
function turnInPlace({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  if (![-1, 1].includes(a.turn)) fail('turn must be -1 or 1');
  pay(act, m, 1 + (m.anchor > 0 ? 1 : 0));
  m.facing = mod6(m.facing + a.turn);
  events.push({ type: 'turned', mechId: m.id, facing: m.facing });
}
function virtualEvadeMove({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  if (act.vevadeMove) fail('already used this activation');
  pay(act, m, 2 + (m.anchor > 0 ? 1 : 0)); act.vevadeMove = true; m.virtualEvade += 1;
  events.push({ type: 'virtual_evade', mechId: m.id });
}
function jump({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  if (act.jumpsUsed >= (m.equipment.jumpjets ?? 0)) fail('no jump jets left');
  spend(takePips(act, a.pipIds, ['jumpjet']));
  if (distance(m.pos, a.to) > 1) fail('a jump moves at most one hex (0 = jump in place)');
  if (![-1, 0, 1].includes(a.turn ?? 0)) fail('turn must be -1, 0 or 1');
  const why = cannotOccupy(s, m, a.to); if (why) fail(why);
  act.jumpsUsed++; act.heat.jumps += 2; m.virtualEvade += 1;
  const moved = distance(m.pos, a.to) === 1;
  m.pos = { q: a.to.q, r: a.to.r }; m.facing = mod6(m.facing + (a.turn ?? 0));
  if (moved && TERRAIN[getCell(s.map, m.pos).terrain].fire) { m.overheat++; events.push({ type: 'overheat_token', mechId: m.id, why: 'enter_fire' }); }
  if (moved) act.route.push({ ...m.pos });
  events.push({ type: 'jumped', mechId: m.id, to: m.pos, facing: m.facing, inPlace: !moved });
}
// RAM: 2 movement actions (+1 with anchor) or 2 jumpjet dice (`via: 'jump'`) against any adjacent enemy; once per activation.
// Each action/die paid beyond the base 2 raises the attacker's class by 1 for this attack: damage = (class + extra − target class), min 0,
// never more than the attacker's own class;
// the armor of the target does not apply (the defender can still eject before the damage dice).
export const ramDamage = (cls, tcls, extra) => Math.min(cls, Math.max(0, cls + extra - tcls));
function ram({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const t = mechById(s, a.targetId);
  if (act.ramUsed) fail('ram can be used once per activation');
  if (t.owner === m.owner || t.status !== 'active' || distance(m.pos, t.pos) !== 1) fail('ram needs an adjacent enemy');
  const extra = a.extraActions ?? 0;
  if (!Number.isInteger(extra) || extra < 0) fail('bad extra actions');
  const dmg = ramDamage(rankOf(m), rankOf(t), extra);
  if (dmg < 1) fail('a ram must deal at least 1 damage (pay more extra actions)');
  if (a.via === 'jump') {
    const n = 2 + extra;
    if (!(m.equipment.jumpjets > 0)) fail('no jump jets');                  // the number of jets limits jumps, not the dice paid for a ram
    spend(takePips(act, a.pipIds, Array(n).fill('jumpjet')));
    act.jumpsUsed += n; act.heat.jumps += 2 * n; m.virtualEvade += n;
  } else pay(act, m, 2 + extra + (m.anchor > 0 ? 1 : 0));
  act.ramUsed = true; act.attacked = true;
  events.push({ type: 'ram', attackerId: m.id, targetId: t.id, damage: dmg, via: a.via === 'jump' ? 'jump' : 'move', extra });
  beginDamage(s, null, events, t, dmg, null, true);   // no source: a ram never gives the attacker's TC reroll
}

// ---------------------------------------------------------------- shooting
function massActivate({ s, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  doMass(act, m, events, a.color, a.pipIds ?? []);
}
// Automatic mass activation inside FIRE: a colour with fewer free dice than armed weapons (but 2+) → all dice of that colour are spent,
// every weapon of the colour on the mech is paid, +1 heat per weapon that got no die of its own.
export function massPlan(m, act, list, only = null) {   // only: ids of the dice the player has set aside for this volley (null = the whole pool)
  const by = {};
  for (const e of list) {
    const w = WEAPONS[m.weapons.find((x) => x.id === e.weaponId)?.type];
    if (!w || w.payWith || w.noMass || w.pips.length !== 1 || e.useTC || act.fired.includes(e.weaponId)) continue;
    if (Object.values(act.mass).some((x) => x.weapons.includes(e.weaponId))) continue;
    (by[w.pips[0]] ??= []).push(e);
  }
  const plan = [];
  for (const [color, entries] of Object.entries(by)) {
    const have = act.pool.filter((p) => !p.spent && p.color === color && (!only || only.includes(p.id))).sort((x, y) => (x.evade ? 1 : 0) - (y.evade ? 1 : 0));
    if (have.length >= entries.length || have.length < 2) continue;
    const ws = m.weapons.filter((w) => { const d = WEAPONS[w.type]; return !d.noMass && d.pips.length === 1 && d.pips[0] === color && !act.fired.includes(w.id); });
    const take = Math.min(have.length, ws.length);
    plan.push({ color, entries, take, ids: have.slice(0, take).map((p) => p.id), weapons: ws.length, heat: Math.max(0, ws.length - take) });
  }
  return plan;
}
function doMass(act, m, events, color, pipIds) {
  if (pipIds.length < 2) fail('mass activation needs 2+ pips of one color');
  const picked = takePips(act, pipIds, pipIds.map(() => color));
  const ws = m.weapons.filter((w) => { const d = WEAPONS[w.type]; return !d.noMass && d.pips.length === 1 && d.pips[0] === color && !act.fired.includes(w.id); });
  if (!ws.length) fail('no weapons of that type');
  spend(picked);
  const unpaid = Math.max(0, ws.length - picked.length);
  act.heat.weapons += unpaid; // 1 heat per system that did not get its own die
  act.mass[color] = { weapons: ws.map((w) => w.id) };
  events.push({ type: 'mass_activation', mechId: m.id, color, weapons: act.mass[color].weapons, extraHeat: unpaid });
}
// FIRE: one weapon ({weaponId, pipIds, useTC}) or a volley ({targetId, weapons:[{weaponId, pipIds, useTC}]}) at one target.
function fire({ s, rng, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const tgt = a.targetHex ? (targetOf(s, buildingId(a.targetHex)) ?? fail('no building there')) : mechById(s, a.targetId);
  const list = a.weapons ?? [{ weaponId: a.weaponId, pipIds: a.pipIds, useTC: a.useTC }];
  if (!list.length) fail('no weapons given');
  for (const pl of massPlan(m, act, list, a.only ?? null)) { doMass(act, m, events, pl.color, pl.ids); for (const e of list) if (act.mass[pl.color].weapons.includes(e.weaponId)) { e.pipIds = []; e.useTC = false; } }   // automatic mass activation (rolled back with the action if the shot is illegal)
  const seen = new Set(), shots = [];
  for (const e of list) {                                  // validate everything first: the action is atomic
    const winst = m.weapons.find((w) => w.id === e.weaponId) ?? fail('no such weapon');
    if (act.fired.includes(winst.id) || seen.has(winst.id)) fail('weapon already fired this activation');
    seen.add(winst.id);
    const w = WEAPONS[winst.type];
    shots.push({ wid: winst.id, w, info: validateAttack(s, m, tgt, w), e });
  }
  for (const { wid, w, e } of shots) {
    const massed = !w.noMass && w.pips.length === 1 && act.mass[w.pips[0]]?.weapons.includes(wid);
    if (w.payWith === 'move') pay(act, m, w.moveCost + (m.anchor > 0 ? 1 : 0));  // melee weapons are paid with movement actions (anchor: +1)
    else if (massed) { if ((e.pipIds ?? []).length) fail('already paid via mass activation'); }
    else if (e.useTC) {
      if (!m.equipment.tc || act.tcUsed) fail('TC is not available');
      spend(takePipsWild(act, e.pipIds, w.pips)); act.tcUsed = true;
      events.push({ type: 'tc_used', mechId: m.id, weapon: wid });
    } else spend(takePips(act, e.pipIds, w.pips));
    act.fired.push(wid);
  }
  act.attacked = true;
  startAttack(rng, act, { s, atk: m, tgt, shots });
  const canCorrect = act.attack.shots.some((sh) => correctionsLeft(s, act, m, tgt, WEAPONS[m.weapons.find((x) => x.id === sh.wid).type]) > 0);
  if (canCorrect || s.holdAttack) events.push({ type: 'attack_rolled', attackerId: m.id, targetId: tgt.id, shots: act.attack.shots.map((sh) => ({ weapon: sh.wid, rolls: sh.rolls })) });
  else finishAttack(s, rng, events, act); // nothing to correct with → resolve at once
}
// Fire correction: spend the weapon's own activation dice again (one die; a PAIR for Gauss and PPC) to reroll one weapon
// die or to ignore one evade. CC may replace one die of the set: pass cc = id of the mech whose CC is used.
function correct({ s, rng, a, events }) {
  const { act, m } = inActivation(s, a, 'PLAY');
  const A = act.attack ?? fail('no attack to correct');
  const shot = A.shots[a.shot ?? 0] ?? fail('no such weapon in the volley');
  const w = WEAPONS[m.weapons.find((x) => x.id === shot.wid).type];
  if (w.payWith) fail('melee attacks cannot be corrected');
  const picked = takePips(act, a.pipIds ?? []);
  if (picked.length !== w.pips.length) fail(`a correction needs ${w.pips.length} dice: ${w.pips.join(' + ')}`);
  const need = [...w.pips]; let wrong = 0;
  for (const p of picked) { const i = need.indexOf(p.color); if (i < 0) wrong++; else need.splice(i, 1); }
  if (wrong > 1) fail('CC can replace only one die of the set');
  if (wrong === 1) {                   // a die of another color: only possible through a CC conversion
    if (!a.cc) fail('correction needs dice of the weapon colors');
    if (act.ccUsed) fail('CC was already used this activation');
    const src = ccSources(s, m, targetOf(s, A.targetId)).find((x) => x.id === a.cc) ?? fail('that CC cannot be used (it must see the target)');
    act.ccUsed = true; if (!src.self) act.heat.equipment += 1;
    events.push({ type: 'cc_used', mechId: m.id, ccMechId: src.id, extraHeat: src.self ? 0 : 1 });
  }
  if (a.mode === 'reroll') {
    const group = shot.rolls[a.group] ?? fail('no such weapon dice');
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= group.length) fail('no such die');
    group[a.index] = rng.int(6);
    events.push({ type: 'rerolled', shot: a.shot ?? 0, group: a.group, index: a.index, rolls: shot.rolls });
  } else if (a.mode === 'ignoreEvade') {
    shot.ignored++; events.push({ type: 'ignored_evade', shot: a.shot ?? 0, total: shot.ignored });
  } else fail('unknown correction mode');
  spend(picked);
}
function resolveAttackAction({ s, rng, a, events }) {
  const { act } = inActivation(s, a, 'PLAY');
  if (!act.attack) fail('no attack in progress');
  finishAttack(s, rng, events, act);
}
function resolveDecision({ s, rng, a, events }) {
  const p = s.pending ?? fail('nothing is pending');
  if (a.player !== p.player) fail('not the deciding player');
  if (!p.options.includes(a.choice)) fail('invalid choice');
  s.pending = null;
  const t = s.mechs[p.targetId];
  if (p.type === 'OS_DECISION') {          // the defender may raise its Omni Shield before the armor roll: +1 armor, +1 overheat; once per enemy activation
    const h = p.hit; let bonusArmor = h.bonusArmor;
    if (a.choice === 'use') {
      s.activation.osUsed.push(t.id); bonusArmor += 1;
      events.push({ type: 'os_used', mechId: t.id });
      events.push({ type: 'overheat_token', mechId: t.id, why: 'os', n: 1 }); addOverheat(s, rng, events, t, 1);
    }
    if (t.status === 'active') resolveHit(s, rng, events, { sourceId: p.sourceId, target: t, damage: h.damage, unblockable: h.unblockable, rear: h.rear, bonusArmor });
    return;
  }
  if (p.type === 'TURN_TARGET') {          // attacker turns the target: none | L:k | R:k (60° steps) | flip:4/5 (180° + 1/2 unblockable)
    if (a.choice === 'none') { events.push({ type: 'target_turned', mechId: t.id, steps: 0 }); return; }
    const [kind, k] = a.choice.split(':'), from = t.facing;
    const unb = kind === 'flip' ? +k - 3 : 0;
    t.facing = mod6(from + (kind === 'flip' ? 3 : kind === 'R' ? +k : -k));
    events.push({ type: 'target_turned', mechId: t.id, from, to: t.facing, steps: kind === 'flip' ? +k : +k, flip: kind === 'flip', unblockable: unb });
    if (unb) resolveHit(s, rng, events, { sourceId: p.sourceId, target: t, damage: 0, unblockable: unb, rear: false });
    return;
  }
  if (p.type === 'TC_REROLL') {          // attacker's TC: keep the damage dice or reroll one of them
    if (a.choice !== 'keep') { const i = +a.choice.split(':')[1]; p.faces[i] = rng.int(6); s.activation.tcUsed = true; events.push({ type: 'tc_reroll', index: i }); }
    applyDamageFaces(s, rng, events, t, p.faces);
  } else if (a.choice === 'eject') {       // the pilot leaves BEFORE the dice, the damage is still rolled: enough → the mech blows up, otherwise it is disabled
    t.pilotEjected = true; events.push({ type: 'ejected', mechId: t.id });
    rollDamageDice(s, rng, events, t, p.dice, p.sourceId);
  }
  else rollDamageDice(s, rng, events, t, p.dice, p.sourceId);
}
// ---------------------------------------------------------------- dispatcher
function checkWinner(s, events) {
  if (s.pending || s.winner) return;
  const alive = s.players.filter((p) => activeMechs(s).some((m) => m.owner === p));
  if (alive.length <= 1) { s.winner = alive[0] ?? 0; events.push({ type: 'game_over', winner: s.winner }); } // 0 = draw
}
const HANDLERS = {
  ACTIVATE: activate, ROLL_PILOT: rollPilot, DISCARD_DICE: discardDice, EMERGENCY_SHUTDOWN: emergencyShutdown,
  CONVERT: convert, COMMIT_MOVE: commitMove, MOVE_STEP: moveStep, TURN: turnInPlace, VIRTUAL_EVADE: virtualEvadeMove,
  USE_GA: useGa, JUMP: jump, RAM: ram, USE_MASC: useMasc, MASS_ACTIVATE: massActivate, FIRE: fire, RESOLVE_DECISION: resolveDecision, END_ACTIVATION: endActivation, CORRECT: correct, RESOLVE_ATTACK: resolveAttackAction,
};

// Pure: returns { ok:true, state, events, usedRng } | { ok:false, error }. Input state is never mutated.
export function apply(state, action) {
  const s = structuredClone(state), rng = makeRng(s.rngState), events = [];
  try {
    const h = HANDLERS[action.type] ?? fail(`unknown action ${action.type}`);
    if (s.winner !== null) fail('game is over');
    if (s.pending && action.type !== 'RESOLVE_DECISION') fail('a decision is pending');
    if (s.activation?.attack && !['CORRECT', 'RESOLVE_ATTACK'].includes(action.type)) fail('finish the current attack first');
    h({ s, rng, a: action, events });
    if (!s.pending && s.turnQueue) {     // the turn choice comes after armor / damage dice / TC have all been played out
      const q = s.turnQueue; s.turnQueue = null;
      const t = s.mechs[q.targetId];
      if (t && t.status === 'active') {
        const options = ['none', ...[1, 2, 3].filter((k) => k <= q.turns).flatMap((k) => [`L:${k}`, `R:${k}`]), ...[4, 5].filter((k) => k <= q.turns).map((k) => `flip:${k}`)];
        s.pending = { type: 'TURN_TARGET', player: q.player, targetId: t.id, sourceId: q.sourceId, turns: q.turns, options };
        events.push({ type: 'decision_required', player: q.player, kind: 'turn_target', turns: q.turns });
      }
    }
    checkWinner(s, events);
    s.rngState = rng.state();
    return { ok: true, state: s, events, usedRng: s.rngState !== state.rngState };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
}
export { enterCost, neighbor };
