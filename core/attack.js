import { BALLISTIC_DIE, ENERGY_DIE, MISSILE_DIE } from './data/dice.js';
import { TERRAIN } from './data/terrain.js';
import { WEAPONS } from './data/weapons.js';
import { resolveHit } from './damage.js';
import { amsReduction, amsRoll, amsSources } from './ams.js';
import { fail } from './errors.js';
import { distance, inArc } from './hex.js';
import { checkLine, nearerEnemyInArc, projection } from './los.js';
import { RuleError } from './errors.js';
import { RULES } from './rules.js';
import { evadeOf, getCell, rankOf, targetOf } from './state.js';

// Jump jets used in this activation = radius around the attacker inside which cover is ignored (target and its neighbours never).
export const jjRadiusOf = (s, atk) => (s.activation && s.activation.mechId === atk.id ? s.activation.jumpsUsed : 0);
export const bandOf = (d) => (d <= RULES.bands.short[1] ? 'short' : d <= RULES.bands.medium[1] ? 'medium' : 'long');
const isLaser = (w) => w.dice.energy && !w.dice.ballistic && !w.adjacentOnly;

// blind tokens shorten the maximum range of the mech's weapons (adjacent-only weapons keep their reach of 1)
export const blindMax = (atk, w) => (w.maxRange > 1 && atk.blind > 0 ? Math.max(1, w.maxRange - RULES.blindRangePenalty * atk.blind) : w.maxRange);
// Everything that can forbid the shot. Throws RuleError; returns data used by the resolver.
export function validateAttack(s, atk, tgt, w) {
  if (tgt.owner === atk.owner) fail('cannot target an ally');
  if (tgt.status !== 'active') fail('target is not active');
  if (!inArc(atk.pos, atk.facing, tgt.pos, RULES.arcDegrees, RULES.arcBoundaryInclusive)) fail('target is outside the front arc');
  const los = checkLine(s, atk.pos, tgt.pos, { indirect: w.sub === 'lrm', rank: rankOf(atk), jjRadius: jjRadiusOf(s, atk) });
  if (los.blocked) fail('line of fire is blocked');
  if (isLaser(w) && los.maxCover > rankOf(tgt)) fail('laser cannot fire through cover larger than the target');
  const dist = distance(atk.pos, tgt.pos);
  let maxRange = blindMax(atk, w);
  if (isLaser(w)) {
    maxRange -= los.fireHexes; // every fire hex on the line shortens lasers by 1
    maxRange -= (TERRAIN[getCell(s.map, tgt.pos).terrain].waterLaser ?? 0) * tgt.overheat; // target standing in (deep) water
  }
  if (dist < w.minRange || dist > maxRange) fail(`out of range: ${dist} (allowed ${w.minRange}-${maxRange})`);
  if (isBallisticRange(w)) {                              // evade / virtual evade / cover can push the target beyond the weapon range
    const eff = stretchOf(tgt, w, dist, los.fireHexes + los.fireTarget, los.maxCover).ballisticRange;
    if (eff > maxRange) fail(`effective range ${eff} exceeds the maximum ${maxRange}`);
  }
  return { dist, los, maxRange, cover: los.maxCover, armorHexes: los.armorHexes };
}

// How far evade / virtual evade / cover push the target away for ballistic-type range, and what they do to missiles.
export function stretchOf(tgt, w, dist, fireHexes, cover, ignored = 0) {
  const ev = evadeOf(tgt);
  let evade = ev.evade, virt = ev.virtual + fireHexes;   // every fire hex on the counted line gives +1 virtual evade
  if (w.sub === 'srm' && dist <= RULES.bands.short[1]) { evade = Math.max(0, evade - 1); virt = Math.max(0, virt - 1); }
  const mg = w.special === 'mg';                                    // MG: virtual evade counts twice for range
  const evTotal = Math.max(0, evade + virt * (mg ? 2 : 1) - ignored); // fire correction: each extra die ignores one evade
  return { evade, virt, virtRange: virt * (mg ? 2 : 1), evTotal, cover, ballisticRange: dist + evTotal + cover };
}
const isBallisticRange = (w) => !!w.dice.ballistic && w.kind !== 'melee';

