"""The cost rules that are configuration, read once and shared by the engine and the cache."""
import hashlib
import json

from ..config import CONFIG_DIR

COST_CONFIG = json.loads((CONFIG_DIR / 'sources.json').read_text(encoding='utf-8'))
# Overhead (G/L 94301000): which sources count toward VC. See config/sources.json -> overheadSources.
OVERHEAD = COST_CONFIG['overheadSources']

# Fingerprint of everything that changes a frozen batch cost (the G/L, which sources count, how they are told apart). Display labels
# are deliberately NOT part of it. The serialisation is compact JSON with a fixed key order, so the fingerprint is stable and a cache
# file written under the same rules is accepted on the next start. A cache written under a different fingerprint is discarded.
_COST_AFFECTING = {
    'gl': OVERHEAD['gl'],
    'included': [x['id'] for x in OVERHEAD['included']],
    'excluded': OVERHEAD['excluded'],
    'identification': {
        'mode': OVERHEAD['identification']['mode'],
        'highRate': OVERHEAD['identification']['highRate'],
        'lowRate': OVERHEAD['identification']['lowRate'],
    },
}
RULE_VERSION = 'oh-' + hashlib.sha1(json.dumps(_COST_AFFECTING, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()[:10]
