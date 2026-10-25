"""On-disk cache of FROZEN batch unit costs (Step 5).
A batch sold in March and again in August must carry the same unit cost both times. Entries whose orders are settled and whose
period is closed are never recomputed."""
import json
import threading
from datetime import datetime, timezone

from ..config import CACHE_DIR
from .rules import RULE_VERSION

FILE = CACHE_DIR / 'batch-unit-cost.json'
_lock = threading.Lock()


def _fresh():
    return {'version': 1, 'ruleVersion': RULE_VERSION, 'entries': {}}


def _read_all():
    try:
        s = json.loads(FILE.read_text(encoding='utf-8'))
        # Frozen costs were derived under the cost rules in force when they were written; if the rules have changed
        # (e.g. which overhead sources count), every stored value is stale and the whole cache is dropped.
        return s if s.get('ruleVersion') == RULE_VERSION else _fresh()
    except Exception:
        return _fresh()


_store = _read_all()


def get(batch):
    return _store['entries'].get(batch)


def get_frozen(batch):
    """A frozen entry is reusable only when it was final when written."""
    e = _store['entries'].get(batch)
    return e if e and e.get('final') else None


def put(batch, entry):
    _store['entries'][batch] = entry


def save():
    with _lock:
        FILE.parent.mkdir(parents=True, exist_ok=True)
        _store['savedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
        FILE.write_text(json.dumps(_store, indent=2), encoding='utf-8')


def stats():
    e = list(_store['entries'].values())
    return {
        'batches': len(e),
        'final': sum(1 for x in e if x.get('final')),
        'provisional': sum(1 for x in e if not x.get('final')),
        'savedAt': _store.get('savedAt'),
    }


def clear():
    global _store
    _store = _fresh()
    save()
