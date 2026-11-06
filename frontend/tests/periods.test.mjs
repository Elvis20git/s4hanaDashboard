// Period panel filters/search: they only narrow rows; they never alter a status.
import assert from 'node:assert/strict';
import { filterPeriods, EMPTY_FILTERS } from '../src/lib/periodsView.js';

const R = (period, o) => ({ period, code: period.slice(5) + '.' + period.slice(0, 4), label: period, closeStatus: 'Closed', closeSource: 'calendar', loaded: 'Yes', included: 'Yes',
  breachCount: 0, badge: 'green', reason: 'Closed and loaded', error: null, ...o });
const rows = [R('2025-12', { breachCount: 2, badge: 'amber', reason: 'Included — 2 closure-control breach(es)' }), R('2026-09'), R('2026-10', { closeSource: 'manual' }),
  R('2026-11', { closeStatus: 'Open', loaded: 'No', included: 'No', badge: 'grey', reason: 'Open — excluded until month-end close' })];
const ids = f => filterPeriods(rows, { ...EMPTY_FILTERS, ...f }).map(r => r.period);

assert.deepEqual(ids({}), ['2025-12', '2026-09', '2026-10', '2026-11']);
assert.deepEqual(ids({ year: '2026' }), ['2026-09', '2026-10', '2026-11']);
assert.deepEqual(ids({ close: 'Open' }), ['2026-11']);
assert.deepEqual(ids({ included: 'No' }), ['2026-11']);
assert.deepEqual(ids({ controls: 'breach' }), ['2025-12']);
assert.deepEqual(ids({ controls: 'ok' }), ['2026-09', '2026-10']);       // open periods have no controls to be "OK"
assert.deepEqual(ids({ badge: 'grey' }), ['2026-11']);
assert.deepEqual(ids({ q: 'breach' }), ['2025-12']);
assert.deepEqual(ids({ q: '  EXCLUDED ' }), ['2026-11']);
assert.deepEqual(ids({ q: '10.2026' }), ['2026-10']);                   // the app's MM.YYYY code
assert.deepEqual(ids({ q: 'manual' }), ['2026-10']);
assert.deepEqual(ids({ year: '2026', newest: true }), ['2026-11', '2026-10', '2026-09']);
assert.deepEqual(ids({ year: '2025', close: 'Open' }), []);
assert.equal(rows[0].breachCount, 2);                                    // input untouched
console.log('periods filters: ALL CHECKS PASSED');
