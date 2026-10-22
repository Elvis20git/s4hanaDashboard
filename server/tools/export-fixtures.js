// One-shot fixture export for docs/port/03-fixtures/. Runs the REAL pipeline stages
// against a representative period (September 2026 — the latest closed month) and
// writes raw inputs, intermediate outputs, and final outputs to disk. No server is
// started; this process exits as soon as it is done writing.
import fs from 'node:fs';
import path from 'node:path';
import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
import { orderCosts, apportion, unitCostEntry, makeIsFinal, costLines, round2 } from '../cost/engine.js';
import * as cache from '../cost/cache.js';

const OUT = path.resolve('docs/port/03-fixtures');
const PERIOD_FROM = '2026-09-01';
const PERIOD_TO = '2026-09-30';
const KG_PER_MT = 1000;
const period = d => d.slice(5, 7) + '.' + d.slice(0, 4);

// Strip OData's own __metadata envelope — it embeds the live tenant hostname in every
// row's id/uri, which the "no hostnames in any fixture" rule forbids, and it's pure
// transport noise that adds nothing to reproducing the engine's output.
function stripMetadata(v) {
  if (Array.isArray(v)) return v.map(stripMetadata);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) if (k !== '__metadata') out[k] = stripMetadata(val);
    return out;
  }
  return v;
}

function write(sub, name, data) {
  const clean = stripMetadata(data);
  const dir = path.join(OUT, sub);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(clean, null, 2));
  console.log(`  wrote ${sub}/${name}  (${JSON.stringify(clean).length.toLocaleString()} bytes)`);
}

console.log(`Exporting fixtures for ${PERIOD_FROM} .. ${PERIOD_TO}`);

// ---------- Stage 1: billing documents in the period ----------
const hdrsAll = await getAll('billing', 'A_BillingDocument', {
  $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
         + ` and BillingDocumentDate ge datetime'${PERIOD_FROM}T00:00:00'`
         + ` and BillingDocumentDate le datetime'${PERIOD_TO}T00:00:00'`,
  $select: 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentIsCancelled,'
         + 'CancelledBillingDocument,SoldToParty,AccountingDocument,FiscalYear,CompanyCode,'
         + 'AccountingPostingStatus,TransactionCurrency',
}, { page: 5000 });
const hdrs = hdrsAll.filter(h => h.AccountingPostingStatus === 'C');
write('input', '01-billing-documents.json', hdrsAll);
console.log(`billing documents: ${hdrsAll.length} (${hdrs.length} posted to accounting)`);

const acctKey = h => `${h.CompanyCode}|${h.FiscalYear}|${h.AccountingDocument}`;
const byAcct = new Map(hdrs.map(h => [acctKey(h), h]));
const byDoc = new Map(hdrs.map(h => [h.BillingDocument, h]));

// ---------- Stage 1b: billing items ----------
const itemsAll = await getByKeys('billing', 'A_BillingDocumentItem', 'BillingDocument',
  hdrs.map(h => h.BillingDocument), {
    chunk: Number(CFG.BATCH_CHUNK),
    params: { $select: 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,'
            + 'BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,'
            + 'ReferenceSDDocument,ReferenceSDDocumentItem,SalesDocument' },
  });
write('input', '02-billing-items.json', itemsAll);
const items = itemsAll.filter(i => num(i.BillingQuantityInBaseUnit) !== 0 || num(i.NetAmount) !== 0);
console.log(`billing items: ${itemsAll.length} (${items.length} non-zero after split-parent removal)`);

