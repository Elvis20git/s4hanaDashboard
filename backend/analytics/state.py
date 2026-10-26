"""In-memory application state and the two data sources.
PostgreSQL is the authoritative store; the in-memory state is a warm cache rebuilt from the DB on
startup and refreshed after every SAP pull or spreadsheet load."""
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

DEFAULT_SPREADSHEETS = [
    'Line Items 01.01.2026 - 15.10.2026.xlsx',
    '20261015-175119_2CCSDREVNFRMINVCQ.xlsx',
]


def iso_now():
    n = datetime.now(timezone.utc)
    return n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z'


def cap_to_report_window(data):
    cutoff = CFG.get('REPORT_TO')
    if not cutoff or not data or 'lines' not in data:
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


def refresh_api(user=None):
    """Rebuild the API dataset from SAP, persist to PostgreSQL, and update the in-memory cache."""
    from django.utils import timezone as dj_tz
    from .models import SyncRun
    from .persist import persist_api_dataset

    api = state['api']
    if not _refresh_lock.acquire(blocking=False):
        return api
    api['refreshing'] = True
    api['log'] = []

    run = SyncRun.objects.create(source='api', status='RUNNING',
                                  triggered_by=user if user and user.pk else None)
    try:
        data = cap_to_report_window(build(log=api['log'].append))
        api['data'] = data
        api['error'] = None
        api['lastRefresh'] = iso_now()

        VALIDATION_DIR.mkdir(parents=True, exist_ok=True)
        (VALIDATION_DIR / 'dataset.json').write_text(json.dumps(data), encoding='utf-8')

        counts = persist_api_dataset(data, sync_run=run)
        api['log'].append(
            f"persisted: {counts['lines']} lines, {counts['batches']} batch costs, "
            f"{counts['materials']} materials, {counts['customers']} customers"
        )
        run.status = 'DONE'
        run.rows_upserted = counts['lines']
        run.finished_at = dj_tz.now()
        run.save(update_fields=['status', 'rows_upserted', 'finished_at'])
    except Exception as e:
        api['error'] = redact(str(e) or repr(e))
        run.status = 'FAILED'
        run.error_message = redact(str(e))
        run.finished_at = dj_tz.now()
        run.save(update_fields=['status', 'error_message', 'finished_at'])
    finally:
        api['refreshing'] = False
        _refresh_lock.release()
    return api


def load_spreadsheets(entries, user=None):
    """Load Excel files, persist to PostgreSQL, and update the in-memory spreadsheet cache."""
    import re
    from .persist import persist_spreadsheet_dataset

    li = next((e for e in entries if re.search(r'line\s*items', e['name'], re.I)), None)
    sv = next((e for e in entries if re.search(r'2CCSDREVNFRMINVCQ|sales\s*volume', e['name'], re.I)), None)
    data = cap_to_report_window(build_from_files(li['path'] if li else None, sv['path'] if sv else None))

    counts = persist_spreadsheet_dataset(data)

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
            out.append({'name': name, 'path': str((BASE_DIR / 'data' / name).resolve())})
    return out


def _load_from_db():
    """Populate state from PostgreSQL on startup so the dashboard shows data immediately."""
    from .persist import load_billing_lines_from_db
    try:
        ss_data = load_billing_lines_from_db('spreadsheet')
        if ss_data:
            state['spreadsheet'].update(data=ss_data, error=None, lastRefresh=iso_now())
            print(f"  spreadsheet source restored from DB ({ss_data['counts']['lines']} lines)")
    except Exception as e:
        print('  DB load (spreadsheet) failed:', redact(str(e)))

    try:
        api_data = load_billing_lines_from_db('api')
        if api_data:
            state['api'].update(data=api_data, error=None, lastRefresh=iso_now())
            print(f"  api source restored from DB ({api_data['counts']['lines']} lines)")
    except Exception as e:
        print('  DB load (api) failed:', redact(str(e)))


def warm_up():
    """Warm both sources. Tries DB first (fast), then falls back to files/SAP."""
    from django.db import connection as _db_conn
    from . import sap

    try:
        # Always try to restore from DB first — gives the dashboard data immediately on restart
        _load_from_db()

        # Spreadsheet: load from files if DB had nothing (first run) or files are newer
        if not state['spreadsheet']['data']:
            try:
                load_spreadsheets(_find_default_files())
                print('  spreadsheet source loaded from files')
            except Exception as e:
                state['spreadsheet']['error'] = redact(str(e))
                print('  spreadsheet source failed:', state['spreadsheet']['error'])

        if FIXTURE_DATASET:
            if not state['api']['data']:
                try:
                    data = json.loads(Path(FIXTURE_DATASET).read_text(encoding='utf-8'))
                    state['api'].update(data=data, error=None, lastRefresh=data.get('builtAt') or iso_now())
                    state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': 'Fixture dataset — no SAP connection (test mode)'}
                    print('  FIXTURE MODE — dataset loaded from', FIXTURE_DATASET)
                except Exception as e:
                    state['api']['error'] = redact(str(e))
                    print('  fixture load failed:', state['api']['error'])
            return

        # Live SAP: only refresh if DB had no api data (first run or empty DB)
        try:
            xml = sap.metadata('journal')
            state['connection'] = {'ok': True, 'checkedAt': iso_now(), 'detail': f'Connected — {len(xml)} bytes of metadata.'}
            if not state['api']['data']:
                print('  SAP connection OK — building live dataset…')
                refresh_api()
                print(f"  live build FAILED: {state['api']['error']}" if state['api']['error'] else '  live dataset ready')
            else:
                print('  SAP connection OK — serving from DB, use /api/refresh to pull latest data')
        except Exception as e:
            state['connection'] = {'ok': False, 'checkedAt': iso_now(), 'detail': redact(str(e))}
            print('  SAP connection failed:', state['connection']['detail'])
    finally:
        _db_conn.close()
