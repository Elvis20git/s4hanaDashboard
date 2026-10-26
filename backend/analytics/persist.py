"""Persistence layer: save build() / build_from_files() output to PostgreSQL and reload it.
All writes to fact tables go through these functions — never directly from views or state."""
from datetime import date, datetime, timezone
from decimal import Decimal

from django.db import transaction
from django.utils import timezone as dj_timezone

from .models import BatchUnitCost, BillingLine, Customer, Material, SyncRun


def _dec(v):
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


def _date(s):
    if not s:
        return None
    if isinstance(s, date):
        return s
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


def _now_str():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'


# ---------------------------------------------------------------------------
# Master data upserts
# ---------------------------------------------------------------------------

def upsert_materials(lines, product_name=None):
    """Upsert Material rows from line dicts. Returns {code: Material instance}."""
    from .productgroup import is_finished_good as _is_fg
    names = dict(product_name or {})
    for l in lines:
        if l.get('material') and l.get('materialName') and l['material'] not in names:
            names[l['material']] = l['materialName']
    codes = list(dict.fromkeys(l['material'] for l in lines if l.get('material')))
    if not codes:
        return {}

    existing = {m.code: m for m in Material.objects.filter(code__in=codes)}
    to_create, to_update = [], []
    for code in codes:
        name = names.get(code, '')
        fg = _is_fg(code)
        if code in existing:
            m = existing[code]
            if (name and m.name != name) or m.is_finished_good != fg:
                if name:
                    m.name = name
                m.is_finished_good = fg
                to_update.append(m)
        else:
            to_create.append(Material(code=code, name=name, is_finished_good=fg))

    if to_create:
        Material.objects.bulk_create(to_create, update_conflicts=True,
            unique_fields=['code'], update_fields=['name', 'is_finished_good', 'updated_at'])
    if to_update:
        Material.objects.bulk_update(to_update, ['name', 'is_finished_good', 'updated_at'])

    return {m.code: m for m in Material.objects.filter(code__in=codes)}


def upsert_customers(lines, customer_name=None):
    """Upsert Customer rows from line dicts. Returns {code: Customer instance}."""
    names = dict(customer_name or {})
    for l in lines:
        if l.get('customer') and l.get('customerName') and l['customer'] not in names:
            names[l['customer']] = l['customerName']
    codes = list(dict.fromkeys(l['customer'] for l in lines if l.get('customer')))
    if not codes:
        return {}

    existing = {c.code: c for c in Customer.objects.filter(code__in=codes)}
    to_create, to_update = [], []
    for code in codes:
        name = names.get(code, '')
        if code in existing:
            c = existing[code]
            if name and c.name != name:
                c.name = name
                to_update.append(c)
        else:
            to_create.append(Customer(code=code, name=name))

    if to_create:
        Customer.objects.bulk_create(to_create, update_conflicts=True,
            unique_fields=['code'], update_fields=['name', 'updated_at'])
    if to_update:
        Customer.objects.bulk_update(to_update, ['name', 'updated_at'])

    return {c.code: c for c in Customer.objects.filter(code__in=codes)}


# ---------------------------------------------------------------------------
# Batch unit cost upsert
# ---------------------------------------------------------------------------

