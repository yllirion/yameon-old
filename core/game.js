import { apply } from './engine.js';

// Thin wrapper with undo. Undo is allowed only until an "event that rolls dice" (anything that used the RNG)
// or a barrier action; history is cleared at that point.
const BARRIERS = new Set(['END_ACTIVATION', 'RESOLVE_DECISION', 'ROLL_PILOT', 'EMERGENCY_SHUTDOWN']);
export class Game {
  constructor(state) { this.state = state; this.history = []; }
  dispatch(action) {
    const r = apply(this.state, action);
    if (!r.ok) return r;
    if (r.usedRng || BARRIERS.has(action.type)) this.history = [];
    else this.history.push(this.state);
    this.state = r.state;
    return r;
  }
  canUndo() { return this.history.length > 0; }
  undo() { if (this.history.length) this.state = this.history.pop(); return this.state; }
}