// Armor bonuses for the target: terrain on its own hex and on the line of fire, plus a nearer enemy in the attacker's arc.
export function armorBonusOf(s, atk, tgt, los) {
  const parts = [];
  const own = TERRAIN[getCell(s.map, tgt.pos).terrain];
  if (own.armor) parts.push({ n: own.armor, terrain: getCell(s.map, tgt.pos).terrain, where: 'target' });
  for (const k of new Set(los.armorHexes)) parts.push({ n: los.armorHexes.filter((x) => x === k).length * TERRAIN[k].armor, terrain: k, where: 'line' });
  if (nearerEnemyInArc(s, atk, tgt)) parts.push({ n: 1, terrain: null, where: 'nearer' });
  return { total: parts.reduce((a, p) => a + p.n, 0), parts };
}

const rollN = (rng, n) => Array.from({ length: n }, () => rng.int(6)); // dice are stored as face indices (serializable)

// Step 1: pay for the weapons and roll their dice. A volley is several weapons against ONE target; every weapon keeps its own
// dice (`shots`). The result sits in activation.attack so the player can use fire correction before damage is resolved.
export function startAttack(rng, act, { s, atk, tgt, shots }) {
  const ams = {};                                                   // AMS answer once per missile type of the volley (not correctable)
  for (const sub of ['lrm', 'srm']) if (shots.some((x) => x.w.sub === sub)) ams[sub] = amsRoll(rng, amsSources(s, atk, tgt, sub));
  act.attack = {
    attackerId: atk.id, targetId: tgt.id, ams,
    shots: shots.map(({ wid, w, info }) => {
      const rolls = {};
      for (const g of ['energy', 'ballistic', 'missile']) if (w.dice[g]) rolls[g] = rollN(rng, w.dice[g]);
      return { wid, rolls, amsDevices: ams[w.sub]?.devices ?? 0, ignored: 0, dist: info.dist, fireHexes: info.los.fireHexes + info.los.fireTarget, cover: info.cover, armorHexes: info.armorHexes };
    }),
  };
}

// CC: the active mech's own CC, or an allied mech's CC (that mech must see the target; the active mech pays 1 heat).
export function ccSources(s, atk, tgt) {
  const out = atk.equipment.cc ? [{ id: atk.id, self: true }] : [];
  for (const m of Object.values(s.mechs))
    if (m.id !== atk.id && m.owner === atk.owner && m.status === 'active' && m.equipment.cc && !checkLine(s, m.pos, tgt.pos).blocked) out.push({ id: m.id, self: false });
  return out;
}
// A fire correction costs the SAME dice as activating the weapon: one die for a laser/AC/missile, a pair for Gauss
// (ballistic + ballistic) and PPC (laser + ballistic). CC may stand in for ONE of those dice (any die works).
const SPARE_ORDER = ['jumpjet', 'move', 'missile', 'ballistic', 'laser']; // what we sacrifice first when any die will do
export function planCorrection(s, act, atk, tgt, w, prefer = []) {
  if (w.payWith) return null;                                       // melee attacks have no pilot-die activation
  const spare = act.pool.filter((p) => !p.spent);
  const rank = (p) => -prefer.includes(p.id);
  const need = [...w.pips], pick = [];
  for (const c of [...need]) {
    const p = spare.filter((x) => x.color === c && !pick.includes(x)).sort((x, y) => rank(x) - rank(y))[0];
    if (p) { pick.push(p); need.splice(need.indexOf(c), 1); }
  }
  if (!need.length) return { pipIds: pick.map((p) => p.id), cc: null };
  if (need.length === 1 && !act.ccUsed) {
    const src = ccSources(s, atk, tgt)[0];                          // own CC comes first (no heat)
    const extra = spare.filter((x) => !pick.includes(x))
      .sort((x, y) => rank(x) - rank(y) || SPARE_ORDER.indexOf(x.color) - SPARE_ORDER.indexOf(y.color))[0];
    if (src && extra) return { pipIds: [...pick, extra].map((p) => p.id), cc: src.id, extra: extra.id };
  }
  return null;
}
// How many corrections can still be paid for (each one is a full set of dice, see above).
export function correctionsLeft(s, act, atk, tgt, w) {
  const copy = { ...act, pool: act.pool.map((p) => ({ ...p })) };
  let n = 0;
  for (let plan; (plan = planCorrection(s, copy, atk, tgt, w)); n++) {
    plan.pipIds.forEach((id) => { copy.pool.find((p) => p.id === id).spent = true; });
    if (plan.cc) copy.ccUsed = true;
  }
  return n;
}

