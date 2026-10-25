"""Manufacturing-order drill-down: the order's own full actual cost (materials by component, activities, utilities) and the
order <-> batch goods-receipt link. Always live, never date-bounded by the dashboard's own
display window."""
import threading
import time

from .. import sap
from ..config import CFG
from ..cost.engine import (OVERHEAD_LABEL, OVERHEAD_SOURCE_ID, in_cost_bucket, overhead_kept, resolve_overhead_sources)
from ..jsutil import num, odata_date, round2

KG_PER_MT = 1000
RECEIPTS_TTL_S = 5 * 60
_cache = {'rows': None, 'at': 0.0}
_lock = threading.Lock()


def all_receipts():
    """Every live (non-cancelled) goods receipt, order <-> batch — the whole view, not scoped to the dashboard's sold set or date
    range, since the order/batch link must reflect full actual history. Short-lived cache."""
    with _lock:
        now = time.time()
        if _cache['rows'] is not None and now - _cache['at'] < RECEIPTS_TTL_S:
            return _cache['rows']
        mvts = sap.get_all('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, page=5000)
        # Same exclusion as apportion(): a handful of rows carry neither ManufacturingOrder nor OrderID, and without that filter they
        # would collapse onto one blank "order" key, falsely linking every batch that has one into one giant connected component.
        _cache['rows'] = [{'order': m.get('ManufacturingOrder') or m.get('OrderID'), 'batch': m.get('Batch'),
                           'qty': num(m.get('QuantityInBaseUnit')), 'unit': m.get('MaterialBaseUnit'),
                           'material': m.get('Material'), 'date': odata_date(m.get('PostingDate'))}
                          for m in mvts
                          if m.get('GoodsMovementType') == '101' and not m.get('GoodsMovementIsCancelled') and m.get('Batch')
                          and (m.get('ManufacturingOrder') or m.get('OrderID'))]
        _cache['at'] = now
        return _cache['rows']


def link_for(batch=None, order=None, receipts=None):
    """The "Produced by" / "Produced into" link for one batch or one order. Walks the full connected order<->batch component via
    BFS, so the "several orders <-> several batches" case is complete, and each pair carries its quantity share of both the batch and
    the order it belongs to. (`receipts` lets a test inject the receipts instead of calling SAP.)"""
    allr = receipts if receipts is not None else all_receipts()
    by_batch, by_order = {}, {}
    for r in allr:
        by_batch.setdefault(r['batch'], []).append(r)
        by_order.setdefault(r['order'], []).append(r)
    seen_b, seen_o = {}, {}                     # insertion-ordered sets
    queue_b = [batch] if batch else []
    queue_o = [order] if order else []
    while queue_b or queue_o:
        while queue_b:
            b = queue_b.pop()
            if b in seen_b:
                continue
            seen_b[b] = True
            for r in by_batch.get(b, []):
                if r['order'] not in seen_o:
                    queue_o.append(r['order'])
        while queue_o:
            o = queue_o.pop()
            if o in seen_o:
                continue
            seen_o[o] = True
            for r in by_order.get(o, []):
                if r['batch'] not in seen_b:
                    queue_b.append(r['batch'])
    pool = [r for r in allr if r['batch'] in seen_b and r['order'] in seen_o]
    batch_qty, order_qty, pair_qty = {}, {}, {}
    for r in pool:
        batch_qty[r['batch']] = batch_qty.get(r['batch'], 0) + r['qty']
        order_qty[r['order']] = order_qty.get(r['order'], 0) + r['qty']
        k = f"{r['order']}|{r['batch']}"
        pair_qty[k] = pair_qty.get(k, 0) + r['qty']
    pairs = []
    for k, qty in pair_qty.items():
        o, b = k.split('|')
        pairs.append({
            'order': o, 'batch': b, 'qty': round2(qty),
            'pctOfBatch': round2(qty / batch_qty[b] * 100) if batch_qty.get(b) else None,
            'pctOfOrder': round2(qty / order_qty[o] * 100) if order_qty.get(o) else None,
        })
    return {
        'pairs': pairs,
        'batches': [{'batch': b, 'qty': round2(batch_qty.get(b, 0))} for b in seen_b],
        'orders': [{'order': o, 'qty': round2(order_qty.get(o, 0))} for o in seen_o],
        'simple': len(seen_b) <= 1 and len(seen_o) <= 1,
    }


def order_cost_detail(order_id, receipts=None):
    """The order's own full actual cost, grouped exactly as the dashboard's COGM engine buckets it (materials / activities / overhead),
    at line-item grain: materials one row per component (signed qty + cost), activities one combined row, utilities one row (G/L
    94301000, source 10101303/Z2 — the only overhead source that counts toward cost). Reversals net out by construction."""
    jl = sap.get_by_keys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', [order_id], params={
        '$filter': f"Ledger eq '{CFG['LEDGER']}' and CompanyCode eq '{CFG['COMPANY_CODE']}'"})
    return order_cost_detail_from(order_id, jl, receipts if receipts is not None else all_receipts())


