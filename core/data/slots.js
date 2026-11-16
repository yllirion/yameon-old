// Build "slots" (Russian/English item names from the mech builder) → engine data.
const LOOK = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' }; // Cyrillic look-alikes
export const norm = (s) => s.trim().replace(/[АВСЕНКМОРТХ]/g, (c) => LOOK[c]).toUpperCase();
const table = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [norm(k), v]));

export const WEAPON_SLOTS = table({
  'MG': 'mg', 'AC2': 'ac2', 'AC5': 'ac5', 'AC10': 'ac10', 'AC20': 'ac20', 'Gauss': 'gauss',
  'LPPC': 'lppc', 'MPPC': 'mppc', 'HPPC': 'hppc',
  'LRM5': 'lrm5', 'LRM10': 'lrm10', 'LRM15': 'lrm15', 'LRM20': 'lrm20', 'SRM2': 'srm2', 'SRM4': 'srm4', 'SRM6': 'srm6',
  'Малый лазер': 'laser_s', 'Средний лазер': 'laser_m', 'Большой лазер': 'laser_l', 'Огнемет': 'flamer',
  'Малый резак': 'plasma_s', 'Средний резак': 'plasma_m', 'Большой резак': 'plasma_h', 'Тяжелый резак': 'plasma_h', // "Большой" = heavy: ASSUMPTION
  'Кулак': 'fist', 'Меч': 'sword', 'Топор': 'axe', // melee: 1 / 2 / 3 movement actions, 1 / 2 / 3 ballistic dice
});

// Returns { weapons:[type], equipment:{}, coolers, unknown:[slot] }
export function parseSlots(slots) {
  const out = { weapons: [], equipment: {}, coolers: 'standard', unknown: [] };
  for (const raw of slots) {
    const s = norm(raw);
    let m;
    if (WEAPON_SLOTS[s]) out.weapons.push(WEAPON_SLOTS[s]);
    else if ((m = /^(STD|COMPACT|DOUBLE)\s*\+\d+/.exec(s))) out.coolers = m[1].toLowerCase() === 'std' ? 'standard' : m[1].toLowerCase();
    // JJ-I..JJ-IV is ONE jump jet unit of that size class (I light … IV assault), not several units
    else if (/^JJ-(I{1,3}|IV|V)$/.test(s)) { out.equipment.jumpjets = (out.equipment.jumpjets ?? 0) + 1; (out.equipment.jjNames ??= []).push(raw.trim()); }
    else if (s.startsWith('MASC')) out.equipment.masc = true;
    else if (s.startsWith('OMNI SHIELD')) out.equipment.os = true;
    else if (s === 'GA' || s.startsWith('GA ')) out.equipment.ga = true;
    else if (s === 'AMS') out.equipment.ams = (out.equipment.ams ?? 0) + 1;
    else if (s === 'ECM') out.equipment.ecm = true;
    else if (s === 'CC') out.equipment.cc = true;
    else if (s === 'TC') out.equipment.tc = true;
    else out.unknown.push(raw);
  }
  return out;
}

// Mech-builder JSON → createGame() mech spec.
export function mechFromBuild(b, { id, name, owner, pos, facing }) {
  const p = parseSlots(b.slots ?? []);
  return {
    spec: {
      id, name, owner, pos, facing, cls: String(b.mechClass).toLowerCase(), speed: norm(String(b.speed)),
      armorClass: Number(b.armor), heatCapacity: Number(b.heatcapacity), weapons: p.weapons, equipment: p.equipment, coolers: p.coolers,
    },
    unknown: p.unknown,
  };
}
