import { CLASSES } from './data/classes.js';
import { TERRAIN } from './data/terrain.js';
import { key, neighbors, offsetToAxial } from './hex.js';

export const rankOf = (m) => CLASSES[m.cls].rank;
export const getCell = (map, h) => map.cells[key(h)];
export const mechAt = (s, pos, exceptId) =>
  Object.values(s.mechs).find((m) => m.id !== exceptId && (m.status === 'active' || m.status === 'disabled') && key(m.pos) === key(pos));
export const heatCapacity = (m) => m.heatCapacity ?? CLASSES[m.cls].heatCapacity + (m.equipment.heatBonus ?? 0); // a build may set its own capacity
export const evadeOf = (m) => ({
  evade: m.evade,
  virtual: m.virtualEvade + (CLASSES[m.cls].abilities.innateVirtualEvade ?? 0) + (m.equipment.ecm ? 1 : 0),
});

// terrain: [{ col, row, type, cover? }] in offset coordinates (odd-r), 17x17 by default
export function createMap({ width = 17, height = 17, terrain = [] } = {}) {
  const cells = {};
  for (let row = 0; row < height; row++)
    for (let col = 0; col < (row & 1 ? width - 1 : width); col++) { // odd rows have one hex less: a tidy rectangle
      const h = offsetToAxial(col, row);
      cells[key(h)] = { ...h, col, row, terrain: 'plain', cover: 0, hp: 0, edge: 0 };
    }
  for (const t of terrain) {
    const c = cells[key(offsetToAxial(t.col, t.row))];
    if (!c) throw new Error(`terrain outside map: ${t.col},${t.row}`);
    c.terrain = t.type; c.cover = t.cover ?? 0; c.hp = TERRAIN[t.type].hp ?? 0;
  }
  // distance to the nearest off-board hex (1 = border hex)
  let frontier = Object.values(cells).filter((c) => neighbors(c).some((n) => !cells[key(n)]));
  frontier.forEach((c) => (c.edge = 1));
  while (frontier.length) {
    const next = [];
    for (const c of frontier)
      for (const n of neighbors(c)) {
        const nc = cells[key(n)];
        if (nc && !nc.edge) { nc.edge = c.edge + 1; next.push(nc); }
      }
    frontier = next;
  }
  return { width, height, cells };
}

export function makeMech(spec) {
  if (!CLASSES[spec.cls]) throw new Error(`unknown class ${spec.cls}`);
  return {
    id: spec.id, owner: spec.owner, name: spec.name ?? spec.id, cls: spec.cls,
    pos: { ...spec.pos }, facing: spec.facing ?? 0,
    speed: spec.speed ?? '1',                       // '2+','1+','X','2','1','0'
    armorClass: spec.armorClass ?? CLASSES[spec.cls].rank,
    weapons: (spec.weapons ?? []).map((type, i) => ({ id: `w${i}`, type })),
    equipment: { jumpjets: 0, jjNames: [], ecm: false, masc: false, cc: false, tc: false, os: false, ga: false, ams: 0, ...(spec.equipment ?? {}) },
    ...(spec.heatCapacity != null ? { heatCapacity: spec.heatCapacity } : {}),
    coolers: spec.coolers ?? 'standard',            // 'standard' | 'compact' | 'double'
    damage: 0, crits: { control: 0, armor: 0, cooling: 0 },
    overheat: 0, evade: 0, virtualEvade: 0, anchor: 0, blind: spec.blind ?? 0,
    activated: false, status: 'active',             // active | disabled | destroyed
    forcedShutdown: false,
  };
}

// Targets: a mech id, or "bld:q,r" for a building hex (a light pseudo-target built on the fly, never stored in s.mechs).
export const buildingId = (h) => `bld:${h.q},${h.r}`;
export function targetOf(s, id) {
  if (s.mechs[id]) return s.mechs[id];
  if (!String(id).startsWith('bld:')) return null;
  const [q, r] = id.slice(4).split(',').map(Number), cell = getCell(s.map, { q, r });
  if (!cell || cell.terrain !== 'building') return null;
  return { id, name: 'Здание', isBuilding: true, pos: { q, r }, owner: 0, status: 'active', cls: 'assault', facing: 0, evade: 0, virtualEvade: 0, overheat: 0, anchor: 0,
    crits: { control: 0, armor: 0, cooling: 0 }, equipment: {}, weapons: [], armorClass: 0 };
}
