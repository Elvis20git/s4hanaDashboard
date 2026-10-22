// Full pipeline: billing -> revenue (USD) -> batches -> order cost -> frozen unit cost
// -> COGM per (line,batch) -> contribution margin -> controls.
// Every join to delivery, batch or order is a LEFT join (rule 1 — completeness).
import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import { CFG } from '../lib/env.js';
import * as cache from '../cost/cache.js';
import { orderCosts, apportion, freezeUnitCosts, makeIsFinal, costLines, round2 } from '../cost/engine.js';
import { runControls } from './controls.js';

const KG_PER_MT = 1000;
const period = d => d.slice(5, 7) + '.' + d.slice(0, 4);

export async function build({
  // `asOf` is the reporting cutoff: the upper bound on BillingDocumentDate, i.e. what the
  // dashboard actually shows. Capping it (via config REPORT_TO) removes a period from the
  // dashboard completely — it is never fetched, not merely filtered client-side.
  asOf = CFG.REPORT_TO || new Date().toISOString().slice(0, 10),
  // `closureAsOf` is the REAL current date, used only to decide whether a batch's feeding
  // orders are still open. It is deliberately independent of `asOf`: narrowing the display
  // window must not make an already-closed month look "provisional" just because it now
  // happens to be the last one shown.
  closureAsOf = new Date().toISOString().slice(0, 10),
  log = () => {},
} = {}) {
  const started = Date.now();
  const from = CFG.PERIOD_FROM;
  log(`scope ${from} .. ${asOf}` + (closureAsOf !== asOf ? ` (period-closure evaluated as of ${closureAsOf})` : ''));

  // ---------- Stage 1: billing documents in scope ----------
  const hdrsAll = await getAll('billing', 'A_BillingDocument', {
    $filter: `SalesOrganization eq '${CFG.SALES_ORG}' and CompanyCode eq '${CFG.COMPANY_CODE}'`
           + ` and BillingDocumentDate ge datetime'${from}T00:00:00'`
           + ` and BillingDocumentDate le datetime'${asOf}T00:00:00'`,
    $select: 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentIsCancelled,'
           + 'CancelledBillingDocument,SoldToParty,AccountingDocument,FiscalYear,CompanyCode,'
           + 'AccountingPostingStatus,TransactionCurrency',
  }, { page: 5000 });
  const hdrs = hdrsAll.filter(h => h.AccountingPostingStatus === 'C');
  log(`billing documents: ${hdrsAll.length} retrieved, ${hdrs.length} posted to accounting`);

  const acctKey = h => `${h.CompanyCode}|${h.FiscalYear}|${h.AccountingDocument}`;
  const byAcct = new Map(hdrs.map(h => [acctKey(h), h]));
  const byDoc = new Map(hdrs.map(h => [h.BillingDocument, h]));

  // ---------- Stage 1b: billing items (these carry the batch split) ----------
  const itemsAll = await getByKeys('billing', 'A_BillingDocumentItem', 'BillingDocument',
    hdrs.map(h => h.BillingDocument), {
      chunk: Number(CFG.BATCH_CHUNK),
      params: { $select: 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,'
              + 'BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,'
              + 'ReferenceSDDocument,ReferenceSDDocumentItem,SalesDocument' },
    });
  // Split parents carry zero quantity AND zero value. They contribute nothing and would
  // double-count the document if kept.
  const items = itemsAll.filter(i => num(i.BillingQuantityInBaseUnit) !== 0 || num(i.NetAmount) !== 0);
  log(`billing items: ${itemsAll.length} (${itemsAll.length - items.length} zero-value split parents set aside)`);

  // ---------- Stage 1b2: resolve non-KG base units via the product master ----------
  // Rule 9 is "no INVENTED conversion", not "no conversion" — when the material master
  // itself states an alternate unit's weight (A_ProductUnitsOfMeasure.GrossWeight/
  // WeightUnit), that is a real, authoritative factor, not a guess, and using it is what
  // the rule was protecting against the opposite failure mode of. A line whose unit has
  // no such factor still falls through to null, exactly as before.
  const nonKgUnits = [...new Set(items.filter(i => i.BaseUnit && i.BaseUnit !== 'KG').map(i => i.Material))];
  const kgPerUnit = new Map(); // "material|unit" -> kg per 1 unit of that alternate unit
  if (nonKgUnits.length) {
    const uom = await getByKeys('product', 'A_ProductUnitsOfMeasure', 'Product', nonKgUnits, {
      chunk: Number(CFG.BATCH_CHUNK), params: { $select: 'Product,AlternativeUnit,GrossWeight,WeightUnit' },
    }).catch(() => []);
    for (const u of uom) if (u.WeightUnit === 'KG' && num(u.GrossWeight) > 0) kgPerUnit.set(`${u.Product}|${u.AlternativeUnit}`, num(u.GrossWeight));
    const resolved = [...new Set(items.filter(i => kgPerUnit.has(`${i.Material}|${i.BaseUnit}`)).map(i => `${i.Material}|${i.BaseUnit}`))];
    log(`non-KG base units: ${nonKgUnits.length} material(s) to check, ${resolved.length}/${new Set(items.filter(i=>i.BaseUnit&&i.BaseUnit!=='KG').map(i=>`${i.Material}|${i.BaseUnit}`)).size} unit(s) resolved via product master gross weight`);
  }

  // ---------- Stage 1c: revenue in GLOBAL CURRENCY from the ledger ----------
  // Revenue originates from the billing document set (rule 6). The ledger supplies the USD
  // valuation because the billing API exposes transaction currency only.
  const jrevAll = await getAll('journal', 'YY1_AIF_JOURNAL_REV', {
    $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}' and startswith(GLAccount,'41')`,
  }, { page: 5000 });
  const jrev = jrevAll.filter(r => {
    const d = odataDate(r.PostingDate);
    return d >= from && d <= asOf && byAcct.has(`${r.CompanyCode}|${r.FiscalYear}|${r.AccountingDocument}`);
  });
  log(`journal revenue lines: ${jrevAll.length} retrieved, ${jrev.length} belong to in-scope billing documents`);

  // ---------- join journal line -> billing item (acctg doc + material + |qty|) ----------
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
    // The billing item stores a credit memo's quantity POSITIVE; the ledger line carries
    // the true posting direction. Take the magnitude from the item and the sign from the
    // ledger, so a reversal carries negative quantity and reverses COGM at the frozen
    // rate (Step 7) instead of adding to it.
    // The ledger carries quantity on the same credit convention as revenue: a normal
    // sale posts NEGATIVE quantity, a credit memo positive. Negate both together.
    const jQty = -num(r.Quantity);
    const qtyInBaseUnit = item
      ? (jQty < 0 ? -1 : 1) * Math.abs(num(item.BillingQuantityInBaseUnit))
      : jQty;
    const unit = item ? item.BaseUnit : r.BaseUnit;
    const kgFactor = unit === 'KG' ? 1 : kgPerUnit.get(`${matl}|${unit}`);
    // qtyKg is genuinely KG whenever a real conversion is known (unit itself or the
    // product master's own gross weight); otherwise it stays in the raw base unit and
    // qtyMt is null — the line is flagged, never guessed at (rule 9).
    const qtyKg = kgFactor != null ? qtyInBaseUnit * kgFactor : qtyInBaseUnit;
    lines.push({
      billingDocument: h.BillingDocument,
      billingItem: item ? item.BillingDocumentItem : null,
      billingDate: odataDate(h.BillingDocumentDate),
      postingDate: date,
      period: period(date),
      billingType: h.BillingDocumentType,
      material: matl,
      customer: r.Customer,
      batch: item ? (item.Batch || null) : null,
      qtyKg,
      baseUnit: unit,
      qtyMt: kgFactor != null ? qtyKg / KG_PER_MT : null,
      revenueUsd: -num(r.AmountInGlobalCurrency),        // credit balance -> positive revenue
      transactionCurrency: h.TransactionCurrency,
      accountingDocument: r.AccountingDocument,
      itemResolved: !!item,
    });
  }
  log(`lines assembled: ${lines.length} (${lines.filter(l => !l.itemResolved).length} without a billing-item match)`);

  // ---------- Stage 2: batches sold, and the orders behind them ----------
  const soldSet = new Set(lines.map(l => l.batch).filter(Boolean));
  log(`distinct batches sold: ${soldSet.size}`);

  // NO date filter on the cost side (rule 2) — a batch sold in Jan 2026 was made in late 2025.
  const mvts = await getAll('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, { page: 5000 });
  const receipts = mvts
    .filter(m => m.GoodsMovementType === '101' && !m.GoodsMovementIsCancelled && m.Batch)
    .map(m => ({ order: m.ManufacturingOrder || m.OrderID, batch: m.Batch,
                 qty: num(m.QuantityInBaseUnit), material: m.Material,
                 date: odataDate(m.PostingDate), unit: m.MaterialBaseUnit }));
  const cancelledRows = mvts.filter(m => m.GoodsMovementIsCancelled).length;
  log(`goods receipts: ${receipts.length} live 101 rows (${cancelledRows} cancelled rows netted out)`);

  // Orders feeding the sold batches — DEDUPLICATED (rule 8: several batches share one order).
  const ordersNeeded = [...new Set(receipts.filter(r => soldSet.has(r.batch))
    .map(r => r.order).filter(Boolean))];
  log(`manufacturing orders behind those batches: ${ordersNeeded.length}`);

  // ---------- Step 3: order cost, signed, keyed by order (never by date) ----------
  const jord = await getByKeys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', ordersNeeded, {
    chunk: Number(CFG.BATCH_CHUNK),
    params: { $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}'` },
  });
  log(`order journal lines: ${jord.length}`);
  const ohReport = {};
  const orders = orderCosts(jord, ohReport);
  log(`overhead: ${ohReport.keptLines} lines counted toward VC (${Math.round(ohReport.keptAmount).toLocaleString('en-US')} USD); `
    + `${ohReport.excludedLines} lines from excluded sources dropped (${Math.round(ohReport.excludedAmount).toLocaleString('en-US')} USD)`);
  if (ohReport.unknownLines) {
    const msg = `WARNING overhead: ${ohReport.unknownLines} line(s), ${Math.round(ohReport.unknownAmount).toLocaleString('en-US')} USD, from an unrecognised source — excluded by default`;
    log(msg); console.warn(msg);
  }
  const orderLast = new Map();
  for (const r of jord) {
    const d = odataDate(r.PostingDate);
    if (!orderLast.has(r.OrderID) || d > orderLast.get(r.OrderID)) orderLast.set(r.OrderID, d);
  }

  // ---------- Step 4/5: apportion by received quantity, then freeze ----------
  const relevant = receipts.filter(r => soldSet.has(r.batch));
  const { batch: batchMap, orderQty, orderDistributed } = apportion(orders, relevant);
  const isFinal = makeIsFinal(orders, orderLast, closureAsOf);
  const frozen = freezeUnitCosts(batchMap, isFinal);
  cache.save();
  log(`batch unit costs: ${frozen.size} (${[...frozen.values()].filter(f => f.fromCache).length} reused from cache, `
    + `${[...frozen.values()].filter(f => f.final).length} final)`);

  // ---------- Step 6/7: allocate COGM to each line (shared engine logic) ----------
  costLines(lines, frozen);

  // ---------- master data for display (names only; never a source of figures) ----------
  const matCodes = [...new Set(lines.map(l => l.material))];
  const custCodes = [...new Set(lines.map(l => l.customer).filter(Boolean))];
  const [descRows, bpRows] = await Promise.all([
    getByKeys('product', 'A_ProductDescription', 'Product', matCodes,
      { chunk: Number(CFG.BATCH_CHUNK), params: { $filter: "Language eq 'EN'", $select: 'Product,ProductDescription' } })
      .catch(() => []),
    getByKeys('bp', 'A_BusinessPartner', 'BusinessPartner', custCodes,
      { chunk: Number(CFG.BATCH_CHUNK), params: { $select: 'BusinessPartner,BusinessPartnerFullName,OrganizationBPName1' } })
      .catch(() => []),
  ]);
  const productName = Object.fromEntries(descRows.map(r => [r.Product, r.ProductDescription]));
  const customerName = Object.fromEntries(bpRows.map(r =>
    [r.BusinessPartner, r.BusinessPartnerFullName || r.OrganizationBPName1 || r.BusinessPartner]));
  for (const l of lines) {
    l.materialName = productName[l.material] || l.material;
    l.customerName = customerName[l.customer] || l.customer || '—';
  }
  log(`master data: ${Object.keys(productName).length} product names, ${Object.keys(customerName).length} customer names`);

  const controls = runControls({ lines, frozen, orders, orderQty, orderDistributed, batchMap, receipts, asOf });
  const ms = Date.now() - started;
  log(`built in ${(ms / 1000).toFixed(1)}s`);

  return {
    asOf, from, builtAt: new Date().toISOString(), buildMs: ms, source: 'api',
    productName, customerName,
    lines,
    frozen: [...frozen.values()],
    orderCost: Object.fromEntries([...orders].map(([k, v]) => [k, { cost: round2(v.cost), buckets: v.buckets }])),
    counts: {
      billingDocuments: hdrs.length,
      billingItems: itemsAll.length,
      lines: lines.length,
      batchesSold: soldSet.size,
      ordersUsed: ordersNeeded.length,
      products: new Set(lines.map(l => l.material)).size,
      customers: new Set(lines.map(l => l.customer)).size,
    },
    controls,
  };
}
