"""Reporting-period status: the ONE place that decides which months are closed, which are loaded and which are in the dashboard.

Used by the live build (window end), the refresh, the Periods panel and the "Data through" popover, so they cannot disagree.

Source of truth for "closed" (interim, until SAP exposes posting-period status to the communication user — see README):
  1. config override  PERIOD_CLOSED=YYYY-MM[,YYYY-MM…]   forced Closed
                      PERIOD_OPEN=YYYY-MM[,…]            forced Open (wins over PERIOD_CLOSED)
  2. calendar rule    a month is Closed once the current Africa/Kigali month is past it.
A provider returning None means "unknown" (shown as Unknown, not included). The window END is never stored: it is derived on every
build as the last day of the latest Closed period."""
import calendar
import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

KIGALI = timezone(timedelta(hours=2))        # Africa/Kigali is UTC+2 all year, no daylight saving
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def kigali_now(now=None):
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n.astimezone(KIGALI)


def kigali_today(now=None):
    return kigali_now(now).strftime('%Y-%m-%d')


def _ym(s):
    """'2026-10', '2026-10-31' or '10.2026' -> '2026-10'."""
    s = str(s).strip()
    if len(s) == 7 and s[2] == '.':
        return f'{s[3:]}-{s[:2]}'
    return s[:7]


def _code(ym):
    return f'{ym[5:7]}.{ym[:4]}'


def label(ym):
    return f'{MONTHS[int(ym[5:7]) - 1]} {ym[:4]}'


