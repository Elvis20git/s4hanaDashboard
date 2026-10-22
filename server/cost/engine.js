// The COGM cost engine — Steps 3 to 7 of the method.
import { num } from '../api/sap.js';
import * as cache from './cache.js';
import { COST_CONFIG as CFGJSON, OVERHEAD } from './rules.js';

const KG_PER_MT = 1000;
const B = CFGJSON.costBuckets;
const EXCL = Object.keys(CFGJSON.excludedFromCost);

// ---- overhead sources (G/L 94301000) -------------------------------------------------------------
// Only an INCLUDED source counts toward product cost; an excluded one is dropped; anything else is excluded by
// default and reported, never silently added. The rule lives in config/sources.json -> overheadSources.
const INCLUDED = new Map(OVERHEAD.included.map(x => [x.id, x.label]));
const EXCLUDED = new Set(OVERHEAD.excluded);
export const OVERHEAD_SOURCE_ID = OVERHEAD.included[0].id;
export const OVERHEAD_LABEL = OVERHEAD.included[0].label;

/**
 * Which source each overhead posting belongs to: Map(line -> source id | null).
 * A line may carry an explicit `OverheadSource` (the real key, once SAP exposes it) and that always wins. Otherwise
 * the source is read from the posting pattern: a confirmation posts exactly two overhead lines, the higher rate per
 * kg is one source and the lower the other (config: identification). Anything that doesn't fit (an unpaired line,
 * equal rates) is null = unknown.
 */
