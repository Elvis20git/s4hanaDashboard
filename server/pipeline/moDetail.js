// Manufacturing-order drill-down: the order's own full actual cost (materials by
// component, activities, overhead) and the order <-> batch goods-receipt link.
// See mo-drilldown-prompt.md. Always live, never date-bounded by the dashboard's
// own display window (rule: "show the order's full actual costs, whatever the
// dashboard date range").
import { getAll, getByKeys, num, odataDate } from '../api/sap.js';
import { inCostBucket, resolveOverheadSources, overheadKept, OVERHEAD_LABEL, OVERHEAD_SOURCE_ID, round2 } from '../cost/engine.js';
import { CFG } from '../lib/env.js';

const KG_PER_MT = 1000;

let receiptsCache = null, receiptsCachedAt = 0;
const RECEIPTS_TTL_MS = 5 * 60 * 1000;

/** Every live (non-cancelled) goods receipt, order <-> batch — the whole
    view, not scoped to the dashboard's sold set or date range, since the
    order/batch link must reflect full actual history. Short-lived cache:
    there is no server-side filter that narrows this usefully, and it's
    re-fetched often across one drill-down session. */
async function allReceipts() {
  const now = Date.now();
  if (receiptsCache && now - receiptsCachedAt < RECEIPTS_TTL_MS) return receiptsCache;
  const mvts = await getAll('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, { page: 5000 });
  // Same exclusion as apportion() in cost/engine.js (rule: !r.order || !r.batch
  // -> skip) — a handful of rows carry neither ManufacturingOrder nor OrderID,
  // and without that filter they'd all collapse onto one blank "order" key,
  // falsely linking every batch that happens to have one into one giant
  // connected component.
  receiptsCache = mvts
    .filter(m => m.GoodsMovementType === '101' && !m.GoodsMovementIsCancelled && m.Batch && (m.ManufacturingOrder || m.OrderID))
    .map(m => ({ order: m.ManufacturingOrder || m.OrderID, batch: m.Batch,
                 qty: num(m.QuantityInBaseUnit), unit: m.MaterialBaseUnit,
                 material: m.Material, date: odataDate(m.PostingDate) }));
  receiptsCachedAt = now;
  return receiptsCache;
}

/**
 * The "Produced by" / "Produced into" link for one batch or one order
 * (mo-drilldown-prompt.md §3). Walks the full connected order<->batch
 * component via BFS, so the "several orders <-> several batches" case is
 * complete rather than just the immediate neighbours, and each pair carries
 * its quantity share of both the batch and the order it belongs to.
 */
export async function linkFor({ batch, order }) {
  const all = await allReceipts();
  const byBatch = new Map(), byOrder = new Map();
  for (const r of all) {
    if (!byBatch.has(r.batch)) byBatch.set(r.batch, []);
    byBatch.get(r.batch).push(r);
    if (!byOrder.has(r.order)) byOrder.set(r.order, []);
    byOrder.get(r.order).push(r);
  }
  const seenB = new Set(), seenO = new Set();
  const queueB = batch ? [batch] : [], queueO = order ? [order] : [];
  while (queueB.length || queueO.length) {
    while (queueB.length) {
      const b = queueB.pop(); if (seenB.has(b)) continue; seenB.add(b);
      for (const r of byBatch.get(b) || []) if (!seenO.has(r.order)) queueO.push(r.order);
    }
    while (queueO.length) {
      const o = queueO.pop(); if (seenO.has(o)) continue; seenO.add(o);
      for (const r of byOrder.get(o) || []) if (!seenB.has(r.batch)) queueB.push(r.batch);
    }
  }
  const pool = all.filter(r => seenB.has(r.batch) && seenO.has(r.order));
  const batchQty = new Map(), orderQty = new Map(), pairQty = new Map();
  for (const r of pool) {
    batchQty.set(r.batch, (batchQty.get(r.batch) || 0) + r.qty);
    orderQty.set(r.order, (orderQty.get(r.order) || 0) + r.qty);
    const k = `${r.order}|${r.batch}`;
    pairQty.set(k, (pairQty.get(k) || 0) + r.qty);
  }
  const pairs = [...pairQty.entries()].map(([k, qty]) => {
    const [o, b] = k.split('|');
    return {
      order: o, batch: b, qty: round2(qty),
      pctOfBatch: batchQty.get(b) ? round2(qty / batchQty.get(b) * 100) : null,
      pctOfOrder: orderQty.get(o) ? round2(qty / orderQty.get(o) * 100) : null,
    };
  });
  return {
    pairs,
    batches: [...seenB].map(b => ({ batch: b, qty: round2(batchQty.get(b) || 0) })),
    orders: [...seenO].map(o => ({ order: o, qty: round2(orderQty.get(o) || 0) })),
    simple: seenB.size <= 1 && seenO.size <= 1,
  };
}

/**
 * The order's own full actual cost, grouped exactly as the dashboard's COGM
 * engine buckets it (materials / activities / overhead), but at line-item
 * grain instead of a single bucket total:
 *   - materials: one row per component (Product), net signed qty + cost
 *   - activities: one combined row — the live API carries real cost and a
 *     quantity basis per posting, but no activity-type or work-center field
 *     anywhere, so it cannot be split further without inventing labels
 *   - overhead: one row — Utilities (G/L 94301000, source 10101303/Z2), the
 *     only overhead source that counts toward cost — with the quantity it was calculated on as the base
 * Reversals net out by construction (every amount is signed and summed);
 * `hadReversal` just flags buckets where that happened, for transparency.
 */
export async function orderCostDetail(orderId) {
  const jl = await getByKeys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', [orderId], {
    params: { $filter: `Ledger eq '${CFG.LEDGER}' and CompanyCode eq '${CFG.COMPANY_CODE}'` },
  });

  const materials = new Map(); // component -> { qty, unit, cost, pos, neg }
  const activities = { cost: 0, qty: 0, unit: null, pos: 0, neg: 0 };
  const overhead = { cost: 0, qty: 0, unit: null, pos: 0, neg: 0 };
  const dates = [];
  let product = null;

  const ohSources = resolveOverheadSources(jl);   // only the included overhead source is a line item; the rest never appears
  for (const r of jl) {
    const bucket = inCostBucket(r.GLAccount);
    if (!bucket || bucket === 'pairedOffset') continue;
    if (bucket === 'overhead' && !overheadKept(r, ohSources)) continue; // internal allocation pair, nets to 0, not a line item
    const amt = num(r.AmountInGlobalCurrency);
    const qty = num(r.Quantity);
    const d = odataDate(r.PostingDate);
    if (d) dates.push(d);
    if (bucket === 'materials') {
      const comp = r.Product || '(unspecified component)';
      const e = materials.get(comp) ?? { qty: 0, unit: r.BaseUnit || null, cost: 0, pos: 0, neg: 0 };
      e.cost += amt; e.qty += qty; e.unit = e.unit || r.BaseUnit || null;
      if (amt >= 0) e.pos += amt; else e.neg += amt;
      materials.set(comp, e);
    } else if (bucket === 'activities') {
      activities.cost += amt; activities.qty += qty; activities.unit = activities.unit || r.BaseUnit || null;
      if (amt >= 0) activities.pos += amt; else activities.neg += amt;
      product = product || r.Product || null;
    } else if (bucket === 'overhead') {
      overhead.cost += amt; overhead.qty += qty; overhead.unit = overhead.unit || r.BaseUnit || null;
      if (amt >= 0) overhead.pos += amt; else overhead.neg += amt;
    }
  }

  const materialRows = [...materials.entries()].map(([component, e]) => ({
    component, qty: round2(e.qty), unit: e.unit, cost: round2(e.cost),
    hadReversal: e.pos > 0 && e.neg < 0,
  })).sort((a, b) => b.cost - a.cost);
  const materialsTotal = round2(materialRows.reduce((s, r) => s + r.cost, 0));
  const activitiesRow = { cost: round2(activities.cost), qty: round2(activities.qty), unit: activities.unit,
    hadReversal: activities.pos > 0 && activities.neg < 0 };
  const overheadRow = { label: OVERHEAD_LABEL, source: OVERHEAD_SOURCE_ID, cost: round2(overhead.cost), qty: round2(overhead.qty), unit: overhead.unit,
    hadReversal: overhead.pos > 0 && overhead.neg < 0 };
  const totalCost = round2(materialsTotal + activitiesRow.cost + overheadRow.cost);

  // Quantity produced and the order's own product, from goods receipts —
  // there is no order-header API among the six granted services, so these
  // (and start/finish dates, system status) come from what IS reachable.
  const receipts = (await allReceipts()).filter(r => r.order === orderId);
  const qtyProducedKg = round2(receipts.reduce((s, r) => s + r.qty, 0));
  product = receipts.find(r => r.material)?.material || product;

  return {
    order: orderId,
    product,
    qtyProducedKg,
    qtyProducedMt: receipts.every(r => r.unit === 'KG') && receipts.length ? round2(qtyProducedKg / KG_PER_MT) : null,
    postingDateFrom: dates.length ? dates.reduce((a, b) => a < b ? a : b) : null,
    postingDateTo: dates.length ? dates.reduce((a, b) => a > b ? a : b) : null,
    materials: materialRows,
    materialsTotal,
    activities: activitiesRow,
    overhead: overheadRow,
    totalCost,
    actualCostPerKg: qtyProducedKg > 0 ? round2(totalCost / qtyProducedKg) : null,
    lineCount: jl.length,
    // Order header fields the brief asks for that no granted API exposes.
    headerGaps: ['Start date', 'Finish date', 'System status'],
  };
}
