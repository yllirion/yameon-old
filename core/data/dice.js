export const PILOT_FACES = ['laser', 'ballistic', 'missile', 'jumpjet', 'move', 'move'];
// Pilot die #i carries the extra "evade" mark on face #i (face === die index).

export const ENERGY_DIE = [1, 1, 1, 1, 2, 3]; // heat per die; every energy die = 1 damage
export const MISSILE_DIE = [
  { dmg: 0 }, { dmg: 0 }, { dmg: 2, srm: true }, { dmg: 2, srm: true }, { dmg: 2 }, { dmg: 3 },
];
export const BALLISTIC_DIE = [
  { dmg: 0 }, { dmg: 1, missMid: true }, { dmg: 1, missLong: true }, { dmg: 1 }, { dmg: 2 }, { dmg: 3 },
];
export const DAMAGE_DIE = ['hit', 'hit', 'crit_control', 'crit_armor', 'crit_cooling', 'hit'];

// Armor die by class: faces [0, 0, 1*, 1**, a, b]. "*" is voided by the 1st armor crit, "**" by the 2nd.
export const armorFaces = ([a, b]) => [
  { v: 0 }, { v: 0 }, { v: 1, mark: 1 }, { v: 1, mark: 2 }, { v: a }, { v: b },
];
