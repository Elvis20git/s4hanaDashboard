"""Aggregation for the dashboard. Every card, chart, table and drill-down is served from here,
so they all answer to the same period, filters and source. See DASHBOARD_CALCULATION_SPEC.md §2 for the definitions."""
from ..jsutil import round2
from ..productgroup import (FG_TITLE, OTHER_TITLE, all_other_categories, category_of, is_finished_good)


def pkey(p):
    return p[3:] + p[:2]


def blank():
    return {'revenue': 0, 'qtyMt': 0, 'cogm': 0, 'cm': 0, 'lines': 0,
            'revFinal': 0, 'revProv': 0, 'revZero': 0, 'revNone': 0, 'costedRevenue': 0,
            'fgRev': 0, 'fgQty': 0, 'fgCm': 0, 'fgCogm': 0, 'fgCostedRev': 0, 'fgRevZero': 0,
            'othRev': 0, 'othQty': 0, 'othRevZero': 0, 'qtyLines': 0, 'noQtyLines': 0}


def add(a, l):
    rev = l['revenueUsd']
    a['revenue'] += rev
    a['lines'] += 1
    # Lines with no valid KG->MT conversion are counted and flagged, never converted and never allowed to suppress the tonnage of the
    # lines that do convert (rule 9).
    if l.get('qtyMt') is None:
        a['noQtyLines'] += 1
    else:
        a['qtyMt'] += l['qtyMt']
        a['qtyLines'] += 1
    fg = is_finished_good(l['material'])
    # revenue costed at an assumed $0 (no manufacturing order), split by basis for the status dot
    if l.get('costStatus') == 'assumed-zero':
        if fg:
            a['fgRevZero'] += rev
        else:
            a['othRevZero'] += rev
    if fg:
        a['fgRev'] += rev
        if l.get('qtyMt') is not None:
            a['fgQty'] += l['qtyMt']
        if l.get('cogmUsd') is not None:
            a['fgCm'] += l['cmUsd']
            a['fgCogm'] += l['cogmUsd']
            a['fgCostedRev'] += rev
    else:
        a['othRev'] += rev
        if l.get('qtyMt') is not None:
            a['othQty'] += l['qtyMt']
    if l.get('cogmUsd') is not None:
        a['cogm'] += l['cogmUsd']
        a['cm'] += l['cmUsd']
        a['costedRevenue'] += rev
    # 'assumed-zero' is tracked separately from 'final' — it counts toward coverage (it IS costed, at $0, on explicit instruction) but
    # must stay visibly distinct from a real resolved cost, never silently merged into the same bucket.
    st = l.get('costStatus')
    if st == 'final':
        a['revFinal'] += rev
    elif st == 'provisional':
        a['revProv'] += rev
    elif st == 'assumed-zero':
        a['revZero'] += rev
    else:
        a['revNone'] += rev
    return a


def seal(a, extra=None):
    covered = a['revFinal'] + a['revProv'] + a['revZero']
    out = dict(extra or {})
    fg_ok = a['fgCostedRev'] != 0
    fg_pct_ok = fg_ok and bool(a['fgRev'])
    out.update({
        'revenue': round2(a['revenue']),
        'qtyMt': None if a['qtyLines'] == 0 else round2(a['qtyMt']),
        'qtyLinesUnconverted': a['noQtyLines'],
        'cogm': None if a['costedRevenue'] == 0 else round2(a['cogm']),
        'cm': None if a['costedRevenue'] == 0 else round2(a['cm']),
        'cmPct': None if a['costedRevenue'] == 0 else round2(a['cm'] / a['costedRevenue'] * 100),
        'lines': a['lines'],
        'groups': {
            'fg': {'revenue': round2(a['fgRev']), 'qtyMt': round2(a['fgQty']),
                   'cogm': round2(a['fgCogm']) if fg_ok else None,
                   'cogmPct': round2(a['fgCogm'] / a['fgRev'] * 100) if fg_pct_ok else None,
                   'cm': round2(a['fgCm']) if fg_ok else None,
                   'cmPct': round2(a['fgCm'] / a['fgRev'] * 100) if fg_pct_ok else None,
                   'revenueAssumedZero': round2(a['fgRevZero'])},
            'other': {'revenue': round2(a['othRev']), 'qtyMt': round2(a['othQty']), 'revenueAssumedZero': round2(a['othRevZero'])},
        },
        'revenueFinal': round2(a['revFinal']),
        'revenueProvisional': round2(a['revProv']),
        'revenueAssumedZero': round2(a['revZero']),
        'revenueNotCosted': round2(a['revNone']),
        'partial': a['revenue'] != 0 and abs(covered - a['revenue']) > 0.005,
        'provisional': a['revProv'] > 0,
        'hasAssumedZero': a['revZero'] > 0,
    })
    return out


def group(lines, key_fn, extra_fn=None):
    """Group and seal in one pass. A line whose key is None is skipped."""
    m = {}
    for l in lines:
        k = key_fn(l)
        if k is None:
            continue
        if k not in m:
            m[k] = (blank(), l)
        add(m[k][0], l)
    return [seal(agg, extra_fn(k, sample) if extra_fn else {'key': k}) for k, (agg, sample) in m.items()]


def _by_rev(rows):
    return sorted(rows, key=lambda r: r['revenue'], reverse=True)    # stable: ties keep first-appearance order


def _total(ls):
    a = blank()
    for l in ls:
        add(a, l)
    return seal(a)


