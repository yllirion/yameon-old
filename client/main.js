import { createGame, Game, apply, CONVERSIONS, ramDamage, massPlan, mustShutdown } from '../core/engine.js';
import { BALLISTIC_DIE, DAMAGE_DIE, ENERGY_DIE, MISSILE_DIE } from '../core/data/dice.js';
import { TERRAIN } from '../core/data/terrain.js';
import { WEAPONS, WEAPON_NAMES } from '../core/data/weapons.js';
import { CLASSES } from '../core/data/classes.js';
import { DIRS, distance, inArc, neighbor, offsetToAxial as ax, key, neighbors, toPixel } from '../core/hex.js';
import { RULES } from '../core/rules.js';
import { actionsAvailable, actionsFor } from '../core/movement.js';
const gain = (m, a, nm) => (nm ? actionsFor(m.speed, a.movePips + nm) - actionsFor(m.speed, a.movePips) : 0);   // movement actions that the button will give
import { correctionsLeft, planCorrection, shotPreview, volleyBreakdown, volleyDamage } from '../core/attack.js';
import { heatGenerated } from '../core/heat.js';
import { amsReduction } from '../core/ams.js';
import { centerR, drawBadge, drawBanner, drawGhost, drawPetals, drawZones, pickFacing, signedTurn } from './moveinput.js';
import { mod6, neighbor as hexNeighbor } from '../core/hex.js';
import { planStep } from '../core/movement.js';
import { evadeOf, heatCapacity, targetOf, buildingId, rankOf } from '../core/state.js';
import { mechFromBuild } from '../core/data/slots.js';
import { newGameState } from './scenario.js';
import { connect } from './net.js';

const newGame = () => new Game(newGameState());

const $ = (id) => document.getElementById(id);
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cv = $('cv'), ctx = cv.getContext('2d'), SQ3 = Math.sqrt(3), S = 30;
const OX = (cv.width - 17 * SQ3 * S) / 2 + (SQ3 * S) / 2, OY = (cv.height - (1.5 * S * 16 + 2 * S)) / 2 + S;   // field is centered

// ---- images: client/img/<name>.png (the build inlines them as data URIs)
const img = (n) => globalThis.__IMG?.[n] ?? `img/${n}.png`;
const mini = (name, title = '', cls = '') => `<img class="${cls || 'mini'}" src="${img(name)}" alt="" title="${esc(title)}">`;
const imgCache = {};
function cimg(name) {                      // canvas image: loads lazily, redraws when ready
  if (typeof Image === 'undefined') return null;
  let i = imgCache[name];
  if (!i) { i = imgCache[name] = new Image(); i.onload = () => draw(); i.src = img(name); }
  return i.complete && i.naturalWidth ? i : null;
}
const COLORS = ['laser', 'ballistic', 'missile', 'jumpjet', 'move'];
const CONV_LABEL = { triple: '3→1', any1: '1→1', pair: '2→1', toMove: '→ move', fromMove: 'move → оружие', tc: 'TC: оружие → другое' };
const convFits = (c, n) => n > 0 && n % c.n === 0;
// a conversion button is live only if the engine would accept it for at least one target color (so no move → move)
const convUseful = (k, c) => convFits(c, sel.size) && (c.to ?? COLORS).some((to) => ok({ type: 'CONVERT', kind: k, pipIds: [...sel], to }));   // several groups can be converted in one go
const SYM = { laser: '⚡', ballistic: '●', missile: '➤', jumpjet: '⇧', move: '➜' };
const WIMG = { // weapon die face index → image
  energy: (i) => `w_laser_${[1, 1, 1, 1, 2, 3][i]}damage`,
  ballistic: (i) => ['w_ballistic_0damage', 'w_ballistic_1damage_00', 'w_ballistic_1damage_000', 'w_ballistic_1damage', 'w_ballistic_2damage', 'w_ballistic_3damage'][i],
  missile: (i) => ['w_missile_0damage', 'w_missile_0damage', 'w_missile_2damage_srm', 'w_missile_2damage_srm', 'w_missile_2damage', 'w_missile_3damage'][i],
};
const ARMOR_IMG = (i) => `armor_s${i + 1}`;                               // armor die face order = [0, 0, 1*, 1**, a, b]
const DMG_IMG = { hit: 'dmg_hit', crit_control: 'dmg_crit_control', crit_armor: 'dmg_crit_armor', crit_cooling: 'dmg_crit_cooling' };
const TOK = { overheat: 'tok_overheat', evade: 'tok_evade', virtual: 'tok_virtual_evade', anchor: 'tok_anchor', blind: 'tok_blind' };
const TNAME = { plain: 'Стандартный гекс', rock: 'Камни', fire: 'Огонь', water: 'Вода', deepWater: 'Глубокая вода', building: 'Здание', cliff: 'Скалы', mud: 'Грязь' };
const FACE = { hit: 'повреждение', crit_control: 'крит: управление', crit_armor: 'крит: броня', crit_cooling: 'крит: охлаждение' };
const CLS_RU = { light: 'Лёгкий', medium: 'Средний', heavy: 'Тяжёлый', assault: 'Штурмовой' };
const SYS_RU = { control: 'Система управления', armor: 'Броня', cooling: 'Охлаждение' };
const SYS_EFFECT = { control: '−1 куб пилотирования за уровень', armor: 'помеченные грани куба брони не работают', cooling: 'один жетон overheat не сбрасывается' };
const SYS_IMG = { control: 'dmg_crit_control', armor: 'dmg_crit_armor', cooling: 'dmg_crit_cooling' };
const COOLER_RU = { standard: 'Standard', compact: 'Compact', double: 'Double' };

let g = newGame(), sel = new Set(), conv = null, armed = [], jumpMode = false, turnAfter = 0, hover = null, hoverMechId = null, ramMode = null, ramExtra = 0, dicePos = { x: 0, y: 0 };
let flashMsg = '', flashTimer = null, logMarks = [], showLog = false;
// on-map movement input: facing by cursor zones and/or arrow petals; right mouse button held = jump mode
let ptr = null, rmb = false, inputMode = 'zones', dead = 0.35;
try { const sv = JSON.parse(localStorage.getItem('mm.input') ?? 'null'); if (sv) { inputMode = sv.mode ?? inputMode; dead = sv.dead ?? dead; showLog = !!sv.log; } } catch (_) {}
const saveInput = () => { try { localStorage.setItem('mm.input', JSON.stringify({ mode: inputMode, dead, log: showLog })); } catch (_) {} };
let lastShot = null, shotTimer = null, legal = { moves: new Map(), jumps: new Map(), targets: new Set(), hexTargets: new Map(), rams: new Set() };
let net = null;                              // network session (client/net.js); null = hot-seat
const st = () => g.state, actor = () => (st().pending ? st().pending.player : st().turn.player);   // whose input the game is waiting for
const who = () => (net ? net.seat : actor()), myInput = () => !net || (net.online && st().winner === null && actor() === net.seat);
const name = (id) => esc(targetOf(st(), id)?.name ?? (String(id).startsWith('bld:') ? 'Здание' : id)), pix = (h) => ({ x: OX + S * toPixel(h).x, y: OY + S * toPixel(h).y });
const ok = (a) => apply(st(), { player: who(), ...a }).ok;
const className = (rank) => Object.keys(CLASSES).find((k) => CLASSES[k].rank === rank);
const wtype = (m, wid) => m.weapons.find((x) => x.id === wid).type;
const wname = (type) => WEAPON_NAMES[type] ?? type;
const CHEAP = ['jumpjet', 'move', 'missile', 'ballistic', 'laser'];       // which dice we spend first when any die will do
const byPref = (x, y) => (sel.has(y.id) - sel.has(x.id)) || (CHEAP.indexOf(x.color) - CHEAP.indexOf(y.color));

// ---- action builders: the UI picks dice automatically, the engine validates
// "Get ДД": converts every free move die that still adds movement actions (a die that would add nothing stays untouched)
// the dice a weapon / movement may use: when the player has selected some dice of the pilot roll, only those; otherwise the whole pool
const poolOf = (a) => (sel.size ? a.pool.filter((p) => sel.has(p.id)) : a.pool);
function moveCommit(m, a) {
  const free = poolOf(a).filter((p) => !p.spent && p.color === 'move').sort((x, y) => (x.evade ? 1 : 0) - (y.evade ? 1 : 0));
  const target = actionsFor(m.speed, a.movePips + free.length); let k = 0;
  while (k < free.length && actionsFor(m.speed, a.movePips + k) < target) k++;
  return { ids: free.slice(0, k).map((p) => p.id), gain: target - actionsFor(m.speed, a.movePips) };
}
const firstMove = () => poolOf(st().activation ?? { pool: [] }).find((p) => !p.spent && p.color === 'move');
// can this weapon still be paid for, given the dice already earmarked by the other armed weapons (TC may stand in for one die)?
function canPay(m, a, wid) {
  const w = WEAPONS[wtype(m, wid)];
  if (w.payWith || a.fired.includes(wid)) return true;
  if (!w.noMass && w.pips.length === 1 && Object.values(a.mass).some((x) => x.weapons.includes(wid))) return true;
  const used = new Set(); let tcFree = !!m.equipment.tc && !a.tcUsed;
  for (const id of [...armed.filter((x) => x !== wid), wid]) {
    const ww = WEAPONS[wtype(m, id)]; if (ww.payWith) continue;
    if (!ww.noMass && ww.pips.length === 1 && poolOf(a).filter((p) => !p.spent && p.color === ww.pips[0]).length >= 2) continue;   // mass activation pays it (with a heat penalty)
    const ids = pickPips(ww, used); ids.forEach((i) => used.add(i));
    if (ids.length < ww.pips.length) {
      const spare = poolOf(a).filter((p) => !p.spent && !used.has(p.id)).length;
      if (id === wid && !(tcFree && spare >= ww.pips.length - ids.length)) return false;
      if (id !== wid && tcFree) tcFree = false;
    }
  }
  return true;
}
function pickPips(w, used) {
  const a = st().activation, out = [], pool = [...poolOf(a)].sort((x, y) => sel.has(y.id) - sel.has(x.id));
  for (const c of w.pips) { const p = pool.find((p) => !p.spent && p.color === c && !out.includes(p.id) && !used.has(p.id)); if (p) out.push(p.id); }
  return out;
}
// one FIRE action for a whole volley: every armed weapon gets its own dice
function fireAction(m, wids, tid) {
  const a = st().activation, used = new Set(), weapons = []; let tcFree = !!m.equipment.tc && !a.tcUsed;
  for (const wid of wids) {
    const w = WEAPONS[wtype(m, wid)];
    if (w.payWith) { weapons.push({ weaponId: wid, pipIds: [] }); continue; }             // melee: paid with movement actions
    if (!w.noMass && w.pips.length === 1 && Object.values(a.mass).some((x) => x.weapons.includes(wid))) { weapons.push({ weaponId: wid, pipIds: [] }); continue; } // paid by mass activation
    const ids = pickPips(w, used); ids.forEach((id) => used.add(id));
    if (ids.length < w.pips.length && tcFree) {                                          // TC: any die may pay for one attack action
      const rest = poolOf(a).filter((p) => !p.spent && !used.has(p.id)).sort(byPref).slice(0, w.pips.length - ids.length);
      rest.forEach((p) => { used.add(p.id); ids.push(p.id); }); tcFree = false;
      weapons.push({ weaponId: wid, pipIds: ids, useTC: true });
    } else weapons.push({ weaponId: wid, pipIds: ids });
  }
  if (String(tid).startsWith('bld:')) { const [q, r] = tid.slice(4).split(',').map(Number); return { type: 'FIRE', targetHex: { q, r }, weapons, ...(sel.size ? { only: [...sel] } : {}) }; }
  return { type: 'FIRE', targetId: tid, weapons, ...(sel.size ? { only: [...sel] } : {}) };
}
// Fire correction costs the weapon's own dice again: one die, or a PAIR for Gauss / PPC (CC may stand in for one die).
function corrAction(mode, extra = {}) {
  const s = st(), a = s.activation, m = s.mechs[a.mechId], A = a.attack, shot = extra.shot ?? 0;
  const plan = planCorrection(s, a, m, targetOf(s, A.targetId), WEAPONS[wtype(m, A.shots[shot].wid)], [...sel]);
  if (plan && plan.cc && !sel.has(plan.extra)) { flash('CC: выбери в пуле кубик пилотирования, который потратить на корректировку'); return null; }
  return plan ? { type: 'CORRECT', mode, shot, pipIds: plan.pipIds, ...(plan.cc ? { cc: plan.cc } : {}), ...extra } : null;
}
function ramAction(m, tid) {
  const a = st().activation, n = 2 + ramExtra;
  if (ramMode === 'jump') return { type: 'RAM', targetId: tid, via: 'jump', extraActions: ramExtra, pipIds: [...a.pool].sort((x, y) => sel.has(y.id) - sel.has(x.id)).filter((p) => !p.spent && p.color === 'jumpjet').slice(0, n).map((p) => p.id) };
  return { type: 'RAM', targetId: tid, extraActions: ramExtra };
}
const jumpPip = () => { const a = st().activation; return a && [...a.pool].sort((x, y) => sel.has(y.id) - sel.has(x.id)).find((p) => !p.spent && p.color === 'jumpjet')?.id; };

