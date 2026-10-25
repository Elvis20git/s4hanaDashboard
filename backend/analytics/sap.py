"""Read-only OData v2 client for S/4HANA Public Cloud. Hard guarantee: GET only."""
import base64
import json
import threading
import urllib.error
import urllib.parse
import urllib.request

from .config import CFG, redact

AUTH = 'Basic ' + base64.b64encode(f"{CFG.get('SAP_USER')}:{CFG.get('SAP_PASS')}".encode()).decode()

SERVICES = {
    'billing': '/sap/opu/odata/sap/API_BILLING_DOCUMENT_SRV',
    'delivery': '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002',
    'orderBatch': '/sap/opu/odata/sap/YY1_AIF_ORDER_BATCH_CDS',
    'journal': '/sap/opu/odata/sap/YY1_AIF_JOURNAL_REV_CDS',
    'product': '/sap/opu/odata/sap/API_PRODUCT_SRV',
    'bp': '/sap/opu/odata/sap/API_BUSINESS_PARTNER',
}


class SapError(Exception):
    def __init__(self, msg, status=None, url=''):
        super().__init__(redact(msg))
        self.status = status
        self.url = redact(url or '')


_calls = 0
_lock = threading.Lock()


def stats():
    return {'calls': _calls}


def _raw_get(url, timeout=120, accept='application/json'):
    global _calls
    with _lock:
        _calls += 1
    req = urllib.request.Request(url, method='GET', headers={'Authorization': AUTH, 'Accept': accept})   # read-only, always
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        detail = body[:400]
        try:
            detail = json.loads(body)['error']['message']['value']
        except Exception:
            pass
        raise SapError(f'HTTP {e.code} — {detail}', status=e.code, url=url) from None
    except Exception as e:  # network, timeout, TLS
        raise SapError(f'{type(e).__name__}: {e}', url=url) from None


def metadata(service):
    """Raw $metadata XML for a service."""
    return _raw_get(CFG['SAP_HOST'] + SERVICES[service] + '/$metadata', accept='application/xml')


def get_json(service, entity_set, params=None):
    """One page of an entity set as parsed JSON."""
    qs = {k: v for k, v in (params or {}).items() if v is not None and v != ''}
    qs['$format'] = 'json'
    url = f"{CFG['SAP_HOST']}{SERVICES[service]}/{entity_set}?{urllib.parse.urlencode(qs)}"
    body = _raw_get(url)
    try:
        j = json.loads(body)
    except ValueError:
        raise SapError('Response was not JSON (check entity set name)', url=url) from None
    return j.get('d', j) if isinstance(j, dict) else j


def get_all(service, entity_set, params=None, page=5000, max_rows=None):
    """Page through an entity set until exhausted. Returns all rows."""
    rows, skip = [], 0
    while True:
        d = get_json(service, entity_set, {**(params or {}), '$top': page, '$skip': skip})
        batch = d.get('results') if isinstance(d, dict) and 'results' in d else (d if isinstance(d, list) else [])
        rows.extend(batch)
        if len(batch) < page or (max_rows is not None and len(rows) >= max_rows):
            break
        skip += page
    return rows


def get_by_keys(service, entity_set, field, keys, chunk=50, params=None):
    """Fetch an entity set filtered by a set of key values, chunked to keep $filter short. De-duplicates the keys first
    (rule 8 — several batches share one order), keeping first-seen order."""
    params = params or {}
    uniq = list(dict.fromkeys(k for k in keys if k is not None and k != ''))
    rows = []
    q = "'"
    for i in range(0, len(uniq), chunk):
        part = uniq[i:i + chunk]
        flt = ' or '.join(f"{field} eq '{str(k).replace(q, q + q)}'" for k in part)
        base = f"({params['$filter']}) and ({flt})" if params.get('$filter') else flt
        rows.extend(get_all(service, entity_set, {**params, '$filter': base}, page=5000))
    return rows
