// Data-driven weapons. dice: how many dice of each type. pips: pilot-die colors needed to fire.
const W = (o) => ({ minRange: 1, maxRange: 9, ...o });
const lrm = (n) => W({ sub: 'lrm', kind: 'missile', pips: ['missile'], dice: { missile: n }, minRange: 6 });
const srm = (n) => W({ sub: 'srm', kind: 'missile', pips: ['missile'], dice: { missile: n }, maxRange: 5 }); // maxRange 5 = ASSUMPTION
export const WEAPONS = {
  laser_s: W({ kind: 'energy', pips: ['laser'], dice: { energy: 1 } }),
  laser_m: W({ kind: 'energy', pips: ['laser'], dice: { energy: 2 } }),
  laser_l: W({ kind: 'energy', pips: ['laser'], dice: { energy: 3 } }),
  mg:   W({ kind: 'ballistic', pips: ['ballistic'], dice: { ballistic: 1 }, special: 'mg' }),   // MG: damage capped by target's armor crits (1/2/3); doubles virtual evade for range
  ac2:  W({ kind: 'ballistic', pips: ['ballistic'], dice: { ballistic: 1 } }),
  ac5:  W({ kind: 'ballistic', pips: ['ballistic'], dice: { ballistic: 2 } }),
  ac10: W({ kind: 'ballistic', pips: ['ballistic'], dice: { ballistic: 3 }, turnOnHit: 1 }),
  ac20: W({ kind: 'ballistic', pips: ['ballistic'], dice: { ballistic: 4 }, turnOnHit: 2 }),
  gauss: W({ kind: 'ballistic', pips: ['ballistic', 'ballistic'], dice: { ballistic: 2 }, special: 'gauss', noMass: true }),
  lppc: W({ kind: 'hybrid', pips: ['laser', 'ballistic'], dice: { ballistic: 1, energy: 1 }, anchorOnHit: 1, noMass: true }),
  mppc: W({ kind: 'hybrid', pips: ['laser', 'ballistic'], dice: { ballistic: 1, energy: 2 }, anchorOnHit: 1, noMass: true }),
  hppc: W({ kind: 'hybrid', pips: ['laser', 'ballistic'], dice: { ballistic: 1, energy: 3 }, anchorOnHit: 1, noMass: true }),
  lrm5: lrm(1), lrm10: lrm(2), lrm15: lrm(3), lrm20: lrm(4),
  srm2: srm(1), srm4: srm(2), srm6: srm(3),
  flamer:   W({ kind: 'special', pips: ['laser'], dice: {}, adjacentOnly: true, maxRange: 1, effect: 'overheat' }), // pip color = ASSUMPTION
  // Melee: paid with movement actions (moveCost), damage from the "ballistic/melee" die, adjacent hex only, no weapon heat.
  fist:  W({ kind: 'melee', pips: [], dice: { ballistic: 1 }, adjacentOnly: true, maxRange: 1, payWith: 'move', moveCost: 1, noHeat: true }),
  sword: W({ kind: 'melee', pips: [], dice: { ballistic: 2 }, adjacentOnly: true, maxRange: 1, payWith: 'move', moveCost: 2, noHeat: true }),
  axe:   W({ kind: 'melee', pips: [], dice: { ballistic: 3 }, adjacentOnly: true, maxRange: 1, payWith: 'move', moveCost: 3, noHeat: true }),
  plasma_s: W({ kind: 'energy', pips: ['laser'], dice: { energy: 1 }, adjacentOnly: true, plasma: true, maxRange: 1 }),
  plasma_m: W({ kind: 'energy', pips: ['laser'], dice: { energy: 2 }, adjacentOnly: true, plasma: true, maxRange: 1 }),
  plasma_h: W({ kind: 'energy', pips: ['laser'], dice: { energy: 3 }, adjacentOnly: true, plasma: true, maxRange: 1 }),
};
// Heat is derived from dice: energy = face value, ballistic = 1 per weapon, missile = 1 per die.

export const WEAPON_NAMES = {
  laser_s: 'Малый лазер', laser_m: 'Средний лазер', laser_l: 'Большой лазер',
  mg: 'MG', ac2: 'AC2', ac5: 'AC5', ac10: 'AC10', ac20: 'AC20', gauss: 'Gauss', lppc: 'LPPC', mppc: 'MPPC', hppc: 'HPPC',
  lrm5: 'LRM5', lrm10: 'LRM10', lrm15: 'LRM15', lrm20: 'LRM20', srm2: 'SRM2', srm4: 'SRM4', srm6: 'SRM6',
  flamer: 'Огнемёт', plasma_s: 'Малый резак', plasma_m: 'Средний резак', plasma_h: 'Большой резак',
  fist: 'Кулак', sword: 'Меч', axe: 'Топор',
};
