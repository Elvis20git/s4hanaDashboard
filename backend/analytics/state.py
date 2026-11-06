"""In-memory application state and the two data sources."""
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import BASE_DIR, CFG, FIXTURE_DATASET, VALIDATION_DIR, redact
from . import datacache
from .periods import _ym, effective_cfg, get_period_statuses, month_range, window_end
from .pipeline.build import build
from .pipeline.spreadsheet import build_from_files

state = {
    'api': {'data': None, 'error': None, 'lastRefresh': None, 'refreshing': False, 'warming': False, 'log': [], 'periodLoadedAt': {},
            'periodErrors': {}, 'progress': None, 'fromCache': False, 'cachedAt': None},
    'spreadsheet': {'data': None, 'error': None, 'lastRefresh': None, 'loadHistory': [], 'periodLoadedAt': {}, 'periodErrors': {}},
    'connection': {'ok': None, 'checkedAt': None, 'detail': None},
}
_refresh_lock = threading.Lock()
_progress_lock = threading.Lock()

# The two spreadsheet extracts warmed at start-up, looked up in AIF_SPREADSHEET_DIR, then backend/data/.
DEFAULT_SPREADSHEETS = [
    'Line Items 01.01.2026 - 15.10.2026.xlsx',
    '20261015-175119_2CCSDREVNFRMINVCQ.xlsx',
]


def iso_now():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'


def cap_to_report_window(data):
    """The window end is derived (periods.window_end), never stored. build() applies it inside the SAP query for the live API source,
    but a spreadsheet's full contents are read as given — this is the one place both sources pass through before being stored, so an
    open month can never reach the dashboard by switching source."""
    if not data or 'lines' not in data:
        return data
    cutoff = window_end(data.get('from') or CFG['PERIOD_FROM'], cfg=effective_cfg(CFG))
    if not cutoff:
        return data

    def pkey(p):
        return p[3:] + p[:2]

    cutoff_period = cutoff[5:7] + '.' + cutoff[0:4]
    lines = [l for l in data['lines'] if pkey(l['period']) <= pkey(cutoff_period)]
    if len(lines) == len(data['lines']):
        return data
    periods = sorted(set(l['period'] for l in lines), key=pkey)
    out = {**data, 'lines': lines, 'periods': periods, 'asOf': cutoff}
    if data.get('counts'):
        out['counts'] = {
            **data['counts'],
            'billingDocuments': len(set(l['billingDocument'] for l in lines)),
            'billingItems': len(lines),
            'lines': len(lines),
            'products': len(set(l['material'] for l in lines)),
            'customers': len(set(l.get('customer') for l in lines)),
        }
    return out


def period_statuses(src='api', now=None):
    """The shared status of every month for a source — used by the Periods panel, the "Data through" popover and the refresh."""
    s = state[src]
    d = s['data'] or {}
    frm = d.get('from') or CFG['PERIOD_FROM']
    return get_period_statuses(lines=d.get('lines') or [], frm=frm, now=now, cfg=effective_cfg(CFG), controls=d.get('controls'), frozen=d.get('frozen'),
                               loaded_at=s.get('periodLoadedAt'), errors=s.get('periodErrors'))


def _scope_months():
    frm = CFG['PERIOD_FROM']
    end = window_end(frm, cfg=effective_cfg(CFG))
    return month_range(frm, end[:7]) if end else []


def _begin(mode, reason):
    """Claim the single loader. Returns False if a load is already running (never two at once)."""
    api = state['api']
    if not _refresh_lock.acquire(blocking=False):
        return False
    months = _scope_months()
    mode = mode if mode in ('concurrent', 'sequential') else (CFG.get('LOAD_MODE') or 'concurrent')
    api['refreshing'] = True
    api['log'] = []
    api['progress'] = {'phase': 'extracting', 'mode': mode, 'reason': reason, 'startedAt': iso_now(), 'finishedAt': None,
                       'total': len(months) + 1, 'done': 0, 'journal': 'pending', 'periods': {m: 'pending' for m in months}}
    return True


def _progress(kind, key, status):
    api = state['api']
    with _progress_lock:
        p = api['progress']
        if kind == 'period':
            p['periods'][key] = status
        elif kind == 'journal':
            p['journal'] = status
        elif kind == 'phase':
            p['phase'] = key
        p['done'] = sum(1 for v in p['periods'].values() if v == 'done') + (1 if p['journal'] == 'done' else 0)


