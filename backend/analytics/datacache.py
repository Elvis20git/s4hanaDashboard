"""On-disk cache of the last successful live dataset, so the app opens instantly and reads nothing from SAP until someone presses
Refresh. It is replaced by every successful load, and ignored (never trusted) if the scope or the cost rules have changed since it was
written. A month that has closed since the cache was saved is NOT silently missing: the period helper reports it as closed-but-not-loaded
and start-up loads it (see state.warm_up)."""
import json
import os
from datetime import datetime, timezone

from .config import CACHE_DIR, CFG
from .cost.rules import RULE_VERSION

FILE = CACHE_DIR / 'dataset-cache.json'
VERSION = 1


def scope():
    """What the cached data was selected by. A different company, ledger, start date or cost rule makes the cache unusable."""
    return {'from': CFG.get('PERIOD_FROM'), 'companyCode': CFG.get('COMPANY_CODE'), 'salesOrg': CFG.get('SALES_ORG'),
            'ledger': CFG.get('LEDGER'), 'ruleVersion': RULE_VERSION, 'version': VERSION}


def save(data, meta, path=None):
    """Atomic write (temp file, then replace) so a crash mid-write can never leave a half-written cache."""
    p = path or FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = {'meta': {**meta, 'scope': scope(), 'savedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, 'data': data}
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc), encoding='utf-8')
    os.replace(tmp, p)


def load(path=None):
    """-> (data, meta) or None when there is no usable cache."""
    try:
        doc = json.loads((path or FILE).read_text(encoding='utf-8'))
        if doc['meta'].get('scope') != scope() or 'lines' not in doc['data']:
            return None
        return doc['data'], doc['meta']
    except Exception:
        return None
