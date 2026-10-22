// Finished Goods ("B2B/B2C") vs Other: the classifier rule, and that the per-period split reconciles to the totals.
import assert from 'node:assert/strict';
import { isFinishedGood, productGroup, normalizeMaterial, categoryOf } from '../lib/productGroup.js';
import { aggregate, sections } from '../pipeline/aggregate.js';

assert.equal(productGroup('11000033'), 'B2B/B2C');
assert.equal(productGroup('000000000011000033'), 'B2B/B2C');   // SAP zero-padding
assert.equal(productGroup('  11000013 '), 'B2B/B2C');          // whitespace
assert.equal(productGroup(11000013), 'B2B/B2C');               // numeric
assert.equal(productGroup('13000001'), 'Other');
assert.equal(productGroup('21000007'), 'Other');
assert.equal(productGroup('61000011'), 'Other');
assert.equal(productGroup('000000000013000001'), 'Other');
assert.equal(productGroup('1000011'), 'Other');                // contains 11 but doesn't start with it
assert.equal(productGroup(null), 'Other');
assert.equal(productGroup(undefined), 'Other');
assert.equal(productGroup(''), 'Other');
assert.equal(productGroup('0000'), 'Other');
assert.equal(normalizeMaterial('0001100'), '1100');
assert.equal(isFinishedGood('11'), true);

const line = (material, rev, mt) => ({ period: '09.2026', material, customer: 'C', revenueUsd: rev, qtyMt: mt, cogmUsd: null, cmUsd: null, costStatus: 'none' });
const data = { source: 'api', lines: [
  line('000000000011000033', 2000, 1500), line('11000013', 610, 425.9),
  line('13000001', 80.4, 12), line('61000011', 40, null) /* no MT conversion */, line('S0001', 0.1, null),
] };
const [sep] = aggregate(data, {}).periods;
const g = sep.groups;
assert.equal(g.fg.revenue, 2610); assert.equal(g.fg.qtyMt, 1925.9);
assert.equal(g.other.revenue, 120.5); assert.equal(g.other.qtyMt, 12);
assert.equal(Math.round((g.fg.revenue + g.other.revenue) * 100) / 100, sep.revenue);
assert.equal(Math.round((g.fg.qtyMt + g.other.qtyMt) * 10) / 10, sep.qtyMt);

// categories inside Other
assert.deepEqual(categoryOf('13000001'), { group: 'other', key: 'byproducts', title: 'By-products' });
assert.equal(categoryOf('000000000021000041').key, 'raw');
assert.equal(categoryOf('61000009').key, 'nonstock');
assert.equal(categoryOf('S0001').key, 'misc');
assert.equal(categoryOf(null).key, 'misc');
assert.equal(categoryOf('11000033').group, 'fg');

// sections: rows -> category -> Other -> grand total, and FG + Other = total
const cust = (customer, material, rev) => ({ ...line(material, rev, 1), customer, customerName: customer });
const many = { source: 'api', lines: [
  cust('A', '11000033', 1000), cust('A', '13000000', 50), cust('B', '11000013', 400), cust('B', '61000009', 30),
  cust('C', '13000002', 20), cust('C', '99999999', 5), cust('D', '11000033', -100),
] };
const sec = sections(many.lines), all = aggregate(many, {}).total;
const [pfg, poth] = sec.products;
const sum = (xs, k) => Math.round(xs.reduce((s, x) => s + x[k], 0) * 100) / 100;
assert.equal(pfg.rows.length, 2); assert.equal(sum(pfg.rows, 'revenue'), pfg.total.revenue);
assert.equal(pfg.total.revenue, 1300);                         // 1000 + 400 - 100
assert.deepEqual(poth.categories.map(c => c.key), ['byproducts', 'nonstock', 'misc']);
poth.categories.forEach(c => assert.equal(sum(c.rows, 'revenue'), c.total.revenue));
assert.equal(sum(poth.categories.map(c => c.total), 'revenue'), poth.total.revenue);
assert.equal(poth.total.revenue, 105);
assert.deepEqual(poth.rows.map(r => r.code), ['13000000', '61000009', '13000002', '99999999']);   // flat, by revenue, nothing dropped
assert.equal(sum(poth.rows, 'revenue'), poth.total.revenue);
assert.equal(poth.rows.length, poth.categories.reduce((n, c) => n + c.rows.length, 0));
assert.equal(Math.round((pfg.total.revenue + poth.total.revenue) * 100) / 100, all.revenue);
const [cfg, coth] = sec.customers;
assert.deepEqual(cfg.rows.map(r => r.code).sort(), ['A', 'B', 'D']);          // customers with FG sales
assert.deepEqual(coth.rows.map(r => r.code).sort(), ['A', 'B', 'C']);         // A and B appear in both
assert.equal(cfg.rows.find(r => r.code === 'A').revenue, 1000); assert.equal(coth.rows.find(r => r.code === 'A').revenue, 50);
assert.equal(sum(cfg.rows, 'revenue'), cfg.total.revenue); assert.equal(sum(coth.rows, 'revenue'), coth.total.revenue);
assert.equal(Math.round((cfg.total.revenue + coth.total.revenue) * 100) / 100, all.revenue);
assert.deepEqual(sections([]).products[1].categories, []);