// Step 2: evaluate the (possibly corrected) dice of every weapon of the volley, apply evade/range effects, then hand the
// summed damage to the armor step (one armor roll for the whole volley).
// TODO: cover vs missiles/ballistics, OS, mines.
export function finishAttack(s, rng, events, act) {
  const A = act.attack, atk = s.mechs[A.attackerId], tgt = targetOf(s, A.targetId);
  act.attack = null;
  let totalDmg = 0, totalUnb = 0, turns = 0; const results = [];
  for (const shot of A.shots) {
    const r = resolveShot(s, atk, tgt, shot, act);
    events.push({ type: 'attack', attackerId: atk.id, targetId: tgt.id, weapon: shot.wid, ...r.ev });
    totalDmg += r.dmg; totalUnb += r.unblockable; results.push(r);
  }
  totalDmg -= missileCuts(A, results, events);
  turns = volleyTurns(tgt, results);
  if (turns > 0 && !tgt.isBuilding) s.turnQueue = { player: atk.owner, targetId: tgt.id, sourceId: atk.id, turns };   // the attacker chooses AFTER the damage is done
  if (tgt.isBuilding) { damageBuilding(s, rng, events, tgt, totalDmg + totalUnb); return; }
  if (totalDmg > 0 || totalUnb > 0) {
    const bonusArmor = armorBonusOf(s, atk, tgt, { armorHexes: A.shots[0].armorHexes ?? [] }).total, rear = projection(tgt, atk.pos) === 'rear';
    if (totalDmg > 0 && tgt.equipment.os && tgt.status === 'active' && !act.osUsed?.includes(tgt.id)) {      // Omni Shield: the defender decides BEFORE the armor roll
      s.pending = { type: 'OS_DECISION', player: tgt.owner, targetId: tgt.id, sourceId: atk.id, options: ['use', 'skip'], hit: { damage: totalDmg, unblockable: totalUnb, rear, bonusArmor } };
      events.push({ type: 'decision_required', player: tgt.owner, kind: 'os' });
      return;
    }
    resolveHit(s, rng, events, { sourceId: atk.id, target: tgt, damage: totalDmg, unblockable: totalUnb, rear, bonusArmor });
  }
}

// Missile damage of a volley is summed per type (LRM / SRM) and then reduced ONCE: first by the target's evade + virtual evade tokens
// (every fire-correction "ignore evade" of those weapons removes one), then by the AMS dice of that type. Returns the total cut.
export function missileCuts(A, results, events = null) {
  let cut = 0;
  for (const sub of ['lrm', 'srm']) {
    const rs = results.filter((r) => r.sub === sub); if (!rs.length) continue;
    let left = rs.reduce((a, r) => a + r.dmg, 0);
    const flat = rs[0].evFlat, ign = rs.reduce((a, r) => a + r.evIgnored, 0), ev = Math.min(left, Math.max(0, flat - ign));
    if (flat) { left -= ev; cut += ev; events?.push({ type: 'evade_cut', sub, tokens: flat, ignored: ign, cut: ev, targetId: A.targetId }); }
    const ams = A.ams?.[sub]; if (!ams) continue;
    const c = Math.min(left, amsReduction(ams)); cut += c;
    events?.push({ type: 'ams', sub, faces: ams.dice, devices: ams.devices, cut: c, targetId: A.targetId });
  }
  return cut;
}