def upsert_batch_unit_costs(frozen_list, sync_run=None):
    """Upsert BatchUnitCost rows. Entries where is_final=True are never overwritten.
    Returns {batch: BatchUnitCost instance}."""
    from .cost.rules import RULE_VERSION
    if not frozen_list:
        return {}
    batches = {f['batch']: f for f in frozen_list if f.get('batch')}
    if not batches:
        return {}

    existing = {b.batch: b for b in BatchUnitCost.objects.filter(batch__in=list(batches))}
    to_create, to_update = [], []

    for batch, f in batches.items():
        computed_at = dj_timezone.now()
        raw_ts = f.get('computedAt')
        if raw_ts:
            try:
                computed_at = datetime.fromisoformat(raw_ts.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                pass

        if batch in existing:
            b = existing[batch]
            if b.is_final:
                continue   # settled batch cost is immutable
            b.cost = _dec(f.get('cost'))
            b.qty_kg = _dec(f.get('qty'))
            b.unit_cost_per_kg = _dec(f.get('unitCostPerKg'))
            b.orders = f.get('orders', [])
            b.costed = bool(f.get('costed', True))
            b.is_final = bool(f.get('final', False))
            b.rule_version = RULE_VERSION
            b.computed_at = computed_at
            b.sync_run = sync_run
            to_update.append(b)
        else:
            to_create.append(BatchUnitCost(
                batch=batch,
                cost=_dec(f.get('cost')),
                qty_kg=_dec(f.get('qty')),
                unit_cost_per_kg=_dec(f.get('unitCostPerKg')),
                orders=f.get('orders', []),
                costed=bool(f.get('costed', True)),
                is_final=bool(f.get('final', False)),
                rule_version=RULE_VERSION,
                computed_at=computed_at,
                sync_run=sync_run,
            ))

    if to_create:
        BatchUnitCost.objects.bulk_create(to_create, update_conflicts=True,
            unique_fields=['batch'],
            update_fields=['cost', 'qty_kg', 'unit_cost_per_kg', 'orders', 'costed',
                           'is_final', 'rule_version', 'computed_at', 'sync_run_id', 'updated_at'])
    if to_update:
        BatchUnitCost.objects.bulk_update(to_update,
            ['cost', 'qty_kg', 'unit_cost_per_kg', 'orders', 'costed',
             'is_final', 'rule_version', 'computed_at', 'sync_run_id', 'updated_at'])

    return {b.batch: b for b in BatchUnitCost.objects.filter(batch__in=list(batches))}


# ---------------------------------------------------------------------------
# Billing line upsert
# ---------------------------------------------------------------------------

def _persist_lines(lines, mat_map, cust_map, buc_map, source, sync_run=None, upload_batch=None):
    objs = []
    for l in lines:
        mat = mat_map.get(l.get('material'))
        if not mat:
            continue
        cust = cust_map.get(l.get('customer')) if l.get('customer') else None
        buc = buc_map.get(l.get('batch')) if l.get('batch') else None
        objs.append(BillingLine(
            billing_document=l.get('billingDocument') or '',
            billing_item=l.get('billingItem') or '',
            billing_date=_date(l.get('billingDate')),
            posting_date=_date(l.get('postingDate')),
            period=l.get('period') or '',
            billing_type=l.get('billingType') or '',
            material=mat,
            customer=cust,
            batch=l.get('batch') or '',
            qty_kg=_dec(l.get('qtyKg')),
            qty_mt=_dec(l.get('qtyMt')),
            base_unit=l.get('baseUnit') or '',
            qty_derived=bool(l.get('qtyDerived', False)),
            revenue_usd=_dec(l.get('revenueUsd', 0)) or Decimal('0'),
            transaction_currency=l.get('transactionCurrency') or '',
            cogm_usd=_dec(l.get('cogmUsd')),
            cm_usd=_dec(l.get('cmUsd')),
            cm_pct=_dec(l.get('cmPct')),
            cost_status=l.get('costStatus') or 'not-costed',
            cost_reason=l.get('costReason') or '',
            batch_unit_cost=buc,
            upload_batch=upload_batch,
            sync_run=sync_run,
            source=source,
        ))
    if objs:
        BillingLine.objects.bulk_create(
            objs, update_conflicts=True,
            unique_fields=['billing_document', 'billing_item', 'source'],
            update_fields=[
                'billing_date', 'posting_date', 'period', 'billing_type',
                'material_id', 'customer_id', 'batch',
                'qty_kg', 'qty_mt', 'base_unit', 'qty_derived',
                'revenue_usd', 'transaction_currency',
                'cogm_usd', 'cm_usd', 'cm_pct',
                'cost_status', 'cost_reason',
                'batch_unit_cost_id', 'upload_batch_id', 'sync_run_id',
            ]
        )
    return len(objs)


# ---------------------------------------------------------------------------
# Top-level dataset persisters
# ---------------------------------------------------------------------------

def persist_api_dataset(data, sync_run=None):
    """Save build() output to PostgreSQL inside one transaction. Returns stats dict."""
    with transaction.atomic():
        lines = data.get('lines', [])
        frozen = data.get('frozen', [])

        mat_map = upsert_materials(lines, data.get('productName'))
        cust_map = upsert_customers(lines, data.get('customerName'))
        buc_map = upsert_batch_unit_costs(frozen, sync_run=sync_run)

        # Lines may reference batches already final in the DB but not in this run's frozen list
        missing = [l['batch'] for l in lines if l.get('batch') and l['batch'] not in buc_map]
        if missing:
            buc_map.update({b.batch: b for b in BatchUnitCost.objects.filter(batch__in=missing)})

        n = _persist_lines(lines, mat_map, cust_map, buc_map, 'api', sync_run=sync_run)

    return {'materials': len(mat_map), 'customers': len(cust_map), 'batches': len(buc_map), 'lines': n}


def persist_spreadsheet_dataset(data, upload_batch=None):
    """Save build_from_files() output to PostgreSQL inside one transaction. Returns stats dict."""
    with transaction.atomic():
        lines = data.get('lines', [])
        mat_map = upsert_materials(lines)
        cust_map = upsert_customers(lines)
        n = _persist_lines(lines, mat_map, cust_map, {}, 'spreadsheet', upload_batch=upload_batch)

    return {'materials': len(mat_map), 'customers': len(cust_map), 'lines': n}


# ---------------------------------------------------------------------------
# Reload from DB
# ---------------------------------------------------------------------------

def load_billing_lines_from_db(source):
    """Reconstruct the data dict that state / aggregate() expects from persisted BillingLine rows.
    Returns None if no rows exist for this source."""
    qs = (BillingLine.objects
          .filter(source=source)
          .select_related('material', 'customer', 'batch_unit_cost')
          .order_by('posting_date'))

    lines = []
    for bl in qs:
        buc = bl.batch_unit_cost
        lines.append({
            'billingDocument': bl.billing_document,
            'billingItem': bl.billing_item,
            'billingDate': bl.billing_date.isoformat() if bl.billing_date else None,
            'postingDate': bl.posting_date.isoformat() if bl.posting_date else None,
            'period': bl.period,
            'billingType': bl.billing_type,
            'material': bl.material.code,
            'materialName': bl.material.name,
            'customer': bl.customer.code if bl.customer_id else None,
            'customerName': bl.customer.name if bl.customer_id else '—',
            'batch': bl.batch or None,
            'qtyKg': float(bl.qty_kg) if bl.qty_kg is not None else None,
            'qtyMt': float(bl.qty_mt) if bl.qty_mt is not None else None,
            'baseUnit': bl.base_unit,
            'qtyDerived': bl.qty_derived,
            'revenueUsd': float(bl.revenue_usd),
            'transactionCurrency': bl.transaction_currency,
            'cogmUsd': float(bl.cogm_usd) if bl.cogm_usd is not None else None,
            'cmUsd': float(bl.cm_usd) if bl.cm_usd is not None else None,
            'cmPct': float(bl.cm_pct) if bl.cm_pct is not None else None,
            'costStatus': bl.cost_status,
            'costReason': bl.cost_reason or None,
            'orders': buc.orders if buc else [],
            'batchUnitCostPerMt': (
                float(buc.unit_cost_per_kg) * 1000
                if buc and buc.unit_cost_per_kg else None
            ),
            'itemResolved': True,
        })

    if not lines:
        return None

    pkey = lambda p: p[3:] + p[:2]  # MM.YYYY → sortable YYYY.MM
    periods = sorted(set(l['period'] for l in lines), key=pkey)
    dates = [l['postingDate'] for l in lines if l['postingDate']]

    frozen = []
    if source == 'api':
        sold_batches = list(set(l['batch'] for l in lines if l.get('batch')))
        for b in BatchUnitCost.objects.filter(batch__in=sold_batches):
            frozen.append({
                'batch': b.batch,
                'cost': float(b.cost),
                'qty': float(b.qty_kg),
                'unitCostPerKg': float(b.unit_cost_per_kg) if b.unit_cost_per_kg else None,
                'orders': b.orders,
                'costed': b.costed,
                'final': b.is_final,
                'computedAt': b.computed_at.isoformat() if b.computed_at else None,
                'fromCache': True,
            })

    return {
        'source': source,
        'lines': lines,
        'frozen': frozen,
        'periods': periods,
        'asOf': max(dates) if dates else '',
        'from': min(dates) if dates else '',
        'builtAt': _now_str(),
        'productName': {l['material']: l['materialName'] for l in lines},
        'customerName': {l['customer']: l['customerName'] for l in lines if l.get('customer')},
        'counts': {
            'billingDocuments': len(set(l['billingDocument'] for l in lines)),
            'billingItems': len(lines),
            'lines': len(lines),
            'batchesSold': len(set(l['batch'] for l in lines if l.get('batch'))),
            'ordersUsed': len(set(o for l in lines for o in (l.get('orders') or []))),
            'products': len(set(l['material'] for l in lines)),
            'customers': len(set(l.get('customer') for l in lines)),
        },
        'cogmAvailable': source == 'api',
        'controls': None,   # controls require the full pipeline; available after a live refresh
        'orderCost': {},    # not stored; available after a live refresh
    }
