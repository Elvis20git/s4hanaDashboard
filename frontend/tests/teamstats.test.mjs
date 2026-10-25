// Unit tests for the Administration overview numbers (src/lib/teamStats.js).
import assert from 'node:assert/strict';
import { teamStats, matchesFilter } from '../src/lib/teamStats.js';

const now = Date.parse('2026-10-24T12:00:00Z');
const day = n => new Date(now - n * 86400000).toISOString();
const U = [
  { role: 'SUPERUSER', status: 'ACTIVE', is_data_steward: true, last_login: day(0.1) },
  { role: 'SUPERUSER', status: 'ACTIVE', is_data_steward: true, last_login: day(30) },
  { role: 'ANALYST', status: 'ACTIVE', is_data_steward: false, last_login: null },
  { role: 'VIEWER', status: 'ACTIVE', is_data_steward: false, last_login: day(6.9) },
  { role: 'VIEWER', status: 'INACTIVE', is_data_steward: true, last_login: day(1) },
];
const s = teamStats(U, now);
assert.deepEqual(s, { total: 5, active: 4, inactive: 1, roles: { SUPERUSER: 2, ANALYST: 1, VIEWER: 2 }, stewards: 3, recent: 2, never: 1 });
assert.equal(s.active + s.inactive, s.total);
assert.equal(s.roles.SUPERUSER + s.roles.ANALYST + s.roles.VIEWER, s.total, 'the role mix covers every member');
// every overview number is what the member list shows when its filter is applied
for (const [f, n] of [['ALL', 5], ['SUPERUSER', 2], ['VIEWER', 2], ['STEWARD', s.stewards], ['INACTIVE', s.inactive], ['RECENT', s.recent], ['NEVER', s.never]]) {
  assert.equal(U.filter(u => matchesFilter(u, f, now)).length, n, f);
}
assert.deepEqual(teamStats([], now), { total: 0, active: 0, inactive: 0, roles: { SUPERUSER: 0, ANALYST: 0, VIEWER: 0 }, stewards: 0, recent: 0, never: 0 });
console.log('team stats: ALL CHECKS PASSED');
