import { getAll, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';

const [jrows, mrows] = await Promise.all([
  getAll('journal', 'YY1_AIF_JOURNAL_REV', {
    $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and OrderID ne ''` }, { page: 5000 }),
  getAll('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, { page: 5000 }),
]);
// Real production orders = those that received a batch via movement 101.
const prodOrders = new Set(mrows.filter(r => !r.GoodsMovementIsCancelled && r.Batch)
  .map(r => r.ManufacturingOrder || r.OrderID).filter(Boolean));
console.log(`production orders (101 into a batch): ${prodOrders.size}`);

const ord = {};
for (const r of jrows) {
  if (!prodOrders.has(r.OrderID)) continue;
  const o = ord[r.OrderID] ??= { acc: {}, last: '', bal: 0 };
  const v = num(r.AmountInGlobalCurrency);
  o.acc[r.GLAccount] = (o.acc[r.GLAccount] || 0) + v;
  o.bal += v;
  const d = odataDate(r.PostingDate); if (d > o.last) o.last = d;
}
const all = Object.entries(ord);
const closed = all.filter(([, o]) => o.last < '2026-10-01');
const settled = closed.filter(([, o]) => Math.abs(o.bal) < 1);
console.log(`with journal cost: ${all.length} · closed period: ${closed.length} · fully settled (|bal|<1): ${settled.length}`);

function test(sample, label) {
  let tDeb = 0, tMat = 0, tOvh = 0; const res = {};
  for (const [, o] of sample) for (const [a, v] of Object.entries(o.acc)) {
    if (a.startsWith('52') || a.startsWith('55') || a.startsWith('24')) continue;  // variances, GR clearing, settlement
    tDeb += v;
    if (a.startsWith('51')) tMat += v;
    else if (a === CFG.OVERHEAD_GL) tOvh += v;
    else res[a] = (res[a] || 0) + v;
  }
  const residual = tDeb - tMat - tOvh;
  console.log(`\n── ${label} (${sample.length} orders)`);
  console.log(`   cost-collector total      ${tDeb.toFixed(2).padStart(15)}`);
  console.log(`   materials 51*             ${tMat.toFixed(2).padStart(15)}   ${(tMat/tDeb*100).toFixed(1)}%`);
  console.log(`   overhead ${CFG.OVERHEAD_GL}           ${tOvh.toFixed(2).padStart(15)}   ${(tOvh/tDeb*100).toFixed(1)}%`);
  console.log(`   RESIDUAL                  ${residual.toFixed(2).padStart(15)}   ${(residual/tDeb*100).toFixed(2)}%`);
  for (const [a, v] of Object.entries(res).sort((x,y)=>Math.abs(y[1])-Math.abs(x[1])))
    console.log(`      ${a}  ${v.toFixed(2).padStart(13)}`);
  return res;
}
test(settled, 'SETTLED + CLOSED');
test(closed, 'ALL CLOSED-PERIOD production orders');