// ---- movement preview: what a click at the cursor would do (step / turn in place / jump / switch jump mode)
const jumpActive = () => jumpMode || rmb;
function movePreview() {
  const s = st(), a = s.activation; if (!ptr || !a || a.phase !== 'PLAY' || s.pending || a.attack || s.winner !== null || !myInput()) return null;
  const m = s.mechs[a.mechId], c = cellAtPt(ptr.x, ptr.y); if (!c) return null;
  const cfg = { mode: inputMode, dead, S }, f = m.facing, hasJJ = (m.equipment.jumpjets ?? 0) > 0;
  if ((armed.length || ramMode) && (s.map.cells[key(c)]?.terrain === 'building' || Object.values(s.mechs).some((x) => x.id !== m.id && x.status !== 'destroyed' && key(x.pos) === key(c)))) return null;   // aiming at an occupied hex: it is a target, not a step
  const own = key(c) === key(m.pos), near = own || neighbors(m.pos).some((n) => key(n) === key(c));
  if (!near) return null;
  const P = pix(c);
  if (jumpActive()) {
    if (!legal.jumps.has(key(c))) return { type: 'jump', h: c, bad: true, reason: !jumpPip() ? 'нет куба ⇧ в запасе' : 'сюда прыгнуть нельзя' };
    const all = [mod6(f - 1), f, mod6(f + 1)];
    return { type: 'jump', h: c, base: f, all, g: pickFacing(cfg, P, ptr.x, ptr.y, all, f), cost: 0 };
  }
  if (own) {
    if (hasJJ && Math.hypot(ptr.x - P.x, ptr.y - P.y) <= centerR(inputMode, dead, S)) return { type: 'arm', h: c };
    const all = [mod6(f - 1), mod6(f + 1)], cost = 1 + (m.anchor > 0 ? 1 : 0);
    if (!ok({ type: 'TURN', turn: 1 }) && !ok({ type: 'TURN', turn: -1 })) return { type: 'rot', h: c, bad: true, reason: 'не хватает ДД на поворот' };
    return { type: 'rot', h: c, base: f, all, g: pickFacing(cfg, P, ptr.x, ptr.y, all, f), cost };
  }
  let plan; try { plan = planStep(s, m, c); } catch (_) { return { type: 'step', h: c, bad: true, reason: 'сюда нельзя' }; }
  if (!legal.moves.has(key(c))) return { type: 'step', h: c, bad: true, reason: plan.cost > actionsAvailable(m, a) ? `не хватает ДД (нужно ${plan.cost})` : 'сюда нельзя' };
  const all = plan.back ? [plan.newFacing] : [mod6(plan.newFacing - 1), plan.newFacing, mod6(plan.newFacing + 1)];
  return { type: 'step', h: c, base: plan.newFacing, all, g: pickFacing(cfg, P, ptr.x, ptr.y, all, plan.newFacing), cost: plan.cost, back: plan.back, dir: dirName(m, c) };
}
const dirName = (m, c) => { const o = signedTurn(m.facing, [0, 1, 2, 3, 4, 5].find((d) => key(hexNeighbor(m.pos, d)) === key(c))); return o === 0 ? 'шаг вперёд' : Math.abs(o) === 1 ? `шаг вперёд-${o > 0 ? 'вправо' : 'влево'} (поворот + вход)` : 'шаг назад'; };
const turnWord = (b, g) => (g === b ? 'без поворота' : signedTurn(b, g) > 0 ? '↷ вправо 60°' : '↶ влево 60°');
function badge(p) {
  if (p.bad) return [p.reason, '#ff6b6b'];
  if (p.type === 'arm') return [jumpMode ? 'выключить режим прыжка' : 'режим прыжка (клик) — или зажми ПКМ', '#e2c6ff'];
  if (p.g === null || p.g === undefined) return [p.type === 'rot' ? 'поворот на месте: выбери сторону' : 'выбери ориентацию', '#a9b2bf'];
  if (p.type === 'rot') return [`поворот на месте ${signedTurn(p.base, p.g) > 0 ? '↷ вправо' : '↶ влево'} 60° · ${p.cost} ДД`, '#cfe6ff'];
  if (p.type === 'jump') return [`прыжок${p.h === st().mechs[st().activation.mechId].pos ? ' на месте' : ''}, ${turnWord(p.base, p.g)} · куб ⇧, 2🌡`, '#e2c6ff'];
  return [`${p.dir}, ${turnWord(p.base, p.g)}${p.g !== p.base ? ' (бесплатно)' : ''} · ${p.cost} ДД`, '#cfe6ff'];
}
function doMove(p) {                       // commit what the preview shows
  const a = st().activation, m = st().mechs[a.mechId];
  if (!p || p.bad) return;
  if (p.type === 'arm') { jumpMode = !jumpMode; armed = []; refresh(); return; }
  if (p.g === null || p.g === undefined) return;
  const to = { q: p.h.q, r: p.h.r };
  if (p.type === 'rot') send({ type: 'TURN', turn: signedTurn(m.facing, p.g) });
  else if (p.type === 'jump') send({ type: 'JUMP', to, turn: signedTurn(m.facing, p.g), pipIds: [jumpPip()] });
  else send({ type: 'MOVE_STEP', to, turn: signedTurn(p.base, p.g) });
}

function computeLegal() {          // "what can I click?" = dry-run the pure engine
  legal = { moves: new Map(), jumps: new Map(), targets: new Set(), hexTargets: new Map(), rams: new Set() };
  const a = st().activation; if (!a || a.phase !== 'PLAY' || st().pending || a.attack) return;
  const m = st().mechs[a.mechId];
  if (jumpMode || rmb) { const pip = jumpPip(); if (pip) for (const n of [m.pos, ...neighbors(m.pos)]) if (ok({ type: 'JUMP', to: n, turn: turnAfter, pipIds: [pip] })) legal.jumps.set(key(n), n); }   // own hex = jump in place
  else for (const n of neighbors(m.pos)) if (ok({ type: 'MOVE_STEP', to: n, turn: 0 })) legal.moves.set(key(n), n);
  if (armed.length) {
    for (const t of Object.values(st().mechs)) if (t.owner !== m.owner && t.status === 'active' && ok(fireAction(m, armed, t.id))) legal.targets.add(t.id);
    for (const c of Object.values(st().map.cells)) if (c.terrain === 'building' && ok(fireAction(m, armed, buildingId(c)))) legal.hexTargets.set(key(c), c);   // buildings can be shot too
  }
  if (ramMode) for (const t of Object.values(st().mechs)) if (t.owner !== m.owner && t.status === 'active' && ok(ramAction(m, t.id))) legal.rams.add(t.id);
}

// ---- the combat window remembers the last shot: weapon dice → armor dice → damage dice
function trackShot(e) {
  const s = st();
  if (e.type === 'attack') {
    const am = s.mechs[e.attackerId];
    const shot = { name: esc(wname(wtype(am, e.weapon))), sub: WEAPONS[wtype(am, e.weapon)].sub ?? null, faces: e.faces, miss: e.miss, damage: e.damage, unblockable: e.unblockable, turns: e.turns };
    if (lastShot && !lastShot.armor && lastShot.targetId === e.targetId && lastShot.open) lastShot.shots.push(shot);   // same volley
    else lastShot = { open: true, shots: [shot], targetId: e.targetId, armor: null, damage: [] };
  } else if (e.type === 'ams' && lastShot) { (lastShot.ams ??= []).push(e);
  } else if (e.type === 'evade_cut' && lastShot) { (lastShot.evCuts ??= []).push(e);
  } else if (e.type === 'building_hit' && lastShot) { lastShot.open = false; lastShot.building = e;
  } else if (lastShot && e.type === 'armor' && e.targetId === lastShot.targetId && !lastShot.armor) {
    lastShot.open = false;
    lastShot.armor = { faces: e.faces, rolls: e.rolls, bonus: e.bonusArmor, absorbed: e.absorbed, through: e.through, rear: e.rear, cls: s.mechs[e.targetId].cls };
  } else if (lastShot && e.type === 'damage_die' && e.mechId === lastShot.targetId) lastShot.damage.push(e.face);
}
const amsRow = (a, label) => (a && a.dice ? `<div class="drow sm" title="AMS: жёлтые кубы, ** и *** — промахи">${a.dice.map((f) => `<div class="d"><img src="${img(WIMG.ballistic(f))}" alt=""></div>`).join('')}<small>${label}</small></div>` : (a && a.faces ? `<div class="drow sm">${a.faces.map((f) => `<div class="d"><img src="${img(WIMG.ballistic(f))}" alt=""></div>`).join('')}<small>${label}</small></div>` : ''));
const shotResult = (x) => (x.miss ? '✖ ПРОМАХ' : `✔ урон ${x.damage}${x.unblockable ? '+' + x.unblockable : ''}`);
function send(a) {
  if (!a) return;
  if (net) {                                  // network game: the server applies the action and broadcasts the result to both players
    if (!net.online) return flash('нет связи с сервером');
    if (!net.seat) return flash('вы наблюдатель');
    if (!myInput()) return flash('сейчас ход соперника');
    net.action(a, (r) => { if (!r.ok) flash(r.error); });
    return;
  }
  const r = g.dispatch({ player: who(), ...a });
  if (!r.ok) flash(r.error);
  else applied(a.type, r.events, g.history.length);
  refresh();
}
// an action went through (ours, or — in a network game — anybody's): shot window, log, selection
function applied(type, events, undoDepth) {
  if (type === 'FIRE' || type === 'RAM') { lastShot = null; diceMoved = false; diceAnchor = null; fold = {}; shotSeq++; }
  sel.clear();
  if (type === 'MOVE_STEP' || type === 'JUMP') turnAfter = 0;   // the free turn is chosen anew for every step
  if (lastShot) lastShot.open = false;
  events.forEach(trackShot);
  if (lastShot) lastShot.open = false;
  const before = $('log').children.length;
  events.forEach(logEvent);
  if (undoDepth) logMarks.push($('log').children.length - before); else logMarks = [];   // the log follows undo
  if (type === 'FIRE') armed = [];
  if (type === 'RAM') { ramMode = null; ramExtra = 0; }
  if (type === 'JUMP') jumpMode = false;
}
function resetUi() { ramMode = null; ramExtra = 0; dicePos = { x: 0, y: 0 }; diceMoved = false; diceAnchor = null; armed = []; logMarks = []; jumpMode = false; lastShot = null; sel.clear(); $('log').innerHTML = ''; }
function undoUi() { const k = logMarks.pop() ?? 0; for (let i = 0; i < k; i++) $('log').firstChild?.remove(); armed = []; jumpMode = false; sel.clear(); }
// network game: `g` becomes a read-only mirror of the server's game
const mirrorGame = (m) => ({ state: m.state, history: { length: m.undo }, canUndo() { return this.history.length > 0 && net.online && !this.state.pending && this.state.turn.player === net.seat; } });
function netStatus() {
  if (!net) return '';
  const other = net.players.find((p) => p.seat !== net.seat && (net.seat || p.seat === 1));
  const me = net.seat ? `вы — <span class="p${net.seat}">игрок ${net.seat}</span>` : 'вы — наблюдатель';
  const opp = !net.online ? '<span class="p2">нет связи с сервером…</span>' : !net.seat ? '' : other?.online ? 'соперник в сети' : other?.taken ? '<span class="p2">соперник отключился</span>' : 'ждём соперника — отправь ему ссылку';
  return ` · ${me}${opp ? ' · ' + opp : ''}`;
}
connect({
  joined(m) {                                 // first join and every reconnect: take the whole state and rebuild the log
    resetUi(); g = mirrorGame(m);
    m.log.forEach((x, i) => { try { applied(x.type, x.events, Math.max(0, m.undo - (m.log.length - 1 - i))); } catch (e) { console.warn('log replay', e); } });
    if (!st().activation?.attack && !st().pending) lastShot = null;
    $('btnLink').style.display = '';
    refresh();
  },
  update(m) { g = mirrorGame(m); applied(m.type, m.events, m.undo); refresh(); },
  undone(m) { g = mirrorGame(m); undoUi(); refresh(); },
  reset(m) { resetUi(); g = mirrorGame(m); refresh(); },
  presence() { panel(); },
  status(_, err) { if (err) flash(err); refresh(); },
}).then((n) => { net = n; if (net) refresh(); });
function flash(msg) { flashMsg = msg; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashMsg = ''; panel(); }, 3500); panel(); }
function log(html) { const d = document.createElement('div'); d.innerHTML = html; $('log').prepend(d); }

const fmtDie = { energy: (i) => ENERGY_DIE[i] + '🌡', ballistic: (i) => { const f = BALLISTIC_DIE[i]; return f.dmg + (f.missMid ? '**' : f.missLong ? '***' : ''); },
  missile: (i) => { const f = MISSILE_DIE[i]; return f.dmg + (f.srm ? 'ˢ' : ''); } };
