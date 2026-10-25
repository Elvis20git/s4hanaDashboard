"""Controls run on every refresh and surface in the validation view. They fail loudly.

  batch closure:  sum of line_COGM from batch B over all deliveries  <=  batch_cost(B)
  order closure:  sum of order_cost_to_batch(o,B) over all B          =   order_cost(o)

A batch cannot cost out for more than it cost; an order's cost must be fully distributed, no more and no less. A breach localises
the error to one step."""
from ..cost.engine import round2
from ..productgroup import product_group

TOL = 0.01          # currency rounding
QTY_TOL = 0.001     # KG rounding

# Reference data for the full reporting history (Jan–Oct 2026): revenue and line count per period.
REGRESSION = {
    '01.2026': [816326.03, 31], '02.2026': [469566.78, 104], '03.2026': [2056492.74, 96],
    '04.2026': [1362331.79, 75], '05.2026': [1235940.20, 61], '06.2026': [1886271.46, 76],
    '07.2026': [1887630.70, 84], '08.2026': [1628675.64, 62], '09.2026': [2725630.53, 106],
    '10.2026': [728937.90, 19],
}


def _pk(p):
    return p[3:] + p[:2]


def run_controls(lines, frozen, orders, order_qty, order_distributed, batch_map, receipts, as_of):
    # ---- Control 1: batch closure ----------------------------------------
    cogm_by_batch, qty_by_batch = {}, {}
    for l in lines:
        if not l.get('batch'):
            continue
        if l.get('cogmUsd') is not None:
            cogm_by_batch[l['batch']] = cogm_by_batch.get(l['batch'], 0) + l['cogmUsd']
        qty_by_batch[l['batch']] = qty_by_batch.get(l['batch'], 0) + l['qtyKg']
    batch_closure = []
    for b, allocated in cogm_by_batch.items():
        f = frozen.get(b) if isinstance(frozen, dict) else next((x for x in frozen if x['batch'] == b), None)
        cost = f['cost'] if f else None
        if cost is None:
            continue
        breach = allocated > cost + TOL
        batch_closure.append({
            'batch': b, 'batchCost': round2(cost), 'allocatedCogm': round2(allocated),
            'ratio': None if cost == 0 else round2(allocated / cost * 10000) / 10000,
            'pass': not breach,
        })

    # ---- Control 2: order closure ----------------------------------------
    order_closure = []
    for o, dist in order_distributed.items():
        oc = orders.get(o)
        if oc is None:
            continue
        # Cost is distributed only across the batches in scope; the in-scope share is the yardstick, not the whole order cost.
        in_scope_qty = sum((e['orders'].get(o) or {}).get('qty', 0) for e in batch_map.values())
        total_qty = order_qty.get(o, 0)
        expected = oc['cost'] * (in_scope_qty / total_qty) if total_qty > 0 else 0
        diff = dist - expected
        order_closure.append({
            'order': o, 'orderCost': round2(oc['cost']), 'inScopeQty': in_scope_qty, 'totalQty': total_qty,
            'expected': round2(expected), 'distributed': round2(dist), 'diff': round2(diff),
            'pass': abs(diff) < TOL,
        })

    # ---- Control 3: delivered quantity per batch <= net produced quantity ----
    produced_by_batch = {}
    for r in receipts:
        produced_by_batch[r['batch']] = produced_by_batch.get(r['batch'], 0) + r['qty']
    qty_control = []
    for b, delivered in qty_by_batch.items():
        produced = produced_by_batch.get(b)
        if produced is None:
            continue
        qty_control.append({
            'batch': b, 'deliveredKg': round2(delivered), 'producedKg': round2(produced),
            'excessKg': round2(delivered - produced), 'pass': delivered <= produced + QTY_TOL,
        })

    # ---- Control 4: revenue ties to source under equivalent filters ----
    by_period = {}
    for l in lines:
        p = by_period.setdefault(l['period'], {'revenue': 0, 'lines': 0, 'cogm': 0, 'cm': 0, 'revFinal': 0, 'revProv': 0, 'revZero': 0, 'revNone': 0})
        p['revenue'] += l['revenueUsd']
        p['lines'] += 1
        if l.get('cogmUsd') is not None:
            p['cogm'] += l['cogmUsd']
            p['cm'] += l['cmUsd']
        st = l.get('costStatus')
        if st == 'final':
            p['revFinal'] += l['revenueUsd']
        elif st == 'provisional':
            p['revProv'] += l['revenueUsd']
        elif st == 'assumed-zero':
            p['revZero'] += l['revenueUsd']
        else:
            p['revNone'] += l['revenueUsd']
    # The regression table covers the full history; a build that stops at an earlier cutoff (REPORT_TO) is only checked against the
    # periods it actually set out to cover.
    cutoff_period = (as_of[5:7] + '.' + as_of[0:4]) if as_of else None
    in_scope_targets = [(p, t) for p, t in REGRESSION.items() if not cutoff_period or _pk(p) <= _pk(cutoff_period)]

    reconciliation = []
    for p, t in in_scope_targets:
        a = by_period.get(p) or {'revenue': 0, 'lines': 0}
        reconciliation.append({
            'period': p, 'revenue': round2(a['revenue']), 'target': t[0], 'diff': round2(a['revenue'] - t[0]),
            'lines': a['lines'], 'targetLines': t[1],
            'pass': abs(a['revenue'] - t[0]) < 0.005 and a['lines'] == t[1],
        })
    regression_total = round2(sum(t[0] for _, t in in_scope_targets))
    regression_lines = sum(t[1] for _, t in in_scope_targets)
    # The total is compared only over periods that have a target; earlier periods (e.g. 2025, loaded so "All data" / "Last 12 months"
    # have something to show) have no regression row and must not make the 2026 total look like a difference.
    targeted = {p for p, _ in in_scope_targets}
    tot_rev = sum_in_order(t['revenue'] for p, t in by_period.items() if p in targeted)
    tot_lines = sum(t['lines'] for p, t in by_period.items() if p in targeted)

    # ---- Coverage per period, and the provisional/final/assumed-zero split ----
    coverage = []
    for p, t in by_period.items():
        covered = t['revFinal'] + t['revProv'] + t['revZero']
        coverage.append({
            'period': p,
            'revenue': round2(t['revenue']),
            'revenueFinal': round2(t['revFinal']),
            'revenueProvisional': round2(t['revProv']),
            'revenueAssumedZero': round2(t['revZero']),
            'revenueNotCosted': round2(t['revNone']),
            'cogm': round2(t['cogm']), 'cm': round2(t['cm']),
            'cmPct': None if covered == 0 else round2(t['cm'] / covered * 100),
        })
    coverage.sort(key=lambda c: _pk(c['period']))

    # ---- Lines with missing cost, and the reason (should be empty — every line resolves to final, provisional or assumed-zero) ----
    missing = [{
        'billingDocument': l['billingDocument'], 'billingItem': l['billingItem'], 'period': l['period'],
        'material': l['material'], 'batch': l['batch'], 'revenueUsd': round2(l['revenueUsd']),
        'qtyMt': l['qtyMt'], 'reason': l.get('costReason'),
    } for l in lines if l.get('cogmUsd') is None]
    # ---- Lines costed at an assumed $0 — kept visible for transparency ----
    assumed_zero_cost = [{
        'billingDocument': l['billingDocument'], 'billingItem': l['billingItem'], 'period': l['period'],
        'material': l['material'], 'group': product_group(l['material']), 'batch': l['batch'],
        'revenueUsd': round2(l['revenueUsd']), 'reason': l.get('costReason'),
    } for l in lines if l.get('costStatus') == 'assumed-zero']
    conversion_issues = [{
        'billingDocument': l['billingDocument'], 'billingItem': l['billingItem'], 'material': l['material'],
        'qty': l['qtyKg'], 'unit': l['baseUnit'], 'reason': f"No valid {l['baseUnit']}->MT conversion — quantity flagged, not converted",
    } for l in lines if l['qtyMt'] is None and l['qtyKg'] != 0]
    unmatched = [{
        'billingDocument': l['billingDocument'], 'accountingDocument': l['accountingDocument'],
        'material': l['material'], 'revenueUsd': round2(l['revenueUsd']), 'reason': 'No billing item matched this ledger line',
    } for l in lines if not l['itemResolved']]

    rev_all = sum_in_order(l['revenueUsd'] for l in lines)

    return {
        'batchClosure': {'total': len(batch_closure), 'breaches': [x for x in batch_closure if not x['pass']], 'rows': batch_closure},
        'orderClosure': {'total': len(order_closure), 'breaches': [x for x in order_closure if not x['pass']], 'rows': order_closure},
        'quantityControl': {'total': len(qty_control), 'breaches': [x for x in qty_control if not x['pass']], 'rows': qty_control},
        'reconciliation': {
            'rows': reconciliation,
            'total': {'revenue': round2(tot_rev), 'target': regression_total, 'diff': round2(tot_rev - regression_total),
                      'lines': tot_lines, 'targetLines': regression_lines},
            'pass': all(r['pass'] for r in reconciliation) and abs(tot_rev - regression_total) < 0.005 and tot_lines == regression_lines,
        },
        'coverage': coverage,
        'missingCost': missing,
        'assumedZeroCost': assumed_zero_cost,
        'conversionIssues': conversion_issues,
        'unmatchedRecords': unmatched,
        'summary': {
            'revenue': round2(rev_all),
            'cogm': round2(sum_in_order((l.get('cogmUsd') or 0) for l in lines)),
            'cm': round2(sum_in_order((l.get('cmUsd') or 0) for l in lines)),
            'linesTotal': len(lines),
            'linesCosted': sum(1 for l in lines if l.get('cogmUsd') is not None),
            'linesNotCosted': len(missing),
        },
    }


def sum_in_order(it):
    """Left-to-right float accumulation starting from the integer 0, exactly like Array.reduce((s, x) => s + x, 0)."""
    s = 0
    for x in it:
        s += x
    return s
