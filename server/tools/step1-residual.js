// Step 1 — establish cost buckets by measurement.
// All journal lines carrying an OrderID, Ledger 0L, no date filter (rule 2).
import { getAll, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';

const t0 = Date.now();
const rows = await getAll('journal', 'YY1_AIF_JOURNAL_REV', {
  $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and OrderID ne ''`,
}, { page: 5000 });
console.log(`order-bearing journal lines: ${rows.length}  (${((Date.now()-t0)/1000).toFixed(1)}s)`);

const acct = {};
for (const r of rows) {
  const a = r.GLAccount;
  const g = acct[a] ??= { dr: 0, cr: 0, n: 0, signed: 0, orders: new Set(), dcc: {} };
  const v = num(r.AmountInGlobalCurrency);
  g.signed += v; g.n++; g.orders.add(r.OrderID);
  g.dcc[r.DebitCreditCode] = (g.dcc[r.DebitCreditCode] || 0) + 1;
  if (v >= 0) g.dr += v; else g.cr += v;
}
console.log('\nG/L accounts on manufacturing orders (global currency USD, SIGNED):');
console.log('  account    signed total        debits          credits      lines  orders  D/C');
for (const [a, g] of Object.entries(acct).sort((x, y) => y[1].signed - x[1].signed)) {
  console.log(`  ${a}  ${g.signed.toFixed(2).padStart(16)}  ${g.dr.toFixed(2).padStart(14)}  ${g.cr.toFixed(2).padStart(14)}  ${String(g.n).padStart(5)}  ${String(g.orders.size).padStart(5)}  ${JSON.stringify(g.dcc)}`);
}
const dates = rows.map(r => odataDate(r.PostingDate)).filter(Boolean).sort();
console.log(`\nposting range: ${dates[0]} → ${dates.at(-1)}   (confirms lookback into 2025)`);
