export const TERRAIN = {
  plain:     { color: 'DCD7AF' },
  rock:      { color: 'AAAAAA', moveExtra: 1, armor: 1 },
  fire:      { color: 'EB2D2D', fire: true, laserRangePenalty: 1 },
  water:     { color: '87BEFF', extraCool: 1, waterLaser: 1 },   // laser range −waterLaser per overheat token of a mech standing here
  deepWater: { color: '3232B4', moveExtra: 1, extraCool: 1, waterLaser: 2, forbidClass: ['light'] },
  building:  { color: '8C8C8C', blocksMove: true, blocksLos: true, hp: 4 },
  cliff:     { color: '000000', blocksMove: true, blocksLos: true, indestructible: true },
  mud:       { color: '463228', moveExtra: 1 },
};
