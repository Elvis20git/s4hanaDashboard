import { getAll, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
const TODAY = new Date().toISOString().slice(0, 10);

const [hdrs, jrev] = await Promise.all([
  getAll('billing', 'A_BillingDocument', {
    $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
           + ` and BillingDocumentDate ge datetime'${CFG.PERIOD_FROM}T00:00:00'`
           + ` and BillingDocumentDate le datetime'${TODAY}T00:00:00'`,
    $select: 'BillingDocument,BillingDocumentDate,SoldToParty,AccountingDocument,FiscalYear,BillingDocumentIsCancelled,AccountingPostingStatus,TransactionCurrency,BillingDocumentType',
  }, { page: 5000 }),
  getAll('journal', 'YY1_AIF_JOURNAL_REV', {
    $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and startswith(GLAccount,'41')`,
  }, { page: 5000 }),
]);
console.log(`billing headers ${hdrs.length} · journal 41* lines ${jrev.length}`);

const acctToBill = new Map();
for (const h of hdrs) if (h.AccountingDocument) acctToBill.set(h.AccountingDocument, h);
console.log(`accounting-doc keys from billing: ${acctToBill.size}`);

let matched = 0, unmatched = 0; const byP = {}; const unm = {};
for (const r of jrev) {
  const d = odataDate(r.PostingDate);
  if (d < CFG.PERIOD_FROM || d > TODAY) continue;
  const h = acctToBill.get(r.AccountingDocument);
  if (h) matched++; else { unmatched++; unm[r.AccountingDocument] = (unm[r.AccountingDocument]||0) + 1; continue; }
  const p = d.slice(5,7) + '.' + d.slice(0,4);
  (byP[p] ??= { rev: 0, n: 0 });
  byP[p].rev += -num(r.AmountInGlobalCurrency); byP[p].n++;
}
console.log(`journal lines in window: matched to a billing doc ${matched}, unmatched ${unmatched}`);
if (unmatched) console.log('  unmatched acctg docs:', Object.keys(unm).slice(0,10).join(', '));

const TARGET = {'01.2026':[816326.03,31],'02.2026':[469566.78,104],'03.2026':[2056492.74,96],'04.2026':[1362331.79,75],
  '05.2026':[1235940.20,61],'06.2026':[1886271.46,76],'07.2026':[1887630.70,84],'08.2026':[1628675.64,62],
  '09.2026':[2725630.53,106],'10.2026':[728937.90,19]};
console.log('\nperiod      revenue USD       target         diff    lines  target  ok');
let tot=0, totN=0, allOk=true;
for (const p of Object.keys(TARGET)) {
  const a = byP[p] || {rev:0,n:0}; const [tv,tn] = TARGET[p];
  const d = a.rev - tv; const ok = Math.abs(d) < 0.005 && a.n === tn; if (!ok) allOk = false;
  console.log(`  ${p}  ${a.rev.toFixed(2).padStart(14)} ${tv.toFixed(2).padStart(14)} ${d.toFixed(2).padStart(10)}  ${String(a.n).padStart(5)} ${String(tn).padStart(6)}  ${ok?'✓':'✗'}`);
  tot += a.rev; totN += a.n;
}
console.log(`  YTD   ${tot.toFixed(2).padStart(14)} ${(14797803.77).toFixed(2).padStart(14)} ${(tot-14797803.77).toFixed(2).padStart(10)}  ${String(totN).padStart(5)} ${String(714).padStart(6)}  ${Math.abs(tot-14797803.77)<0.005&&totN===714?'✓':'✗'}`);
console.log(allOk ? '\nALL TEN PERIODS TIE.' : '\nMISMATCH — do not proceed.');