const weaponMinis = (rolls) => Object.entries(rolls).flatMap(([k, v]) => v.map((i) => mini(WIMG[k](i), fmtDie[k](i)))).join('');
function logEvent(e) {
  const n = name, s = st();
  const t = {
    activation_started: () => `▶ ${n(e.mechId)} активируется`,
    pilot_roll: () => `🎲 ${e.dice.map((d) => mini(d.color + (d.evade ? '_e' : ''), d.color)).join('')}${e.mustDiscard ? ` (сбросить ${e.mustDiscard})` : ''}`,
    moved: () => `${n(e.mechId)} шаг (цена ${e.cost})`, turned: () => `${n(e.mechId)} поворот`, jumped: () => `⇧ ${n(e.mechId)} ${e.inPlace ? 'прыжок на месте' : 'прыжок'}`,
    attack: () => `💥 ${n(e.attackerId)} → ${n(e.targetId)} [${esc(wname(wtype(s.mechs[e.attackerId], e.weapon)))}] дист ${e.dist} (${e.band}) ${weaponMinis(e.faces)} ${e.miss ? 'ПРОМАХ' : 'урон ' + e.damage + (e.unblockable ? '+' + e.unblockable : '')}`,
    attack_rolled: () => `🎲 ${n(e.attackerId)}: ${e.shots.map((x) => `[${esc(wname(wtype(s.mechs[e.attackerId], x.weapon)))}] ${weaponMinis(x.rolls)}`).join(' ')} — можно корректировать`, rerolled: () => `↻ переброс → ${weaponMinis(e.rolls)}`,
    ignored_evade: () => `◇ игнор evade (всего ${e.total})`, masc: () => `${n(e.mechId)}: MASC — 2 ДД, +1 тепло`, mass_activation: () => `${n(e.mechId)}: массовая активация (${e.color}) — орудий ${e.weapons.length}${e.extraHeat ? `, штраф +${e.extraHeat} тепла` : ''}`, tc_used: () => `TC: смена типа действия атаки`,
    cc_used: () => `CC (${n(e.ccMechId)}): куб заменён для корректировки${e.extraHeat ? ', +1 тепло' : ''}`, tc_reroll: () => `TC: переброс куба урона №${e.index + 1}`,
    armor: () => { const c = CLASSES[s.mechs[e.targetId].cls].armor;
      return e.faces.length ? `🛡 ${n(e.targetId)} (${e.rear ? 'тыл' : 'фронт'}) ${e.faces.map((f, k) => mini(ARMOR_IMG(f), '', e.rolls[k] < c[f].v ? 'mini dim' : 'mini')).join('')} поглощено ${e.absorbed}${e.bonusArmor ? ` (в т.ч. бонус ${e.bonusArmor})` : ''}, прошло ${e.through}`
        : `🛡 ${n(e.targetId)}: бонус брони ${e.bonusArmor}, прошло ${e.through}`; },
    decision_required: () => e.kind === 'os' ? `⚠ игрок ${e.player}: Omni Shield — активировать до броска брони?` : e.kind === 'turn_target' ? `⚠ игрок ${e.player}: поворот цели (до ${e.turns} × 60°)` : e.kind === 'tc_reroll' ? `⚠ игрок ${e.player}: TC — переброс куба урона?` : `⚠ игрок ${e.player}: катапульта или принять ${e.dice} куб. урона`,
    damage_die: () => `${mini(DMG_IMG[e.face], FACE[e.face])} ${FACE[e.face]}`, destroyed: () => `☠ ${n(e.mechId)} уничтожен`, ejected: () => `🪂 ${n(e.mechId)} катапультировался`,
    disabled: () => `✖ ${n(e.mechId)} выведен из строя`, detonation_hit: () => `🔥 детонация → ${n(e.targetId)}: ${weaponMinis({ missile: e.faces ?? [] })} урон ${e.damage}`,
    evade_cut: () => `🌀 evade цели (${e.sub.toUpperCase()}): ${mini('tok_evade', 'evade', 'pi')}${e.tokens}${e.ignored ? `, проигнорировано ${e.ignored}` : ''} → −${e.cut} урона ракет залпа`,
    ams: () => `🛰 AMS цели (${e.sub.toUpperCase()}): ${weaponMinis({ ballistic: e.faces })} −${e.cut} урона ракет`,
    target_turned: () => e.steps ? `↻ ${n(e.mechId)} повёрнут: ${e.flip ? '180°' : e.steps * 60 + '°'}${e.unblockable ? `, +${e.unblockable} неблокируемого урона` : ''}` : `${n(e.mechId)} не повёрнут`,
    heat_control: () => `🌡 ${n(e.mechId)}: тепло ${e.generated}/${e.capacity}, жетонов ${e.overheat}${e.overflow ? ', ПЕРЕГРЕВ' : ''}`,
    overheat_token: () => `🌡 ${n(e.mechId)} получает ${mini('tok_overheat', 'overheat', 'pi')}${e.n > 1 ? ' ×' + e.n : ''} (${{ start_in_fire: 'активация в огне', ga: 'GA', os: 'OS' }[e.why] ?? 'вход в огонь'})`,
    ga_used: () => `⚓ ${n(e.mechId)}: GA, радиус ${e.radius} — ${mini('tok_anchor', 'anchor', 'pi')} получают: ${e.affected.map(n).join(', ')}`, os_used: () => `🛡 ${n(e.mechId)}: Omni Shield — +1 ЕБ`,
    blind: () => `${n(e.mechId)} получает ${mini('tok_blind', 'blind', 'pi')} (детонация), всего ${e.n}`, blind_lost: () => `${n(e.mechId)} теряет ${mini('tok_blind', 'blind', 'pi')} (осталось ${e.left})`,
    building_hit: () => `🏢 здание (${e.hex.q},${e.hex.r}): урон ${e.damage}${e.destroyed ? ` → разрушено, теперь ${e.becomes === 'fire' ? 'огонь' : 'камни'}` : `, осталось ${e.left}`}`,
    ram: () => `🐏 ${n(e.attackerId)} таранит ${n(e.targetId)}${e.via === 'jump' ? ' (JJ)' : ''}: урон ${e.damage}${e.extra ? ` (доп. ${e.extra})` : ''}`,
    round_started: () => `═══ раунд ${e.round} ═══`, class_started: () => `— класс ${className(e.rank)} —`,
    game_over: () => `🏁 ${e.winner ? 'победил игрок ' + e.winner : 'ничья'}`, emergency_shutdown: () => `${n(e.mechId)}: экстренное отключение`,
  }[e.type];
  if (t) log(t());
}