// ---------- Stage 1c: journal revenue lines (41*), scoped to this period's docs ----------
const jrevAll = await getAll('journal', 'YY1_AIF_JOURNAL_REV', {
  $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and startswith(GLAccount,'41')`,
}, { page: 5000 });
const jrev = jrevAll.filter(r => {
  const d = odataDate(r.PostingDate);
  return d >= PERIOD_FROM && d <= PERIOD_TO && byAcct.has(`${r.CompanyCode}|${r.FiscalYear}|${r.AccountingDocument}`);
});
write('input', '03-journal-revenue-lines.json', jrev);
console.log(`journal revenue lines (41*): ${jrevAll.length} total, ${jrev.length} in scope`);

// ---------- join journal line -> billing item, assemble lines ----------
const pool = new Map();
for (const i of items) {
  const h = byDoc.get(i.BillingDocument);
  const k = `${acctKey(h)}|${i.Material}|${Math.abs(num(i.BillingQuantityInBaseUnit)).toFixed(3)}`;
  if (!pool.has(k)) pool.set(k, []);
  pool.get(k).push(i);
}
const usedItems = new Set();
const lines = [];
for (const r of jrev) {
  const h = byAcct.get(`${r.CompanyCode}|${r.FiscalYear}|${r.AccountingDocument}`);
  const matl = r.SoldProduct || r.Product;
  const k = `${acctKey(h)}|${matl}|${Math.abs(num(r.Quantity)).toFixed(3)}`;
  const item = (pool.get(k) || []).find(i => !usedItems.has(i));
  if (item) usedItems.add(item);
  const date = odataDate(r.PostingDate);
  const jQty = -num(r.Quantity);
  const qtyKg = item ? (jQty < 0 ? -1 : 1) * Math.abs(num(item.BillingQuantityInBaseUnit)) : jQty;
  const unit = item ? item.BaseUnit : r.BaseUnit;
  lines.push({
    billingDocument: h.BillingDocument, billingItem: item ? item.BillingDocumentItem : null,
    billingDate: odataDate(h.BillingDocumentDate), postingDate: date, period: period(date),
    billingType: h.BillingDocumentType, material: matl, customer: r.Customer,
    batch: item ? (item.Batch || null) : null, qtyKg, baseUnit: unit,
    qtyMt: unit === 'KG' ? qtyKg / KG_PER_MT : null,
    revenueUsd: -num(r.AmountInGlobalCurrency), transactionCurrency: h.TransactionCurrency,
    accountingDocument: r.AccountingDocument, itemResolved: !!item,
  });
}
write('intermediate', '04-assembled-lines.json', lines);
console.log(`lines assembled: ${lines.length} (${lines.filter(l => !l.itemResolved).length} unmatched)`);

// ---------- Stage 2: batches sold, movement rows for their feeding orders ----------
const soldSet = new Set(lines.map(l => l.batch).filter(Boolean));
const mvts = await getAll('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, { page: 5000 });
const receiptsAll = mvts
  .filter(m => m.GoodsMovementType === '101' && !m.GoodsMovementIsCancelled && m.Batch)
  .map(m => ({ order: m.ManufacturingOrder || m.OrderID, batch: m.Batch,
               qty: num(m.QuantityInBaseUnit), material: m.Material,
               date: odataDate(m.PostingDate), unit: m.MaterialBaseUnit }));
const ordersNeeded = [...new Set(receiptsAll.filter(r => soldSet.has(r.batch)).map(r => r.order).filter(Boolean))];
// For the fixture, keep only the movement rows relevant to the batches sold this period
// (not the entire multi-year table) — this is what the engine itself narrows down to.
const relevantMvts = mvts.filter(m => ordersNeeded.includes(m.ManufacturingOrder || m.OrderID) || soldSet.has(m.Batch));
write('input', '05-order-batch-movements.json', relevantMvts);
console.log(`distinct batches sold: ${soldSet.size}, orders behind them: ${ordersNeeded.length}, relevant movement rows: ${relevantMvts.length} of ${mvts.length} total`);

const jord = await getByKeys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', ordersNeeded, {
  chunk: Number(CFG.BATCH_CHUNK),
  params: { $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}'` },
});
write('input', '06-order-journal-lines.json', jord);
console.log(`order journal lines: ${jord.length}`);

// ---------- run the REAL engine on this data ----------
const orders = orderCosts(jord);   // inherits the overhead-source rule from the shared engine
write('intermediate', '07-order-costs.json',
  Object.fromEntries([...orders].map(([k, v]) => [k, { cost: round2(v.cost), buckets: v.buckets }])));

const relevant = receiptsAll.filter(r => soldSet.has(r.batch));
const { batch: batchMap, orderQty, orderDistributed } = apportion(orders, relevant);
write('intermediate', '08-apportionment.json', Object.fromEntries([...batchMap].map(([b, e]) => [b, {
  cost: round2(e.cost), qty: e.qty, costed: e.costed,
  orders: Object.fromEntries([...e.orders].map(([o, d]) => [o, { qty: d.qty, share: round2(d.share * 10000) / 10000, cost: round2(d.cost) }])),
}])));

// Snapshot cache state before this export so we don't mutate the live cache file.
const orderLast = new Map();
for (const r of jord) { const d = odataDate(r.PostingDate); if (!orderLast.has(r.OrderID) || d > orderLast.get(r.OrderID)) orderLast.set(r.OrderID, d); }
const closureAsOf = new Date().toISOString().slice(0, 10);
const isFinal = makeIsFinal(orders, orderLast, closureAsOf);
const frozenMap = new Map();
for (const [b, e] of batchMap) frozenMap.set(b, unitCostEntry(b, e, isFinal(b, e)));
write('intermediate', '09-frozen-unit-costs.json', Object.fromEntries([...frozenMap].map(([b, f]) => [b, { ...f, unitCostPerMt: f.unitCostPerKg == null ? null : round2(f.unitCostPerKg * 1000) }])));

// The shared engine derives each line's VC — this export has no formula of its own any more.
costLines(lines, frozenMap);
write('output', '10-final-lines.json', lines);

// Monthly aggregate for September specifically (the one period in this fixture)
const agg = { period: '09.2026', revenue: 0, cogm: 0, cm: 0, lines: lines.length };
for (const l of lines) { agg.revenue += l.revenueUsd; if (l.cogmUsd != null) { agg.cogm += l.cogmUsd; agg.cm += l.cmUsd; } }
agg.revenue = round2(agg.revenue); agg.cogm = round2(agg.cogm); agg.cm = round2(agg.cm);
write('output', '11-monthly-aggregate.json', agg);

console.log('\nDone.');
console.log(`September aggregate: revenue ${agg.revenue}  cogm ${agg.cogm}  cm ${agg.cm}  lines ${agg.lines}`);
process.exit(0);
