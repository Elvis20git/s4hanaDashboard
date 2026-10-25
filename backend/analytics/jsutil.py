"""Helpers that reproduce the JavaScript number/date semantics the dashboard's front end uses, so every figure the backend computes or
formats matches what is displayed: Math.round, Number.prototype.toFixed, Intl number formatting, Number(), and /Date(ms)/ parsing."""
import math
import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

EPSILON = 2.220446049250313e-16   # Number.EPSILON
NAN = float('nan')


def js_round(x):
    """Math.round: halves round toward +infinity."""
    return math.floor(x + 0.5)


def round2(n):
    """round2(n) = Math.round((n + Number.EPSILON) * 100) / 100 as JavaScript computes it (never returns -0)."""
    return js_round((n + EPSILON) * 100) / 100 + 0.0


def to_fixed(x, digits):
    """Number.prototype.toFixed: rounds the exact binary value half-up (not half-even)."""
    if x != x:
        return 'NaN'
    if x in (math.inf, -math.inf):
        return 'Infinity' if x > 0 else '-Infinity'
    q = Decimal(1).scaleb(-digits)
    return format(Decimal(x).quantize(q, rounding=ROUND_HALF_UP), 'f')


def intl_en_us(x, max_frac=3, min_frac=0):
    """toLocaleString('en-US', {minimumFractionDigits, maximumFractionDigits}): halfExpand on the shortest decimal form."""
    if x is None or x != x:
        return 'NaN'
    d = Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-max_frac), rounding=ROUND_HALF_UP)
    s = format(abs(d), 'f')
    if '.' in s:
        whole, frac = s.split('.')
        frac = frac.rstrip('0')
    else:
        whole, frac = s, ''
    frac = frac.ljust(min_frac, '0')
    out = f'{int(whole):,}' + ('.' + frac if frac else '')
    return ('-' if d < 0 else '') + out


def num(v):
    """Number(v) with the rule that None / '' mean 0; unparsable -> NaN."""
    if v is None or v == '':
        return 0
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).strip())
    except ValueError:
        return NAN


_DATE_RE = re.compile(r'/Date\((-?\d+)')


def odata_date(v):
    """'/Date(1767225600000)/' or an ISO string -> 'YYYY-MM-DD' (the UTC calendar date), None if unparsable."""
    if not v:
        return None
    m = _DATE_RE.search(str(v))
    try:
        if m:
            d = datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
        else:
            s = str(v).strip().replace('Z', '+00:00')
            d = datetime.fromisoformat(s)
            d = d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)
        return d.strftime('%Y-%m-%d')
    except (ValueError, OverflowError, OSError):
        return None


def js_str(v):
    """String(v) for a spreadsheet cell: whole floats print without '.0' like JavaScript."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)