def _run(reason):
    """Extract the closed window from SAP (read-only), then store, cache and record it. Caller holds the loader (see _begin)."""
    api = state['api']
    try:
        data = cap_to_report_window(build(log=api['log'].append, mode=api['progress']['mode'], progress=_progress))
        api['data'] = data
        api['error'] = None
        api['lastRefresh'] = iso_now()
        loaded = sorted({_ym(l['period']) for l in data['lines']})
        api['periodLoadedAt'] = {p: api['lastRefresh'] for p in loaded}
        api['periodErrors'] = {}
        api['fromCache'], api['cachedAt'] = False, None
        api['log'].append(f"window {data['from']} → {data['asOf']} · {len(loaded)} period(s) loaded")
        VALIDATION_DIR.mkdir(parents=True, exist_ok=True)
        (VALIDATION_DIR / 'dataset.json').write_text(json.dumps(data), encoding='utf-8')
        try:
            datacache.save(data, {'lastRefresh': api['lastRefresh'], 'periodLoadedAt': api['periodLoadedAt'],
                                  'mode': api['progress']['mode'], 'reason': reason})
        except Exception as e:       # a cache that cannot be written must never fail the load itself
            api['log'].append('cache not saved: ' + redact(str(e)))
        api['progress']['phase'] = 'done'
    except Exception as e:  # surfaced to the UI as "Data unavailable"
        api['error'] = redact(str(e) or repr(e))
        api['periodErrors'] = {r['period']: api['error'] for r in period_statuses('api')['rows'] if r['closeStatus'] == 'Closed'}
        api['progress']['phase'] = 'error'
    finally:
        api['progress']['finishedAt'] = iso_now()
        api['refreshing'] = False
        _refresh_lock.release()


def refresh_api(mode=None, reason='refresh'):
    """Blocking load (start-up, tests, scripts). The web UI uses start_refresh so the page stays responsive."""
    if _begin(mode, reason):
        _run(reason)
    return state['api']


def start_refresh(mode=None, reason='refresh'):
    """Non-blocking load: returns at once; the work runs in a background thread and is reported through state['api']['progress'].
    Returns False if a load is already running."""
    if not _begin(mode, reason):
        return False
    threading.Thread(target=_run, args=(reason,), name='aif-load', daemon=True).start()
    return True


def load_spreadsheets(entries):
    """Load Excel files and update the in-memory spreadsheet cache."""
    import re
    li = next((e for e in entries if re.search(r'line\s*items', e['name'], re.I)), None)
    sv = next((e for e in entries if re.search(r'2CCSDREVNFRMINVCQ|sales\s*volume', e['name'], re.I)), None)
    data = cap_to_report_window(build_from_files(li['path'] if li else None, sv['path'] if sv else None))

    ss = state['spreadsheet']
    ss['data'] = data
    ss['lastRefresh'] = iso_now()
    ss['error'] = None
    ss['periodLoadedAt'] = {p: ss['lastRefresh'] for p in sorted({_ym(l['period']) for l in data['lines']})}
    for l in data['loaded']:
        ss['loadHistory'].insert(0, {
            'file': l['file'], 'kind': l['kind'], 'rows': l['rows'],
            'loadedAt': iso_now(),
            'periods': f"{data['periods'][-1]} → {data['periods'][0]}" if data['periods'] else '—',
            'status': 'LOADED',
        })
    return data


def _find_default_files():
    out = []
    for name in DEFAULT_SPREADSHEETS:
        for d in (os.environ.get('AIF_SPREADSHEET_DIR'), BASE_DIR / 'data'):
            if d and (Path(d) / name).exists():
                out.append({'name': name, 'path': str((Path(d) / name).resolve())})
                break
        else:
            out.append({'name': name, 'path': str((BASE_DIR / 'data' / name).resolve())})
    return out


def warm_up():
    """Open with every closed period loaded. First run: load them all from SAP (the UI shows "Loading data…") and cache the result.
    Later runs: open from that cache at once and read nothing from SAP until Refresh — except a month that has closed since the cache
    was written, which is loaded now. Runs in a background thread so the server answers immediately."""
    from . import sap
    api = state['api']
    api['warming'] = True
    try:
        try:
            load_spreadsheets(_find_default_files())
            print('  spreadsheet source loaded')
        except Exception as e:
            state['spreadsheet']['error'] = redact(str(e))
            print('  spreadsheet source failed:', state['spreadsheet']['error'])
        if FIXTURE_DATASET:
            try:
                data = json.loads(Path(FIXTURE_DATASET).read_text(encoding='utf-8'))
                api.update(data=data, error=None, lastRefresh=data.get('builtAt') or iso_now())
                state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': 'Fixture dataset — no SAP connection (test mode)'}
                print('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET)
            except Exception as e:
                api['error'] = redact(str(e))
                print('  fixture load failed:', api['error'])
            return
        cached = datacache.load()
        if cached:
            data, meta = cached
            api.update(data=data, error=None, lastRefresh=meta.get('lastRefresh'), fromCache=True, cachedAt=meta.get('savedAt'),
                       periodLoadedAt=meta.get('periodLoadedAt') or {}, periodErrors={})
            print(f"  live dataset opened from cache (saved {meta.get('savedAt')}) — no SAP read until Refresh")
        try:
            xml = sap.metadata('journal')
            state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Connected — {len(xml)} bytes of metadata.'}
        except Exception as e:
            state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
            print('  SAP connection failed:', state['connection']['detail'])
            return
        missing = [r['label'] for r in period_statuses('api')['rows'] if r['closeStatus'] == 'Closed' and r['loaded'] == 'No'] if cached else []
        if cached and not missing:
            return
        print('  SAP connection OK — ' + (f"loading newly closed period(s): {', '.join(missing)}" if cached else 'first load, building live dataset…'))
        refresh_api(reason='startup' if not cached else 'startup: newly closed ' + ', '.join(missing))
        print(f"  live build FAILED: {api['error']}" if api['error'] else '  live dataset ready (cached for next start)')
    finally:
        api['warming'] = False
