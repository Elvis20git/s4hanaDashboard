// The module registry drives the sidebar, the router and the sticky filter bar, so its shape is checked here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'modules.js'), 'utf8') + '\nthis.MODULES = MODULES; this.APP_NAME = APP_NAME;', ctx);
const M = JSON.parse(JSON.stringify(ctx.MODULES));   // plain objects of this realm (arrays made in the sandbox are not deepEqual to ours)

assert.equal(M.length, 8);
assert.deepEqual(M.map(m => m.label), ['Sales', 'Production', 'AR & AP aging', 'Inventory', 'Goods in transit', 'Tax', 'Data Management', 'Administration']);
assert.equal(new Set(M.map(m => m.route)).size, M.length, 'routes are unique');
for (const m of M) {
  for (const k of ['route', 'group', 'label', 'icon', 'title', 'subtitle', 'status']) assert.ok(m[k], `${m.route}: ${k}`);
  assert.ok(['live', 'soon'].includes(m.status)); assert.ok(['modules', 'governance'].includes(m.group));
  assert.equal(typeof m.filters, 'object', `${m.route}: filters`);
  if (m.status === 'soon') assert.ok(m.description, `${m.route}: a soon module has placeholder copy`);
}
assert.deepEqual(M.filter(m => m.status === 'soon').map(m => m.route), ['production', 'ar-ap-aging', 'inventory', 'goods-in-transit', 'tax']);
// the status dots and "Data through" belong to Sales only; Data Management and Administration have no period filters
const sales = M.find(m => m.route === 'overview');
assert.deepEqual(sales.filters, { period: true, dataThrough: true, statusDots: true });
assert.deepEqual(M.filter(m => m.filters.statusDots).map(m => m.route), ['overview']);
assert.deepEqual(M.filter(m => m.filters.dataThrough).map(m => m.route), ['overview']);
for (const r of ['data', 'admin']) assert.equal(!!M.find(m => m.route === r).filters.period, false);
assert.equal(ctx.APP_NAME, 'AIF Analytics');
console.log('module registry: ALL CHECKS PASSED');