def sections(lines):
    """Rows grouped under titled sections with subtotals, for Sales by product, Sales by customer and the donut.
    Level 1: Finished Goods (B2B/B2C) vs Other; level 2 (products only): Other's categories. Every subtotal is sealed from the same lines
    as its rows, so rows add up to the category, categories to Other, and FG + Other to the total."""
    def prod_rows(ls):
        return _by_rev(group(ls, lambda l: l['material'], lambda k, s: {'code': k, 'name': s.get('materialName')}))

    def cust_rows(ls):
        return _by_rev(group(ls, lambda l: l.get('customer'), lambda k, s: {'code': k, 'name': s.get('customerName')}))

    fg = [l for l in lines if is_finished_good(l['material'])]
    other = [l for l in lines if not is_finished_good(l['material'])]
    categories = []
    for c in all_other_categories():
        ls = [l for l in other if category_of(l['material'])['key'] == c['key']]
        if ls:
            categories.append({'key': c['key'], 'title': c['title'], 'total': _total(ls), 'rows': prod_rows(ls)})
    return {
        'products': [
            {'key': 'fg', 'title': FG_TITLE, 'total': _total(fg), 'rows': prod_rows(fg)},
            # `rows` is the flat list of every non-Finished-Goods item (Sales by product); `categories` stays for the donut
            {'key': 'other', 'title': OTHER_TITLE, 'total': _total(other), 'rows': prod_rows(other), 'categories': categories},
        ],
        'customers': [
            {'key': 'fg', 'title': FG_TITLE, 'total': _total(fg), 'rows': cust_rows(fg)},
            {'key': 'other', 'title': OTHER_TITLE, 'total': _total(other), 'rows': cust_rows(other)},
        ],
    }


def aggregate(data, query=None):
    query = query or {}
    period, material, customer = query.get('period'), query.get('material'), query.get('customer')
    frm, to = query.get('from'), query.get('to')
    lines = data['lines']
    if period:
        lines = [l for l in lines if l['period'] == period]
    if frm:
        lines = [l for l in lines if pkey(l['period']) >= pkey(frm)]
    if to:
        lines = [l for l in lines if pkey(l['period']) <= pkey(to)]
    if material:
        lines = [l for l in lines if l['material'] == material]
    if customer:
        lines = [l for l in lines if l.get('customer') == customer]

    periods = sorted(group(lines, lambda l: l['period'], lambda k, s: {'period': k}), key=lambda p: pkey(p['period']))
    products = _by_rev(group(lines, lambda l: l['material'], lambda k, s: {'code': k, 'name': s.get('materialName')}))
    customers = _by_rev(group(lines, lambda l: l.get('customer'), lambda k, s: {'code': k, 'name': s.get('customerName')}))
    total = _total(lines)

    all_periods = sorted(set(l['period'] for l in data['lines']), key=pkey)

    # Shape-of-the-window counts, recomputed from the FILTERED lines — not the full dataset. They sit in the subtitle right beside the
    # filtered totals, so reporting the unfiltered counts there would contradict every other figure on the page.
    counts = {
        'billingDocuments': len(set(l['billingDocument'] for l in lines)),
        'billingItems': len(lines),
        'lines': len(lines),
        'batchesSold': len(set(l['batch'] for l in lines if l.get('batch'))),
        'ordersUsed': len(set(o for l in lines for o in (l.get('orders') or []))),
        'products': len(set(l['material'] for l in lines)),
        'customers': len(set(l.get('customer') for l in lines)),
    }

    # The closure controls are structural checks on a batch's or an order's whole cost chain — so a breach is scoped to the filter by
    # asking only whether that batch/order is actually sold somewhere in the current selection. Coverage and not-costed revenue are
    # plain sums over the filtered lines and come straight from `total`.
    controls = None
    c = data.get('controls')
    if c:
        in_scope_batches = set(l['batch'] for l in lines if l.get('batch'))
        in_scope_orders = set(o for l in lines for o in (l.get('orders') or []))
        controls = {
            'reconciliationPass': c['reconciliation']['pass'],
            'batchBreaches': sum(1 for b in c['batchClosure']['breaches'] if b['batch'] in in_scope_batches),
            'orderBreaches': sum(1 for b in c['orderClosure']['breaches'] if b['order'] in in_scope_orders),
            'quantityBreaches': sum(1 for b in c['quantityControl']['breaches'] if b['batch'] in in_scope_batches),
            # the Validation page counts the whole dataset; carried so the status dot can say how many lie outside this period
            'dataset': {'batch': len(c['batchClosure']['breaches']), 'order': len(c['orderClosure']['breaches']),
                        'quantity': len(c['quantityControl']['breaches'])},
            'notCostedRevenue': total['revenueNotCosted'],
            'assumedZeroRevenue': total['revenueAssumedZero'],
        }

    return {
        'source': data.get('source'),
        'cogmAvailable': data.get('source') == 'api',
        'cogmUnavailableReason': None if data.get('source') == 'api' else 'Unavailable — VC data not included in the spreadsheet source',
        'asOf': data.get('asOf'), 'from': data.get('from'), 'builtAt': data.get('builtAt'),
        'filters': {'period': query.get('period'), 'material': query.get('material'), 'customer': query.get('customer'),
                    'from': query.get('from'), 'to': query.get('to')},
        'allPeriods': all_periods,
        'total': total, 'periods': periods, 'products': products, 'customers': customers,
        'sections': sections(lines),
        'counts': counts,
        'controls': controls,
    }


def documents(lines):
    """Drill level 3/4: documents for a product or customer in a period."""
    rows = group(lines, lambda l: l['billingDocument'], lambda k, s: {
        'billingDocument': k, 'billingDate': s.get('billingDate'), 'period': s['period'],
        'customer': s.get('customer'), 'customerName': s.get('customerName')})
    return sorted(rows, key=lambda r: r['billingDate'], reverse=True)
