"""Loading closed periods concurrently or one by one, progress reporting, and the first-load disk cache. SAP is replaced by a fake that
only answers GETs from memory (these tests never touch the network). Run: python backend/manage.py test analytics."""
import os

os.environ.setdefault('AIF_NO_WARMUP', '1')

import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402

from django.test import SimpleTestCase  # noqa: E402

from . import datacache  # noqa: E402
from .pipeline import build as build_mod  # noqa: E402


class FakeSap:
    """Two documents per month; counts how many calls are in flight at once."""

    def __init__(self, delay=0.03):
        self.delay, self.inflight, self.peak, self.lock = delay, 0, 0, threading.Lock()

    def _enter(self):
        with self.lock:
            self.inflight += 1
            self.peak = max(self.peak, self.inflight)
        time.sleep(self.delay)

    def _leave(self):
        with self.lock:
            self.inflight -= 1

    def get_all(self, service, entity, params, page=5000, max_rows=None):
        self._enter()
        try:
            if service == 'journal':
                return [{'AccountingDocument': 'J1', 'PostingDate': '2026-09-02T00:00:00'}]
            flt = params['$filter']
            month = flt.split("BillingDocumentDate ge datetime'")[1][:7]
            return [{'BillingDocument': f'{month}-A', 'AccountingPostingStatus': 'C'}, {'BillingDocument': f'{month}-B', 'AccountingPostingStatus': 'C'},
                    {'BillingDocument': f'{month}-X', 'AccountingPostingStatus': 'A'}]
        finally:
            self._leave()

    def get_by_keys(self, service, entity, field, keys, chunk=50, params=None):
        self._enter()
        try:
            return [{'BillingDocument': k, 'BillingDocumentItem': '10'} for k in keys]
        finally:
            self._leave()


def extract(mode, workers=4):
    fake, events = FakeSap(), []
    with mock.patch.object(build_mod, 'sap', fake):
        out = build_mod._extract_sales('2026-07-01', '2026-10-31', 50, mode, workers, lambda m: None, lambda *e: events.append(e))
    return out, fake, events


class ExtractModes(SimpleTestCase):
    def test_concurrent_and_one_by_one_return_identical_data(self):
        a, _, _ = extract('sequential')
        b, _, _ = extract('concurrent')
        self.assertEqual(a, b)
        hdrs, items, jrev = a
        self.assertEqual([h['BillingDocument'] for h in hdrs][:3], ['2026-07-A', '2026-07-B', '2026-07-X'])   # month order, always
        self.assertEqual(len(hdrs), 12)                  # 4 months x 3 documents
        self.assertEqual(len(items), 8)                  # only posted documents get items
        self.assertEqual(len(jrev), 1)

    def test_one_by_one_never_overlaps_and_concurrent_does(self):
        _, seq, _ = extract('sequential')
        _, con, _ = extract('concurrent', workers=4)
        self.assertEqual(seq.peak, 1)
        self.assertGreater(con.peak, 1)
        self.assertLessEqual(con.peak, 4)                # bounded by LOAD_WORKERS: SAP is never flooded

    def test_one_by_one_runs_in_calendar_order(self):
        _, _, events = extract('sequential')
        started = [e[1] for e in events if e[0] == 'period' and e[2] == 'loading']
        self.assertEqual(started, ['2026-07', '2026-08', '2026-09', '2026-10'])

    def test_every_task_reports_loading_then_done(self):
        _, _, events = extract('concurrent')
        for ym in ('2026-07', '2026-08', '2026-09', '2026-10'):
            self.assertEqual([e[2] for e in events if e[:2] == ('period', ym)], ['loading', 'done'])
        self.assertEqual([e[2] for e in events if e[0] == 'journal'], ['loading', 'done'])

    def test_a_failing_month_is_reported_and_stops_the_load(self):
        fake = FakeSap()
        orig = fake.get_all

        def boom(service, entity, params, **kw):
            if service == 'billing' and "ge datetime'2026-08-01" in params['$filter']:
                raise RuntimeError('HTTP 500')
            return orig(service, entity, params, **kw)
        fake.get_all, events = boom, []
        for mode in ('sequential', 'concurrent'):
            with mock.patch.object(build_mod, 'sap', fake), self.assertRaises(RuntimeError):
                build_mod._extract_sales('2026-07-01', '2026-10-31', 50, mode, 4, lambda m: None, lambda *e: events.append(e))
        self.assertIn(('period', '2026-08', 'error'), events)


class ProgressTracking(SimpleTestCase):
    def test_progress_counts_done_tasks_and_phase(self):
        from . import state as st
        st.state['api']['progress'] = {'phase': 'extracting', 'total': 3, 'done': 0, 'journal': 'pending', 'periods': {'2026-09': 'pending', '2026-10': 'pending'}}
        st._progress('period', '2026-09', 'done')
        st._progress('journal', '', 'done')
        st._progress('phase', 'costing', 'running')
        p = st.state['api']['progress']
        self.assertEqual((p['done'], p['total'], p['phase']), (2, 3, 'costing'))
        st.state['api']['progress'] = None


class DatasetCache(SimpleTestCase):
    DATA = {'lines': [{'period': '10.2026'}], 'asOf': '2026-10-31', 'from': '2025-07-01'}

    def test_round_trip_and_atomic_file(self):
        path = Path(tempfile.mkdtemp()) / 'c.json'
        datacache.save(self.DATA, {'lastRefresh': 'T', 'periodLoadedAt': {'2026-10': 'T'}}, path)
        data, meta = datacache.load(path)
        self.assertEqual(data, self.DATA)
        self.assertEqual(meta['periodLoadedAt'], {'2026-10': 'T'})
        self.assertFalse(path.with_suffix('.tmp').exists())

    def test_cache_from_another_scope_or_rule_version_is_ignored(self):
        path = Path(tempfile.mkdtemp()) / 'c.json'
        datacache.save(self.DATA, {}, path)
        with mock.patch.object(datacache, 'RULE_VERSION', 'other-rules'):
            self.assertIsNone(datacache.load(path))
        with mock.patch.dict(datacache.CFG, {'LEDGER': 'ZZ'}):
            self.assertIsNone(datacache.load(path))
        self.assertIsNotNone(datacache.load(path))

    def test_missing_or_corrupt_cache_is_just_no_cache(self):
        d = Path(tempfile.mkdtemp())
        self.assertIsNone(datacache.load(d / 'none.json'))
        (d / 'bad.json').write_text('{not json', encoding='utf-8')
        self.assertIsNone(datacache.load(d / 'bad.json'))
