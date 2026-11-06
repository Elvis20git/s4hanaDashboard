"""getPeriodStatuses (periods.get_period_statuses): closed+loaded, closed-not-loaded, open, closed-with-breaches, time-zone boundary,
config override and the derived window end. Run: python backend/manage.py test analytics (AIF_NO_WARMUP=1)."""
import os

os.environ.setdefault('AIF_NO_WARMUP', '1')

from datetime import datetime, timezone  # noqa: E402

from django.test import SimpleTestCase  # noqa: E402

from .periods import close_status, get_period_statuses, kigali_today, window_end  # noqa: E402


def line(period, rev, batch=None, resolved=True):
    return {'period': period, 'revenueUsd': rev, 'batch': batch, 'itemResolved': resolved}


def utc(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


NOW = utc(2026, 11, 6, 8, 0)          # 6 Nov 2026 10:00 Kigali
FROM = '2026-08-01'
LINES = [line('08.2026', 100.0, 'B1'), line('08.2026', 50.0, 'B1'), line('09.2026', 2725630.53, 'B2'), line('10.2026', 728937.90, 'B3')]


def rows(res):
    return {r['period']: r for r in res['rows']}


class PeriodStatuses(SimpleTestCase):
    def test_closed_and_loaded_is_green_and_included(self):
        r = rows(get_period_statuses(lines=LINES, frm=FROM, now=NOW))['2026-09']
        self.assertEqual((r['closeStatus'], r['loaded'], r['badge'], r['included']), ('Closed', 'Yes', 'green', 'Yes'))
        self.assertEqual((r['rows'], r['revenue']), (1, 2725630.53))

    def test_closed_but_not_loaded_is_red_with_the_error(self):
        res = get_period_statuses(lines=[l for l in LINES if l['period'] != '10.2026'], frm=FROM, now=NOW,
                                  errors={'2026-10': 'HTTP 500 — boom'})
        r = rows(res)['2026-10']
        self.assertEqual((r['closeStatus'], r['loaded'], r['badge'], r['included']), ('Closed', 'No', 'red', 'No'))
        self.assertEqual(r['reason'], 'HTTP 500 — boom')
        self.assertEqual(res['windowEnd'], '2026-10-31')       # the window still extends: the period is closed even though loading failed

    def test_current_month_is_open_grey_and_excluded(self):
        res = get_period_statuses(lines=LINES, frm=FROM, now=NOW)
        r = rows(res)['2026-11']
        self.assertEqual((r['closeStatus'], r['badge'], r['included'], r['rows']), ('Open', 'grey', 'No', 0))
        self.assertIn('excluded until month-end close', r['reason'])
        self.assertEqual(res['summary']['text'], 'Included: Aug 2026 – Oct 2026 · 3 closed periods · 1 open (Nov 2026)')
        self.assertEqual(res['windowEnd'], '2026-10-31')

    def test_closed_with_breaches_is_amber_but_still_included(self):
        controls = {'batchClosure': {'breaches': [{'batch': 'B2'}]}, 'quantityControl': {'breaches': [{'batch': 'B1'}]},
                    'orderClosure': {'breaches': [{'order': 'O3'}]}}
        frozen = [{'batch': 'B3', 'orders': ['O3']}]
        res = rows(get_period_statuses(lines=LINES, frm=FROM, now=NOW, controls=controls, frozen=frozen))
        self.assertEqual((res['2026-09']['badge'], res['2026-09']['breaches']['batch'], res['2026-09']['included']), ('amber', 1, 'Yes'))
        self.assertEqual((res['2026-08']['badge'], res['2026-08']['breaches']['quantity']), ('amber', 1))
        self.assertEqual((res['2026-10']['badge'], res['2026-10']['breaches']['order']), ('amber', 1))

    def test_partial_when_lines_lack_a_billing_item_match(self):
        r = rows(get_period_statuses(lines=[line('09.2026', 1.0, resolved=False)], frm='2026-09-01', now=NOW))['2026-09']
        self.assertEqual((r['loaded'], r['badge'], r['included']), ('Partial', 'amber', 'Yes'))

    def test_kigali_boundary_1_nov_0030_is_still_october_in_utc_but_november_in_kigali(self):
        t = utc(2026, 10, 31, 22, 30)                        # 00:30 on 1 Nov in Kigali (UTC+2)
        self.assertEqual(kigali_today(t), '2026-11-01')
        self.assertEqual(close_status('2026-10', t), ('Closed', 'calendar'))     # UTC logic would still call October open
        self.assertEqual(window_end(FROM, t), '2026-10-31')
        self.assertEqual(rows(get_period_statuses(lines=LINES, frm=FROM, now=t))['2026-11']['closeStatus'], 'Open')

    def test_just_before_midnight_kigali_october_is_still_open(self):
        t = utc(2026, 10, 31, 21, 59)                        # 23:59 on 31 Oct in Kigali
        self.assertEqual(close_status('2026-10', t), ('Open', 'calendar'))
        self.assertEqual(window_end(FROM, t), '2026-09-30')

    def test_config_override_closes_or_holds_a_period(self):
        t = utc(2026, 10, 20)
        self.assertEqual(close_status('2026-10', t, {'PERIOD_CLOSED': '2026-10'}), ('Closed', 'config'))
        self.assertEqual(close_status('2026-09', NOW, {'PERIOD_OPEN': '2026-09, 2026-08', 'PERIOD_CLOSED': '2026-09'}), ('Open', 'config'))
        self.assertEqual(window_end(FROM, NOW, {'PERIOD_OPEN': '2026-10'}), '2026-09-30')

    def test_window_end_is_derived_not_stored_and_none_when_nothing_is_closed(self):
        self.assertEqual(window_end('2026-11-01', NOW), None)
        self.assertEqual(window_end('2025-07-01', utc(2027, 1, 5, 12)), '2026-12-31')    # year roll-over

    def test_provider_hook_and_unknown_status(self):
        res = get_period_statuses(lines=LINES, frm='2026-09-01', now=NOW, provider=lambda ym: {'2026-09': ('Closed', 'sap'), '2026-10': ('Unknown', 'sap')}.get(ym, ('Open', 'sap')))
        r = rows(res)
        self.assertEqual((r['2026-10']['closeStatus'], r['2026-10']['included']), ('Unknown', 'No'))
        self.assertEqual(res['windowEnd'], '2026-09-30')


class ManualOverrides(SimpleTestCase):
    def test_manual_override_wins_over_env_and_calendar_and_can_revert(self):
        import tempfile
        from pathlib import Path
        from .periods import effective_cfg, read_overrides, set_override
        path = Path(tempfile.mkdtemp()) / 'ov.json'
        set_override('2026-10', 'Open', 'ann', NOW, path)                     # hold October back although the calendar says closed
        set_override('2026-11', 'Closed', 'ann', NOW, path)                   # close the current month early
        ov = read_overrides(path)
        self.assertEqual((ov['2026-10']['status'], ov['2026-10']['by']), ('Open', 'ann'))
        cfg = effective_cfg({'PERIOD_CLOSED': '2026-10'}, ov)                 # .env says closed, manual says open: manual wins
        self.assertEqual(close_status('2026-10', NOW, cfg), ('Open', 'manual'))
        self.assertEqual(close_status('2026-11', NOW, cfg), ('Closed', 'manual'))
        self.assertEqual(close_status('2026-09', NOW, cfg), ('Closed', 'calendar'))
        self.assertEqual(window_end(FROM, NOW, cfg), '2026-11-30')
        set_override('2026-10', 'auto', 'ann', NOW, path)
        self.assertEqual(list(read_overrides(path)), ['2026-11'])
        with self.assertRaises(ValueError):
            set_override('2026-10', 'bogus', 'ann', NOW, path)
