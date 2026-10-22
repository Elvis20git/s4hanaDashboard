// Controls run on every refresh and surface in the validation view. They fail loudly.
//
//   batch closure:  sum of line_COGM from batch B over all deliveries  <=  batch_cost(B)
//   order closure:  sum of order_cost_to_batch(o,B) over all B          =   order_cost(o)
//
// A batch cannot cost out for more than it cost; an order's cost must be fully
// distributed, no more and no less. A breach localises the error to one step.
import { round2 } from '../cost/engine.js';
import { productGroup } from '../lib/productGroup.js';

const TOL = 0.01;          // currency rounding
const QTY_TOL = 0.001;     // KG rounding

const REGRESSION = {
  '01.2026': [816326.03, 31], '02.2026': [469566.78, 104], '03.2026': [2056492.74, 96],
  '04.2026': [1362331.79, 75], '05.2026': [1235940.20, 61], '06.2026': [1886271.46, 76],
  '07.2026': [1887630.70, 84], '08.2026': [1628675.64, 62], '09.2026': [2725630.53, 106],
  '10.2026': [728937.90, 19],
};
export function runControls({ lines, frozen, orders, orderQty, orderDistributed, batchMap, receipts, asOf }) {
  // ---- Control 1: batch closure ----------------------------------------
  const cogmByBatch = new Map();
  const qtyByBatch = new Map();
  for (const l of lines) {
    if (!l.batch) continue;
    if (l.cogmUsd != null) cogmByBatch.set(l.batch, (cogmByBatch.get(l.batch) || 0) + l.cogmUsd);
    qtyByBatch.set(l.batch, (qtyByBatch.get(l.batch) || 0) + l.qtyKg);
  }
  const batchClosure = [];
  for (const [b, allocated] of cogmByBatch) {
    const f = frozen.get ? frozen.get(b) : frozen.find(x => x.batch === b);
    const cost = f ? f.cost : null;
    if (cost == null) continue;
    const breach = allocated > cost + TOL;
    batchClosure.push({
      batch: b, batchCost: round2(cost), allocatedCogm: round2(allocated),
      ratio: cost === 0 ? null : round2(allocated / cost * 10000) / 10000,
      pass: !breach,
    });
  }

  // ---- Control 2: order closure ----------------------------------------
  const orderClosure = [];
  for (const [o, dist] of orderDistributed) {
    const oc = orders.get(o);
    if (!oc) continue;
    // Cost is distributed only across the batches in scope; the in-scope share is
    // the yardstick, not the whole order cost.
    const inScopeQty = [...batchMap.values()]
      .reduce((s, e) => s + (e.orders.get(o)?.qty || 0), 0);
    const totalQty = orderQty.get(o) || 0;
    const expected = totalQty > 0 ? oc.cost * (inScopeQty / totalQty) : 0;
    const diff = dist - expected;
    orderClosure.push({
      order: o, orderCost: round2(oc.cost), inScopeQty, totalQty,
      expected: round2(expected), distributed: round2(dist), diff: round2(diff),
      pass: Math.abs(diff) < TOL,
    });
  }

  // ---- Control 3: delivered quantity per batch <= net produced quantity ----
  const producedByBatch = new Map();
  for (const r of receipts) producedByBatch.set(r.batch, (producedByBatch.get(r.batch) || 0) + r.qty);
  const qtyControl = [];
  for (const [b, delivered] of qtyByBatch) {
    const produced = producedByBatch.get(b);
    if (produced == null) continue;
    qtyControl.push({
      batch: b, deliveredKg: round2(delivered), producedKg: round2(produced),
      excessKg: round2(delivered - produced), pass: delivered <= produced + QTY_TOL,
    });
  }

  // ---- Control 4: revenue ties to source under equivalent filters ----
  const byPeriod = {};
  for (const l of lines) {
    const p = (byPeriod[l.period] ??= { revenue: 0, lines: 0, cogm: 0, cm: 0, revFinal: 0, revProv: 0, revZero: 0, revNone: 0 });
    p.revenue += l.revenueUsd; p.lines++;
    if (l.cogmUsd != null) { p.cogm += l.cogmUsd; p.cm += l.cmUsd; }
    if (l.costStatus === 'final') p.revFinal += l.revenueUsd;
    else if (l.costStatus === 'provisional') p.revProv += l.revenueUsd;
    else if (l.costStatus === 'assumed-zero') p.revZero += l.revenueUsd;
    else p.revNone += l.revenueUsd;
  }
  // The regression table is reference data for the full reporting history (Jan–Oct
  // 2026). A build that stops at an earlier cutoff (config REPORT_TO) must only be
  // checked against the periods it actually set out to cover — holding it to a target
  // for a period it never fetched would read as a reconciliation failure for data that
  // was deliberately left out, not an actual discrepancy.
  const pk = p => p.slice(3) + p.slice(0, 2);
  const cutoffPeriod = asOf ? asOf.slice(5, 7) + '.' + asOf.slice(0, 4) : null;
  const inScopeTargets = Object.entries(REGRESSION).filter(([p]) => !cutoffPeriod || pk(p) <= pk(cutoffPeriod));

  const reconciliation = [];
  let totRev = 0, totLines = 0;
  for (const [p, t] of inScopeTargets) {
    const a = byPeriod[p] || { revenue: 0, lines: 0 };
    reconciliation.push({
      period: p, revenue: round2(a.revenue), target: t[0], diff: round2(a.revenue - t[0]),
      lines: a.lines, targetLines: t[1],
      pass: Math.abs(a.revenue - t[0]) < 0.005 && a.lines === t[1],
    });
  }
  const regressionTotal = round2(inScopeTargets.reduce((s, [, t]) => s + t[0], 0));
  const regressionLines = inScopeTargets.reduce((s, [, t]) => s + t[1], 0);
  for (const t of Object.values(byPeriod)) { totRev += t.revenue; totLines += t.lines; }

  // ---- Coverage per period, and the provisional/final/assumed-zero split ----
  const coverage = Object.entries(byPeriod).map(([p, t]) => {
    const covered = t.revFinal + t.revProv + t.revZero;
    return {
      period: p,
      revenue: round2(t.revenue),
      revenueFinal: round2(t.revFinal),
      revenueProvisional: round2(t.revProv),
      revenueAssumedZero: round2(t.revZero),
      revenueNotCosted: round2(t.revNone),
      cogm: round2(t.cogm), cm: round2(t.cm),
      cmPct: covered === 0 ? null : round2(t.cm / covered * 100),
    };
  }).sort((a, b) => (a.period.slice(3) + a.period.slice(0, 2)).localeCompare(b.period.slice(3) + b.period.slice(0, 2)));

  // ---- Lines with missing cost, and the reason (should now be empty — every line
  // resolves to final, provisional, or assumed-zero; kept as a safety net for any
  // future path that still leaves cogmUsd null) ----
  const missing = lines.filter(l => l.cogmUsd == null).map(l => ({
    billingDocument: l.billingDocument, billingItem: l.billingItem, period: l.period,
    material: l.material, batch: l.batch, revenueUsd: round2(l.revenueUsd),
    qtyMt: l.qtyMt, reason: l.costReason,
  }));
  // ---- Lines costed at an assumed $0 — kept visible for transparency even though they
  // no longer show as "missing," since $0 here is a stated assumption, not a fact ----
  const assumedZeroCost = lines.filter(l => l.costStatus === 'assumed-zero').map(l => ({
    billingDocument: l.billingDocument, billingItem: l.billingItem, period: l.period,
    material: l.material, group: productGroup(l.material), batch: l.batch, revenueUsd: round2(l.revenueUsd), reason: l.costReason,
  }));
  const conversionIssues = lines.filter(l => l.qtyMt == null && l.qtyKg !== 0).map(l => ({
    billingDocument: l.billingDocument, billingItem: l.billingItem, material: l.material,
    qty: l.qtyKg, unit: l.baseUnit, reason: `No valid ${l.baseUnit}->MT conversion — quantity flagged, not converted`,
  }));
  const unmatched = lines.filter(l => !l.itemResolved).map(l => ({
    billingDocument: l.billingDocument, accountingDocument: l.accountingDocument,
    material: l.material, revenueUsd: round2(l.revenueUsd), reason: 'No billing item matched this ledger line',
  }));

  const revAll = lines.reduce((s, l) => s + l.revenueUsd, 0);

  return {
    batchClosure: { total: batchClosure.length, breaches: batchClosure.filter(x => !x.pass), rows: batchClosure },
    orderClosure: { total: orderClosure.length, breaches: orderClosure.filter(x => !x.pass), rows: orderClosure },
    quantityControl: { total: qtyControl.length, breaches: qtyControl.filter(x => !x.pass), rows: qtyControl },
    reconciliation: {
      rows: reconciliation,
      total: { revenue: round2(totRev), target: regressionTotal, diff: round2(totRev - regressionTotal),
               lines: totLines, targetLines: regressionLines },
      pass: reconciliation.every(r => r.pass) && Math.abs(totRev - regressionTotal) < 0.005 && totLines === regressionLines,
    },
    coverage,
    missingCost: missing,
    assumedZeroCost,
    conversionIssues,
    unmatchedRecords: unmatched,
    summary: {
      revenue: round2(revAll),
      cogm: round2(lines.reduce((s, l) => s + (l.cogmUsd || 0), 0)),
      cm: round2(lines.reduce((s, l) => s + (l.cmUsd || 0), 0)),
      linesTotal: lines.length,
      linesCosted: lines.filter(l => l.cogmUsd != null).length,
      linesNotCosted: missing.length,
    },
  };
}
