import { armorFaces } from './dice.js';
export const CLASS_ORDER = ['light', 'medium', 'heavy', 'assault'];
export const CLASSES = {
  light:   { rank: 1, durability: 3, heatCapacity: 1, edgeMin: 1, armor: armorFaces([1, 2]),
             abilities: { innateVirtualEvade: 1, swapToMove: 3 } },
  medium:  { rank: 2, durability: 4, heatCapacity: 2, edgeMin: 2, armor: armorFaces([2, 2]),
             abilities: { anyToChoice: 1 } },
  heavy:   { rank: 3, durability: 5, heatCapacity: 3, edgeMin: 3, armor: armorFaces([2, 3]),
             abilities: { maxStoredEvade: 1, pairToChoice: 1 } },
  assault: { rank: 4, durability: 6, heatCapacity: 4, edgeMin: 4, armor: armorFaces([3, 3]),
             abilities: { maxStoredEvade: 0, swapFromMove: 1 } },
};
// edgeMin = minimal distance to the off-board hexes (1 = on the very border, allowed for light).
