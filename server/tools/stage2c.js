import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
const TODAY = new Date().toISOString().slice(0, 10);
const hdrs = await getAll('billing', 'A_BillingDocument', {
  $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}' and BillingDocumentDate ge datetime'${CFG.PERIOD_FROM}T00:00:00' and BillingDocumentDate le datetime'${TODAY}T00:00:00'`,
  $select: 'BillingDocument,BillingDocumentDate,AccountingDocument,AccountingPostingStatus,SoldToParty' }, { page: 5000 });
const scope = hdrs.filter(h => h.AccountingPostingStatus === 'C');
const byAcct = new Map(scope.map(h => [h.AccountingDocument, h]));
const items = await getByKeys('billing', 'A_BillingDocumentItem', 'BillingDocument', scope.map(h=>h.BillingDocument), {
  chunk: 50, params: { $select: 'BillingDocument,BillingDocumentItem,Material,Batch,BillingQuantityInBaseUnit,BaseUnit,NetAmount' } });
const jrev = (await getAll('journal', 'YY1_AIF_JOURNAL_REV', {
  $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and startswith(GLAccount,'41')` }, { page: 5000 }))
  .filter(r => byAcct.has(r.AccountingDocument));
console.log(`journal revenue lines in scope: ${jrev.length}`);

// Join key: accounting doc + product + |quantity|
const key = (a, p, q) => `${a}|${p}|${Math.abs(Number(q)).toFixed(3)}`;
const pool = new Map();
for (const i of items) {
  if (num(i.BillingQuantityInBaseUnit) === 0 && num(i.NetAmount) === 0) continue;
  const h = scope.find(h => h.BillingDocument === i.BillingDocument);
  const k = key(h.AccountingDocument, i.Material, i.BillingQuantityInBaseUnit);
  (pool.get(k) ?? pool.set(k, []).get(k)).push(i);
}
let one = 0, many = 0, none = 0; const dup = [];
for (const r of jrev) {
  const k = key(r.AccountingDocument, r.SoldProduct || r.Product, r.Quantity);
  const c = pool.get(k);
  if (!c) none++; else if (c.length === 1) one++; else { many++; if (dup.length < 5) dup.push([k, c.length]); }
}
console.log(`unique match ${one} · ambiguous ${many} · no match ${none}`);
if (dup.length) console.log('ambiguous samples:', JSON.stringify(dup));
const jq = jrev.filter(r => num(r.Quantity) === 0).length;
console.log(`journal lines with zero quantity: ${jq}`);
console.log('sample journal line:', JSON.stringify(Object.fromEntries(Object.entries(jrev[0]).filter(([k])=>k!=='__metadata'))));
