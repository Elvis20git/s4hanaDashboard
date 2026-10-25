"""Environment loading, scope settings and secret redaction."""
import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
CONFIG_DIR = BASE_DIR / 'config'
CACHE_DIR = BASE_DIR / 'cache'
VALIDATION_DIR = BASE_DIR / 'validation'


def load_env(path):
    """Minimal .env loader. Does NOT process backslash escapes (the communication-user password contains \\ > } = + - literally);
    strips only one matched pair of surrounding quotes."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f'Missing env file: {p}')
    out = {}
    for raw in p.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        eq = line.find('=')
        if eq < 0:
            continue
        key = line[:eq].strip()
        val = line[eq + 1:].strip()
        if len(val) > 1 and ((val[0] == '"' and val[-1] == '"') or (val[0] == "'" and val[-1] == "'")):
            val = val[1:-1]
        out[key] = val
    return out


FIXTURE_DATASET = Path(os.environ['AIF_FIXTURE_DATASET']).resolve() if os.environ.get('AIF_FIXTURE_DATASET') else None
FIXTURE_DIR = Path(os.environ['AIF_FIXTURE_DIR']).resolve() if os.environ.get('AIF_FIXTURE_DIR') else None

_SCOPE_KEYS = ['PORT', 'REPORT_TO', 'COMPANY_CODE', 'SALES_ORG', 'LEDGER', 'PERIOD_FROM', 'OVERHEAD_GL', 'BATCH_CHUNK']


def _find_env():
    """backend/config/.env (AIF_ENV_FILE overrides)."""
    for c in (os.environ.get('AIF_ENV_FILE'), CONFIG_DIR / '.env'):
        if c and Path(c).exists():
            return Path(c)
    return None


_env_file = _find_env()
if _env_file:
    CFG = load_env(_env_file)
elif FIXTURE_DATASET:
    # fixture mode needs no SAP access: scope settings may come from the process environment
    CFG = {k: os.environ[k] for k in _SCOPE_KEYS if os.environ.get(k) is not None}
else:
    raise FileNotFoundError(f'Missing env file: {CONFIG_DIR / ".env"} (copy config/.env.example and fill it in)')

_SECRETS = [s for s in (CFG.get('SAP_PASS'), CFG.get('SAP_USER')) if s and len(s) > 3]


def redact(value):
    """Scrub credentials from anything that is logged, returned or exported."""
    s = value if isinstance(value, str) else ('' if value is None else str(value))
    for sec in _SECRETS:
        s = s.replace(sec, '«redacted»')
    s = re.sub(r'Basic\s+[A-Za-z0-9+/=]+', 'Basic «redacted»', s)
    s = re.sub(r'//[^/@\s]+:[^/@\s]+@', '//«redacted»@', s)
    return s