function resolveShot(s, atk, tgt, A, act) {
  const w = WEAPONS[atk.weapons.find((x) => x.id === A.wid).type];
  const st = stretchOf(tgt, w, A.dist, A.fireHexes, A.cover ?? 0, A.ignored);
  const { evade, virt, evTotal } = st;
  const close = A.dist <= RULES.bands.short[1];

  let dmg = 0, unblockable = 0, heat = 0, miss = false, band = bandOf(A.dist), turns = 0, turnPts = 0;
  const rolls = {};
  if (A.rolls.energy) {
    rolls.energy = A.rolls.energy.map((i) => ENERGY_DIE[i]);
    const sum = rolls.energy.reduce((a, b) => a + b, 0);
    heat += sum;
    dmg += w.plasma ? sum : rolls.energy.length;     // plasma cutters: damage equals the heat rolled
  }
  if (A.rolls.ballistic) {
    const faces = A.rolls.ballistic.map((i) => BALLISTIC_DIE[i]);
    rolls.ballistic = faces;
    band = w.kind === 'melee' ? 'short' : bandOf(A.dist + evTotal + (A.cover ?? 0)); // cover on the line adds range too; evade stretches the range; melee is always the adjacent hex
    const mid = faces.map((f) => !!f.missMid), lng = faces.map((f) => !!f.missLong);
    const marked = faces.map((f) => f.missMid || f.missLong);
    if (w.special === 'gauss') { // Gauss reads the marks its own way
      if (band === 'medium') miss = mid.every(Boolean) || lng.every(Boolean);
      if (band === 'long') miss = marked.every(Boolean);
      if (!miss && marked.some(Boolean)) unblockable = 1; // OPEN: 1 unblockable on top of normal damage?
    } else {
      if (band === 'medium') miss = mid.some(Boolean);
      if (band === 'long') miss = marked.some(Boolean);
    }
    const cap = [1, 2, 3][Math.min(2, tgt.crits.armor)];     // MG deals at most 1/2/3 per die against intact / 1 / 2 armor crits
    dmg += faces.reduce((a, f) => a + (w.special === 'mg' ? Math.min(f.dmg, cap) : f.dmg), 0);
    if (!w.noHeat) heat += 1;
  }
  if (A.rolls.missile) {
    const faces = A.rolls.missile.map((i) => MISSILE_DIE[i]);
    rolls.missile = faces;
    const srmLive = w.sub === 'srm' && close; // "2 SRM damage" faces count only for SRM at close range
    dmg += faces.reduce((a, f) => a + (f.srm && !srmLive ? 0 : f.dmg), 0);
    heat += faces.length;
    if (w.sub === 'lrm') turnPts = faces.filter((f) => f.dmg === 0 || f.srm).length;   // LRM turn points: every "0" and every "2 SRM" face is 1; the whole volley is summed and divided ONCE (see volleyTurns)
  }
  act.heat.weapons += heat;

  if (miss) { dmg = 0; unblockable = 0; }
  if (w.turnOnHit && !miss) turns = w.turnOnHit;           // AC10 turns the target once, AC20 twice
  if (w.effect === 'overheat' && !miss) tgt.overheat += 1;
  if (w.anchorOnHit && !miss) tgt.anchor += w.anchorOnHit;
  const evFlat = w.dice.missile && (w.sub === 'lrm' || (w.sub === 'srm' && !close)) ? evade + virt : 0;   // evade eats the summed missile damage of the VOLLEY (see missileCuts)
  return { dmg, unblockable, turns, turnPts, amsDevices: A.amsDevices ?? 0, sub: w.sub ?? null, evFlat, evIgnored: A.ignored ?? 0, ev: { turns, dist: A.dist, band, evade, virtualEvade: virt, ignored: A.ignored, faces: A.rolls, rolls, miss, damage: dmg, unblockable, heat } };
}

