import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRS, distance, inArc, line, lineVariants, neighbor, offsetToAxial } from '../core/hex.js';
import { makeRng } from '../core/rng.js';
import { createMap } from '../core/state.js';
import { actionsFor } from '../core/movement.js';

test('distance and neighbors', () => {
  assert.equal(distance({ q: 0, r: 0 }, { q: 3, r: 0 }), 3);
  assert.equal(distance({ q: 0, r: 0 }, { q: 2, r: 2 }), 4);
  for (const d of DIRS) assert.equal(distance({ q: 0, r: 0 }, neighbor({ q: 0, r: 0 }, DIRS.indexOf(d))), 1);
});

test('line includes both ends and has distance+1 hexes', () => {
  const a = { q: 0, r: 0 }, b = { q: 4, r: 2 };
  for (const l of lineVariants(a, b)) {
    assert.equal(l.length, distance(a, b) + 1);
    assert.deepEqual(l[0], a); assert.deepEqual(l.at(-1), b);
  }
  assert.deepEqual(line(a, { q: 3, r: 0 }).map((h) => h.q), [0, 1, 2, 3]);
});

test('120° front arc', () => {
  const o = { q: 0, r: 0 };
  assert.ok(inArc(o, 0, { q: 3, r: 0 }));          // dead ahead
  assert.ok(inArc(o, 0, { q: 0, r: 2 }));          // exactly +60° → inclusive
  assert.ok(!inArc(o, 0, { q: 0, r: 2 }, 120, false));
  assert.ok(!inArc(o, 0, { q: -2, r: 1 }));        // behind-ish
  assert.ok(!inArc(o, 0, { q: -3, r: 0 }));
});

test('rng is deterministic and state is resumable', () => {
  const a = makeRng(42), b = makeRng(42);
  assert.deepEqual([a.int(6), a.int(6), a.int(6)], [b.int(6), b.int(6), b.int(6)]);
  const c = makeRng(a.state());
  assert.equal(c.int(1000), a.int(1000));
});

test('map 17/16 with edge distances for class restrictions', () => {
  const m = createMap();
  assert.equal(Object.keys(m.cells).length, 281);
  const edge = (c, r) => m.cells[`${offsetToAxial(c, r).q},${r}`].edge;
  assert.equal(edge(0, 5), 1);
  assert.equal(edge(8, 8) >= 4, true);
});

test('speed rating → movement actions', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => actionsFor('2+', n)), [0, 2, 4, 5, 6]);
  assert.deepEqual([0, 1, 2, 3].map((n) => actionsFor('1+', n)), [0, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => actionsFor('2', n)), [0, 1, 2, 2, 3, 3]);
  assert.deepEqual([0, 1, 2, 3].map((n) => actionsFor('1', n)), [0, 1, 1, 2]);
  assert.deepEqual([0, 1, 2, 3].map((n) => actionsFor('0', n)), [0, 0, 1, 1]);
  assert.equal(actionsFor('X', 5), 5);
});
