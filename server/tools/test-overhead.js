// Overhead rule: only the included source of G/L 94301000 (Utilities, 10101303/Z2) counts toward VC.
// The excluded source is dropped, and any unrecognised source is excluded by default and reported.
import assert from 'node:assert/strict';
import { orderCosts, resolveOverheadSources, apportion, unitCostEntry, costLines, round2, OVERHEAD_LABEL, OVERHEAD_SOURCE_ID } from '../cost/engine.js';
import { RULE_VERSION } from '../cost/rules.js';

const Z1 = '10101303/Z1', Z2 = '10101303/Z2';
const oh = (order, doc, amt, qty, extra = {}) => ({ OrderID: order, AccountingDocument: doc, GLAccount: '94301000', AmountInGlobalCurrency: String(amt), Quantity: String(qty), ...extra });
const mat = (order, amt) => ({ OrderID: order, AccountingDocument: 'M' + order, GLAccount: '51000000', AmountInGlobalCurrency: String(amt), Quantity: '1' });
const run = journal => { const report = {}; const orders = orderCosts(journal, report); return { orders, report, o: orders.get('O1') }; };

assert.equal(OVERHEAD_SOURCE_ID, Z2); assert.equal(OVERHEAD_LABEL, 'Utilities');
assert.match(RULE_VERSION, /^oh-[0-9a-f]{10}$/);

// 1. only the excluded source -> overhead contributes nothing (not even a zero line)
let r = run([mat('O1', 100), oh('O1', 'D1', 30, 100, { OverheadSource: Z1 })]);
assert.equal(r.o.cost, 100); assert.equal(r.o.buckets.overhead, undefined); assert.equal(r.report.excludedLines, 1); assert.equal(r.report.excludedAmount, 30);

// 2. both sources -> only the included one counts
r = run([mat('O1', 100), oh('O1', 'D1', 30, 100, { OverheadSource: Z1 }), oh('O1', 'D1', 5, 100, { OverheadSource: Z2 })]);
assert.equal(r.o.cost, 105); assert.equal(r.o.buckets.overhead, 5); assert.equal(r.report.keptLines, 1);

// 3. an unrecognised source under 94301000 is excluded by default and reported
r = run([mat('O1', 100), oh('O1', 'D1', 7, 100, { OverheadSource: '99999999/Q9' })]);
assert.equal(r.o.cost, 100); assert.equal(r.report.unknownLines, 1); assert.equal(r.report.unknownAmount, 7); assert.equal(r.report.keptLines, 0);

// 4. interim identification: of a confirmation's two overhead lines the higher rate is excluded, the lower kept
r = run([mat('O1', 100), oh('O1', 'D1', 30, 100), oh('O1', 'D1', 5, 100)]);
assert.equal(r.o.cost, 105); assert.equal(r.o.buckets.overhead, 5);
let src = resolveOverheadSources([oh('O1', 'D1', 30, 100), oh('O1', 'D1', 5, 100)]);
assert.deepEqual([...src.values()].sort(), [Z1, Z2]);
//    the order the lines arrive in does not matter, and the rate (not the amount) decides
r = run([mat('O1', 100), oh('O1', 'D1', 5, 10), oh('O1', 'D1', 30, 1000)]);     // rates 0.5 vs 0.03: the 5 is the high rate
assert.equal(r.o.buckets.overhead, 30);
//    a reversal (negative amounts and quantities) is classified the same way and nets the kept line off
r = run([mat('O1', 100), oh('O1', 'D1', 30, 100), oh('O1', 'D1', 5, 100), oh('O1', 'D2', -30, -100), oh('O1', 'D2', -5, -100)]);
assert.equal(r.o.buckets.overhead, 0); assert.equal(r.o.cost, 100);

// 5. lines that cannot be told apart are excluded, not guessed
r = run([mat('O1', 100), oh('O1', 'D1', 5, 100)]);                               // unpaired
assert.equal(r.o.cost, 100); assert.equal(r.report.unknownLines, 1);
r = run([mat('O1', 100), oh('O1', 'D1', 5, 100), oh('O1', 'D1', 5, 100)]);       // equal rates
assert.equal(r.o.cost, 100); assert.equal(r.report.unknownLines, 2);

// 6. other G/L accounts are untouched by the overhead rule
r = run([mat('O1', 100), { OrderID: 'O1', AccountingDocument: 'A1', GLAccount: '54400000', AmountInGlobalCurrency: '12', Quantity: '1' }]);
assert.equal(r.o.cost, 112); assert.equal(r.o.buckets.activities, 12);

// 7. old VC − Z1 = new VC, at order, batch and line level
const journal = [mat('O1', 100), oh('O1', 'D1', 30, 100), oh('O1', 'D1', 5, 100)];
const oldCost = journal.reduce((s, l) => s + Number(l.AmountInGlobalCurrency), 0);   // everything, as before the rule
const newOrders = orderCosts(journal);
assert.equal(oldCost - 30, newOrders.get('O1').cost);
const receipts = [{ order: 'O1', batch: 'B1', qty: 100 }];
const unit = ord => { const { batch } = apportion(ord, receipts); return unitCostEntry('B1', batch.get('B1'), true); };
const oldOrders = new Map([['O1', { cost: oldCost, buckets: {}, accounts: {} }]]);
const oldU = unit(oldOrders), newU = unit(newOrders);
const lineWith = u => costLines([{ batch: 'B1', qtyKg: 10, revenueUsd: 50 }], new Map([['B1', u]]))[0];
const oldLine = lineWith(oldU), newLine = lineWith(newU);
assert.equal(oldLine.cogmUsd, 13.5); assert.equal(newLine.cogmUsd, 10.5);
assert.equal(round2(oldLine.cogmUsd - 10 * (30 / 100)), newLine.cogmUsd);        // old − Z1 allocation = new
assert.equal(newLine.cmUsd, round2(50 - newLine.cogmUsd));                       // Revenue − new VC = new CM
assert.ok(newLine.cmUsd > oldLine.cmUsd);                                         // CM rises by exactly the Z1 amount
assert.equal(round2(newLine.cmUsd - oldLine.cmUsd), 3);
console.log('overhead rule: ALL CHECKS PASSED');
