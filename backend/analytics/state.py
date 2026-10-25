"""In-memory application state and the two data sources.
The dataset is built once at start-up (and on demand) and kept in the process; every API call aggregates from it."""
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import BASE_DIR, CFG, FIXTURE_DATASET, VALIDATION_DIR, redact
from .pipeline.build import build
from .pipeline.spreadsheet import build_from_files

state = {
    'api': {'data': None, 'error': None, 'lastRefresh': None, 'refreshing': False, 'log': []},
    'spreadsheet': {'data': None, 'error': None, 'lastRefresh': None, 'loadHistory': []},
    'connection': {'ok': None, 'checkedAt': None, 'detail': None},
}
_refresh_lock = threading.Lock()

# The two spreadsheet extracts warmed at start-up, looked up in AIF_SPREADSHEET_DIR, then backend/data/.
DEFAULT_SPREADSHEETS = [
    'Line Items 01.01.2026 - 15.10.2026.xlsx',
    '20261015-175119_2CCSDREVNFRMINVCQ.xlsx',
]


def iso_now():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'


def cap_to_report_window(data):
    """`REPORT_TO` removes a period from the dashboard completely, regardless of which source serves it. build() already applies it
    inside the SAP query for the live API source, but a spreadsheet's full contents are read as given — this is the one place both
    sources pass through before being stored, so a cutoff set here can never be bypassed by switching source."""
    cutoff = CFG.get('REPORT_TO')
    if not cutoff or not data or 'lines' not in data:
        return data

    def pkey(p):
        return p[3:] + p[:2]

    cutoff_period = cutoff[5:7] + '.' + cutoff[0:4]
    lines = [l for l in data['lines'] if pkey(l['period']) <= pkey(cutoff_period)]
    if len(lines) == len(data['lines']):
        return data         # already within the window
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


def refresh_api():
    api = state['api']
    if not _refresh_lock.acquire(blocking=False):
        return api
    api['refreshing'] = True
    api['log'] = []
    try:
        data = cap_to_report_window(build(log=api['log'].append))
        api['data'] = data
        api['error'] = None
        api['lastRefresh'] = iso_now()
        VALIDATION_DIR.mkdir(parents=True, exist_ok=True)
        (VALIDATION_DIR / 'dataset.json').write_text(json.dumps(data), encoding='utf-8')
    except Exception as e:  # surfaced to the UI as "Data unavailable"
        api['error'] = redact(str(e) or repr(e))
    finally:
        api['refreshing'] = False
        _refresh_lock.release()
    return api


def load_spreadsheets(entries):
    """entries: [{ name, path }]"""
    import re
    li = next((e for e in entries if re.search(r'line\s*items', e['name'], re.I)), None)
    sv = next((e for e in entries if re.search(r'2CCSDREVNFRMINVCQ|sales\s*volume', e['name'], re.I)), None)
    data = cap_to_report_window(build_from_files(li['path'] if li else None, sv['path'] if sv else None))
    ss = state['spreadsheet']
    ss['data'] = data
    ss['lastRefresh'] = iso_now()
    ss['error'] = None
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
            out.append({'name': name, 'path': str((BASE_DIR / 'data' / name).resolve())})   # missing: the loader skips absent files
    return out


def warm_up():
    """Warm both sources so the dashboard opens with data ."""
    from . import sap
    try:
        load_spreadsheets(_find_default_files())
        print('  spreadsheet source loaded')
    except Exception as e:
        state['spreadsheet']['error'] = redact(str(e))
        print('  spreadsheet source failed:', state['spreadsheet']['error'])
    if FIXTURE_DATASET:
        try:
            data = json.loads(Path(FIXTURE_DATASET).read_text(encoding='utf-8'))
            state['api'].update(data=data, error=None, lastRefresh=data.get('builtAt') or iso_now())
            state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': 'Fixture dataset — no SAP connection (test mode)'}
            print('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET)
        except Exception as e:
            state['api']['error'] = redact(str(e))
            print('  fixture load failed:', state['api']['error'])
        return
    try:
        xml = sap.metadata('journal')
        state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Connected — {len(xml)} bytes of metadata.'}
        print('  SAP connection OK — building live dataset…')
        refresh_api()
        print(f"  live build FAILED: {state['api']['error']}" if state['api']['error'] else '  live dataset ready')
    except Exception as e:
        state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
        print('  SAP connection failed:', state['connection']['detail'])
