import { getAll, getByKeys, num } from '../api/sap.js';
import { CFG } from '../lib/env.js';
const TODAY = new Date().toISOString().slice(0, 10);
const hdrs = await getAll('billing', 'A_BillingDocument', {
  $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
         + ` and BillingDocumentDate ge datetime'${CFG.PERIOD_FROM}T00:00:00' and BillingDocumentDate le datetime'${TODAY}T00:00:00'`,
  $select: 'BillingDocument,BillingDocumentDate,AccountingDocument,AccountingPostingStatus' }, { page: 5000 });
const scope = hdrs.filter(h => h.AccountingPostingStatus === 'C');
const si = await getByKeys('billing', 'A_BillingDocumentItem', 'BillingDocument', scope.map(h => h.BillingDocument), {
  chunk: 50, params: { $select: 'BillingDocument,BillingDocumentItem,Material,Batch,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,ReferenceSDDocument,ReferenceSDDocumentItem' } });

const nz = si.filter(i => num(i.BillingQuantityInBaseUnit) !== 0 || num(i.NetAmount) !== 0);
const z  = si.filter(i => num(i.BillingQuantityInBaseUnit) === 0 && num(i.NetAmount) === 0);
console.log(`items ${si.length} = non-zero ${nz.length} + zero-value split parents ${z.length}`);
console.log(`non-zero items WITH batch   : ${nz.filter(i => i.Batch).length}`);
console.log(`non-zero items WITHOUT batch: ${nz.filter(i => !i.Batch).length}`);
console.log('\nnon-zero items without a batch, by material:');
const nb = {};
for (const i of nz.filter(i => !i.Batch)) {
  const k = i.Material; (nb[k] ??= { n: 0, qty: 0, net: 0 });
  nb[k].n++; nb[k].qty += num(i.BillingQuantityInBaseUnit); nb[k].net += num(i.NetAmount);
}
for (const [k, v] of Object.entries(nb).sort((a,b)=>b[1].net-a[1].net))
  console.log(`   ${k}  lines ${String(v.n).padStart(3)}  qty ${v.qty.toFixed(0).padStart(10)}  net ${v.net.toFixed(2).padStart(13)} (mixed ccy)`);
console.log(`\ndistinct batches sold: ${new Set(nz.map(i=>i.Batch).filter(Boolean)).size}`);
console.log(`split-parent items (qty 0 and net 0) all have blank batch: ${z.every(i=>!i.Batch)}`);