def order_cost_detail_from(order_id, jl, receipts_all):
    materials = {}      # component -> {qty, unit, cost, pos, neg}
    activities = {'cost': 0, 'qty': 0, 'unit': None, 'pos': 0, 'neg': 0}
    overhead = {'cost': 0, 'qty': 0, 'unit': None, 'pos': 0, 'neg': 0}
    dates = []
    product = None

    oh_sources = resolve_overhead_sources(jl)   # only the included overhead source is a line item; the rest never appears
    for r in jl:
        bucket = in_cost_bucket(r.get('GLAccount') or '')
        if not bucket or bucket == 'pairedOffset':
            continue
        if bucket == 'overhead' and not overhead_kept(r, oh_sources):
            continue                            # internal allocation pair, nets to 0, not a line item
        amt = num(r.get('AmountInGlobalCurrency'))
        qty = num(r.get('Quantity'))
        d = odata_date(r.get('PostingDate'))
        if d:
            dates.append(d)
        if bucket == 'materials':
            comp = r.get('Product') or '(unspecified component)'
            e = materials.get(comp)
            if e is None:
                e = materials[comp] = {'qty': 0, 'unit': r.get('BaseUnit') or None, 'cost': 0, 'pos': 0, 'neg': 0}
            e['cost'] += amt
            e['qty'] += qty
            e['unit'] = e['unit'] or r.get('BaseUnit') or None
            if amt >= 0:
                e['pos'] += amt
            else:
                e['neg'] += amt
        elif bucket == 'activities':
            activities['cost'] += amt
            activities['qty'] += qty
            activities['unit'] = activities['unit'] or r.get('BaseUnit') or None
            if amt >= 0:
                activities['pos'] += amt
            else:
                activities['neg'] += amt
            product = product or r.get('Product') or None
        elif bucket == 'overhead':
            overhead['cost'] += amt
            overhead['qty'] += qty
            overhead['unit'] = overhead['unit'] or r.get('BaseUnit') or None
            if amt >= 0:
                overhead['pos'] += amt
            else:
                overhead['neg'] += amt

    material_rows = [{'component': c, 'qty': round2(e['qty']), 'unit': e['unit'], 'cost': round2(e['cost']),
                      'hadReversal': e['pos'] > 0 and e['neg'] < 0} for c, e in materials.items()]
    material_rows.sort(key=lambda r: r['cost'], reverse=True)
    materials_total = 0
    for r in material_rows:
        materials_total += r['cost']
    materials_total = round2(materials_total)
    activities_row = {'cost': round2(activities['cost']), 'qty': round2(activities['qty']), 'unit': activities['unit'],
                      'hadReversal': activities['pos'] > 0 and activities['neg'] < 0}
    overhead_row = {'label': OVERHEAD_LABEL, 'source': OVERHEAD_SOURCE_ID, 'cost': round2(overhead['cost']), 'qty': round2(overhead['qty']),
                    'unit': overhead['unit'], 'hadReversal': overhead['pos'] > 0 and overhead['neg'] < 0}
    total_cost = round2(materials_total + activities_row['cost'] + overhead_row['cost'])

    # Quantity produced and the order's own product, from goods receipts — there is no order-header API among the six granted
    # services, so these (and start/finish dates, system status) come from what IS reachable.
    receipts = [r for r in receipts_all if r['order'] == order_id]
    qty_produced_kg = 0
    for r in receipts:
        qty_produced_kg += r['qty']
    qty_produced_kg = round2(qty_produced_kg)
    product = next((r['material'] for r in receipts if r.get('material')), None) or product

    return {
        'order': order_id,
        'product': product,
        'qtyProducedKg': qty_produced_kg,
        'qtyProducedMt': round2(qty_produced_kg / KG_PER_MT) if (receipts and all(r['unit'] == 'KG' for r in receipts)) else None,
        'postingDateFrom': min(dates) if dates else None,
        'postingDateTo': max(dates) if dates else None,
        'materials': material_rows,
        'materialsTotal': materials_total,
        'activities': activities_row,
        'overhead': overhead_row,
        'totalCost': total_cost,
        'actualCostPerKg': round2(total_cost / qty_produced_kg) if qty_produced_kg > 0 else None,
        'lineCount': len(jl),
        # Order header fields the brief asks for that no granted API exposes.
        'headerGaps': ['Start date', 'Finish date', 'System status'],
    }
