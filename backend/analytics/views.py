"""HTTP API: JSON in/out under /api. Every route is
guarded (analytics.auth.decorators.guard): the Sales data needs the `sales` dashboard, Data Management routes need `data_management`,
uploads / refresh need a data steward, exports need a non-VIEWER role. See backend/README.md."""
import json
from pathlib import Path

from django.http import HttpResponse

from . import sap
from .auth import permissions as perm, services
from .auth.decorators import guard
from .config import CFG, FIXTURE_DATASET, FIXTURE_DIR, redact
from .cost import cache as cost_cache
from .http import body_json as _body, jres
from .jsutil import round2
from .pipeline import chat as chat_mod
from .pipeline.aggregate import aggregate
from .pipeline.modetail import link_for, order_cost_detail
from .state import iso_now, load_spreadsheets, refresh_api, state


# ---------------------------------------------------------------- helpers
def _src(request, body=None):
    s = (body or {}).get('source') if body is not None else request.GET.get('source')
    return 'spreadsheet' if s == 'spreadsheet' else 'api'


def _query(request):
    g = request.GET
    return {k: g.get(k) for k in ('period', 'material', 'customer', 'from', 'to')}


def _js_str(v):
    """String(number) as JavaScript prints it (100 not 100.0)."""
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e21:
        return str(int(v))
    return str(v)


def _fixture_reply(kind, ident):
    from urllib.parse import quote
    f = Path(FIXTURE_DIR) / kind / (quote(ident, safe="-_.!~*'()") + '.json')
    if not f.exists():
        return jres({'error': f'No captured {kind} snapshot for {ident} (fixture mode).'}, 404)
    return HttpResponse(f.read_text(encoding='utf-8'), content_type='application/json')


# ---------------------------------------------------------------- routes
@guard()
def status(request):
    """Shared by every dashboard (user, data window, the "Data through" dot). Infrastructure detail — build log, cache and SAP-call
    counts, connection message — is returned only to users who can open Data Management."""
    u = request.aif_user
    api, ss = state['api'], state['spreadsheet']
    dm = perm.can_view(u, perm.DATA_MANAGEMENT)
    conn = state['connection'] if dm else {'ok': state['connection'].get('ok')}
    out = {
        'user': services.public_user(u),
        'scope': {'from': CFG.get('PERIOD_FROM'), 'companyCode': CFG.get('COMPANY_CODE'), 'salesOrg': CFG.get('SALES_ORG'),
                  'ledger': CFG.get('LEDGER'), 'currency': 'USD (global currency)', 'overheadGl': CFG.get('OVERHEAD_GL')},
        'connection': conn,
        'sources': {
            'api': {'available': bool(api['data']), 'error': api['error'] if dm else None, 'refreshing': api['refreshing'],
                    'lastRefresh': api['lastRefresh'],
                    'periodFrom': api['data']['from'] if api['data'] else None, 'periodTo': api['data']['asOf'] if api['data'] else None,
                    'cogmAvailable': True, 'log': api['log'] if dm else []},
            'spreadsheet': {'available': bool(ss['data']), 'error': ss['error'] if dm else None, 'lastRefresh': ss['lastRefresh'],
                            'periodFrom': ss['data']['from'] if ss['data'] else None, 'periodTo': ss['data']['asOf'] if ss['data'] else None,
                            'cogmAvailable': False, 'loaded': ss['data']['loaded'] if (ss['data'] and dm) else []},
        },
        'cache': cost_cache.stats() if dm else {},
        'sapCalls': sap.stats()['calls'] if dm else None,
    }
    return jres(out)


@guard(dashboard=perm.DATA_MANAGEMENT)
def connection_test(request):
    try:
        xml = sap.metadata('journal')
        state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Reached YY1_AIF_JOURNAL_REV — {len(xml)} bytes of metadata.'}
    except Exception as e:
        state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
    return jres(state['connection'])


@guard(dashboard=perm.SALES)
def data(request):
    src = _src(request)
    s = state[src]
    if s.get('error'):
        return jres({'error': s['error'], 'source': src}, 502)
    if not s['data']:
        return jres({'error': f'The {src} source has not been loaded yet.', 'source': src}, 503)
    return jres(aggregate(s['data'], _query(request)))


@guard(dashboard=perm.SALES)
def lines(request):
    src = _src(request)
    s = state[src]
    if not s['data']:
        return jres({'error': f'The {src} source has not been loaded yet.'}, 503)
    g = request.GET
    period, material, customer, doc = g.get('period'), g.get('material'), g.get('customer'), g.get('billingDocument')
    rows = [l for l in s['data']['lines']
            if (not period or l['period'] == period) and (not material or l['material'] == material)
            and (not customer or l.get('customer') == customer) and (not doc or l['billingDocument'] == doc)]
    return jres({'source': src, 'asOf': s['data']['asOf'], 'count': len(rows), 'rows': rows})


