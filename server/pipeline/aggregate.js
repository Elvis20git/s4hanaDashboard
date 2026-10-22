// Aggregation for the dashboard. Every card, chart, table and drill-down is served
// from here, so they all answer to the same period, filters and source.
import { isFinishedGood, categoryOf, allOtherCategories, FG_TITLE, OTHER_TITLE } from '../lib/productGroup.js';
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const pkey = p => p.slice(3) + p.slice(0, 2);

function blank() {
  return { revenue: 0, qtyMt: 0, cogm: 0, cm: 0, lines: 0,
           revFinal: 0, revProv: 0, revZero: 0, revNone: 0, costedRevenue: 0,
           fgRev: 0, fgQty: 0, fgCm: 0, fgCogm: 0, fgCostedRev: 0, fgRevZero: 0, othRev: 0, othQty: 0, othRevZero: 0, qtyLines: 0, noQtyLines: 0 };
}
function add(a, l) {
  a.revenue += l.revenueUsd; a.lines++;
  // Lines with no valid KG->MT conversion are counted and flagged, never converted
  // and never allowed to suppress the tonnage of the lines that do convert (rule 9).
  if (l.qtyMt == null) a.noQtyLines++; else { a.qtyMt += l.qtyMt; a.qtyLines++; }
  // Finished Goods vs Other split (the hero cards). A line with no MT quantity adds revenue but 0 quantity.
  // revenue costed at an assumed $0 (no manufacturing order), split by basis for the status dot
  if (l.costStatus === 'assumed-zero') { if (isFinishedGood(l.material)) a.fgRevZero += l.revenueUsd; else a.othRevZero += l.revenueUsd; }
  if (isFinishedGood(l.material)) { a.fgRev += l.revenueUsd; if (l.qtyMt != null) a.fgQty += l.qtyMt; if (l.cogmUsd != null) { a.fgCm += l.cmUsd; a.fgCogm += l.cogmUsd; a.fgCostedRev += l.revenueUsd; } }
  else { a.othRev += l.revenueUsd; if (l.qtyMt != null) a.othQty += l.qtyMt; }
  if (l.cogmUsd != null) { a.cogm += l.cogmUsd; a.cm += l.cmUsd; a.costedRevenue += l.revenueUsd; }
  // 'assumed-zero' is tracked separately from 'final' — it counts toward coverage (it IS
  // costed, at $0, on explicit instruction) but must stay visibly distinct from a real
  // resolved cost, never silently merged into the same bucket.
  if (l.costStatus === 'final') a.revFinal += l.revenueUsd;
  else if (l.costStatus === 'provisional') a.revProv += l.revenueUsd;
  else if (l.costStatus === 'assumed-zero') a.revZero += l.revenueUsd;
  else a.revNone += l.revenueUsd;
  return a;
}
function seal(a, extra = {}) {
  const covered = a.revFinal + a.revProv + a.revZero;
  return {
    ...extra,
    revenue: round2(a.revenue),
    qtyMt: a.qtyLines === 0 ? null : round2(a.qtyMt),
    qtyLinesUnconverted: a.noQtyLines,
    cogm: a.costedRevenue === 0 ? null : round2(a.cogm),
    cm: a.costedRevenue === 0 ? null : round2(a.cm),
    cmPct: a.costedRevenue === 0 ? null : round2(a.cm / a.costedRevenue * 100),
    lines: a.lines,
    groups: { fg: { revenue: round2(a.fgRev), qtyMt: round2(a.fgQty), cogm: a.fgCostedRev === 0 ? null : round2(a.fgCogm), cogmPct: a.fgCostedRev === 0 || !a.fgRev ? null : round2(a.fgCogm / a.fgRev * 100), cm: a.fgCostedRev === 0 ? null : round2(a.fgCm), cmPct: a.fgCostedRev === 0 || !a.fgRev ? null : round2(a.fgCm / a.fgRev * 100), revenueAssumedZero: round2(a.fgRevZero) }, other: { revenue: round2(a.othRev), qtyMt: round2(a.othQty), revenueAssumedZero: round2(a.othRevZero) } },
    revenueFinal: round2(a.revFinal),
    revenueProvisional: round2(a.revProv),
    revenueAssumedZero: round2(a.revZero),
    revenueNotCosted: round2(a.revNone),
    partial: a.revenue !== 0 && Math.abs(covered - a.revenue) > 0.005,
    provisional: a.revProv > 0,
    hasAssumedZero: a.revZero > 0,
  };
}

/** Group and seal in one pass. */
function group(lines, keyFn, extraFn) {
  const m = new Map();
  for (const l of lines) {
    const k = keyFn(l);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, { agg: blank(), sample: l });
    add(m.get(k).agg, l);
  }
  return [...m].map(([k, v]) => seal(v.agg, extraFn ? extraFn(k, v.sample) : { key: k }));
}

/**
 * Rows grouped under titled sections with subtotals, for Sales by product, Sales by customer and the donut.
 * Level 1: Finished Goods (B2B/B2C) vs Other; level 2 (products only): Other's categories. Every subtotal is sealed
 * from the same lines as its rows, so rows add up to the category, categories to Other, and FG + Other to the total.
 */
