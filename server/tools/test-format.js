// Unit tests for the shared compact money formatter used by the chart / month-by-month tooltips.
// public/format.js is a plain browser script, so it is loaded here the same way a browser would run it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'format.js'), 'utf8');
const ctx = {}; ctx.globalThis = ctx; vm.runInNewContext(src, ctx);
const { formatMoneyCompact: f, formatAvgPriceKg: kg } = ctx;

const cases = [
  [2662998, '$2.66M'], [2000000, '$2M'], [1500000, '$1.50M'],
  [230010, '$230.01K'], [230000, '$230K'], [1180, '$1.18K'],
  [950, '$950'], [949.5, '$949.50'], [-15800, '-$15.80K'], [1250000000, '$1.25B'],
  // rollover after rounding
  [999996, '$1M'], [999999999, '$1B'], [999994, '$999.99K'], [999.996, '$1K'], [999.99, '$999.99'], [999994999, '$999.99M'],
  // zero, tiny and negative edges
  [0, '$0'], [-0.001, '$0'], [0.4, '$0.40'], [-1500000, '-$1.50M'], [-999996, '-$1M'], [-950, '-$950'], [1000, '$1K'], [1000000, '$1M'], [1e9, '$1B'],
  // the real September figures
  [2662998.22, '$2.66M'], [2432988.41, '$2.43M'], [230009.81, '$230.01K'],
  [null, '—'], [undefined, '—'], [NaN, '—'],
];
for (const [v, want] of cases) assert.equal(f(v), want, `formatMoneyCompact(${v}) -> ${f(v)}, wanted ${want}`);

assert.equal(kg(1.51), '$1.51 /kg'); assert.equal(kg(1.5102), '$1.51 /kg'); assert.equal(kg(2), '$2 /kg'); assert.equal(kg(1.5), '$1.50 /kg');
assert.equal(kg(null), '—'); assert.equal(kg(1.9996), '$2 /kg');
console.log('money formatter: ALL CHECKS PASSED');
