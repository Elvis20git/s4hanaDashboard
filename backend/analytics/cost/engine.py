"""The COGM cost engine — Steps 3 to 7 of the method.

VC (variable cost, called COGM in the code) per order = the SIGNED sum of: materials (G/L 51*), activities (labour and machine
accounts, included on purpose even while they are zero), utilities (G/L 94301000, source 10101303/Z2 only) and the paired-offset
account. Overheads (10101303/Z1) are dropped."""
from datetime import datetime, timezone

from ..jsutil import num, round2
from . import cache
from .rules import COST_CONFIG, OVERHEAD

KG_PER_MT = 1000
B = COST_CONFIG['costBuckets']
EXCL = list(COST_CONFIG['excludedFromCost'].keys())

# ---- overhead sources (G/L 94301000) --------------------------------------------------------------------------------
# Only an INCLUDED source counts toward product cost; an excluded one is dropped; anything else is excluded by default and
# reported, never silently added.
INCLUDED = {x['id']: x['label'] for x in OVERHEAD['included']}
EXCLUDED = set(OVERHEAD['excluded'])
OVERHEAD_SOURCE_ID = OVERHEAD['included'][0]['id']
OVERHEAD_LABEL = OVERHEAD['included'][0]['label']


def resolve_overhead_sources(journal):
    """Which source each overhead posting belongs to: dict(id(line) -> source id | None).
    A line may carry an explicit `OverheadSource` and that always wins. Otherwise the source is read from the posting pattern: a
    confirmation posts exactly two overhead lines, the higher rate per kg is one source and the lower the other (config:
    identification). Anything that doesn't fit (an unpaired line, equal rates) is None = unknown."""
    out, groups = {}, {}
    for r in journal:
        if r.get('GLAccount') != OVERHEAD['gl']:
            continue
        if r.get('OverheadSource'):
            out[id(r)] = r['OverheadSource']
            continue
        groups.setdefault(f"{r.get('OrderID')}|{r.get('AccountingDocument')}", []).append(r)

    def rate(r):
        q, a = abs(num(r.get('Quantity'))), abs(num(r.get('AmountInGlobalCurrency')))
        return a / q if q else a

    ident = OVERHEAD['identification']
    for g in groups.values():
        if len(g) != 2 or abs(rate(g[0]) - rate(g[1])) < 1e-9:
            for r in g:
                out[id(r)] = None
            continue
        hi, lo = (g[0], g[1]) if rate(g[0]) > rate(g[1]) else (g[1], g[0])
        out[id(hi)] = ident['highRate']
        out[id(lo)] = ident['lowRate']
    return out


def overhead_kept(line, sources):
    """Does this overhead posting count toward product cost? Only an included source does."""
    return sources.get(id(line)) in INCLUDED


def in_cost_bucket(account):
    """Is this G/L account part of the manufacturing cost collector? -> bucket name or False."""
    if any(account.startswith(p) for p in EXCL):
        return False
    if any(account.startswith(p) for p in B['materials']['prefixes']):
        return 'materials'
    if account in B['activities']['accounts']:
        return 'activities'
    if account in B['overhead']['accounts']:
        return 'overhead'
    if account in B['pairedOffset']['accounts']:
        return 'pairedOffset'
    return False


def order_costs(journal_order_lines, report=None):
    """Step 3 — order cost, SIGNED (not debits-only). A debits-only filter keeps every 261 and drops every 262, overstating cost."""
    report = report if report is not None else {}
    orders = {}
    sources = resolve_overhead_sources(journal_order_lines)
    report.update(keptLines=0, keptAmount=0, excludedLines=0, excludedAmount=0, unknownLines=0, unknownAmount=0)
    for r in journal_order_lines:
        bucket = in_cost_bucket(r.get('GLAccount') or '')
        if not bucket:
            continue
        v = num(r.get('AmountInGlobalCurrency'))        # signed
        if bucket == 'overhead':
            src = sources.get(id(r))
            if src in INCLUDED:
                report['keptLines'] += 1
                report['keptAmount'] += v
            else:
                # an excluded source is dropped; one that is not listed at all is dropped too, but flagged
                if src and src in EXCLUDED:
                    report['excludedLines'] += 1
                    report['excludedAmount'] += v
                elif v:
                    report['unknownLines'] += 1
                    report['unknownAmount'] += v
                continue
        key = r.get('OrderID')
        o = orders.get(key)
        if o is None:
            o = orders[key] = {'cost': 0, 'buckets': {}, 'accounts': {}, 'lastPosting': ''}
        o['cost'] += v
        o['buckets'][bucket] = o['buckets'].get(bucket, 0) + v
        acct = r.get('GLAccount')
        o['accounts'][acct] = o['accounts'].get(acct, 0) + v
    return orders


