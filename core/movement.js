import { CLASSES } from './data/classes.js';
import { TERRAIN } from './data/terrain.js';
import { fail } from './errors.js';
import { dirTo, mod6, neighbor } from './hex.js';
import { RULES } from './rules.js';
import { getCell, mechAt, rankOf } from './state.js';

// Speed rating: how many movement actions you get for n committed `move` pips.
export function actionsFor(rating, n) {
  switch (rating) {
    case '2+': return n + Math.min(n, 2);
    case '1+': return n + Math.min(n, 1);
    case 'X':  return n;
    case '2':  return n <= 2 ? n : 2 + Math.floor((n - 2) / 2);
    case '1':  return n <= 1 ? n : 1 + Math.floor((n - 1) / 2);
    case '0':  return Math.floor(n / 2);
    default: throw new Error(`bad speed rating ${rating}`);
  }
}
// MASC: one move die spent through USE_MASC is worth 2 flat movement actions (act.mascBonus is 0 or 2).
export const actionsTotal = (m, act) => actionsFor(m.speed, act.movePips) + (act.mascBonus ?? 0);
export const actionsAvailable = (m, act) => actionsTotal(m, act) - act.moveSpent;

// null = ok, otherwise the reason
export function cannotOccupy(s, m, hex) {
  const cell = getCell(s.map, hex);
  if (!cell) return 'off the map';
  const t = TERRAIN[cell.terrain];
  if (t.blocksMove) return 'impassable terrain';
  if (t.forbidClass?.includes(m.cls)) return `${m.cls} mechs cannot enter ${cell.terrain}`;
  if (cell.edge < CLASSES[m.cls].edgeMin) return 'too close to the map edge for this class';
  if (cell.cover - rankOf(m) >= 2) return 'cover is two classes higher';
  const occ = mechAt(s, hex, m.id);
  if (occ && (occ.owner !== m.owner || occ.status !== 'active')) return 'hex is occupied';
  return null; // allied mechs may be passed through (end-of-activation check forbids stopping there)
}

const anchorTax = (m) => (m.anchor > 0 ? 1 : 0);
export function enterCost(s, m, hex) {
  const cell = getCell(s.map, hex);
  const over = cell.cover - rankOf(m);
  return (TERRAIN[cell.terrain].moveExtra ?? 0) + (over === 1 ? 1 : 0) + anchorTax(m);
}

// One step to an adjacent hex. A front-side hex (±60°) first needs a turn toward it (1 action, +1 with anchor), then the
// step itself. A backward step costs backStepCost and never turns. Returns { cost, newFacing }.
export function planStep(s, m, to) {
  const dir = dirTo(m.pos, to);
  if (dir < 0) fail('destination is not adjacent');
  const offset = mod6(dir - m.facing); // 0 ahead, 1 right-front, 5 left-front, 3 behind
  const signed = offset > 3 ? offset - 6 : offset;
  let base, newFacing = m.facing;
  if (offset === 3) base = RULES.backStepCost;
  else if (RULES.allowedStepOffsets.includes(signed)) {
    base = 1;
    if (signed !== 0) { base += 1 + anchorTax(m); newFacing = dir; }   // turn first, then move
  } else fail('cannot step in that direction');
  const why = cannotOccupy(s, m, to);
  if (why) fail(why);
  return { cost: base + enterCost(s, m, to), newFacing, back: offset === 3 };
}
export { neighbor };
