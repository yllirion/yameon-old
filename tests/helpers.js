import { createGame } from '../core/engine.js';
import { offsetToAxial } from '../core/hex.js';

export const at = (col, row) => offsetToAxial(col, row);
export const mech = (id, owner, cls, col, row, extra = {}) => ({ id, owner, cls, pos: at(col, row), ...extra });
export const game = (mechs, opts = {}) => createGame({ seed: 7, mechs, ...opts });

// Put the engine into the PLAY phase with a hand-picked pool (state is plain JSON, so tests can set it).
export function playWith(state, apply, player, mechId, colors, { evade = [] } = {}) {
  let r = apply(state, { type: 'ACTIVATE', player, mechId });
  if (!r.ok) throw new Error(r.error);
  const s = r.state;
  s.activation.phase = 'PLAY';
  s.activation.pool = colors.map((color, i) => ({ id: `d${i}`, die: i, color, evade: evade.includes(i), spent: false, origin: 'roll' }));
  return s;
}