@guard(dashboard=perm.DATA_MANAGEMENT)
def validation(request):
    src = _src(request)
    s = state[src]
    if not s['data']:
        return jres({'error': f'The {src} source has not been loaded yet.'}, 503)
    d = s['data']
    controls = d.get('controls')
    if not controls:
        note = ('Controls require a live data refresh — click Refresh to generate them.'
                if src == 'api'
                else 'Validation controls apply to the live API source only — the spreadsheet source carries no cost chain.')
        controls = {'note': note}
    return jres({'source': src, 'asOf': d['asOf'], 'builtAt': d['builtAt'], 'controls': controls})


@guard(dashboard=perm.SALES)
def batch(request, batch_id):
    if FIXTURE_DIR:
        return _fixture_reply('batch', batch_id)
    d = state['api']['data']
    if not d:
        return jres({'error': 'The API source has not been loaded yet.'}, 503)
    f = next((x for x in d['frozen'] if x['batch'] == batch_id), None)
    if not f:
        return jres({'error': f'Batch {batch_id} not found.'}, 404)
    try:
        link = link_for(batch=batch_id)
        # Cost share, not just quantity share: this order's own total cost, apportioned by its quantity share into THIS batch, as a
        # fraction of the batch's own total apportioned cost.
        for p in link['pairs']:
            oc = (d['orderCost'].get(p['order']) or {}).get('cost')
            p['costSharePct'] = round2((oc * ((p['pctOfOrder'] or 0) / 100)) / f['cost'] * 100) if (oc is not None and f['cost']) else None
        order_detail = [{'order': o, **(d['orderCost'].get(o) or {})} for o in f['orders']]
        return jres({**f, 'orderDetail': order_detail, 'link': link})
    except Exception as e:
        return jres({'error': redact(str(e))}, 502)


@guard(dashboard=perm.SALES)
def order(request, order_id):
    """Manufacturing-order drill-down — the order's own full actual cost by component/bucket, plus how it links to the batch(es) it fed,
    compared against the frozen unit cost those batches actually carry in the margin figures."""
    if FIXTURE_DIR:
        return _fixture_reply('order', order_id)
    d = state['api']['data']
    if not d:
        return jres({'error': 'The API source has not been loaded yet.'}, 503)
    try:
        detail = order_cost_detail(order_id)
        link = link_for(order=order_id)
        if not detail['lineCount']:
            return jres({'error': f'No cost postings found for order {order_id}.'}, 404)
        compare = []
        for b in link['batches']:
            bid = b['batch']
            f = next((x for x in d['frozen'] if x['batch'] == bid), None)
            pair = next((p for p in link['pairs'] if p['order'] == order_id and p['batch'] == bid), None)
            share = round2((detail['totalCost'] * (pair['pctOfOrder'] / 100)) / f['cost'] * 100) if (f and f.get('cost') and pair and pair.get('pctOfOrder') is not None) else None
            if not f or f.get('unitCostPerKg') is None or detail['actualCostPerKg'] is None:
                compare.append({'batch': bid, 'unitCostPerKg': f.get('unitCostPerKg') if f else None, 'diffPerKg': None, 'diffPct': None, 'reason': None, 'costSharePct': share})
                continue
            diff = round2(f['unitCostPerKg'] - detail['actualCostPerKg'])
            feeding = sum(1 for p in link['pairs'] if p['batch'] == bid)
            reason = None
            if abs(diff) < 0.005:
                reason = None
            elif feeding > 1:
                reason = f"This batch blends {feeding} orders at different actual cost rates — its frozen cost is a weighted average, not this order's own rate."
            elif not f.get('final'):
                reason = 'Batch cost is still provisional — the order was open or the period not yet closed when it was frozen.'
            compare.append({'batch': bid, 'unitCostPerKg': f['unitCostPerKg'], 'diffPerKg': diff,
                            'diffPct': round2(diff / detail['actualCostPerKg'] * 100) if detail['actualCostPerKg'] else None,
                            'reason': reason, 'costSharePct': share})
        product_name = (d.get('productName') or {}).get(detail['product']) or detail['product']
        material_codes = [m['component'] for m in detail['materials'] if m['component'][:1].isdigit()]
        if material_codes:
            try:
                rows = sap.get_by_keys('product', 'A_ProductDescription', 'Product', material_codes,
                                       params={'$filter': "Language eq 'EN'", '$select': 'Product,ProductDescription'})
                names = {r['Product']: r.get('ProductDescription') for r in rows}
                for m in detail['materials']:
                    m['componentName'] = names.get(m['component']) or m['component']
            except Exception:
                for m in detail['materials']:
                    m['componentName'] = m['component']
        return jres({**detail, 'productName': product_name, 'link': link, 'compareBatches': compare})
    except Exception as e:
        return jres({'error': redact(str(e))}, 502)


