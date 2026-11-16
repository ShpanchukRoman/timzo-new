import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the same date lookup that joins adjacent absence cells in the planner.
const source = readFileSync(new URL('../public/schedule.js', import.meta.url), 'utf8');
const lookup = source.slice(source.indexOf('const absenceCache ='), source.indexOf('function openEmployeeSettings'));
function planner(start, absences) {
  const dates = Array.from({length: 7}, (_, i) => new Date(Date.parse(start) + i * 86400000));
  const context = vm.createContext({ currentWeekDates: dates, formatDateISO: d => d.toISOString().slice(0,10) });
  vm.runInContext(lookup, context);
  return { row: {dataset: {absences: JSON.stringify(absences)}}, at: (row, i) => context.absenceForDay(row, i) };
}
const vacation = {type: 'vacation', start: '2026-11-19', end: '2026-11-25'};
test('absence includes both boundaries and continues into the following week', () => {
  const first = planner('2026-11-16', [vacation]);
  assert.equal(first.at(first.row, 2), undefined);
  assert.equal(first.at(first.row, 3).type, 'vacation');
  assert.equal(first.at(first.row, 6).type, 'vacation');
  const next = planner('2026-11-23', [vacation]);
  assert.equal(next.at(next.row, 0).type, 'vacation');
  assert.equal(next.at(next.row, 2).type, 'vacation');
  assert.equal(next.at(next.row, 3), undefined);
});
test('adjacent cells share an absence identity for a single spanning frame', () => {
  const p = planner('2026-11-16', [vacation]);
  assert.equal(p.at(p.row, 3), p.at(p.row, 4));
});
test('removing an absence invalidates the rendered lookup immediately', () => {
  const p = planner('2026-11-16', [vacation]);
  assert.equal(p.at(p.row, 3).type, 'vacation');
  p.row.dataset.absences = '[]';
  assert.equal(p.at(p.row, 3), undefined);
});
