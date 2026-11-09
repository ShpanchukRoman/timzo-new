import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, isoWeek, entryDate, shiftHours, entryHours, validHours } from '../lib/schedule-domain.mjs';

test('ISO weeks remain correct across year boundaries and reject impossible week 53', () => {
  assert.equal(weekStart('2026-W01').toISOString().slice(0,10), '2025-12-29');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(weekStart('2025-W53'), null);
  for (const invalid of ['2026-W00','2026-W54','2026-W1','garbage',null]) assert.equal(weekStart(invalid), null);
  assert.equal(entryDate('2026-W01',6).toISOString().slice(0,10), '2026-01-04');
});
test('shift validation accepts the editor format and rejects impossible or reversed times', () => {
  assert.equal(shiftHours('09:15 - 17:30'), 8.25);
  assert.equal(shiftHours('9 - 17'), 8);
  assert.equal(shiftHours(''), 0);
  for (const value of ['25:00 - 26:00','09:75 - 17:00','17:00 - 09:00','09:00 - 09:00','invalid']) assert.equal(shiftHours(value), null);
});
test('daily hours apply the existing one-hour break once across both shifts', () => {
  assert.equal(entryHours({ primary: '09:00 - 12:00', secondary:'13:00 - 16:00' }),5);
  assert.equal(entryHours({ primary:'09:00 - 14:30', secondary:'' }),5.5);
  assert.equal(entryHours({ primary:'09:00 - 14:45', secondary:'' }),4.75);
  assert.equal(entryHours({ primary:'09:00 - 17:00', secondary:'',locked:true }),0);
});
test('hour plans reject negative, nonfinite, excessive, or nonnumeric input', () => {
  for (const value of [0,26,'180.25']) assert.equal(validHours(value),true);
  for (const value of [-1,Infinity,NaN,'',null,{},100001,'bad']) assert.equal(validHours(value),false);
});
