import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
const TODAY = new Date().toISOString().slice(0, 10);

const hdrs = await getAll('billing', 'A_BillingDocument', {
  $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
         + ` and BillingDocumentDate ge datetime'${CFG.PERIOD_FROM}T00:00:00'`
         + ` and BillingDocumentDate le datetime'${TODAY}T00:00:00'`,
  $select: 'BillingDocument,BillingDocumentDate,AccountingDocument,AccountingPostingStatus',
}, { page: 5000 });
const inScope = [...new Set(hdrs.filter(h => h.AccountingPostingStatus === 'C').map(h => h.BillingDocument))];
console.log(`in-scope billing docs: ${inScope.length}`);
const si = await getByKeys('billing', 'A_BillingDocumentItem', 'BillingDocument', inScope, {
  chunk: Number(CFG.BATCH_CHUNK),
  params: { $select: 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,ReferenceSDDocument,ReferenceSDDocumentItem,ReferenceSDDocumentCategory,SalesDocument,SalesDocumentItem,OrderID' },
});
console.log(`items on the 527 in-scope billing docs: ${si.length}`);

const c = (f) => si.reduce((m, r) => (m[r[f] || '∅'] = (m[r[f] || '∅'] || 0) + 1, m), {});
console.log('BaseUnit           :', JSON.stringify(c('BaseUnit')));
console.log('BillingQuantityUnit:', JSON.stringify(c('BillingQuantityUnit')));
console.log('RefSDDocCategory   :', JSON.stringify(c('ReferenceSDDocumentCategory')));
console.log(`items WITH a batch on the item     : ${si.filter(i => i.Batch).length}`);
console.log(`items WITHOUT a batch on the item  : ${si.filter(i => !i.Batch).length}`);
console.log(`items WITH a delivery reference    : ${si.filter(i => i.ReferenceSDDocument).length}`);
console.log(`items WITHOUT delivery reference   : ${si.filter(i => !i.ReferenceSDDocument).length}`);
console.log('\nsample items:');
for (const i of si.slice(0, 4)) console.log('  ', JSON.stringify(Object.fromEntries(Object.entries(i).filter(([k]) => k !== '__metadata'))));

// 90000733 — the COGM unit test document
console.log('\n--- billing doc 90000733 ---');
for (const i of si.filter(x => x.BillingDocument === '90000733'))
  console.log(`  item ${i.BillingDocumentItem} mat ${i.Material} batch ${i.Batch||'∅'} qty ${i.BillingQuantityInBaseUnit} ${i.BaseUnit} net ${i.NetAmount} ${i.TransactionCurrency} refdoc ${i.ReferenceSDDocument||'∅'}`);
console.log('\n--- billing doc 90000732 (credit note) ---');
for (const i of si.filter(x => x.BillingDocument === '90000732'))
  console.log(`  item ${i.BillingDocumentItem} mat ${i.Material} batch ${i.Batch||'∅'} qty ${i.BillingQuantityInBaseUnit} ${i.BaseUnit} net ${i.NetAmount} ${i.TransactionCurrency} refdoc ${i.ReferenceSDDocument||'∅'}`);