export function resolveOverheadSources(journal) {
  const out = new Map(), groups = new Map();
  for (const r of journal) {
    if (r.GLAccount !== OVERHEAD.gl) continue;
    if (r.OverheadSource) { out.set(r, r.OverheadSource); continue; }
    const k = `${r.OrderID}|${r.AccountingDocument}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const rate = r => { const q = Math.abs(num(r.Quantity)), a = Math.abs(num(r.AmountInGlobalCurrency)); return q ? a / q : a; };
  const { highRate, lowRate } = OVERHEAD.identification;
  for (const g of groups.values()) {
    if (g.length !== 2 || Math.abs(rate(g[0]) - rate(g[1])) < 1e-9) { g.forEach(r => out.set(r, null)); continue; }
    const [hi, lo] = rate(g[0]) > rate(g[1]) ? [g[0], g[1]] : [g[1], g[0]];
    out.set(hi, highRate); out.set(lo, lowRate);
  }
  return out;
}
/** Does this overhead posting count toward product cost? Only an included source does. */
export const overheadKept = (line, sources) => INCLUDED.has(sources.get(line));

/** Is this G/L account part of the manufacturing cost collector? */
export function inCostBucket(account) {
  if (EXCL.some(p => account.startsWith(p))) return false;
  if (B.materials.prefixes.some(p => account.startsWith(p))) return 'materials';
  if (B.activities.accounts.includes(account)) return 'activities';
  if (B.overhead.accounts.includes(account)) return 'overhead';
  if (B.pairedOffset.accounts.includes(account)) return 'pairedOffset';
  return false;
}

/**
 * Step 3 — order cost, SIGNED (not debits-only).
 * A debits-only filter keeps every 261 and drops every 262, overstating cost.
 */
export function orderCosts(journalOrderLines, report = {}) {
  const orders = new Map();
  const sources = resolveOverheadSources(journalOrderLines);
  Object.assign(report, { keptLines: 0, keptAmount: 0, excludedLines: 0, excludedAmount: 0, unknownLines: 0, unknownAmount: 0 });
  for (const r of journalOrderLines) {
    const bucket = inCostBucket(r.GLAccount);
    if (!bucket) continue;
    const v = num(r.AmountInGlobalCurrency);        // signed
    if (bucket === 'overhead') {
      const src = sources.get(r);
      if (INCLUDED.has(src)) { report.keptLines++; report.keptAmount += v; }
      else {
        // an excluded source is dropped; one that is not listed at all is dropped too, but flagged
        if (src && EXCLUDED.has(src)) { report.excludedLines++; report.excludedAmount += v; }
        else if (v) { report.unknownLines++; report.unknownAmount += v; }
        continue;
      }
    }
    const o = orders.get(r.OrderID) ?? { cost: 0, buckets: {}, accounts: {}, lastPosting: '' };
    o.cost += v;
    o.buckets[bucket] = (o.buckets[bucket] || 0) + v;
    o.accounts[r.GLAccount] = (o.accounts[r.GLAccount] || 0) + v;
    orders.set(r.OrderID, o);
  }
  return orders;
}

/**
 * Step 4 — apportion each order across the batches it fed, by received quantity.
 * Never charge a batch the whole cost of an order that also fed other batches.
 */
export function apportion(orders, receipts) {
  // receipts: [{ order, batch, qty }] — movement 101 net of cancellations
  const orderQty = new Map();     // order -> total qty into all batches
  const pairQty = new Map();      // `${order}|${batch}` -> qty
  for (const r of receipts) {
    if (!r.order || !r.batch) continue;
    orderQty.set(r.order, (orderQty.get(r.order) || 0) + r.qty);
    const k = `${r.order}|${r.batch}`;
    pairQty.set(k, (pairQty.get(k) || 0) + r.qty);
  }
  const batch = new Map();        // batch -> { cost, qty, orders:Map, allocations:[] }
  const orderDistributed = new Map();
  for (const [k, qty] of pairQty) {
    const [order, b] = k.split('|');
    const total = orderQty.get(order) || 0;
    if (total <= 0) continue;
    const oc = orders.get(order);
    const share = qty / total;
    const cost = oc ? oc.cost * share : 0;
    const e = batch.get(b) ?? { cost: 0, qty: 0, orders: new Map(), costed: true };
    e.cost += cost; e.qty += qty;
    e.orders.set(order, { qty, share, cost, orderCost: oc ? oc.cost : null, hasCost: !!oc });
    if (!oc) e.costed = false;    // batch fed by an order with no journal cost
    batch.set(b, e);
    orderDistributed.set(order, (orderDistributed.get(order) || 0) + cost);
  }
  return { batch, orderQty, orderDistributed };
}

/**
 * Step 5 — freeze the batch unit cost. Computed once per batch, cached by batch number.
 * `isFinal(batch)` decides whether the entry may be frozen for reuse.
 */
export function unitCostEntry(b, e, final) {
  return {
    batch: b,
    cost: round2(e.cost),
    qty: e.qty,
    unitCostPerKg: e.qty > 0 ? e.cost / e.qty : null,   // divide in KG
    orders: [...e.orders.keys()],
    costed: e.costed,
    final,
    computedAt: new Date().toISOString(),
  };
}

/** A batch may be frozen for good only when every order behind it is costed and last posted in a closed month. */
export function makeIsFinal(orders, orderLast, closureAsOf) {
  const openPeriodFrom = closureAsOf.slice(0, 7) + '-01';     // the current month is never closed
  return (b, e) => {
    for (const o of e.orders.keys()) {
      const last = orderLast.get(o);
      if (!last || last >= openPeriodFrom) return false;
      if (!orders.get(o)) return false;
    }
    return e.costed;
  };
}

export function freezeUnitCosts(batchMap, isFinal) {
  const out = new Map();
  for (const [b, e] of batchMap) {
    const frozen = cache.getFrozen(b);
    if (frozen) { out.set(b, { ...frozen, fromCache: true }); continue; }
    const entry = unitCostEntry(b, e, isFinal(b, e));
    cache.put(b, entry);
    out.set(b, { ...entry, fromCache: false });
  }
  return out;
}

/**
 * Step 6 — allocate to the sold quantity. One allocation per (line, batch) pair.
 * Step 7 — a reversal carries a negative quantity, so it reverses at the SAME frozen
 * unit cost by construction. Never recomputed at a current rate.
 */
export function allocateToLine(qtyKg, unitCostPerKg) {
  if (unitCostPerKg == null || !Number.isFinite(unitCostPerKg)) return null;
  return qtyKg * unitCostPerKg;
}

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Steps 6/7 for every sold line: COGM (shown as VC) = sold quantity x the batch's frozen unit cost; a reversal carries a
 * negative quantity and so reverses at the same rate. A line whose batch/order never resolves is costed at an ASSUMED
 * $0 (status 'assumed-zero'), kept distinct from a real resolved cost. The ONE place a line's VC is derived —
 * the dashboard build and the fixture export both call it.
 */
export function costLines(lines, frozen) {
  const zeroCost = (l, reason) => {
    l.cogmUsd = 0;
    l.cmUsd = l.revenueUsd;
    l.cmPct = l.revenueUsd === 0 ? null : 100;
    l.costStatus = 'assumed-zero';
    l.costReason = reason;
  };
  for (const l of lines) {
    l.orders = [];
    if (!l.batch) { zeroCost(l, 'Missing batch — no manufacturing order exists for this product; VC assumed $0, not computed'); continue; }
    const f = frozen.get(l.batch);
    if (!f) { zeroCost(l, `Manufacturing order not found for batch ${l.batch} — VC assumed $0, not computed`); continue; }
    l.orders = f.orders;
    l.batchUnitCostPerMt = f.unitCostPerKg == null ? null : round2(f.unitCostPerKg * KG_PER_MT);
    if (f.unitCostPerKg == null || !f.costed) {
      zeroCost(l, (f.qty === 0 ? 'Batch produced zero quantity' : `VC unavailable for batch ${l.batch}`) + ' — VC assumed $0, not computed');
      continue;
    }
    l.cogmUsd = round2(allocateToLine(l.qtyKg, f.unitCostPerKg));
    l.cmUsd = round2(l.revenueUsd - l.cogmUsd);
    l.cmPct = l.revenueUsd === 0 ? null : round2(l.cmUsd / l.revenueUsd * 100);
    l.costStatus = f.final ? 'final' : 'provisional';
    l.costReason = f.final ? null : 'Order open or period not closed — overhead surcharge runs at period close';
  }
  return lines;
}