def apportion(orders, receipts):
    """Step 4 — apportion each order across the batches it fed, by received quantity.
    Never charge a batch the whole cost of an order that also fed other batches.
    receipts: [{order, batch, qty}] — movement 101 net of cancellations."""
    order_qty, pair_qty = {}, {}
    for r in receipts:
        if not r.get('order') or not r.get('batch'):
            continue
        order_qty[r['order']] = order_qty.get(r['order'], 0) + r['qty']
        k = f"{r['order']}|{r['batch']}"
        pair_qty[k] = pair_qty.get(k, 0) + r['qty']
    batch, order_distributed = {}, {}
    for k, qty in pair_qty.items():
        order, b = k.split('|')
        total = order_qty.get(order, 0)
        if total <= 0:
            continue
        oc = orders.get(order)
        share = qty / total
        cost = oc['cost'] * share if oc is not None else 0
        e = batch.get(b)
        if e is None:
            e = batch[b] = {'cost': 0, 'qty': 0, 'orders': {}, 'costed': True}
        e['cost'] += cost
        e['qty'] += qty
        e['orders'][order] = {'qty': qty, 'share': share, 'cost': cost,
                              'orderCost': oc['cost'] if oc is not None else None, 'hasCost': oc is not None}
        if oc is None:
            e['costed'] = False    # batch fed by an order with no journal cost
        order_distributed[order] = order_distributed.get(order, 0) + cost
    return batch, order_qty, order_distributed


def _iso_now():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'


def unit_cost_entry(b, e, final):
    """Step 5 — freeze the batch unit cost. Computed once per batch, cached by batch number."""
    return {
        'batch': b,
        'cost': round2(e['cost']),
        'qty': e['qty'],
        'unitCostPerKg': e['cost'] / e['qty'] if e['qty'] > 0 else None,   # divide in KG, from the UNROUNDED cost
        'orders': list(e['orders'].keys()),
        'costed': e['costed'],
        'final': final,
        'computedAt': _iso_now(),
    }


def make_is_final(orders, order_last, closure_as_of):
    """A batch may be frozen for good only when every order behind it is costed and last posted in a closed month."""
    open_period_from = closure_as_of[:7] + '-01'     # the current month is never closed

    def is_final(b, e):
        for o in e['orders'].keys():
            last = order_last.get(o)
            if not last or last >= open_period_from:
                return False
            if orders.get(o) is None:
                return False
        return e['costed']
    return is_final


def freeze_unit_costs(batch_map, is_final):
    out = {}
    for b, e in batch_map.items():
        frozen = cache.get_frozen(b)
        if frozen:
            out[b] = {**frozen, 'fromCache': True}
            continue
        entry = unit_cost_entry(b, e, is_final(b, e))
        cache.put(b, entry)
        out[b] = {**entry, 'fromCache': False}
    return out


def allocate_to_line(qty_kg, unit_cost_per_kg):
    """Step 6 — allocate to the sold quantity. Step 7 — a reversal carries a negative quantity, so it reverses at the SAME frozen
    unit cost by construction. Never recomputed at a current rate."""
    if unit_cost_per_kg is None or unit_cost_per_kg != unit_cost_per_kg or unit_cost_per_kg in (float('inf'), float('-inf')):
        return None
    return qty_kg * unit_cost_per_kg


def cost_lines(lines, frozen):
    """Steps 6/7 for every sold line: COGM (shown as VC) = sold quantity x the batch's frozen unit cost. A line whose batch/order never
    resolves is costed at an ASSUMED $0 (status 'assumed-zero'), kept distinct from a real resolved cost."""
    def zero_cost(l, reason):
        l['cogmUsd'] = 0
        l['cmUsd'] = l['revenueUsd']
        l['cmPct'] = None if l['revenueUsd'] == 0 else 100
        l['costStatus'] = 'assumed-zero'
        l['costReason'] = reason

    for l in lines:
        l['orders'] = []
        if not l.get('batch'):
            zero_cost(l, 'Missing batch — no manufacturing order exists for this product; VC assumed $0, not computed')
            continue
        f = frozen.get(l['batch'])
        if not f:
            zero_cost(l, f"Manufacturing order not found for batch {l['batch']} — VC assumed $0, not computed")
            continue
        l['orders'] = f['orders']
        l['batchUnitCostPerMt'] = None if f.get('unitCostPerKg') is None else round2(f['unitCostPerKg'] * KG_PER_MT)
        if f.get('unitCostPerKg') is None or not f.get('costed'):
            zero_cost(l, ('Batch produced zero quantity' if f['qty'] == 0 else f"VC unavailable for batch {l['batch']}") + ' — VC assumed $0, not computed')
            continue
        l['cogmUsd'] = round2(allocate_to_line(l['qtyKg'], f['unitCostPerKg']))
        l['cmUsd'] = round2(l['revenueUsd'] - l['cogmUsd'])
        l['cmPct'] = None if l['revenueUsd'] == 0 else round2(l['cmUsd'] / l['revenueUsd'] * 100)
        l['costStatus'] = 'final' if f.get('final') else 'provisional'
        l['costReason'] = None if f.get('final') else 'Order open or period not closed — overhead surcharge runs at period close'
    return lines
