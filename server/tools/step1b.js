import { getAll, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';

const rows = await getAll('journal', 'YY1_AIF_JOURNAL_REV', {
  $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and OrderID ne ''`,
}, { page: 5000 });

const ord = {};
for (const r of rows) {
  const o = ord[r.OrderID] ??= { acc: {}, last: '', bal: 0 };
  const v = num(r.AmountInGlobalCurrency);
  ord[r.OrderID].acc[r.GLAccount] = (o.acc[r.GLAccount] || 0) + v;
  o.bal += v;
  const d = odataDate(r.PostingDate); if (d > o.last) o.last = d;
}
// Settled & closed: whole-order balance ~0 and last posting before the open period (Oct 2026).
const settled = Object.entries(ord).filter(([, o]) => Math.abs(o.bal) < 0.5 && o.last < '2026-10-01');
console.log(`orders total ${Object.keys(ord).length}, settled+closed sample: ${settled.length}`);

const isMat = a => a.startsWith('51');
const isOvh = a => a === CFG.OVERHEAD_GL;
let tDeb = 0, tMat = 0, tOvh = 0; const resAcc = {};
for (const [, o] of settled) {
  for (const [a, v] of Object.entries(o.acc)) {
    // "total debits on the order" scoped to the order's own cost collector,
    // i.e. excluding variance (52*), GR clearing (55*) and settlement (24*) postings.
    if (a.startsWith('52') || a.startsWith('55') || a.startsWith('24')) continue;
    tDeb += v;
    if (isMat(a)) tMat += v;
    else if (isOvh(a)) tOvh += v;
    else resAcc[a] = (resAcc[a] || 0) + v;
  }
}
const residual = tDeb - tMat - tOvh;
console.log(`\n  total cost-collector debits  ${tDeb.toFixed(2).padStart(16)}`);
console.log(`  less material accounts 51*   ${(-tMat).toFixed(2).padStart(16)}`);
console.log(`  less overhead ${CFG.OVERHEAD_GL}       ${(-tOvh).toFixed(2).padStart(16)}`);
console.log(`  = RESIDUAL                   ${residual.toFixed(2).padStart(16)}   (${(residual / tDeb * 100).toFixed(2)}% of cost)`);
console.log(`\n  residual is carried by:`);
for (const [a, v] of Object.entries(resAcc).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])))
  console.log(`    ${a}  ${v.toFixed(2).padStart(14)}`);
console.log(`\n  VERDICT: residual is ${Math.abs(residual) < 1 ? 'ZERO — materials + overhead are the whole of it' : 'MATERIAL — a third bucket (activity cost) exists'}`);
