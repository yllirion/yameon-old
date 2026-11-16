import { BALLISTIC_DIE } from './data/dice.js';
import { distance, lineVariants } from './hex.js';

// AMS (anti-missile system): fires yellow ballistic dice at missile attacks, never produces heat.
// One AMS roll per missile TYPE of the volley (all LRM together, all SRM together), cutting the summed missile damage.
// - the target's own AMS fire once per AMS against SRM and twice (two separate dice) against LRM;
// - allied mechs (LRM only) fire each AMS once if they stand next to the target or on/next to the line of fire.
// The damage of a die that is NOT marked (** / ***: long-range accuracy) is taken off the missile damage.
// The number of AMS taking part also raises the target's class for the LRM turn check.
export function amsSources(s, atk, tgt, sub) {
  if (tgt.isBuilding || !sub) return [];
  const line = new Set(lineVariants(atk.pos, tgt.pos).flat().map((h) => `${h.q},${h.r}`));
  const out = [];
  for (const m of Object.values(s.mechs)) {
    const n = m.equipment.ams ?? 0;
    if (!n || m.status !== 'active' || m.owner !== tgt.owner) continue;
    const own = m.id === tgt.id;
    if (!own && sub !== 'lrm') continue;                       // allied AMS help against LRM only
    const near = own || distance(m.pos, tgt.pos) <= 1 || [...line].some((k) => { const [q, r] = k.split(',').map(Number); return distance(m.pos, { q, r }) <= 1; });
    if (near) out.push({ mechId: m.id, own, devices: n, dice: n * (own && sub === 'lrm' ? 2 : 1) });
  }
  return out;
}
export const amsRoll = (rng, srcs) => {
  const dice = srcs.flatMap((x) => Array.from({ length: x.dice }, () => rng.int(6)));
  return srcs.length ? { srcs, devices: srcs.reduce((a, x) => a + x.devices, 0), dice } : null;
};
export const amsReduction = (ams) => (ams ? ams.dice.reduce((a, i) => { const f = BALLISTIC_DIE[i]; return a + (f.missMid || f.missLong ? 0 : f.dmg); }, 0) : 0);