def _next(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return f'{y + (m == 12)}-{1 if m == 12 else m + 1:02d}'


def month_range(frm, to):
    """Every month 'YYYY-MM' from frm to to inclusive."""
    out, p, end = [], _ym(frm), _ym(to)
    while p <= end:
        out.append(p)
        p = _next(p)
    return out


def last_day(ym):
    return f'{ym}-{calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]:02d}'


def _list(v):
    return {_ym(x) for x in str(v or '').replace(';', ',').split(',') if x.strip()}


# ---- manual overrides set from the Periods panel (persisted; the audit trail is kept with each entry) -------------------------------
OVERRIDES_FILE = Path(__file__).resolve().parent.parent / 'config' / 'period_overrides.json'
_ov_lock = threading.Lock()


def read_overrides(path=None):
    """{'YYYY-MM': {'status': 'Closed'|'Open', 'by': user, 'at': iso}} — empty when none (or the file is unreadable)."""
    try:
        d = json.loads(Path(path or OVERRIDES_FILE).read_text(encoding='utf-8'))
        return {k: v for k, v in d.items() if isinstance(v, dict) and v.get('status') in ('Closed', 'Open')}
    except Exception:
        return {}


def set_override(ym, status, by, now=None, path=None):
    """status 'Closed' | 'Open' sets a manual override; 'auto' removes it (back to .env / calendar). Returns the new overrides."""
    if status not in ('Closed', 'Open', 'auto'):
        raise ValueError('status must be Closed, Open or auto')
    with _ov_lock:
        d = read_overrides(path)
        if status == 'auto':
            d.pop(ym, None)
        else:
            d[ym] = {'status': status, 'by': by, 'at': (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')}
        p = Path(path or OVERRIDES_FILE)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(d, indent=2, sort_keys=True), encoding='utf-8')
        return d


def effective_cfg(cfg, overrides=None):
    """The scope config with manual overrides merged over the .env lists (manual wins). Every caller that decides closed/open passes this,
    so the build, the refresh, the panel and the pill read the same answer."""
    ov = read_overrides() if overrides is None else overrides
    closed, opened = _list(cfg.get('PERIOD_CLOSED')) - set(ov), _list(cfg.get('PERIOD_OPEN')) - set(ov)
    for ym, v in ov.items():
        (closed if v['status'] == 'Closed' else opened).add(ym)
    return {**cfg, 'PERIOD_CLOSED': ','.join(sorted(closed)), 'PERIOD_OPEN': ','.join(sorted(opened)), 'PERIOD_MANUAL': ','.join(sorted(ov))}


def close_status(ym, now=None, cfg=None):
    """-> ('Closed'|'Open'|'Unknown', source). Manual override (panel), then .env override, then the calendar rule."""
    cfg = cfg or {}
    src = 'manual' if ym in _list(cfg.get('PERIOD_MANUAL')) else 'config'
    if ym in _list(cfg.get('PERIOD_OPEN')):
        return 'Open', src
    if ym in _list(cfg.get('PERIOD_CLOSED')):
        return 'Closed', src
    return ('Closed' if ym < kigali_today(now)[:7] else 'Open'), 'calendar'


def window_end(frm, now=None, cfg=None):
    """Last day of the latest closed period from `frm` to the current month (or None if nothing is closed yet). Derived, never stored."""
    cur = kigali_today(now)[:7]
    closed = [p for p in month_range(frm, max(cur, _ym(frm))) if close_status(p, now, cfg)[0] == 'Closed']
    return last_day(closed[-1]) if closed else None


def _breach_periods(controls, frozen, lines):
    """period -> {'batch': n, 'order': n, 'quantity': n}. A batch breach belongs to every period that sold that batch; an order breach to
    every period that sold a batch the order fed."""
    by_batch = {}
    for l in lines:
        if l.get('batch'):
            by_batch.setdefault(l['batch'], set()).add(_ym(l['period']))
    orders_to_batches = {}
    for f in frozen or []:
        for o in f.get('orders') or []:
            orders_to_batches.setdefault(o, set()).add(f['batch'])
    out = {}

    def add(periods, kind):
        for p in periods:
            out.setdefault(p, {'batch': 0, 'order': 0, 'quantity': 0})[kind] += 1
    c = controls or {}
    for b in (c.get('batchClosure') or {}).get('breaches', []):
        add(by_batch.get(b['batch'], ()), 'batch')
    for b in (c.get('quantityControl') or {}).get('breaches', []):
        add(by_batch.get(b['batch'], ()), 'quantity')
    for o in (c.get('orderClosure') or {}).get('breaches', []):
        ps = set()
        for b in orders_to_batches.get(o['order'], ()):
            ps |= by_batch.get(b, set())
        add(ps, 'order')
    return out


def get_period_statuses(*, lines, frm, now=None, cfg=None, controls=None, frozen=None, loaded_at=None, errors=None, provider=None):
    """Status of every month from `frm` to the current Kigali month.

    lines      the loaded dataset's lines (each has period 'MM.YYYY', revenueUsd, itemResolved, batch)
    loaded_at  {'YYYY-MM': iso timestamp} of the last successful extract of that month
    errors     {'YYYY-MM': message} of the last failed extract
    provider   optional callable ym -> ('Closed'|'Open'|'Unknown', source); default is close_status (config override, then calendar)
    Returns {'rows': [...], 'summary': {...}, 'windowEnd': 'YYYY-MM-DD'|None}."""
    cfg, loaded_at, errors = cfg or {}, loaded_at or {}, errors or {}
    provider = provider or (lambda ym: close_status(ym, now, cfg))
    cur = kigali_today(now)[:7]
    by = {}
    for l in lines or []:
        p = by.setdefault(_ym(l['period']), {'rows': 0, 'revenue': 0.0, 'unresolved': 0})
        p['rows'] += 1
        p['revenue'] += l.get('revenueUsd') or 0
        p['unresolved'] += 0 if l.get('itemResolved', True) else 1
    breaches = _breach_periods(controls, frozen, lines or [])
    rows = []
    for ym in month_range(frm, max(cur, _ym(frm))):
        st, src = provider(ym)
        a = by.get(ym)
        err = errors.get(ym)
        n_br = sum((breaches.get(ym) or {}).values())
        loaded = 'No' if not a else ('Partial' if (err or a['unresolved']) else 'Yes')
        if st == 'Closed':
            if loaded == 'No':
                badge, included, why = 'red', 'No', err or 'Closed but not loaded'
            elif loaded == 'Partial' or n_br:
                badge, included, why = 'amber', 'Yes', ('Included — ' + ('; '.join(x for x in (
                    f'{n_br} closure-control breach(es)' if n_br else '', f"{a['unresolved']} line(s) without a billing-item match" if a['unresolved'] else '',
                    f'last reload failed: {err}' if err else '') if x)))
            else:
                badge, included, why = 'green', 'Yes', 'Closed and loaded'
        elif st == 'Open':
            badge, included, why = 'grey', 'No', 'Open — excluded until month-end close'
        else:
            badge, included, why = 'grey', 'No', 'Close status unknown — excluded'
        rows.append({
            'period': ym, 'code': _code(ym), 'label': label(ym), 'closeStatus': st, 'closeSource': src, 'loaded': loaded,
            'rows': a['rows'] if a else 0, 'revenue': round(a['revenue'], 2) if a else 0.0,
            'breaches': {'batch': 0, 'order': 0, 'quantity': 0, **(breaches.get(ym) or {})}, 'breachCount': n_br,
            'lastLoaded': loaded_at.get(ym), 'error': err, 'badge': badge, 'included': included, 'reason': why,
        })
    inc = [r for r in rows if r['included'] == 'Yes']
    closed = [r for r in rows if r['closeStatus'] == 'Closed']
    openp = [r for r in rows if r['closeStatus'] != 'Closed']
    end = last_day(closed[-1]['period']) if closed else None
    parts = [f"Included: {label(inc[0]['period'])} – {label(inc[-1]['period'])}" if inc else 'Included: none',
             f'{len(closed)} closed period{"" if len(closed) == 1 else "s"}']
    if openp:
        parts.append(f"{len(openp)} open ({', '.join(label(r['period']) for r in openp)})")
    return {'rows': rows, 'windowEnd': end, 'summary': {
        'text': ' · '.join(parts), 'includedFrom': inc[0]['period'] if inc else None, 'includedTo': inc[-1]['period'] if inc else None,
        'closed': len(closed), 'open': len(openp), 'withBreaches': sum(1 for r in rows if r['breachCount']),
        'timezone': 'Africa/Kigali', 'today': kigali_today(now)}}