// What the UI shows while a weapon is armed and the cursor is over a target: legality, the line and every modifier.
// Structured so the client can lay it out: range line, target line, armor bonus parts, extra notes.
export function shotPreview(s, atk, tgt, w) {
  let info = null, error = null;
  try { info = validateAttack(s, atk, tgt, w); } catch (e) { if (e instanceof RuleError) error = e.message; else throw e; }
  const los = info?.los ?? checkLine(s, atk.pos, tgt.pos, { indirect: w.sub === 'lrm', rank: rankOf(atk), jjRadius: jjRadiusOf(s, atk) });
  const dist = distance(atk.pos, tgt.pos), notes = [], rangeMods = [], reachMods = [];
  const st = stretchOf(tgt, w, dist, los.fireHexes + los.fireTarget, los.maxCover);
  let eff = dist, maxRange = info?.maxRange ?? blindMax(atk, w);
  if (isBallisticRange(w)) {
    eff = st.ballisticRange;
    if (st.evade) rangeMods.push({ n: st.evade, what: 'evade' });
    if (st.virtRange) rangeMods.push({ n: st.virtRange, what: w.special === 'mg' ? 'virtual evade (×2 для MG)' : 'virtual evade' });
    if (st.cover) rangeMods.push({ n: st.cover, what: 'cover' });
  } else {
    if (isLaser(w)) {
      const water = (TERRAIN[getCell(s.map, tgt.pos).terrain].waterLaser ?? 0) * tgt.overheat;
      maxRange = Math.max(0, blindMax(atk, w) - los.fireHexes - water);
      if (los.fireHexes) reachMods.push({ n: los.fireHexes, what: `огонь на линии (${los.fireHexes} гекс.)` });
      if (water) reachMods.push({ n: water, what: `вода × overheat цели ${tgt.overheat}` });
    }
    if (w.dice.missile) notes.push(w.sub === 'srm' && dist <= RULES.bands.short[1] ? 'SRM вблизи: −1 evade и virtual evade цели' : `evade и virtual evade цели (${st.evade + st.virt}) вычитаются из суммарного урона ракет этого типа в залпе`);
    if (isLaser(w) && los.maxCover) notes.push(`укрытие ${los.maxCover}: лазер ${los.maxCover > rankOf(tgt) ? 'не проходит (выше цели)' : 'не страдает'}`);
    else if (los.maxCover && w.dice.missile) notes.push(`укрытие на линии: ${los.maxCover} (правило для ракет пока не реализовано)`);
  }
  const plain = notes.filter((n) => !n.startsWith('evade и virtual evade'));       // notes the client prints as text; the rest are shown structurally (JJ line, dice, evade / AMS / fire icons)
  if (jjRadiusOf(s, atk) > 0) notes.push(`JJ: укрытия в радиусе ${jjRadiusOf(s, atk)} от стрелка игнорируются (кроме цели и соседних гексов)`);
  if (w.sub) { const ams = amsSources(s, atk, tgt, w.sub), n = ams.reduce((a, x) => a + x.dice, 0); if (n) notes.push(`AMS цели и союзников: ${n} куб. баллистики снимут урон ракет${w.sub === 'lrm' ? `; класс для поворота +${ams.reduce((a, x) => a + x.devices, 0)}` : ''}`); }
  if (atk.blind > 0 && w.maxRange > 1) notes.push(`blind ×${atk.blind}: максимальная дальность ${w.maxRange} → ${blindMax(atk, w)}`);
  if (w.turnOnHit) notes.push(`после урона можно повернуть цель на ${w.turnOnHit} × 60°`);
  if (w.sub === 'lrm') notes.push('навесом: считаются только первый гекс и гекс перед целью');
  if (los.fireHexes && !isLaser(w)) notes.push(`огонь на линии: +${los.fireHexes} virtual evade цели (по 1 за гекс)`);
  if (los.fireTarget && !isLaser(w)) notes.push('цель стоит в огне: +1 virtual evade');
  const amsSrc = w.sub ? amsSources(s, atk, tgt, w.sub) : [];
  if (atk.blind > 0 && w.maxRange > 1) plain.push(`blind ×${atk.blind}: максимальная дальность ${w.maxRange} → ${blindMax(atk, w)}`);
  const outOfRange = eff > maxRange || dist < w.minRange;
  const band = outOfRange ? 'out' : bandOf(eff);
  const armor = tgt.isBuilding ? { total: 0, parts: [] } : armorBonusOf(s, atk, tgt, los);
  const fire = los.fireHexes + los.fireTarget;
  return { plain, jj: jjRadiusOf(s, atk), evade: st.evade, virt: st.virt, fire, cover: st.cover, pips: w.pips, turnOnHit: w.turnOnHit ?? 0, sub: w.sub ?? null, amsDice: amsSrc.reduce((a, x) => a + x.dice, 0), amsDevices: amsSrc.reduce((a, x) => a + x.devices, 0), building: !!tgt.isBuilding, ok: !error, error, dist, eff, band, maxRange, rangeMods, reachMods, baseMax: blindMax(atk, w), minRange: w.minRange, laserReach: isLaser(w), notes, tcls: tgt.cls, side: projection(tgt, atk.pos), armor, variants: los.variants, counted: [...los.counted] };
}