export function sections(lines) {
  const total = ls => seal(ls.reduce((a, l) => add(a, l), blank()));
  const byRev = (a, b) => b.revenue - a.revenue;
  const prodRows = ls => group(ls, l => l.material, (k, s) => ({ code: k, name: s.materialName })).sort(byRev);
  const custRows = ls => group(ls, l => l.customer, (k, s) => ({ code: k, name: s.customerName })).sort(byRev);
  const fg = lines.filter(l => isFinishedGood(l.material)), other = lines.filter(l => !isFinishedGood(l.material));
  const categories = allOtherCategories()
    .map(c => ({ key: c.key, title: c.title, ls: other.filter(l => categoryOf(l.material).key === c.key) }))
    .filter(c => c.ls.length)
    .map(c => ({ key: c.key, title: c.title, total: total(c.ls), rows: prodRows(c.ls) }));
  return {
    products: [
      { key: 'fg', title: FG_TITLE, total: total(fg), rows: prodRows(fg) },
      // `rows` is the flat list of every non-Finished-Goods item (Sales by product); `categories` stays for the donut
      { key: 'other', title: OTHER_TITLE, total: total(other), rows: prodRows(other), categories },
    ],
    customers: [
      { key: 'fg', title: FG_TITLE, total: total(fg), rows: custRows(fg) },
      { key: 'other', title: OTHER_TITLE, total: total(other), rows: custRows(other) },
    ],
  };
}

export function aggregate(data, query = {}) {
  const { period, material, customer, from, to } = query;
  let lines = data.lines;
  if (period) lines = lines.filter(l => l.period === period);
  if (from) lines = lines.filter(l => pkey(l.period) >= pkey(from));
  if (to) lines = lines.filter(l => pkey(l.period) <= pkey(to));
  if (material) lines = lines.filter(l => l.material === material);
  if (customer) lines = lines.filter(l => l.customer === customer);

  const periods = group(lines, l => l.period, k => ({ period: k }))
    .sort((a, b) => pkey(a.period).localeCompare(pkey(b.period)));
  const products = group(lines, l => l.material, (k, s) => ({ code: k, name: s.materialName }))
    .sort((a, b) => b.revenue - a.revenue);
  const customers = group(lines, l => l.customer, (k, s) => ({ code: k, name: s.customerName }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = seal(lines.reduce((a, l) => add(a, l), blank()));

  const allPeriods = [...new Set(data.lines.map(l => l.period))].sort((a, b) => pkey(a).localeCompare(pkey(b)));

  // Shape-of-the-window counts, recomputed from the FILTERED lines — not the full
  // dataset. These sit in the subtitle right beside the filtered totals, so reporting
  // the unfiltered document/batch/order counts there would silently contradict every
  // other figure on the page the moment a period range narrower than full YTD is applied.
  const counts = {
    billingDocuments: new Set(lines.map(l => l.billingDocument)).size,
    billingItems: lines.length,
    lines: lines.length,
    batchesSold: new Set(lines.map(l => l.batch).filter(Boolean)).size,
    ordersUsed: new Set(lines.flatMap(l => l.orders || [])).size,
    products: new Set(lines.map(l => l.material)).size,
    customers: new Set(lines.map(l => l.customer)).size,
  };

  // The closure controls are structural checks on a batch's or an order's whole cost
  // chain — not something a period slice can partially apply to — so a breach is scoped
  // to the filter by asking only whether that batch/order is actually sold somewhere in
  // the current selection. Coverage and not-costed revenue, by contrast, are plain sums
  // over the filtered lines and come straight from `total` so they can never disagree
  // with the figure shown next to them.
  let controls = null;
  if (data.controls) {
    const inScopeBatches = new Set(lines.map(l => l.batch).filter(Boolean));
    const inScopeOrders = new Set(lines.flatMap(l => l.orders || []));
    controls = {
      reconciliationPass: data.controls.reconciliation.pass,
      batchBreaches: data.controls.batchClosure.breaches.filter(b => inScopeBatches.has(b.batch)).length,
      orderBreaches: data.controls.orderClosure.breaches.filter(b => inScopeOrders.has(b.order)).length,
      quantityBreaches: data.controls.quantityControl.breaches.filter(b => inScopeBatches.has(b.batch)).length,
      // the Validation page counts the whole dataset; carried so the status dot can say how many lie outside this period
      dataset: { batch: data.controls.batchClosure.breaches.length, order: data.controls.orderClosure.breaches.length, quantity: data.controls.quantityControl.breaches.length },
      notCostedRevenue: total.revenueNotCosted,
      assumedZeroRevenue: total.revenueAssumedZero,
    };
  }

  return {
    source: data.source,
    cogmAvailable: data.source === 'api',
    cogmUnavailableReason: data.source === 'api' ? null : 'Unavailable — VC data not included in the spreadsheet source',
    asOf: data.asOf, from: data.from, builtAt: data.builtAt,
    filters: { period: period ?? null, material: material ?? null, customer: customer ?? null, from: from ?? null, to: to ?? null },
    allPeriods,
    total, periods, products, customers,
    sections: sections(lines),
    counts,
    controls,
  };
}

/** Drill level 3/4: documents for a product or customer in a period. */
export function documents(lines) {
  return group(lines, l => l.billingDocument, (k, s) => ({
    billingDocument: k, billingDate: s.billingDate, period: s.period,
    customer: s.customer, customerName: s.customerName,
  })).sort((a, b) => b.billingDate.localeCompare(a.billingDate));
}
