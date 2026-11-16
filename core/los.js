import { TERRAIN } from './data/terrain.js';
import { DIRS, distance, inArc, lineVariants } from './hex.js';
import { RULES } from './rules.js';
import { getCell, mechAt, rankOf } from './state.js';

// Line of fire. Disputed lines resolve in the defender's favour: blocked if EITHER variant is blocked.
// Indirect fire (LRM, arcing over obstacles): only the first hex after the attacker and the hex right before the target count;
// everything between is ignored. The shot is impossible if the first hex is a cliff/building or cover higher than the attacker.
export function checkLine(s, from, to, { indirect = false, rank = 99, jjRadius = 0 } = {}) {
  let blocked = false, fireHexes = 0, maxCover = 0, armorHexes = [];
  const variants = lineVariants(from, to), counted = new Set();
  for (const v of variants) {
    let f = 0, c = 0; const arm = [];
    const mid = v.slice(1, -1);
    mid.forEach((h, i) => {
      const cell = getCell(s.map, h);
      if (indirect && i !== 0 && i !== mid.length - 1) return;      // ignored hexes
      counted.add(`${h.q},${h.r}`);
      if (!cell) { blocked = true; return; }
      const t = TERRAIN[cell.terrain];
      const near = jjRadius > 0 && distance(from, h) <= jjRadius;        // jump jets: the jumper looks over obstacles close to it
      if ((t.blocksLos && !near) || (indirect && i === 0 && cell.cover > rank)) blocked = true;
      if (t.fire) f++;
      if (t.armor) arm.push(cell.terrain);          // terrain on the line gives the target armor too
      const occ = mechAt(s, h);                      // a mech on the line is cover of its own size
      const ignored = near && distance(h, to) > 1;   // jump jets: cover near the attacker is ignored, never the target or its neighbours (cliffs/buildings close to the jumper do not block at all)
      if (!ignored) c = Math.max(c, cell.cover, occ ? rankOf(occ) : 0);
    });
    fireHexes = Math.max(fireHexes, f); maxCover = Math.max(maxCover, c);
    if (arm.length > armorHexes.length) armorHexes = arm;     // disputed line: the variant better for the defender
  }
  const fireTarget = TERRAIN[getCell(s.map, to)?.terrain]?.fire ? 1 : 0;      // the target stands in fire: +1 virtual evade for it (lasers are not affected: only the fire ON the line shortens them)
  return { blocked, fireHexes, fireTarget, maxCover, armorHexes, variants, counted };
}

// Attack hits the front projection if the attacker stands in the target's front arc, otherwise the rear.
// OPEN: flanks are treated as rear for now.
export const projection = (target, attackerPos) =>
  inArc(target.pos, target.facing, attackerPos, RULES.arcDegrees, RULES.arcBoundaryInclusive) ? 'front' : 'rear';

// A closer enemy inside the attacker's firing arc that the attacker can SEE (line of fire not blocked) gives the chosen target +1 armor.
export function nearerEnemyInArc(s, atk, tgt) {
  const d = distance(atk.pos, tgt.pos);
  return Object.values(s.mechs).some((m) =>
    m.status === 'active' && m.owner !== atk.owner && m.id !== tgt.id &&
    distance(atk.pos, m.pos) < d && inArc(atk.pos, atk.facing, m.pos, RULES.arcDegrees, RULES.arcBoundaryInclusive) &&
    !checkLine(s, atk.pos, m.pos, { rank: rankOf(atk) }).blocked);
}
export { DIRS, rankOf };
