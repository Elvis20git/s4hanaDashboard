"""Full pipeline: billing -> revenue (USD) -> batches -> order cost -> frozen unit cost -> COGM per (line,batch) -> contribution margin
-> controls. Every join to delivery, batch or order is a LEFT join (rule 1 — completeness)."""
import time
from datetime import datetime, timezone

from .. import sap
from ..config import CFG
from ..cost import cache
from ..cost.engine import (apportion, cost_lines, freeze_unit_costs, make_is_final, order_costs, round2)
from ..jsutil import js_round, num, odata_date, to_fixed
from .controls import run_controls

KG_PER_MT = 1000


def _today():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _period(d):
    return d[5:7] + '.' + d[0:4]


def build(as_of=None, closure_as_of=None, log=None):
    """`as_of` is the reporting cutoff: the upper bound on BillingDocumentDate, i.e. what the dashboard actually shows. Capping it
    (via config REPORT_TO) removes a period from the dashboard completely — it is never fetched, not merely filtered client-side.
    `closure_as_of` is the REAL current date, used only to decide whether a batch's feeding orders are still open."""
    as_of = as_of or CFG.get('REPORT_TO') or _today()
    closure_as_of = closure_as_of or _today()
    log = log or (lambda m: None)
    started = time.time()
    frm = CFG['PERIOD_FROM']
    chunk = int(CFG.get('BATCH_CHUNK') or 50)
    log(f'scope {frm} .. {as_of}' + (f' (period-closure evaluated as of {closure_as_of})' if closure_as_of != as_of else ''))

    # ---------- Stage 1: billing documents in scope ----------
    hdrs_all = sap.get_all('billing', 'A_BillingDocument', {
        '$filter': f"SalesOrganization eq '{CFG['SALES_ORG']}' and CompanyCode eq '{CFG['COMPANY_CODE']}'"
                   f" and BillingDocumentDate ge datetime'{frm}T00:00:00'"
                   f" and BillingDocumentDate le datetime'{as_of}T00:00:00'",
        '$select': 'BillingDocument,BillingDocumentDate,BillingDocumentType,BillingDocumentIsCancelled,'
                   'CancelledBillingDocument,SoldToParty,AccountingDocument,FiscalYear,CompanyCode,'
                   'AccountingPostingStatus,TransactionCurrency',
    }, page=5000)
    hdrs = [h for h in hdrs_all if h.get('AccountingPostingStatus') == 'C']
    log(f'billing documents: {len(hdrs_all)} retrieved, {len(hdrs)} posted to accounting')

    def acct_key(h):
        return f"{h.get('CompanyCode')}|{h.get('FiscalYear')}|{h.get('AccountingDocument')}"

    by_acct = {acct_key(h): h for h in hdrs}
    by_doc = {h['BillingDocument']: h for h in hdrs}

    # ---------- Stage 1b: billing items (these carry the batch split) ----------
    items_all = sap.get_by_keys('billing', 'A_BillingDocumentItem', 'BillingDocument', [h['BillingDocument'] for h in hdrs],
                                chunk=chunk, params={
        '$select': 'BillingDocument,BillingDocumentItem,Material,Batch,Plant,BillingQuantity,'
                   'BillingQuantityUnit,BillingQuantityInBaseUnit,BaseUnit,NetAmount,TransactionCurrency,'
                   'ReferenceSDDocument,ReferenceSDDocumentItem,SalesDocument'})
    # Split parents carry zero quantity AND zero value. They contribute nothing and would double-count the document if kept.
    items = [i for i in items_all if num(i.get('BillingQuantityInBaseUnit')) != 0 or num(i.get('NetAmount')) != 0]
    log(f'billing items: {len(items_all)} ({len(items_all) - len(items)} zero-value split parents set aside)')

    # ---------- Stage 1b2: resolve non-KG base units via the product master ----------
    # Rule 9 is "no INVENTED conversion", not "no conversion": the material master's own alternate-unit gross weight is authoritative.
    non_kg_units = list(dict.fromkeys(i.get('Material') for i in items if i.get('BaseUnit') and i.get('BaseUnit') != 'KG'))
    kg_per_unit = {}        # "material|unit" -> kg per 1 unit of that alternate unit
    if non_kg_units:
        try:
            uom = sap.get_by_keys('product', 'A_ProductUnitsOfMeasure', 'Product', non_kg_units, chunk=chunk,
                                  params={'$select': 'Product,AlternativeUnit,GrossWeight,WeightUnit'})
        except Exception:
            uom = []
        for u in uom:
            if u.get('WeightUnit') == 'KG' and num(u.get('GrossWeight')) > 0:
                kg_per_unit[f"{u.get('Product')}|{u.get('AlternativeUnit')}"] = num(u.get('GrossWeight'))
        resolved = list(dict.fromkeys(f"{i.get('Material')}|{i.get('BaseUnit')}" for i in items if f"{i.get('Material')}|{i.get('BaseUnit')}" in kg_per_unit))
        total_units = len(set(f"{i.get('Material')}|{i.get('BaseUnit')}" for i in items if i.get('BaseUnit') and i.get('BaseUnit') != 'KG'))
        log(f'non-KG base units: {len(non_kg_units)} material(s) to check, {len(resolved)}/{total_units} unit(s) resolved via product master gross weight')

    # ---------- Stage 1c: revenue in GLOBAL CURRENCY from the ledger ----------
    # Revenue originates from the billing document set (rule 6). The ledger supplies the USD valuation because the billing API
    # exposes transaction currency only.
    jrev_all = sap.get_all('journal', 'YY1_AIF_JOURNAL_REV', {
        '$filter': f"Ledger eq '{CFG['LEDGER']}' and CompanyCode eq '{CFG['COMPANY_CODE']}' and startswith(GLAccount,'41')",
    }, page=5000)
    jrev = []
    for r in jrev_all:
        d = odata_date(r.get('PostingDate'))
        if d is not None and frm <= d <= as_of and f"{r.get('CompanyCode')}|{r.get('FiscalYear')}|{r.get('AccountingDocument')}" in by_acct:
            jrev.append(r)
    log(f'journal revenue lines: {len(jrev_all)} retrieved, {len(jrev)} belong to in-scope billing documents')

    # ---------- join journal line -> billing item (acctg doc + material + |qty|) ----------
    pool = {}
    for i in items:
        h = by_doc[i['BillingDocument']]
        k = f"{acct_key(h)}|{i.get('Material')}|{to_fixed(abs(num(i.get('BillingQuantityInBaseUnit'))), 3)}"
        pool.setdefault(k, []).append(i)
    used_items = set()
    lines = []
    for r in jrev:
        h = by_acct[f"{r.get('CompanyCode')}|{r.get('FiscalYear')}|{r.get('AccountingDocument')}"]
        matl = r.get('SoldProduct') or r.get('Product')
        k = f"{acct_key(h)}|{matl}|{to_fixed(abs(num(r.get('Quantity'))), 3)}"
        item = next((i for i in pool.get(k, []) if id(i) not in used_items), None)
        if item is not None:
            used_items.add(id(item))
        date = odata_date(r.get('PostingDate'))
        # The billing item stores a credit memo's quantity POSITIVE; the ledger line carries the true posting direction. Take the
        # magnitude from the item and the sign from the ledger, so a reversal carries negative quantity and reverses COGM at the
        # frozen rate (Step 7). The ledger carries quantity on the same credit convention as revenue: a normal sale posts NEGATIVE
        # quantity, a credit memo positive. Negate both together.
        j_qty = -num(r.get('Quantity'))
        qty_in_base_unit = ((-1 if j_qty < 0 else 1) * abs(num(item.get('BillingQuantityInBaseUnit')))) if item is not None else j_qty
        unit = item.get('BaseUnit') if item is not None else r.get('BaseUnit')
        kg_factor = 1 if unit == 'KG' else kg_per_unit.get(f'{matl}|{unit}')
        # qtyKg is genuinely KG whenever a real conversion is known (unit itself or the product master's own gross weight); otherwise it
        # stays in the raw base unit and qtyMt is null — the line is flagged, never guessed at (rule 9).
        qty_kg = qty_in_base_unit * kg_factor if kg_factor is not None else qty_in_base_unit
        lines.append({
            'billingDocument': h['BillingDocument'],
            'billingItem': item.get('BillingDocumentItem') if item is not None else None,
            'billingDate': odata_date(h.get('BillingDocumentDate')),
            'postingDate': date,
            'period': _period(date),
            'billingType': h.get('BillingDocumentType'),
            'material': matl,
            'customer': r.get('Customer'),
            'batch': (item.get('Batch') or None) if item is not None else None,
            'qtyKg': qty_kg,
            'baseUnit': unit,
            'qtyMt': qty_kg / KG_PER_MT if kg_factor is not None else None,
            'revenueUsd': -num(r.get('AmountInGlobalCurrency')) + 0.0,        # credit balance -> positive revenue
            'transactionCurrency': h.get('TransactionCurrency'),
            'accountingDocument': r.get('AccountingDocument'),
            'itemResolved': item is not None,
        })
    log(f"lines assembled: {len(lines)} ({sum(1 for l in lines if not l['itemResolved'])} without a billing-item match)")

    # ---------- Stage 2: batches sold, and the orders behind them ----------
    sold_set = set(l['batch'] for l in lines if l['batch'])
    log(f'distinct batches sold: {len(sold_set)}')

    # NO date filter on the cost side (rule 2) — a batch sold in Jan 2026 was made in late 2025.
    mvts = sap.get_all('orderBatch', 'YY1_AIF_ORDER_BATCH', {}, page=5000)
    receipts = [{'order': m.get('ManufacturingOrder') or m.get('OrderID'), 'batch': m.get('Batch'),
                 'qty': num(m.get('QuantityInBaseUnit')), 'material': m.get('Material'),
                 'date': odata_date(m.get('PostingDate')), 'unit': m.get('MaterialBaseUnit')}
                for m in mvts if m.get('GoodsMovementType') == '101' and not m.get('GoodsMovementIsCancelled') and m.get('Batch')]
    cancelled_rows = sum(1 for m in mvts if m.get('GoodsMovementIsCancelled'))
    log(f'goods receipts: {len(receipts)} live 101 rows ({cancelled_rows} cancelled rows netted out)')

    # Orders feeding the sold batches — DEDUPLICATED (rule 8: several batches share one order).
    orders_needed = list(dict.fromkeys(r['order'] for r in receipts if r['batch'] in sold_set and r['order']))
    log(f'manufacturing orders behind those batches: {len(orders_needed)}')

    # ---------- Step 3: order cost, signed, keyed by order (never by date) ----------
    jord = sap.get_by_keys('journal', 'YY1_AIF_JOURNAL_REV', 'OrderID', orders_needed, chunk=chunk, params={
        '$filter': f"Ledger eq '{CFG['LEDGER']}' and CompanyCode eq '{CFG['COMPANY_CODE']}'"})
    log(f'order journal lines: {len(jord)}')
    oh_report = {}
    orders = order_costs(jord, oh_report)
    log(f"overhead: {oh_report['keptLines']} lines counted toward VC ({_us(js_round(oh_report['keptAmount']))} USD); "
        f"{oh_report['excludedLines']} lines from excluded sources dropped ({_us(js_round(oh_report['excludedAmount']))} USD)")
    if oh_report['unknownLines']:
        msg = f"WARNING overhead: {oh_report['unknownLines']} line(s), {_us(js_round(oh_report['unknownAmount']))} USD, from an unrecognised source — excluded by default"
        log(msg)
        print(msg)
    order_last = {}
    for r in jord:
        d = odata_date(r.get('PostingDate'))
        oid = r.get('OrderID')
        if oid not in order_last or (d is not None and order_last[oid] is not None and d > order_last[oid]):
            order_last[oid] = d

    # ---------- Step 4/5: apportion by received quantity, then freeze ----------
    relevant = [r for r in receipts if r['batch'] in sold_set]
    batch_map, order_qty, order_distributed = apportion(orders, relevant)
    is_final = make_is_final(orders, order_last, closure_as_of)
    frozen = freeze_unit_costs(batch_map, is_final)
    cache.save()
    log(f"batch unit costs: {len(frozen)} ({sum(1 for f in frozen.values() if f['fromCache'])} reused from cache, "
        f"{sum(1 for f in frozen.values() if f['final'])} final)")

    # ---------- Step 6/7: allocate COGM to each line (shared engine logic) ----------
    cost_lines(lines, frozen)

    # ---------- master data for display (names only; never a source of figures) ----------
    mat_codes = list(dict.fromkeys(l['material'] for l in lines))
    cust_codes = list(dict.fromkeys(l['customer'] for l in lines if l['customer']))
    try:
        desc_rows = sap.get_by_keys('product', 'A_ProductDescription', 'Product', mat_codes, chunk=chunk,
                                    params={'$filter': "Language eq 'EN'", '$select': 'Product,ProductDescription'})
    except Exception:
        desc_rows = []
    try:
        bp_rows = sap.get_by_keys('bp', 'A_BusinessPartner', 'BusinessPartner', cust_codes, chunk=chunk,
                                  params={'$select': 'BusinessPartner,BusinessPartnerFullName,OrganizationBPName1'})
    except Exception:
        bp_rows = []
    product_name = {r['Product']: r.get('ProductDescription') for r in desc_rows}
    customer_name = {r['BusinessPartner']: (r.get('BusinessPartnerFullName') or r.get('OrganizationBPName1') or r['BusinessPartner']) for r in bp_rows}
    for l in lines:
        l['materialName'] = product_name.get(l['material']) or l['material']
        l['customerName'] = customer_name.get(l['customer']) or l['customer'] or '—'
    log(f'master data: {len(product_name)} product names, {len(customer_name)} customer names')

    controls = run_controls(lines=lines, frozen=frozen, orders=orders, order_qty=order_qty, order_distributed=order_distributed,
                            batch_map=batch_map, receipts=receipts, as_of=as_of)
    ms = round((time.time() - started) * 1000)
    log(f'built in {ms / 1000:.1f}s')

    return {
        'asOf': as_of, 'from': frm, 'builtAt': _iso_now(), 'buildMs': ms, 'source': 'api',
        'productName': product_name, 'customerName': customer_name,
        'lines': lines,
        'frozen': list(frozen.values()),
        'orderCost': {k: {'cost': round2(v['cost']), 'buckets': v['buckets']} for k, v in orders.items()},
        'counts': {
            'billingDocuments': len(hdrs),
            'billingItems': len(items_all),
            'lines': len(lines),
            'batchesSold': len(sold_set),
            'ordersUsed': len(orders_needed),
            'products': len(set(l['material'] for l in lines)),
            'customers': len(set(l['customer'] for l in lines)),
        },
        'controls': controls,
    }


def _us(n):
    return f'{int(n):,}'


def _iso_now():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'