// FG margin per aggregate (the Sales-by-period tooltip and CM bars): FG CM and CM % of FG revenue, Others excluded
const costed = (material, rev, mt, cogm) => ({ ...line(material, rev, mt), cogmUsd: cogm, cmUsd: rev - cogm, costStatus: 'final' });
const fgData = { source: 'api', lines: [costed('11000033', 1000, 100, 800), costed('11000013', 500, 50, 400), costed('13000000', 200, 20, 0)] };
const fgP = aggregate(fgData, {}).periods[0];
assert.equal(fgP.groups.fg.revenue, 1500); assert.equal(fgP.groups.fg.qtyMt, 150);
assert.equal(fgP.groups.fg.cogm, 1200);                                   // FG variable cost only
assert.equal(fgP.groups.fg.revenue - fgP.groups.fg.cogm, fgP.groups.fg.cm);     // Revenue - VC = CM
assert.equal(fgP.groups.fg.cogmPct, 80);                                    // VC % of FG revenue
assert.equal(fgP.groups.fg.cogmPct + fgP.groups.fg.cmPct, 100);                  // VC % + CM % = 100%
assert.equal(fgP.groups.fg.cm, 300); assert.equal(fgP.groups.fg.cmPct, 20);     // 300 / 1500, not diluted by Others
assert.equal(fgP.cm, 500);                                                      // the total CM still includes Others
assert.equal(aggregate({ source: 'api', lines: [line('13000000', 5, 1)] }, {}).periods[0].groups.fg.cm, null);

// zero-cost assumption split by basis (status dot) and whole-dataset vs in-period breach counts
const az = (material, rev) => ({ ...line(material, rev, 1), cogmUsd: 0, cmUsd: rev, costStatus: 'assumed-zero', batch: 'B-' + material });
const zeroData = { source: 'api', lines: [az('13000000', 100), az('61000009', 30), az('11000013', 7), costed('11000033', 500, 5, 400)],
  controls: { reconciliation: { pass: true },
    batchClosure: { breaches: [{ batch: 'B-13000000' }, { batch: 'B-OUT' }] }, orderClosure: { breaches: [] },
    quantityControl: { breaches: [{ batch: 'B-13000000' }, { batch: 'B-OUT' }, { batch: 'B-OUT2' }] } } };
const zr = aggregate(zeroData, {});
assert.equal(zr.total.revenueAssumedZero, 137);
assert.equal(zr.total.groups.fg.revenueAssumedZero, 7); assert.equal(zr.total.groups.other.revenueAssumedZero, 130);
assert.equal(zr.total.groups.fg.revenueAssumedZero + zr.total.groups.other.revenueAssumedZero, zr.total.revenueAssumedZero);
assert.equal(zr.periods[0].groups.other.revenueAssumedZero, 130);
assert.equal(zr.controls.batchBreaches, 1); assert.equal(zr.controls.quantityBreaches, 1);               // in this selection
assert.deepEqual(zr.controls.dataset, { batch: 2, order: 0, quantity: 3 });                                // the whole dataset
console.log('product group: ALL CHECKS PASSED');