@guard(dashboard=perm.DATA_MANAGEMENT, steward=True)
def refresh(request):
    if request.method != 'POST':
        return jres({'error': 'Method not allowed'}, 405)
    if FIXTURE_DATASET:
        a = state['api']
        return jres({'ok': True, 'error': None, 'lastRefresh': a['lastRefresh'], 'log': a['log']})   # fixture mode: nothing to refresh
    s = refresh_api(user=request.aif_user)
    return jres({'ok': not s['error'], 'error': s['error'], 'lastRefresh': s['lastRefresh'], 'log': s['log']})


@guard(dashboard=perm.DATA_MANAGEMENT, steward=True)
def spreadsheet_load(request):
    if request.method != 'POST':
        return jres({'error': 'Method not allowed'}, 405)
    try:
        entries = [{'name': f['name'], 'path': str(Path(f['path']).resolve())} for f in (_body(request).get('files') or [])]
        if not entries:
            return jres({'error': 'No files given.'}, 400)
        d = load_spreadsheets(entries, user=request.aif_user)
        return jres({'ok': True, 'loaded': d['loaded'], 'counts': d['counts'], 'history': state['spreadsheet']['loadHistory']})
    except Exception as e:
        return jres({'error': redact(str(e))}, 400)


@guard(dashboard=perm.DATA_MANAGEMENT)
def load_history(request):
    return jres({'history': state['spreadsheet']['loadHistory']})


@guard(dashboard=perm.SALES)
def chat(request):
    """Chat is a local, rule-based lookup over the already-aggregated data — no external API call, nothing it says can disagree with the
    dashboard's own cards, and nothing it says is fabricated."""
    if request.method != 'POST':
        return jres({'error': 'Method not allowed'}, 405)
    body = _body(request)
    src = _src(request, body)
    s = state[src]
    if not s['data']:
        return jres({'reply': f'The {src} source has not been loaded yet.', 'kind': 'text'}, 503)
    scope = {k: body.get(k) for k in ('period', 'material', 'customer', 'from', 'to')}
    try:
        return jres(chat_mod.answer(s['data'], scope, body.get('message'), allow_controls=perm.can_view(request.aif_user, perm.DATA_MANAGEMENT), context=body.get('context')))
    except Exception as e:
        return jres({'reply': 'Something went wrong answering that — try rephrasing.', 'kind': 'text', 'error': redact(str(e))}, 500)


@guard(dashboard=perm.DATA_MANAGEMENT, export=True)
def export_validation_csv(request):
    d = state['api']['data']
    if not d:
        return HttpResponse('The API source has not been loaded yet.', status=503)
    c = d['controls']
    s = _js_str
    out = ['section,key,value1,value2,value3,note']
    for r in c['reconciliation']['rows']:
        out.append(f"reconciliation,{r['period']},{s(r['revenue'])},{s(r['target'])},{s(r['diff'])},{'tie' if r['pass'] else 'DIFFERENCE'}")
    t = c['reconciliation']['total']
    out.append(f"reconciliation,YTD,{s(t['revenue'])},{s(t['target'])},{s(t['diff'])},{'tie' if c['reconciliation']['pass'] else 'DIFFERENCE'}")
    for r in c['coverage']:
        out.append(f"costing,{r['period']},{s(r['revenueNotCosted'])},{s(r['cm'])},,not-costed revenue and CM")
    for b in c['batchClosure']['breaches']:
        out.append(f"batch-closure-breach,{b['batch']},{s(b['batchCost'])},{s(b['allocatedCogm'])},{s(b['ratio'])},allocated COGM exceeds batch cost")
    for b in c['orderClosure']['breaches']:
        out.append(f"order-closure-breach,{b['order']},{s(b['expected'])},{s(b['distributed'])},{s(b['diff'])},order cost not fully distributed")
    for b in c['quantityControl']['breaches']:
        out.append(f"quantity-breach,{b['batch']},{s(b['deliveredKg'])},{s(b['producedKg'])},{s(b['excessKg'])},delivered exceeds net produced")
    for m in c['missingCost']:
        out.append(f"missing-cost,{m['billingDocument']}-{m['billingItem']},{m['material']},{s(m['revenueUsd'])},{m['batch'] or ''},\"{m['reason']}\"")
    for m in c['conversionIssues']:
        out.append(f"conversion,{m['billingDocument']}-{m['billingItem']},{m['material']},{s(m['qty'])},{m['unit']},\"{m['reason']}\"")
    for m in c['unmatchedRecords']:
        out.append(f"unmatched,{m['billingDocument']},{m['material']},{s(m['revenueUsd'])},,\"{m['reason']}\"")
    resp = HttpResponse('\n'.join(out), content_type='text/csv')
    resp['Content-Disposition'] = 'attachment; filename="aif-validation.csv"'
    return resp
