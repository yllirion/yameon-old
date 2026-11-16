// Test scenario shared by the hot-seat client and the network server.
import { createGame } from '../core/engine.js';
import { offsetToAxial as ax } from '../core/hex.js';
import { mechFromBuild } from '../core/data/slots.js';
import { BUILDS } from './builds.js';

// ---- scenario: 4 vs 4 from the test builds, on the 17/16 map
const T = (col, row, type, cover) => ({ col, row, type, cover });
const terrain = [T(8,8,'building'),T(8,7,'building'),T(7,9,'rock'),T(9,9,'rock'),T(8,4,'cliff'),T(8,5,'cliff'),T(8,11,'cliff'),T(8,12,'cliff'),
  T(6,6,'fire'),T(10,10,'fire'),T(5,8,'mud'),T(11,8,'mud'),T(7,12,'water'),T(9,4,'water'),T(10,12,'deepWater'),T(6,4,'deepWater'),T(6,10,'rock',1),T(10,6,'rock',1)];
const mirror = (col, row) => (row & 1 ? 15 : 16) - col;               // odd rows are 16 wide
const TEAMS = [
  { owner: 1, id: 'a', picks: [['Light_Armor5_Speed2plus', 3, 14], ['Medium_Armor4_Speed1plus', 4, 11], ['Heavy_Armor3_Speed2', 4, 5], ['Assault_Armor4_Speed2', 4, 8], ['Light_Armor3_Speed1plus', 2, 11]] },
  { owner: 2, id: 'b', picks: [['Light_Armor1_Speed1plus', 3, 14], ['Medium_Armor3_SpeedX', 4, 11], ['Heavy_Armor5_SpeedX', 4, 5], ['Assault_Armor5_Speed1', 4, 8]] },
];
export const newGameState = (seed = (Math.random() * 1e9) | 0) => {
  const mechs = [];
  for (const t of TEAMS) t.picks.forEach(([file, col, row], i) => {
    const b = BUILDS[file], c = t.owner === 1 ? col : mirror(col, row);
    const { spec, unknown } = mechFromBuild(b, { id: t.id + (i + 1), owner: t.owner, pos: ax(c, row), facing: t.owner === 1 ? 0 : 3 });
    spec.name = `${b.mechClass} ${spec.armorClass}/${spec.speed} · И${t.owner}`;
    if (unknown.length) console.warn('unknown slots', file, unknown);
    mechs.push(spec);
  });
  const init = createGame({ seed, map: { terrain }, mechs });
  init.holdAttack = true;                    // the shot window always waits for "finish the shot" (draggable), even with nothing to correct
  return init;
};
