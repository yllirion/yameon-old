import { RULES } from './rules.js';
import { TERRAIN } from './data/terrain.js';
import { rollDamageDice } from './damage.js';
import { getCell, heatCapacity } from './state.js';

// Heat generated so far in this activation (compared with the capacity at the end of it).
export const heatGenerated = (act) =>
  Math.ceil(act.movePips / 2) + act.initialEvade + act.heat.weapons + act.heat.jumps + act.heat.equipment;

// End-of-activation heat control: cool first, then generated heat vs capacity, then overflow damage.
export function heatControl(s, rng, events, m, act) {
  const locked = m.crits.cooling; // tokens that cannot be removed while the cooling crit stands
  const cool = (m.coolers === 'double' ? 2 : 1) + (act.shutdown ? 1 : 0);
  m.overheat = Math.max(locked, m.overheat - cool);
  const extra = TERRAIN[getCell(s.map, m.pos).terrain].extraCool ?? 0;
  m.overheat = Math.max(locked, m.overheat - extra);

  const generated = heatGenerated(act);
  const capacity = heatCapacity(m);
  const tokensAdded = Math.max(0, generated - capacity);
  m.overheat += tokensAdded;

  let overflow = 0;
  if (m.overheat > RULES.maxOverheat) { overflow = m.overheat - RULES.maxOverheat; m.overheat = RULES.maxOverheat; }
  events.push({ type: 'heat_control', mechId: m.id, generated, capacity, tokensAdded, overheat: m.overheat, overflow });
  if (overflow > 0) {
    if (RULES.overheatForcesShutdown) m.forcedShutdown = true;
    rollDamageDice(s, rng, events, m, overflow); // unblockable: no armor roll, no eject window
  }
}

// Overheat tokens received outside the heat control (fire, OS, GA): tokens above the maximum turn into unblockable damage dice.
export function addOverheat(s, rng, events, m, n) {
  m.overheat += n;
  let overflow = 0;
  if (m.overheat > RULES.maxOverheat) { overflow = m.overheat - RULES.maxOverheat; m.overheat = RULES.maxOverheat; }
  if (overflow > 0) {
    if (RULES.overheatForcesShutdown) m.forcedShutdown = true;
    rollDamageDice(s, rng, events, m, overflow);
  }
  return overflow;
}