// ---- drawing
// hexPath draws corner i at angle 60i−30°; the edge between corners i and i+1 faces the neighbour in this direction
const hexEdgeDir = (i) => i;
function hexPath(c) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); ctx[i ? 'lineTo' : 'moveTo'](c.x + S * Math.cos(a), c.y + S * Math.sin(a)); } ctx.closePath(); }
function draw() {
  const s = st(); ctx.clearRect(0, 0, cv.width, cv.height); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const act = s.activation && s.mechs[s.activation.mechId];
  const mp = movePreview(), pv = mp && !mp.bad && mp.type !== 'arm' && mp.g !== null && mp.g !== undefined ? mp : null;   // where the mech would stand / look
  for (const c of Object.values(s.map.cells)) {
    const p = pix(c); hexPath(p); ctx.fillStyle = '#' + TERRAIN[c.terrain].color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
    if (c.cover) { ctx.fillStyle = 'rgba(60,60,60,.8)'; ctx.font = '13px sans-serif'; ctx.fillText('▲' + c.cover, p.x, p.y + 14); }
  }
  if (act) {                      // reach of the active mech (or of its ghost while a move is previewed): every hex inside the 120° arc within 9, outlined along its outer edge
    const rp = pv ? { pos: pv.h, facing: pv.g } : act;
    const reach = new Set(Object.values(s.map.cells).filter((c) => distance(rp.pos, c) >= 1 && distance(rp.pos, c) <= 9 && inArc(rp.pos, rp.facing, c, RULES.arcDegrees, RULES.arcBoundaryInclusive)).map(key));
    for (const k of reach) { hexPath(pix(s.map.cells[k])); ctx.fillStyle = pv ? 'rgba(60,140,255,.12)' : 'rgba(240,180,41,.12)'; ctx.fill(); }
    ctx.strokeStyle = pv ? 'rgba(60,140,255,.95)' : 'rgba(240,160,20,.95)'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (const k of reach) { const c = s.map.cells[k], p = pix(c);
      for (let i = 0; i < 6; i++) { if (reach.has(key(neighbor(c, hexEdgeDir(i))))) continue;
        const a1 = (Math.PI / 180) * (60 * i - 30), a2 = (Math.PI / 180) * (60 * (i + 1) - 30);
        ctx.moveTo(p.x + S * Math.cos(a1), p.y + S * Math.sin(a1)); ctx.lineTo(p.x + S * Math.cos(a2), p.y + S * Math.sin(a2)); } }
    ctx.stroke(); ctx.lineWidth = 1;
  }
  for (const [, h] of legal.moves) { hexPath(pix(h)); ctx.fillStyle = 'rgba(60,200,90,.45)'; ctx.fill(); }
  if (act && legal.moves.size) { ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#123'; for (const [, h] of legal.moves) { try { const q = pix(h); ctx.fillText(String(planStep(s, act, h).cost), q.x, q.y + S * 0.55); } catch (_) {} } }
  for (const [, h] of legal.jumps) { hexPath(pix(h)); ctx.fillStyle = 'rgba(60,170,255,.55)'; ctx.fill(); }
  if (act && s.activation.route.length) {            // path walked in this activation + the facing the mech started with
    const r = s.activation.route, a0 = pix(r[0]);
    if (r.length > 1) { ctx.beginPath(); r.forEach((h, i) => { const q = pix(h); ctx[i ? 'lineTo' : 'moveTo'](q.x, q.y); }); ctx.strokeStyle = 'rgba(240,180,41,.9)'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.stroke(); ctx.lineWidth = 1;
      for (const h of r.slice(1)) { const q = pix(h); ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 7); ctx.fillStyle = 'rgba(240,180,41,.95)'; ctx.fill(); } }
    const d = toPixel(DIRS[s.activation.startFacing]), L = Math.hypot(d.x, d.y), ux = d.x / L, uy = d.y / L, sz = S * 0.34;
    ctx.beginPath(); ctx.moveTo(a0.x + ux * sz * 1.5, a0.y + uy * sz * 1.5); ctx.lineTo(a0.x - ux * sz * 0.6 - uy * sz, a0.y - uy * sz * 0.6 + ux * sz); ctx.lineTo(a0.x - ux * sz * 0.6 + uy * sz, a0.y - uy * sz * 0.6 - ux * sz); ctx.closePath();
    ctx.fillStyle = '#f0b429'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
  }
  for (const [, h] of legal.hexTargets) { hexPath(pix(h)); ctx.lineWidth = 3; ctx.strokeStyle = '#ff3b3b'; ctx.stroke(); ctx.lineWidth = 1; }
  for (const id of legal.rams) { const p = pix(s.mechs[id].pos); ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.9, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#ff8c1a'; ctx.stroke(); ctx.lineWidth = 1; }
  for (const id of legal.targets) { const p = pix(s.mechs[id].pos); ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.9, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#ff3b3b'; ctx.stroke(); ctx.lineWidth = 1; }
  if (mp && !mp.bad && mp.type !== 'arm' && inputMode !== 'petals') drawZones(ctx, S, pix(mp.h), mp, dead, ptr);
  for (const m of Object.values(s.mechs)) if (m.status === 'active' || m.status === 'disabled') drawMech(m, act);
  drawRollButtons();
  if (mp && !mp.bad && mp.type !== 'arm') {
    if (pv && key(mp.h) !== key(act.pos)) {            // path + ghost on the destination hex
      const A0 = pix(act.pos), T0 = pix(mp.h); ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(A0.x, A0.y);
      if (mp.type === 'jump') { ctx.strokeStyle = 'rgba(170,60,255,.95)'; ctx.quadraticCurveTo((A0.x + T0.x) / 2, (A0.y + T0.y) / 2 - S * 0.9, T0.x, T0.y); } else { ctx.strokeStyle = 'rgba(30,100,200,.9)'; ctx.lineTo(T0.x, T0.y); }
      ctx.stroke(); ctx.restore(); drawGhost(ctx, S, T0, pv.g, 0.7, act.owner === 1 ? '#4a90e2' : '#e25555');
    } else if (pv) drawGhost(ctx, S, pix(act.pos), pv.g, 0.55, act.owner === 1 ? '#4a90e2' : '#e25555');   // turn in place: where it will look
    if (inputMode !== 'zones') drawPetals(ctx, S, pix(mp.h), mp, inputMode, ptr);
  }
  if (gaPrev && act) for (const c of Object.values(s.map.cells)) if (distance(act.pos, c) <= gaPrev) { hexPath(pix(c)); ctx.fillStyle = 'rgba(255,140,0,.22)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,140,0,.7)'; ctx.stroke(); }   // GA radius preview
  if (turnPrev && s.mechs[turnPrev.id]) { const tm = s.mechs[turnPrev.id]; drawGhost(ctx, S, pix(tm.pos), turnPrev.facing, 0.8, tm.owner === 1 ? '#4a90e2' : '#e25555'); }
  if (!act && !s.pending && s.winner === null) for (const m of Object.values(s.mechs)) if (m.status === 'active' && !m.activated && m.owner === s.turn.player && CLASSES[m.cls].rank === s.turn.rank) {
    const p = pix(m.pos); ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.95, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#f0b429'; ctx.stroke(); ctx.lineWidth = 1; }
  if (preview) {                 // trajectory of the armed weapons: both candidate lines, hexes that count are lit
    const A = pix(act.pos), T = pix(previewPos), p0 = preview[0], allOk = preview.every((p) => p.ok);
    const col = allOk ? '240,180,41' : '226,85,85', counted = new Set(preview.flatMap((p) => p.counted));
    { hexPath(T); ctx.fillStyle = `rgba(${col},0.38)`; ctx.fill(); }          // the target hex is lit like the hexes of the line
    for (const v of p0.variants) for (const h of v.slice(1, -1)) { const k = key(h), cell = s.map.cells[k]; if (!cell) continue; hexPath(pix(h)); ctx.fillStyle = `rgba(${col},${counted.has(k) ? 0.38 : 0.12})`; ctx.fill(); if (counted.has(k) && cell.cover) { ctx.fillStyle = '#000'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('укр.' + cell.cover, pix(h).x, pix(h).y - 12); } }
    // terrain on the line that matters for this shot: armor tokens (rock) and +1 virtual evade (fire; lasers lose range instead)
    const best = (f) => p0.variants.reduce((acc, v) => { const hs = v.slice(1, -1).filter((h) => counted.has(key(h)) && f(s.map.cells[key(h)])); return hs.length > acc.length ? hs : acc; }, []);
    const armHs = best((c) => c && TERRAIN[c.terrain].armor), fireHs = preview.some((p) => !p.laserReach) ? best((c) => c && TERRAIN[c.terrain].fire) : [];
    const tc0 = s.map.cells[key(previewPos)];
    const mark = (h, name, n, dx) => { const q = pix(h), r = 11; ctx.beginPath(); ctx.arc(q.x + dx, q.y, r + 2, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill(); const im = cimg(name); if (im) { ctx.save(); ctx.beginPath(); ctx.arc(q.x + dx, q.y, r, 0, 7); ctx.clip(); ctx.drawImage(im, q.x + dx - r, q.y - r, r * 2, r * 2); ctx.restore(); }
      if (n > 1) { ctx.font = 'bold 12px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(n, q.x + dx + r, q.y + r - 1); ctx.fillStyle = '#fff'; ctx.fillText(n, q.x + dx + r, q.y + r - 1); ctx.lineWidth = 1; } };
    armHs.forEach((h) => mark(h, 'icon_armor', TERRAIN[s.map.cells[key(h)].terrain].armor, fireHs.some((f) => key(f) === key(h)) ? -9 : 0));
    fireHs.forEach((h) => mark(h, TOK.virtual, 1, armHs.some((f) => key(f) === key(h)) ? 9 : 0));
    if (tc0 && TERRAIN[tc0.terrain].fire && preview.some((p) => !p.laserReach)) mark(previewPos, TOK.virtual, 1, 0);   // the target stands in fire: +1 virtual evade
    if (tc0 && TERRAIN[tc0.terrain].armor) mark(previewPos, 'icon_armor', TERRAIN[tc0.terrain].armor, 0);   // the target's own hex
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(T.x, T.y); ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  }
  if (hover) { hexPath(pix(hover)); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
  if (mp && ptr) { const [txt, col] = badge(mp); drawBadge(ctx, cv.width, cv.height, ptr, txt, col); }
  if (rmb) drawBanner(ctx, cv.width, jumpPip() ? 'РЕЖИМ ПРЫЖКА · отпусти ПКМ над гексом (вне поля — отмена)' : 'нет куба ⇧ для прыжка', jumpPip() ? 'rgba(150,60,230,.92)' : 'rgba(220,40,40,.9)');
  else if (jumpMode) drawBanner(ctx, cv.width, 'РЕЖИМ ПРЫЖКА (клик по своему центру или кнопка — выключить)', 'rgba(150,60,230,.85)');
}
function drawCrit(sys, lvl, x, y) {              // images crit_<system>_<1..3> if present; otherwise the damage-die icon with level dots
  const named = `crit_${sys}_${lvl}`, i = (!globalThis.__IMG || named in globalThis.__IMG) ? cimg(named) : null, r = 9;
  if (i) { ctx.drawImage(i, x - r, y - r, r * 2, r * 2); return; }
  const f = cimg('dmg_crit_' + sys);
  ctx.fillStyle = '#111'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (f) ctx.drawImage(f, x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
  ctx.strokeStyle = lvl >= 3 ? '#ff2d2d' : '#f0b429'; ctx.lineWidth = 1.5; ctx.strokeRect(x - r, y - r, r * 2, r * 2); ctx.lineWidth = 1;
  for (let k = 0; k < lvl; k++) { ctx.fillStyle = '#ff2d2d'; ctx.fillRect(x - 6 + k * 5, y + r - 3, 4, 3); }
}
function drawToken(name, x, y, n) {            // token icon with a count (the count is hidden for a single token)
  const i = cimg(name), r = 6.5;
  if (i) ctx.drawImage(i, x - r, y - r, r * 2, r * 2);
  else { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#ccc'; ctx.fill(); }
  if (n > 1) { ctx.font = 'bold 11px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(n, x + r, y + r - 1); ctx.fillStyle = '#fff'; ctx.fillText(n, x + r, y + r - 1); ctx.lineWidth = 1; }
}
// pilot-roll buttons drawn on the token of the activated mech: green = roll the pilot dice, red = emergency shutdown
let hoverBtn = null;
function rollButtons() {
  const s = st(), a = s.activation; if (!a || a.phase !== 'ROLL' || s.pending || s.winner !== null || !myInput()) return [];
  const m = s.mechs[a.mechId], p = pix(m.pos), r = Math.max(13, S * 0.42), y = Math.max(r + 2, p.y - S * 0.15), dx = S * 1.22;
  return mustShutdown(m) ? [{ id: 'shutdown', x: p.x, y, r, title: 'Экстренное отключение (бросок невозможен: перегрев или нет кубов после сброса)' }]
    : [{ id: 'roll', x: p.x - dx, y, r, title: 'Бросок пилотирования' }, { id: 'shutdown', x: p.x + dx, y, r, title: 'Экстренное отключение (вместо броска)' }];
}
const btnAt = (pt) => pt && rollButtons().find((b) => Math.hypot(pt.x - b.x, pt.y - b.y) <= b.r + 2);
function drawRollButtons() {
  for (const b of rollButtons()) {
    const hot = hoverBtn === b.id, roll = b.id === 'roll';
    ctx.save(); ctx.shadowColor = '#0009'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + (hot ? 2 : 0), 0, 7); ctx.fillStyle = roll ? (hot ? '#43c966' : '#2fa84f') : (hot ? '#ee5555' : '#d63838'); ctx.fill(); ctx.restore();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 1;
    ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    if (roll) { const q = b.r * 0.55; ctx.beginPath(); ctx.roundRect(b.x - q, b.y - q, q * 2, q * 2, 4); ctx.stroke();
      for (const [ox, oy] of [[-0.45, -0.45], [0, 0], [0.45, 0.45]]) { ctx.beginPath(); ctx.arc(b.x + ox * q, b.y + oy * q, 2, 0, 7); ctx.fill(); } }
    else { const q = b.r * 0.5; ctx.beginPath(); ctx.arc(b.x, b.y + 1, q, -Math.PI * 0.32, Math.PI * 1.32, false); ctx.stroke(); ctx.beginPath(); ctx.moveTo(b.x, b.y - q - 2); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.lineCap = 'butt'; ctx.lineWidth = 1;
  }
}
function drawMech(m, act) {
  const p = pix(m.pos), d = toPixel(DIRS[m.facing]), L = Math.hypot(d.x, d.y), dead = m.status === 'disabled';
  ctx.globalAlpha = m.activated ? 0.5 : 1;   // only the body of a mech that has finished is dimmed
  ctx.beginPath(); ctx.arc(p.x, p.y, S * 0.62, 0, 7); ctx.fillStyle = dead ? '#777' : m.owner === 1 ? '#4a90e2' : '#e25555'; ctx.fill();
  ctx.strokeStyle = act && act.id === m.id ? '#f0b429' : '#111'; ctx.lineWidth = act && act.id === m.id ? 3 : 1.5; ctx.stroke(); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (d.x / L) * S * 0.95, p.y + (d.y / L) * S * 0.95); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(dead ? '✖' : m.cls[0].toUpperCase(), p.x - 2, p.y + 1);
  ctx.globalAlpha = 1;
  const dur = CLASSES[m.cls].durability;
  for (let i = 0; i < dur; i++) { ctx.fillStyle = i < m.damage ? '#ff2d2d' : '#222'; ctx.fillRect(p.x - dur * 3 + i * 6, p.y + S * 0.72, 5, 5); }
  const ev = evadeOf(m);                                   // two aligned columns: left overheat/anchor, right evade/virtual evade
  if (m.overheat) drawToken(TOK.overheat, p.x - 20, p.y - 10, m.overheat);
  if (m.anchor) drawToken(TOK.anchor, p.x - 20, p.y + 10, m.anchor);
  if (m.blind) drawToken(TOK.blind, p.x - 20, p.y + 30, m.blind);
  if (ev.evade) drawToken(TOK.evade, p.x + 20, p.y - 10, ev.evade);
  if (ev.virtual) drawToken(TOK.virtual, p.x + 20, p.y + 10, ev.virtual);
  const sys = ['control', 'armor', 'cooling'].filter((k) => m.crits[k] > 0);       // critical damage badges above the mech, 3 levels per system
  sys.forEach((k, i) => drawCrit(k, m.crits[k], p.x + (i - (sys.length - 1) / 2) * 19, p.y - S * 0.98));
  ctx.globalAlpha = 1;
}

// ---- the dice window in the middle of the field
//  while the player can correct a shot: weapon dice with a 🔄 button (and the number of corrections left) over each die;
//  afterwards: a read-only summary (weapon dice → armor dice → damage dice) that never blocks the field and goes away on its own
// the window opens beside the target (about two hexes away, on the side away from the attacker) so it never covers the mech; once dragged it stays where the player put it
let diceMoved = false, diceAnchor = null;   // diceAnchor: where the window was put for the current shot (it keeps its top-left corner while it changes size)
function placeDice() {
  const box = $('dice').querySelector('.dicebox'); if (!box || diceMoved) return;
  const s = st(), id = s.activation?.attack?.targetId ?? lastShot?.targetId, tg = id && targetOf(s, id); if (!tg) return;
  const stage = $('stage').getBoundingClientRect(), cvr = $('cv').getBoundingClientRect(), k = cvr.width / $('cv').width;
  const T = pix(tg.pos), tx = cvr.left - stage.left + T.x * k, ty = cvr.top - stage.top + T.y * k;
  const am = s.activation && s.mechs[s.activation.mechId], ax = am ? cvr.left - stage.left + pix(am.pos).x * k : tx - 1;
  const ay = am ? cvr.top - stage.top + pix(am.pos).y * k : ty;
  const w = box.offsetWidth, h = box.offsetHeight, gap = 2 * Math.sqrt(3) * S * k, W = stage.width, H = stage.height;
  const cy = Math.min(Math.max(ty - h / 2, 4), Math.max(4, H - h - 4)), cx = Math.min(Math.max(tx - w / 2, 4), Math.max(4, W - w - 4));
  const R = { l: tx + gap, t: cy }, L = { l: tx - gap - w, t: cy }, D = { l: cx, t: ty + gap }, U = { l: cx, t: ty - gap - h };
  const cand = (ax <= tx ? [R, L, D, U] : [L, R, D, U]);                         // away from the attacker first
  const fits = (c) => c.l >= 4 && c.t >= 4 && c.l + w <= W - 4 && c.t + h <= H - 4;
  const hitsAtk = (c) => ax > c.l - 28 && ax < c.l + w + 28 && ay > c.t - 28 && ay < c.t + h + 28;     // do not cover the attacker either
  const pick = diceAnchor && diceAnchor.seq === shotSeq ? diceAnchor : cand.find((c) => fits(c) && !hitsAtk(c)) ?? cand.find(fits) ?? cand[0];
  diceAnchor = { l: pick.l, t: pick.t, seq: shotSeq };
  const left = Math.min(Math.max(pick.l, 4), Math.max(4, W - w - 4)), top = Math.min(Math.max(pick.t, 4), Math.max(4, H - h - 4));
  dicePos = { x: Math.round(left + w / 2 - W / 2), y: Math.round(top + h / 2 - H / 2) };
  box.style.transform = `translate(${dicePos.x}px,${dicePos.y}px)`;
}
let shotSeq = 0, fold = {};       // fold: sections the player has opened / closed by hand (reset with every new shot)
const isOpen = (key, auto) => (key in fold ? fold[key] : auto);
const foldHead = (key, open, title, sum) => `<div class="fold" data-fold="${key}" title="свернуть / развернуть">${open ? '▾' : '▸'} <b>${title}</b>${open ? '' : ` <span class="fsum">${sum}</span>`}</div>`;
const turnPoints = (shots) => shots.reduce((n, x) => n + (x.faces.missile ?? []).filter((i) => MISSILE_DIE[i].dmg === 0 || MISSILE_DIE[i].srm).length, 0);
// The unified shot window. One layout for the whole shot, filled from the top as the shot goes on:
//   header (target + what we are waiting for) → weapons (missile group first, then single weapons) → total line → armor → damage dice → decision zone
function renderDice() {
  const s = st(), a = s.activation, el = $('dice'), p = s.pending, corr = !!(a && a.attack);
  if (!corr && !lastShot) { el.innerHTML = ''; return; }
  const L = lastShot, A = corr ? a.attack : null, tid = corr ? A.targetId : L.targetId, m = a && s.mechs[a.mechId];
  const tgt = targetOf(s, tid), tcls = tgt && !tgt.isBuilding ? CLASSES[tgt.cls].armor : null;
  // ---- the shots of the window in one shape
  let shots, evCuts, amsEv, br = null;
  if (corr) {
    br = volleyBreakdown(s); evCuts = br.events.filter((e) => e.type === 'evade_cut'); amsEv = br.events.filter((e) => e.type === 'ams');
    shots = A.shots.map((sh, si) => { const w = WEAPONS[wtype(m, sh.wid)]; return { si, name: esc(wname(wtype(m, sh.wid))), sub: w.sub ?? null, faces: sh.rolls, dist: sh.dist, left: correctionsLeft(s, a, m, tgt, w) }; });
  } else { evCuts = L.evCuts ?? []; amsEv = L.ams ?? []; shots = L.shots; }
  const total = corr ? { dmg: br.dmg, unb: br.unb } : (() => { const raw = L.shots.reduce((n, x) => n + (x.miss ? 0 : x.damage), 0), cut = evCuts.reduce((n, x) => n + x.cut, 0) + amsEv.reduce((n, x) => n + x.cut, 0); return { dmg: Math.max(0, raw - cut), unb: L.shots.reduce((n, x) => n + (x.unblockable ?? 0), 0) }; })();
  const dice = (x) => Object.entries(x.faces).flatMap(([k, v]) => v.map((f, i) => ({ k, f, i })));
  const shotHtml = (x) => corr
    ? `<div class="wgrp"><div class="dhead">${x.name} · дист ${x.dist}</div><div class="drow">${dice(x).map((d) => `<div class="d">${x.left ? `<button data-die="${x.si}:${d.k}:${d.i}" title="Корректировка: переброс этого куба">🔄 ${x.left}</button>` : '<span class="ph"></span>'}<img src="${img(WIMG[d.k](d.f))}" alt=""></div>`).join('')}</div></div>`
    : `<div class="wgrp"><div class="dhead">${x.name}</div><div class="drow">${dice(x).map((d) => `<div class="d"><img src="${img(WIMG[d.k](d.f))}" alt=""></div>`).join('')}</div><div class="dres">${shotResult(x)}${x.turns ? ` · поворот до ${x.turns}×60°` : ''}</div></div>`;
  const rawOf = (x) => (x.miss ? 0 : x.damage);
  const groupHtml = (sub, mem) => {                                    // a missile group: launchers, then the one cut chain of the whole group
    const ev = evCuts.find((e) => e.sub === sub), am = amsEv.find((e) => e.sub === sub);
    const raw = corr ? br.results.filter((r) => r.sub === sub).reduce((n, r) => n + r.dmg, 0) : mem.reduce((n, x) => n + rawOf(x), 0);
    const net = Math.max(0, raw - (ev?.cut ?? 0) - (am?.cut ?? 0));
    const pts = sub === 'lrm' ? turnPoints(mem) : 0, rating = sub === 'lrm' && tgt && !tgt.isBuilding ? rankOf(tgt) + (am?.devices ?? A?.ams?.lrm?.devices ?? 0) : 0;
    return `<div class="wgrp grp"><div class="dhead">${sub.toUpperCase()} ×${mem.length}</div>${mem.map(shotHtml).join('')}`
      + `<div class="chain">Σ ${raw}${ev ? ` → ${mini('tok_evade', 'evade', 'pi')} ${ev.tokens}${ev.ignored ? ` (−${ev.ignored} игнор)` : ''}: −${ev.cut}` : ''}${am ? ` → AMS: −${am.cut}` : ''} = <b>${net}</b></div>`
      + (am ? amsRow(am, `AMS vs ${sub.toUpperCase()}`) : '')
      + (sub === 'lrm' && pts ? `<div class="chain">поворот: ${pts} ÷ ${rating} → ${Math.floor(pts / Math.max(1, rating))} × 60°</div>` : '') + '</div>';
  };
  const order = ['lrm', 'srm'], groups = order.filter((k) => shots.some((x) => x.sub === k)), singles = shots.filter((x) => !order.includes(x.sub));
  const weaponsInner = `<div class="wcol">${groups.map((k) => groupHtml(k, shots.filter((x) => x.sub === k))).join('')}${singles.map(shotHtml).join('')}</div>`;
  const wSum = [...groups.map((k) => { const mem = shots.filter((x) => x.sub === k); return `${k.toUpperCase()} ×${mem.length}`; }), ...singles.map((x) => `${x.name}${corr ? '' : x.miss ? ' ✖' : ' ' + x.damage}`)].join(' · ');
  // ---- stage
  const hasArmor = !!(L && L.armor), hasBld = !!(L && L.building), dmgDice = !corr && L ? (p && p.type === 'TC_REROLL' ? p.faces.map((i) => DAMAGE_DIE[i]) : L.damage) : [];
  const tcFaces = !corr && p && p.type === 'TC_REROLL' && p.targetId === tid;
  const mine = !corr && p && p.targetId === tid && ['OS_DECISION', 'DEFENDER_DECISION', 'TC_REROLL', 'TURN_TARGET'].includes(p.type) ? p : null;
  const status = corr ? 'корректировка' : mine ? { OS_DECISION: `ждём игрока ${p.player}: Omni Shield`, DEFENDER_DECISION: `ждём игрока ${p.player}: принять урон или катапульта`, TC_REROLL: `ждём игрока ${p.player}: переброс TC`, TURN_TARGET: `ждём игрока ${p.player}: разворот цели` }[p.type] : 'завершено';
  let h = `<div class="dicebox${corr ? '' : ' res'}" style="transform:translate(${dicePos.x}px,${dicePos.y}px)"><div class="dhead dgrab" title="потяни, чтобы переместить окно">⠿ → ${name(tid)} <span class="dstat">· ${status}</span></div>`;
  const wOpen = isOpen('w', !hasArmor && !hasBld);
  h += (corr ? '' : foldHead('w', wOpen, 'Оружие', wSum)) + (corr || wOpen ? weaponsInner : '');
  const totLine = `урон по цели: <b>${total.dmg}</b>${total.unb ? ` (+${total.unb} без брони)` : ''}`;
  h += `<div class="dtotal">${corr ? 'ожидаемый ' : ''}${totLine}</div>`;
  if (!corr && hasBld) h += `<div class="dsub">Здание: урон ${L.building.damage} · ${L.building.destroyed ? 'разрушено → ' + (L.building.becomes === 'fire' ? 'огонь' : 'камни') : 'устояло (осталось ' + L.building.left + ')'}</div>`;
  if (!corr && hasArmor) {
    const ar = L.armor, aOpen = isOpen('a', !dmgDice.length);
    h += foldHead('a', aOpen, `Броня (${ar.rear ? 'тыл' : 'фронт'})`, `поглощено ${ar.absorbed}, прошло ${ar.through}`)
      + (aOpen ? `<div class="dsub">поглощено ${ar.absorbed}${ar.bonus ? ` (в т.ч. бонус ${ar.bonus})` : ''} · прошло ${ar.through}</div><div class="drow sm">${ar.faces.map((f, k) => `<div class="d"><img class="${ar.rolls[k] < tcls[f].v ? 'dim' : ''}" src="${img(ARMOR_IMG(f))}" alt="" title="${ar.rolls[k]}"></div>`).join('')}</div>` : '');
  }
  if (!corr && dmgDice.length) h += `<div class="dsub">Кубы урона${tcFaces ? ' — клик по кубу: переброс TC' : ''}</div><div class="drow sm">${dmgDice.map((f, i) => `<div class="d">${tcFaces ? `<button data-tc="reroll:${i}" style="margin:0;padding:0;border:0;background:none"><img src="${img(DMG_IMG[f])}" alt="" title="${FACE[f]}"></button>` : `<img src="${img(DMG_IMG[f])}" alt="" title="${FACE[f]}">`}</div>`).join('')}</div>`;
  // ---- the decision zone: always the last thing in the window
  h += '<div class="dzone">';
  if (corr) h += `<button data-do="resolve">✔ Завершить выстрел (урон ${total.dmg + total.unb}${total.unb ? `, из них без брони ${total.unb}` : ''})</button>`;
  else if (mine && mine.type === 'OS_DECISION') h += `<div class="dsub">Активировать <b>Omni Shield</b>: +1 ЕБ и +1 ${mini(TOK.overheat, 'overheat', 'pi')}?</div><button data-tc="use">🛡 Активировать OS</button><button data-tc="skip">Не активировать</button>`;
  else if (mine && mine.type === 'DEFENDER_DECISION') h += `<div class="dsub">${name(mine.targetId)} получает ${mine.dice} куб. урона</div><button data-do="take">Принять урон</button><button data-do="eject">Катапультироваться</button>`;
  else if (mine && mine.type === 'TC_REROLL') h += '<button data-tc="keep">Оставить как есть</button>';
  else if (mine && mine.type === 'TURN_TARGET') h += `<div class="dsub"><b>Повернуть цель</b> (до ${mine.turns} × 60°)</div>${turnButtons(mine)}`;
  else if (!p) h += '<button data-do="closeres">Закрыть</button>';
  h += '</div></div>';
  el.innerHTML = h;
  placeDice();
}

// ---- side panel
const chip = (p) => `<span class="chip ${p.spent ? 'spent' : ''} ${sel.has(p.id) ? 'sel' : ''} ${p.origin === 'converted' ? 'conv' : ''}" data-chip="${p.id}"><img src="${img(p.color + (p.evade ? '_e' : ''))}" alt="${p.color}" title="${p.color}${p.evade ? ' + evade' : ''}"></span>`;
const colorBtn = (c, attrs) => `<button ${attrs}><img src="${img(c)}" alt="${c}" title="${c}"></button>`;
const costIcons = (def) => def.payWith ? `<b>(${def.moveCost} ДД)</b>` : def.pips.map((c) => mini(c, c, 'pi')).join('');
const TURN_LAB = { none: 'Не поворачивать', 'L:1': '↺ 60°', 'L:2': '↺ 120°', 'L:3': '↺ 180°', 'R:1': '↻ 60°', 'R:2': '↻ 120°', 'R:3': '↻ 180°', 'flip:4': '180° + 1 урон без брони', 'flip:5': '180° + 2 урона без брони' };
const turnButtons = (p) => p.options.map((o) => `<button data-tc="${o}">${TURN_LAB[o]}</button>`).join('');
function panel() {
  const s = st(), a = s.activation, p = s.pending, m = a && s.mechs[a.mechId];
  let h = (flashMsg ? `<div class="box flash">✖ ${esc(flashMsg)}</div>` : '') + '<div class="box">';
  $('roundbar').innerHTML = `<b>Раунд ${s.round}</b> · класс <b>${className(s.turn.rank)}</b> · ходит <span class="p${s.turn.player}">игрок ${s.turn.player}</span>${netStatus()}`;
  $('panel').classList.toggle('locked', !myInput());
  if (s.winner !== null) h += `<b>Игра окончена: ${s.winner ? 'победил игрок ' + s.winner : 'ничья'}</b>`;
  else if (p && lastShot && p.targetId === lastShot.targetId && ['OS_DECISION', 'DEFENDER_DECISION', 'TC_REROLL', 'TURN_TARGET'].includes(p.type)) h += `<span class="p${p.player}">Игрок ${p.player}</span>: ждём решения — ${{ OS_DECISION: 'Omni Shield', DEFENDER_DECISION: 'принять урон или катапульта', TC_REROLL: 'переброс TC', TURN_TARGET: 'разворот цели' }[p.type]} (в окне выстрела).`;
  else if (p && p.type === 'TC_REROLL') h += `<span class="p${p.player}">Игрок ${p.player}</span>: TC — кубы урона по ${name(p.targetId)}. Перебросить один?<br>${p.faces.map((f, i) => `<button data-tc="reroll:${i}">↻ ${mini(DMG_IMG[DAMAGE_DIE[f]], '', 'pi')} ${FACE[DAMAGE_DIE[f]]}</button>`).join('')}<br><button data-tc="keep">Оставить как есть</button>`;
  else if (p && p.type === 'TURN_TARGET') {
    h += `<span class="p${p.player}">Игрок ${p.player}</span>: можно повернуть ${name(p.targetId)} (до ${p.turns} × 60°).<br>` + (lastShot ? '<small>Варианты — в окне выстрела.</small>' : turnButtons(p));
  }
  else if (p && p.type === 'OS_DECISION') h += `<span class="p${p.player}">Игрок ${p.player}</span>: по ${name(p.targetId)} будет бросок брони (урон ${p.hit.damage}). Активировать <b>Omni Shield</b>: +1 ЕБ и +1 ${mini(TOK.overheat, 'overheat', 'pi')}?<br><button data-tc="use">🛡 Активировать OS</button><button data-tc="skip">Не активировать</button>`;
  else if (p) h += `<span class="p${p.player}">Игрок ${p.player}</span>: ${name(p.targetId)} получает ${p.dice} куб. урона.<br><button data-do="take">Принять урон</button><button data-do="eject">Катапультироваться</button>`;
  else if (!a) h += 'Кликни по подсвеченному меху, чтобы начать активацию.';
  else {
    h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span><b>${name(m.id)}</b> (скорость ${esc(m.speed)})</span><span>${g.canUndo() ? '<button data-do="undo" style="margin:0 4px 0 0">↶ Отменить</button>' : ''}${a.phase === 'PLAY' && !a.attack ? '<button data-do="end" style="margin:0">✔ Закончить активацию</button>' : ''}</span></div>`;
    if (a.phase === 'ROLL') h += mustShutdown(m) ? '<br><b>Перегрев:</b> нужно экстренное отключение — красная кнопка на токене меха.' : '<br>Кнопки на токене меха: <span style="color:#2fa84f"><b>зелёная</b></span> — бросок пилотирования, <span style="color:#d63838"><b>красная</b></span> — экстренное отключение.';
    if (a.phase === 'DISCARD') h += `<br>Сбросьте кубов: <b>${a.mustDiscard}</b> (выбери и нажми)<button data-do="discard" ${sel.size === a.mustDiscard ? '' : 'disabled'}>Сбросить</button>`;
    if (a.pool.length) h += '<div>' + a.pool.map(chip).join('') + '</div>';
    if (a.phase === 'PLAY' && a.attack) {      // fire correction window (the dice themselves are in the middle of the field)
      const A = a.attack;
      const per = A.shots.map((sh, i) => { const w = WEAPONS[wtype(m, sh.wid)]; return { i, w, left: correctionsLeft(s, a, m, targetOf(s, A.targetId), w) }; });
      h += `<div><b>Корректировка огня</b>${a.ccUsed ? ' (CC использован)' : ''}. Корректировка стоит те же кубы, что и активация оружия. Клик 🔄 над кубом оружия — переброс. Если нужного цвета нет, CC заменит один куб: сначала выбери его в пуле.<br>
        ${!RULES.ignoreEvadeCorrection ? '' : per.map((x) => `<button data-do="ignore:${x.i}" ${x.left ? '' : 'disabled'}>Игнор evade: ${esc(wname(wtype(m, A.shots[x.i].wid)))} (осталось ${x.left}; ${x.w.pips.map((c) => mini(c, c, 'pi')).join('')})</button>`).join('')}<button data-do="resolve">✔ Завершить выстрел (урон ${(() => { const v = volleyDamage(s, a); return v.dmg + v.unb; })()})</button></div>`;
    } else if (a.phase === 'PLAY') {
      const nm = [...sel].filter((id) => a.pool.find((x) => x.id === id && x.color === 'move')).length;
      const ab = CLASSES[m.cls].abilities, jjLeft = (m.equipment.jumpjets ?? 0) - a.jumpsUsed;
      const kinds = Object.entries(CONVERSIONS).filter(([, c]) => (!c.limit || (ab[c.limit] ?? 0) > (a.conv[c.limit] ?? 0)) && (!c.equipment || (m.equipment[c.equipment] && !a.tcUsed)));
      h += `<div>Замены (выбери кубы; можно сразу несколько — конвертируются пачкой): ${kinds.map(([k, c]) => `<button data-conv="${k}" class="${conv === k ? 'on' : ''}" ${convUseful(k, c) ? '' : 'disabled'}>${CONV_LABEL[k]}${c.limit ? ' (' + ((ab[c.limit] ?? 0) - (a.conv[c.limit] ?? 0)) + ')' : ''}</button>`).join('')}`;
      if (conv) h += '<br>в: ' + (CONVERSIONS[conv].to ?? COLORS).map((c) => colorBtn(c, `data-to="${c}" ${ok({ type: 'CONVERT', kind: conv, pipIds: [...sel], to: c }) ? '' : 'disabled'}`)).join('');
      h += `</div><div>Действий движения: <b>${actionsAvailable(m, a)}</b> · move-кубов в запасе ${a.movePips}<br><button data-do="commit" ${moveCommit(m, a).gain ? '' : 'disabled'} title="все полезные кубы move станут действиями движения; лишний куб, не дающий ДД, не тратится">Получить ${moveCommit(m, a).gain} ДД</button>
        ${m.equipment.masc ? `<button data-do="masc" ${!a.masc && firstMove() ? '' : 'disabled'} title="заберёт первый свободный куб move: он даст 2 ДД и 1 тепло; один раз за активацию">+2 ДД за move: MASC (+1🌡)${a.masc ? ' ✔' : ''}</button>` : ''}
        <button data-do="vev" ${ok({ type: 'VIRTUAL_EVADE' }) ? '' : 'disabled'}>${mini(TOK.virtual, 'virtual evade', 'pi')} (${2 + (m.anchor > 0 ? 1 : 0)} ДД)</button>
        
        ${(m.equipment.jumpjets ?? 0) > 0 ? `<br><button data-do="jumpmode" class="${jumpMode ? 'on' : ''}" ${jjLeft > 0 && jumpPip() ? '' : 'disabled'} title="${jjLeft > 0 ? 'нужен куб ⇧ (можно получить заменой)' : 'прыжковые двигатели уже использованы'}">⇧ Прыжок (двигателей: ${Math.max(0, jjLeft)})</button>${jumpMode ? ' <small>выбери соседний голубой гекс или свой (прыжок на месте) · 2🌡, +1 virtual evade</small>' : ''}` : ''}</div>
        ${m.equipment.ga ? `<div>GA (радиус → ${mini(TOK.overheat, 'overheat', 'pi')}, все в радиусе получают ${mini(TOK.anchor, 'anchor', 'pi')}):<br>${Array.from({ length: RULES.gaMaxRadius }, (_, i) => `<button data-ga="${i + 1}" ${a.gaUsed ? 'disabled' : ''}>${i + 1}</button>`).join('')}${a.gaUsed ? ' ✔' : ''}</div>` : ''}
        <div>Оружие:<br>${m.weapons.map((w) => `<button data-w="${w.id}" class="${armed.includes(w.id) ? 'on' : ''}" ${a.fired.includes(w.id) || (!armed.includes(w.id) && !canPay(m, a, w.id)) ? 'disabled' : ''} title="${canPay(m, a, w.id) ? '' : 'не хватает кубов пилотирования'}">${a.fired.includes(w.id) ? '✔ ' : ''}${esc(wname(w.type))} ${costIcons(WEAPONS[w.type])}</button>`).join('')}
        ${m.equipment.tc ? `<br><small>TC ${a.tcUsed ? 'использован' : 'готов: подойдёт куб любого цвета для одной атаки'}</small>` : ''}</div>
        <div>Таран:<br>
          <button data-ram="move" class="${ramMode === 'move' ? 'on' : ''}" ${a.ramUsed ? 'disabled' : ''}>Таран (${2 + ramExtra + (m.anchor > 0 ? 1 : 0)} ДД)</button>
          ${(m.equipment.jumpjets ?? 0) > 0 ? `<button data-ram="jump" class="${ramMode === 'jump' ? 'on' : ''}" ${a.ramUsed || a.pool.filter((p) => !p.spent && p.color === 'jumpjet').length < 2 + ramExtra ? 'disabled' : ''}>Таран с JJ (${2 + ramExtra} ⇧)</button>` : ''}
          доп.: <button data-ramx="-1" ${ramExtra > 0 ? '' : 'disabled'}>−</button> <b>${ramExtra}</b> <button data-ramx="1" ${ramExtra < 4 ? '' : 'disabled'}>+</button>
          ${ramMode ? '<br><small>выбери соседнего врага (оранжевая рамка)</small>' : ''}</div>
        `;
    }
  }
  $('panel').innerHTML = h + `</div>${g.canUndo() && !(a && !p && s.winner === null) ? '<div><button data-do="undo">↶ Отменить</button></div>' : ''}`;
}

// ---- mech specification card: the hovered mech, otherwise the one that is activating
const items = (rows) => `<ul class="items">${rows.map((r) => `<li class="${r.state === 'used' ? 'used' : ''}"><span class="nm">${r.html}</span>${r.badge ? `<span class="b ${r.state}">${r.badge}</span>` : ''}</li>`).join('')}</ul>`;
function mechCard(m) {
  const s = st(), a = s.activation, on = a && a.mechId === m.id ? a : null;          // "used" marks exist only for the mech that is activating
  const cap = heatCapacity(m), segs = Math.max(8, cap), gen = on ? heatGenerated(on) : 0, ev = evadeOf(m), dur = CLASSES[m.cls].durability, eq = m.equipment;
  const bar = Array.from({ length: segs }, (_, i) => `<i class="${i < cap ? 'cap' : ''} ${i < gen ? (i < cap ? 'fill' : 'over') : ''}"></i>`).join('');
  const weapons = m.weapons.map((w) => {
    const def = WEAPONS[w.type], fired = on?.fired.includes(w.id), paid = !fired && on && Object.values(on.mass).some((x) => x.weapons.includes(w.id));
    const badge = fired ? 'задействовано' : paid ? 'оплачено' : on ? 'готово' : '';
    return { state: fired ? 'used' : on ? 'ready' : '', badge, html: `<b>${esc(wname(w.type))}</b> ${costIcons(def)} <small>${def.minRange}–${def.maxRange} гекс.</small>` };
  });
  const gear = [{ state: 'passive', badge: 'активно', html: `Охладители <b>${COOLER_RU[m.coolers] ?? m.coolers}</b> <small>ёмкость ${cap}, остывает на ${m.coolers === 'double' ? 2 : 1}</small>` }];
  for (let i = 0; i < (eq.jumpjets ?? 0); i++) gear.push({ state: on ? (i < on.jumpsUsed ? 'used' : 'ready') : '', badge: on ? (i < on.jumpsUsed ? 'задействовано' : 'готово') : '', html: `<b>${esc(eq.jjNames?.[i] ?? 'JJ')}</b> <small>1 куб ⇧ = 1 прыжок</small>` });
  if (eq.masc) gear.push({ state: on ? (on.masc ? 'used' : 'ready') : '', badge: on ? (on.masc ? 'задействовано' : 'готово') : '', html: '<b>MASC</b> <small>1 move = 2 ДД, +1🌡</small>' });
  if (eq.cc) gear.push({ state: on ? (on.ccUsed ? 'used' : 'ready') : '', badge: on ? (on.ccUsed ? 'задействовано' : 'готово') : '', html: '<b>CC</b> <small>любой куб → цвет для корректировки</small>' });
  if (eq.tc) gear.push({ state: on ? (on.tcUsed ? 'used' : 'ready') : '', badge: on ? (on.tcUsed ? 'задействовано' : 'готово') : '', html: '<b>TC</b> <small>смена типа атаки / переброс куба урона</small>' });
  if (eq.ecm) gear.push({ state: 'passive', badge: 'активно', html: '<b>ECM</b> <small>+1 virtual evade</small>' });
  if (eq.ams) gear.push({ state: 'todo', badge: 'без эффекта', html: `<b>AMS</b>${eq.ams > 1 ? ' ×' + eq.ams : ''}` });
  if (eq.os) gear.push({ state: 'passive', badge: 'готов', html: '<b>OS</b> <small>до броска брони: +1 ЕБ, +1 overheat; раз за вражескую активацию</small>' });
  if (eq.ga) gear.push({ state: on ? (on.gaUsed ? 'used' : 'ready') : '', badge: on ? (on.gaUsed ? 'задействовано' : 'готово') : '', html: '<b>GA</b> <small>anchor всем в радиусе; радиус = overheat</small>' });
  const crits = Object.entries(m.crits).filter(([, n]) => n > 0);
  const tok = (name, label, n) => (n ? `<span title="${label}">${mini(TOK[name], label, 'tk')}<b>${n}</b></span>` : '');
  const tokens = [tok('overheat', 'overheat', m.overheat), tok('evade', 'evade', ev.evade), tok('virtual', 'virtual evade', ev.virtual), tok('anchor', 'anchor', m.anchor), tok('blind', 'blind: −2 к макс. дальности за жетон', m.blind)].join('');
  return `<div class="mc"><h4><span class="p${m.owner}">${esc(m.name)}</span>${m.status === 'disabled' ? '<span class="tag">выведен из строя</span>' : m.activated ? '<span class="tag">ходил</span>' : ''}${on ? '<span class="tag">активация</span>' : ''}</h4>
    <div class="kv"><span>Класс</span><span>${CLS_RU[m.cls]}</span>
    <span>Броня</span><span>${m.armorClass} куб. <small>(тыл: 2)</small></span>
    <span>Скорость</span><span>${esc(m.speed)}</span>
    <span>Теплоёмкость</span><span><div class="hbar" title="закрашено: тепло, набранное в этой активации; красное — сверх ёмкости (станет жетонами overheat)">${bar}</div><small>${on ? `набрано ${gen} из ${cap}${gen > cap ? ` → +${gen - cap} overheat` : ''}` : `ёмкость ${cap}`} · жетонов overheat: ${m.overheat}/6</small></span>
    <span>HP</span><span><div class="hp">${Array.from({ length: dur }, (_, i) => `<i class="${i < m.damage ? 'f' : ''}"></i>`).join('')}<i class="last ${m.damage > dur ? 'f' : ''}" title="уничтожен, когда повреждений больше ${dur}">☠</i></div><small>повреждений ${m.damage} из ${dur}</small></span></div>
    ${crits.length ? `<div class="sec">Критические повреждения</div>${items(crits.map(([k, n]) => ({ state: '', badge: n >= 3 ? 'выведен из строя' : '', html: `${mini(SYS_IMG[k], SYS_RU[k], 'pi')} <b>${SYS_RU[k]}</b> ×${n} <small>${SYS_EFFECT[k]}</small>` })))}` : ''}
    ${tokens ? `<div class="sec">Жетоны</div><div class="toks">${tokens}</div>` : ''}
    <div class="sec">Вооружение</div>${weapons.length ? items(weapons) : '<small>нет</small>'}
    <div class="sec">Оборудование</div>${items(gear)}</div>`;
}
function renderMech() {
  const s = st(), id = hoverMechId ?? s.activation?.mechId, m = id && s.mechs[id];
  $('mech').innerHTML = m && (m.status === 'active' || m.status === 'disabled') ? mechCard(m) : '<small>Наведи на мех или начни активацию — здесь будет его спецификация.</small>';
}

// ---- hover: hex properties
function describeCell(c) {
  const t = TERRAIN[c.terrain], L = [];
  if (t.moveExtra) L.push(`вход стоит на ${t.moveExtra} действие движения больше`);
  if (t.armor) L.push(`+${t.armor} ЕБ меху в этом гексе`);
  if (t.fire) L.push('стрельба сквозь огонь: +1 virtual evade цели и −1 дальность лазеров за каждый гекс огня на линии; цель, стоящая в огне, получает +1 virtual evade', '+1 overheat при входе, старте активации и появлении огня');
  if (t.extraCool) L.push(`контроль нагрева: −1 дополнительный ${mini('tok_overheat', 'overheat', 'pi')}`, `лазеры по меху здесь: −${t.waterLaser} дальности за каждый ${mini('tok_overheat', 'overheat', 'pi')}`);
  if (t.forbidClass) L.push('легкие мехи не могут занимать гекс');
  if (t.blocksMove) L.push('движение невозможно', 'закрывает линию огня');
  if (t.hp) L.push(`прочность ${t.hp} (при разрушении — камни или огонь)`); else if (t.indestructible) L.push('неразрушимо');
  if (c.cover) L.push(`укрытие/обломки размера ${c.cover}`);
  return `<span class="sw" style="background:#${t.color}"></span><b>${TNAME[c.terrain]}</b> <small>(${c.col},${c.row} · до края ${c.edge})</small>${L.length ? '<ul style="margin:4px 0 0;padding-left:18px">' + L.map((x) => `<li>${x}</li>`).join('') + '</ul>' : '<br><small>особых свойств нет</small>'}`;
}
const BAND_RU = { short: 'ближняя', medium: 'средняя', long: 'дальняя', out: 'ВНЕ ДАЛЬНОСТИ' };
const ARMOR_PART = { target: 'гекс цели', line: 'на линии', nearer: 'Атака не в ближайшего видимого врага' };
// the common part of the aiming tooltip: distance, side and armor dice of the target, its owner, and the armor bonuses that apply to EVERY weapon of the volley
function aimHeader(hm, p) {
  if (hm.isBuilding) return `<b>Выстрел</b> → Дист. ${p.dist} · Здание (4 урона одной атакой)`;
  const rear = p.side === 'rear', dice = rear ? 2 : hm.armorClass;
  const src = (x) => x.terrain ? `<span class="sw" style="background:#${TERRAIN[x.terrain].color}" title="${esc(TNAME[x.terrain])}${x.where === 'line' ? ' на линии' : ' в гексе цели'}: +${x.n}"></span>${x.n > 1 ? '×' + x.n : ''}` : mini('icon_nearer', ARMOR_PART.nearer, 'pi');
  const bonus = p.armor.total ? ` · +${p.armor.total}${mini('icon_armor', 'бонус брони', 'pi')} (${p.armor.parts.map(src).join(' ')})` : '';
  return `<b>Выстрел</b> → Дист. ${p.dist} · ${rear ? 'Rear' : 'Front'} ${dice} · <span class="p${hm.owner}">${esc(hm.name)}</span>${bonus}`;
}
const bandTxt = (p) => `<b style="color:${p.band === 'out' ? '#e25555' : 'inherit'}">${BAND_RU[p.band]}</b>`;
const fireSw = (k) => `<span class="sw" style="background:#${TERRAIN.fire.color}" title="Огонь: ${k} гекс."></span>${k > 1 ? '×' + k : ''}`;
const jjLine = (p) => p.jj > 0 ? `<p class="jjl">${mini('jumpjet', 'прыжковые двигатели', 'pi')} <b>JJ:</b> гексы на R${p.jj} игнорируются (кроме цели и соседних с ней гексов)</p>` : '';
// one weapon group of the aiming tooltip: name ×n, ✔, the pilot dice that will pay for it (missing ones struck out, with the penalty heat), then range / modifiers
function weaponBlock(p, n, slots, heat) {
  const dice = slots.map((s) => s.ok ? mini(s.color, 'куб пилотирования', 'pi') : `<span class="dxs">${mini(s.color, 'куба не хватает', 'pi')}</span>`).join('');
  const bad = p.error && !/range/.test(p.error) ? ` <span style="color:#e25555">✖ ${esc(p.error)}</span>` : '';
  let head = `<b>${esc(p.name)}${n > 1 ? ' ×' + n : ''}</b>${p.ok ? ' <span style="color:#4caf50">✔</span>' : bad} ${dice}${heat ? ` <b>+${heat}</b>${mini('tok_overheat', 'штрафное тепло', 'pi')}` : ''}${p.sub === 'lrm' ? ' <small>(навесом: влияют только первый гекс и гекс перед целью)</small>' : ''}`;
  let body;
  if (p.laserReach) {
    const mods = p.reachMods.map((x) => /огонь/.test(x.what) ? `−${x.n} ${fireSw(x.n)}` : `−${x.n} ${esc(x.what)}`).join(', ');
    body = `Макс. дальность <b style="color:${p.band === 'out' ? '#e25555' : 'inherit'}">${p.maxRange}</b>${p.band === 'out' ? '' : ' (' + BAND_RU[p.band] + ')'}${mods ? ` (${mods})` : ''}`;
  } else if (p.sub) {
    const ams = (img) => p.amsDice ? ` · AMS: ${p.amsDice} ${mini(img, 'кубы AMS (баллистика)', 'pi')}${p.sub === 'lrm' ? `, класс для поворота +${p.amsDevices}` : ''}` : '';
    const fireTxt = p.fire ? ' ' + fireSw(p.fire) : '';
    if (p.sub === 'srm') {                                          // SRM: only the tokens that actually cut the damage (close range already took 1 off)
      const tok = [p.evade ? `${p.evade}${mini('tok_evade', 'evade', 'pi')}` : '', p.virt ? `${p.virt}${mini('tok_virtual_evade', 'virtual evade', 'pi')}` : ''].filter(Boolean);
      head += tok.length ? ` (${tok.join(' ')})` : '';
      body = `Дальность ${p.eff} (${bandTxt(p)})${tok.length ? ` · ${tok.join('+')}${fireTxt} вычитаются из урона ракет` : ''}${ams('w_ballistic_1damage')}`;
    } else body = `Дальность ${p.eff} (${bandTxt(p)})<br>${p.evade}${mini('tok_evade', 'evade', 'pi')}+${p.virt}${mini('tok_virtual_evade', 'virtual evade', 'pi')}${p.fire ? ' (' + fireSw(p.fire) + ')' : ''} вычитаются из урона ракет${ams('w_ballistic_0damage')}`;
  } else {
    const mods = p.rangeMods.map((x) => x.what.startsWith('virtual') ? `+${x.n} ${mini('tok_virtual_evade', x.what, 'pi')}${p.fire ? ` (${fireSw(p.fire)})` : ''}` : x.what === 'evade' ? `+${x.n} ${mini('tok_evade', 'evade', 'pi')}` : `+${x.n} ${esc(x.what)}`).join(' ');
    body = `Дальность ${p.eff} (${bandTxt(p)})${mods ? ` (${mods})` : ''}${p.turnOnHit ? ` · при попадании ↻ ${60 * p.turnOnHit}°` : ''}`;
  }
  return `<p>${head}<br>${body}${p.plain.length ? '<br><small>' + p.plain.map(esc).join(' · ') + '</small>' : ''}</p>`;
}
const CLASS_EN = { light: 'Light', medium: 'Medium', heavy: 'Heavy', assault: 'Assault' };
let gaPrev = 0, turnPrev = null;     // {id, facing}: where the target would look after the turn option under the cursor
let preview = null, previewPos = null;           // shot preview for the armed weapons while the cursor is over an enemy mech
function info(c) {
  const s = st(), a = s.activation, hb = hover && s.map.cells[key(hover)]?.terrain === 'building' ? targetOf(s, buildingId(hover)) : null;
  const hm = (hoverMechId && s.mechs[hoverMechId]) || hb;
  preview = null; previewPos = hm ? hm.pos : null;
  if (a && a.phase === 'PLAY' && !a.attack && armed.length && hm && hm.status === 'active' && (hm.isBuilding || hm.owner !== s.mechs[a.mechId].owner)) {
    const am = s.mechs[a.mechId];
    preview = armed.map((wid) => { const w = WEAPONS[wtype(am, wid)]; return { wid, name: wname(wtype(am, wid)), ...shotPreview(s, am, hm, w) }; });
    const mp = massPlan(am, a, fireAction(am, armed, hm.id).weapons ?? [], sel.size ? [...sel] : null);
    const have = {};                                                  // dice per color that the volley can still hand out, spent group by group
    for (const c of new Set(preview.flatMap((p) => p.pips))) { const m = mp.find((x) => x.color === c); have[c] = m ? m.take : a.pool.filter((q) => !q.spent && q.color === c && (!sel.size || sel.has(q.id))).length; }
    const seen = new Map(); preview.forEach((p) => { const k = p.name; seen.set(k, { p, n: (seen.get(k)?.n ?? 0) + 1 }); });   // identical weapons: one block with ×N
    const blocks = [...seen.values()].map(({ p, n }) => {
      const slots = []; let heat = 0;
      for (let i = 0; i < n; i++) for (const c of p.pips) { const ok = have[c] > 0; if (ok) have[c]--; slots.push({ color: c, ok }); if (!ok && mp.some((x) => x.color === c)) heat++; }
      return weaponBlock(p, n, slots, heat);
    });
    $('info').innerHTML = aimHeader(hm, preview[0]) + jjLine(preview[0]) + blocks.join('');
    return;
  }
  if (a && a.phase === 'PLAY' && !a.attack && ramMode) {
    const am = s.mechs[a.mechId], rt = hm && !hm.isBuilding && hm.owner !== am.owner && hm.status === 'active' ? hm : null;
    const cost = ramMode === 'jump' ? `${2 + ramExtra} куб. ⇧ (+${2 * (2 + ramExtra)}🌡, +${2 + ramExtra} virtual evade)` : `${2 + ramExtra + (am.anchor > 0 ? 1 : 0)} ДД`;
    const rule = `Таран${ramMode === 'jump' ? ' с JJ' : ''}: стоит ${cost}. Каждое действие сверх базы (разгон ${ramExtra}) повышает класс на 1; урон = класс с разгоном − класс цели (мин. 0), не больше собственного класса (${rankOf(am)}); броня не действует.`;
    if (rt) { const dmg = ramDamage(rankOf(am), rankOf(rt), ramExtra), why = apply(st(), { player: who(), ...ramAction(am, rt.id) }); $('info').innerHTML = `<p><b>Таран → ${name(rt.id)}</b> ${why.ok ? '<span style="color:#4caf50">✔</span>' : `<span style="color:#e25555">✖ ${esc(why.error)}</span>`}<br>Урон ${dmg}: класс ${CLASS_EN[am.cls]} ${rankOf(am)}${ramExtra ? ` + разгон ${ramExtra} = ${rankOf(am) + ramExtra}` : ''} против ${CLASS_EN[rt.cls]} ${rankOf(rt)}, максимум ${rankOf(am)}. Цена: ${cost}. Защитник может катапультироваться до броска урона.</p>`; return; }
    $('info').innerHTML = `<p>${rule}<br><small>Наведи на соседнего врага.</small></p>`; return;
  }
  $('info').innerHTML = c ? describeCell(c) : '<small>Наведи на гекс для описания.</small>';
}
let lastActId = null;
function refresh() {
  const curAct = st().activation?.mechId ?? null;
  if (curAct !== lastActId) { lastActId = curAct; lastShot = null; diceMoved = false; armed = []; ramMode = null; ramExtra = 0; jumpMode = false; conv = null; sel.clear(); }   // a new activation starts with nothing selected
  if (conv && !convFits(CONVERSIONS[conv], sel.size)) conv = null;
  const a = st().activation;
  if (jumpMode && !(a && a.phase === 'PLAY' && !a.attack && !st().pending && jumpPip())) jumpMode = false;
  if (!(st().pending?.type === 'TURN_TARGET')) turnPrev = null;
  computeLegal(); info(hover); panel(); renderMech(); renderDice(); draw();
}

// ---- input
function onClick(e) {
  const t = e.target.closest('[data-chip],[data-do],[data-w],[data-turn],[data-conv],[data-to],[data-die],[data-tc],[data-fold],[data-ga],[data-ram],[data-ramx],[data-imode]'); if (!t) return; const a = st().activation;
  if (t.dataset.chip) { if (!a.pool.find((p) => p.id === t.dataset.chip).spent) { sel.has(t.dataset.chip) ? sel.delete(t.dataset.chip) : sel.add(t.dataset.chip); refresh(); } }
  else if (t.dataset.imode) { inputMode = t.dataset.imode; saveInput(); if ($('settings').style.display === 'block') renderSettings(); refresh(); }
  else if (t.dataset.conv) { conv = t.dataset.conv; refresh(); }
  else if (t.dataset.to) { const k = conv; conv = null; send({ type: 'CONVERT', kind: k, pipIds: [...sel], to: t.dataset.to }); }
  else if (t.dataset.die) { const [si, k, i] = t.dataset.die.split(':'), act = corrAction('reroll', { shot: +si, group: k, index: +i }); if (act) send(act); }
  else if (t.dataset.fold) { fold[t.dataset.fold] = !t.textContent.trim().startsWith('▾'); renderDice(); }
  else if (t.dataset.ga) send({ type: 'USE_GA', radius: +t.dataset.ga });
  else if (t.dataset.tc) send({ type: 'RESOLVE_DECISION', choice: t.dataset.tc });
  else if (t.dataset.w) { ramMode = null; armed = armed.includes(t.dataset.w) ? armed.filter((x) => x !== t.dataset.w) : [...armed, t.dataset.w]; jumpMode = false; refresh(); }
  else if (t.dataset.ram) { ramMode = ramMode === t.dataset.ram ? null : t.dataset.ram; armed = []; jumpMode = false; refresh(); }
  else if (t.dataset.ramx) { ramExtra = Math.max(0, ramExtra + +t.dataset.ramx); refresh(); }
  else if (t.dataset.turn) { turnAfter = +t.dataset.turn; refresh(); }
  else {
    const d = t.dataset.do;
    if (d === 'closeres') { lastShot = null; renderDice(); return; }
    if (d === 'new') { if (net) net.newGame((r) => { if (!r.ok) flash(r.error); }); else { g = newGame(); resetUi(); refresh(); } }
    else if (d === 'undo') { if (net) net.undo((r) => { if (!r.ok) flash(r.error); }); else { g.undo(); undoUi(); refresh(); } }
    else if (d === 'jumpmode') { jumpMode = !jumpMode; armed = []; refresh(); }
    else if (d.startsWith('ignore')) { const act = corrAction('ignoreEvade', { shot: +d.split(':')[1] }); if (act) send(act); }
    else if (d === 'take' || d === 'eject') send({ type: 'RESOLVE_DECISION', choice: d });
    else send({ roll: { type: 'ROLL_PILOT' }, shutdown: { type: 'EMERGENCY_SHUTDOWN' }, discard: { type: 'DISCARD_DICE', dieIds: [...sel] }, commit: { type: 'COMMIT_MOVE', pipIds: moveCommit(st().mechs[a.mechId], a).ids },
      resolve: { type: 'RESOLVE_ATTACK' }, masc: { type: 'USE_MASC', pipIds: [firstMove()?.id] }, tl: { type: 'TURN', turn: -1 }, tr: { type: 'TURN', turn: 1 }, vev: { type: 'VIRTUAL_EVADE' }, end: { type: 'END_ACTIVATION' } }[d]);
  }
}
for (const host of [$('panel'), $('dice')]) host.addEventListener('mouseover', (e) => {          // hovering a turn option shows the resulting facing of the enemy mech
  const b = e.target.closest('[data-tc]'), p = st().pending; if (!b || !p || p.type !== 'TURN_TARGET') return;
  const [k, n] = b.dataset.tc.split(':'), f = st().mechs[p.targetId].facing;
  turnPrev = k === 'L' ? { id: p.targetId, facing: (f - +n + 6) % 6 } : k === 'R' ? { id: p.targetId, facing: (f + +n) % 6 } : k === 'flip' ? { id: p.targetId, facing: (f + 3) % 6 } : null; draw();
});
for (const host of [$('panel'), $('dice')]) host.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tc]') && turnPrev) { turnPrev = null; draw(); } });
$('panel').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-ga]'); const r = b && !b.disabled ? +b.dataset.ga : 0; if (r !== gaPrev) { gaPrev = r; draw(); } });
$('panel').addEventListener('mouseout', (e) => { if (e.target.closest('[data-ga]') && gaPrev) { gaPrev = 0; draw(); } });
$('panel').addEventListener('click', onClick); $('dice').addEventListener('click', onClick);
// ---- corner buttons: settings window, battle log window
function renderSettings() {
  $('settings').innerHTML = `<h4>Настройки <button id="setClose" title="Закрыть">✕</button></h4>
    <div class="sec">Ввод перемещения на карте</div>
    ${[['zones', 'Зоны'], ['petals', 'Лепестки'], ['both', 'Оба']].map(([k, l]) => `<button data-imode="${k}" class="${inputMode === k ? 'on' : ''}">${l}</button>`).join('')}
    ${inputMode === 'petals' ? '' : `<br><small>мёртвая зона в центре ${Math.round(dead * 100)}%</small> <input type="range" id="deadSlider" min="0" max="60" step="5" value="${Math.round(dead * 100)}" style="width:110px;vertical-align:middle">`}
    <div class="sec">Как двигаться</div>
    <small>Клик по соседнему гексу — шаг; положение курсора в гексе выбирает бесплатный поворот (центр — без поворота). Клик по краю своего меха — поворот на месте, по центру — режим прыжка; зажатая ПКМ — прыжок (отпусти над гексом).</small>
    <div class="sec">Клавиши</div>
    <small>W — вперёд · Q/E — вперёд + поворот · S — назад · A/D — поворот на месте · Space — режим прыжка · Z — отмена</small>`;
}
function showSettings(on) { $('settings').style.display = on ? 'block' : 'none'; $('btnSet').classList.toggle('on', on); if (on) renderSettings(); }
function showLogWin() { $('logwin').style.display = showLog ? 'block' : 'none'; $('btnLog').classList.toggle('on', showLog); }
$('btnSet').addEventListener('click', () => showSettings($('settings').style.display !== 'block'));
$('btnLog').addEventListener('click', () => { showLog = !showLog; saveInput(); showLogWin(); });
$('btnLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); flash('ссылка скопирована — отправь её сопернику'); } catch (_) { prompt('Ссылка на партию:', location.href); } });
$('logClose').addEventListener('click', () => { showLog = false; saveInput(); showLogWin(); });
$('settings').addEventListener('click', (e) => { if (e.target.id === 'setClose') showSettings(false); else onClick(e); });
$('settings').addEventListener('input', (e) => { if (e.target.id === 'deadSlider') { dead = +e.target.value / 100; saveInput(); renderSettings(); draw(); } });
$('corner').addEventListener('click', onClick);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') showSettings(false); });
showLogWin();

const canvasPt = (ev) => { const r = cv.getBoundingClientRect(), k = cv.width / r.width; return { x: (ev.clientX - r.left) * k, y: (ev.clientY - r.top) * k }; };
function cellAtPt(x, y) { return Object.values(st().map.cells).find((c) => { const p = pix(c); return Math.hypot(p.x - x, p.y - y) < S * 0.9; }); }
function cellAt(ev) { const q = canvasPt(ev); return cellAtPt(q.x, q.y); }
const mechIn = (c) => c && Object.values(st().mechs).find((m) => (m.status === 'active' || m.status === 'disabled') && key(m.pos) === key(c));
cv.addEventListener('mousemove', (e) => {
  ptr = canvasPt(e); if (rmb && !(e.buttons & 2)) { rmb = false; refresh(); return; }
  const hb = btnAt(ptr); if ((hb?.id ?? null) !== hoverBtn) { hoverBtn = hb?.id ?? null; cv.style.cursor = hb ? 'pointer' : ''; cv.title = hb?.title ?? ''; }
  const c = cellAt(e) ?? null, was = hover;
  hover = c; if (!was || !c || key(was) !== key(c)) { hoverMechId = mechIn(c)?.id ?? null; info(c); renderMech(); }
  draw();
});
cv.addEventListener('mouseleave', () => { ptr = null; hoverBtn = null; cv.style.cursor = ''; cv.title = ''; if (rmb) return; hover = null; hoverMechId = null; info(null); renderMech(); draw(); });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => { if (e.button !== 2) return; const a = st().activation; if (!a || a.phase !== 'PLAY' || st().pending || a.attack) return; ptr = canvasPt(e); rmb = true; refresh(); });
window.addEventListener('mouseup', (e) => {                       // releasing the right button over a hex = jump there (outside the field = cancel)
  if (e.button !== 2 || !rmb) return;
  ptr = canvasPt(e); const p = e.target === cv ? movePreview() : null;
  rmb = false;
  if (p && !p.bad && p.g !== null && p.g !== undefined) doMove(p); else refresh();
});
window.addEventListener('blur', () => { if (rmb) { rmb = false; refresh(); } });
cv.addEventListener('click', (e) => {
  const bt = btnAt(canvasPt(e)); if (bt) { hoverBtn = null; cv.style.cursor = ''; cv.title = ''; send({ type: bt.id === 'roll' ? 'ROLL_PILOT' : 'EMERGENCY_SHUTDOWN' }); return; }
  const c = cellAt(e); if (!c || st().pending || st().winner !== null) return; const m = mechIn(c), a = st().activation;
  if (!a) { if (m) send({ type: 'ACTIVATE', mechId: m.id }); return; }
  if (a.phase !== 'PLAY') return;
  if (m && ramMode && legal.rams.has(m.id)) send(ramAction(st().mechs[a.mechId], m.id));
  else if (!m && legal.hexTargets.has(key(c))) send(fireAction(st().mechs[a.mechId], armed, buildingId(c)));
  else if (m && legal.targets.has(m.id)) send(fireAction(st().mechs[a.mechId], armed, m.id));
  else { ptr = canvasPt(e); doMove(movePreview()); }
});

// keyboard movement (physical keys, any layout): W forward, Q/E forward + free turn, S back, A/D turn in place, Space jump mode, Z undo
function keyStep(back, turn) {
  const a = st().activation; if (!a) return; const m = st().mechs[a.mechId], to = hexNeighbor(m.pos, back ? m.facing + 3 : m.facing);
  send({ type: 'MOVE_STEP', to: { q: to.q, r: to.r }, turn: back ? 0 : turn });
}
const KEYS = { KeyW: () => keyStep(false, 0), KeyQ: () => keyStep(false, -1), KeyE: () => keyStep(false, 1), KeyS: () => keyStep(true, 0),
  KeyA: () => send({ type: 'TURN', turn: -1 }), KeyD: () => send({ type: 'TURN', turn: 1 }),
  Space: () => { jumpMode = !jumpMode; armed = []; refresh(); }, KeyZ: () => document.querySelector('[data-do="undo"]')?.click() };
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const fn = KEYS[e.code], a = st().activation; if (!fn || e.repeat) return;
  if (e.code !== 'KeyZ' && !(a && a.phase === 'PLAY' && !st().pending && !a.attack && st().winner === null)) return;
  e.preventDefault(); fn();
});
$('skills').innerHTML = Array.from({ length: 10 }, (_, i) => `<div class="slot">навык ${i + 1}</div>`).join('');   // placeholder slots
globalThis.__mm = { get g() { return g; }, refresh, pix, dry: (a) => apply(st(), { player: who(), ...a }), get legal() { return legal; }, fireAction, get armed() { return armed; } };   // debug hook for smoke tests
refresh();

// the correction window can be dragged by its header
{
  let drag = null;
  $('dice').addEventListener('pointerdown', (e) => { const h = e.target.closest('.dgrab'); if (!h) return; drag = { x: e.clientX - dicePos.x, y: e.clientY - dicePos.y }; diceMoved = true; h.setPointerCapture(e.pointerId); e.preventDefault(); });
  $('dice').addEventListener('pointermove', (e) => { if (!drag) return; dicePos = { x: e.clientX - drag.x, y: e.clientY - drag.y }; const b = $('dice').querySelector('.dicebox'); if (b) b.style.transform = `translate(${dicePos.x}px,${dicePos.y}px)`; });
  $('dice').addEventListener('pointerup', () => { drag = null; });
}