// Buildings have no armor and no decision window. They collapse into rocks or fire once they have taken their HP in damage
// (by default the damage of ONE attack has to reach it — it does not accumulate, see RULES.buildingDamageAccumulates).
function damageBuilding(s, rng, events, b, dmg) {
  const cell = getCell(s.map, b.pos), hp = TERRAIN.building.hp;
  let left = hp, destroyed = false, becomes = null;
  if (dmg > 0) {
    if (RULES.buildingDamageAccumulates) { cell.hp -= dmg; left = Math.max(0, cell.hp); destroyed = cell.hp <= 0; }
    else { destroyed = dmg >= hp; left = destroyed ? 0 : hp - dmg; }
  }
  if (destroyed) { becomes = rng.int(2) ? 'fire' : 'rock'; cell.terrain = becomes; cell.hp = 0; cell.cover = 0; }
  events.push({ type: 'building_hit', hex: b.pos, damage: dmg, left, destroyed, becomes });
}

// Turn steps of a volley: AC10/AC20 hits add up; the LRM points ("0" and "2 SRM" faces of ALL LRM shots) are summed and divided by (target class + AMS devices) once.
export function volleyTurns(tgt, results) {
  const lrm = results.filter((r) => r.sub === 'lrm'), pts = lrm.reduce((a, r) => a + r.turnPts, 0), dev = lrm[0]?.amsDevices ?? 0;
  return results.reduce((a, r) => a + r.turns, 0) + (pts ? Math.floor(pts / (rankOf(tgt) + dev)) : 0);
}

// Total damage the volley would deal right now (for the "finish the shot (damage N)" button). Works on a copy: no side effects.
// Same evaluation as volleyDamage, but with every figure the shot window needs: per-shot results and the evade / AMS cut events of the missile groups.
export function volleyBreakdown(s) {
  const c = structuredClone(s), A = c.activation.attack, atk = c.mechs[A.attackerId], tgt = targetOf(c, A.targetId);
  let dmg = 0, unb = 0; const results = [], events = [];
  for (const shot of A.shots) { const r = resolveShot(c, atk, tgt, shot, c.activation); dmg += r.dmg; unb += r.unblockable; results.push({ ...r, wid: shot.wid }); }
  const cut = missileCuts(A, results, events);
  return { dmg: dmg - cut, unb, raw: dmg, turns: volleyTurns(tgt, results), results, events };
}
export function volleyDamage(s, act) {
  const c = structuredClone(s), A = c.activation.attack, atk = c.mechs[A.attackerId], tgt = targetOf(c, A.targetId);
  let dmg = 0, unb = 0, turns = 0; const results = [];
  for (const shot of A.shots) { const r = resolveShot(c, atk, tgt, shot, c.activation); dmg += r.dmg; unb += r.unblockable; results.push(r); }
  return { dmg: dmg - missileCuts(A, results), unb, turns: volleyTurns(tgt, results) };
}
