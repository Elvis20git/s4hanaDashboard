import { getAll, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
const TODAY = new Date().toISOString().slice(0, 10);
const t0 = Date.now();

const hdrs = await getAll('billing', 'A_BillingDocument', {
  $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
         + ` and BillingDocumentDate ge datetime'${CFG.PERIOD_FROM}T00:00:00'`
         + ` and BillingDocumentDate le datetime'${TODAY}T00:00:00'`,
  $select: 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentCategory,SDDocumentCategory,'
         + 'BillingDocumentIsCancelled,CancelledBillingDocument,SoldToParty,TotalNetAmount,TransactionCurrency,'
         + 'AccountingDocument,CompanyCode,AccountingPostingStatus,OverallBillingStatus',
}, { page: 5000 });
console.log(`billing headers ${CFG.PERIOD_FROM}..${TODAY}: ${hdrs.length}  (${((Date.now()-t0)/1000).toFixed(1)}s)`);

const cnt = (f) => hdrs.reduce((m, r) => (m[r[f] ?? '∅'] = (m[r[f] ?? '∅'] || 0) + 1, m), {});
console.log('TransactionCurrency :', JSON.stringify(cnt('TransactionCurrency')));
console.log('BillingDocumentType :', JSON.stringify(cnt('BillingDocumentType')));
console.log('BillingDocCategory  :', JSON.stringify(cnt('BillingDocumentCategory')));
console.log('SDDocumentCategory  :', JSON.stringify(cnt('SDDocumentCategory')));
console.log('IsCancelled         :', JSON.stringify(cnt('BillingDocumentIsCancelled')));
console.log('AcctgPostingStatus  :', JSON.stringify(cnt('AccountingPostingStatus')));
const byM = {};
for (const h of hdrs) { const d = odataDate(h.BillingDocumentDate); const p = d.slice(5,7)+'.'+d.slice(0,4);
  byM[p] = (byM[p] || 0) + num(h.TotalNetAmount); }
console.log('\nheader TotalNetAmount by period (transaction currency, mixed):');
for (const k of Object.keys(byM).sort((a,b)=>(a.slice(3)+a.slice(0,2)).localeCompare(b.slice(3)+b.slice(0,2))))
  console.log(`  ${k}  ${byM[k].toFixed(2).padStart(15)}`);
