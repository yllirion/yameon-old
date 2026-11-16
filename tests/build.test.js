import test from 'node:test';
import assert from 'node:assert/strict';
import { mechFromBuild, parseSlots } from '../core/data/slots.js';
import { createMap } from '../core/state.js';
import { createGame } from '../core/engine.js';
import { at } from './helpers.js';

test('map: even rows 17 hexes, odd rows 16', () => {
  const m = createMap();
  assert.equal(Object.keys(m.cells).length, 9 * 17 + 8 * 16);
  const inRow = (r) => Object.values(m.cells).filter((c) => c.row === r).length;
  assert.deepEqual([inRow(0), inRow(1), inRow(2), inRow(16)], [17, 16, 17, 17]);
});

test('builds: JJ-II is ONE jump jet (not two), a mech may carry several JJ slots', () => {
  assert.equal(parseSlots(['JJ-II']).equipment.jumpjets, 1);
  assert.equal(parseSlots(['JJ-IV']).equipment.jumpjets, 1);
  assert.equal(parseSlots(['JJ-I', 'JJ-I']).equipment.jumpjets, 2);
  assert.deepEqual(parseSlots(['Кулак', 'Меч', 'Топор']).weapons, ['fist', 'sword', 'axe']);
});

test('builds: slots → weapons / equipment / coolers (Cyrillic look-alikes included)', () => {
  const p = parseSlots(['АС10', 'SRM4', 'MASC A', 'TC', 'ECM', 'AMS', 'JJ-III', 'COMPACT +2', 'Малый лазер', 'Большой резак', 'Omni Shield M', 'CC', 'Нечто']);
  assert.deepEqual(p.weapons, ['ac10', 'srm4', 'laser_s', 'plasma_h']);
  assert.deepEqual(p.equipment, { masc: true, tc: true, ecm: true, ams: 1, jumpjets: 1, jjNames: ['JJ-III'], os: true, cc: true });
  assert.equal(p.coolers, 'compact'); assert.deepEqual(p.unknown, ['Нечто']);
});

test('build → mech: Cyrillic speed "Х", own heat capacity and armor class', () => {
  const { spec } = mechFromBuild({ mechClass: 'Heavy', armor: '5', speed: 'Х', heatcapacity: 3.0, slots: ['MG', 'MASC H'] }, { id: 'h', name: 'H', owner: 1, pos: at(3, 8), facing: 0 });
  assert.equal(spec.speed, 'X'); assert.equal(spec.armorClass, 5); assert.equal(spec.heatCapacity, 3); assert.equal(spec.cls, 'heavy');
  const g = createGame({ mechs: [spec] });
  assert.equal(g.mechs.h.heatCapacity, 3); assert.equal(g.mechs.h.equipment.masc, true);
});
