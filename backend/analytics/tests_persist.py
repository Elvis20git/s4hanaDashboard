"""Persistence layer tests: ORM upserts, idempotency, DB-to-state reload, management commands.
Run: python backend/manage.py test analytics  (AIF_NO_WARMUP=1 is set below)"""
import json
import os
import tempfile
from io import StringIO
from unittest import mock

os.environ.setdefault('AIF_NO_WARMUP', '1')

from django.core.management import call_command  # noqa: E402
from django.test import TestCase  # noqa: E402

from .models import BatchUnitCost, BillingLine, Customer, Material, SyncRun  # noqa: E402
from .persist import (  # noqa: E402
    load_billing_lines_from_db,
    persist_api_dataset,
    persist_spreadsheet_dataset,
    upsert_batch_unit_costs,
    upsert_customers,
    upsert_materials,
)
from .state import _load_from_db, state  # noqa: E402


# ---------------------------------------------------------------------------
# Test data helpers
# ---------------------------------------------------------------------------

def _pline(doc, period, material, cust, rev, qty_kg=1000, cogm=700.0, status='final', batch='B1'):
    """Build a billing line dict with every field that _persist_lines() needs."""
    month = period[:2]
    return {
        'billingDocument': doc, 'billingItem': '10',
        'billingDate': f'2026-{month}-15',
        'postingDate': f'2026-{month}-15',   # posting_date is NOT NULL in the DB schema
        'period': period,
        'material': material, 'materialName': f'Item {material}',
        'customer': cust, 'customerName': f'Cust {cust}',
        'batch': batch,
        'qtyKg': qty_kg, 'qtyMt': qty_kg / 1000,
        'revenueUsd': rev, 'costStatus': status,
        'cogmUsd': cogm, 'cmUsd': round(rev - cogm, 2),
        'cmPct': round((rev - cogm) / rev * 100, 2) if rev else 0,
        'orders': ['O1'] if batch else [],
    }


def _frozen(batch, cost, qty, final=False):
    return {
        'batch': batch, 'cost': cost, 'qty': qty,
        'unitCostPerKg': cost / qty if qty else None,
        'orders': ['O1'], 'costed': True, 'final': final,
    }


def _dataset(lines=None, frozen=None):
    lines = lines or [_pline('1', '01.2026', '11000001', 'C1', 1000.0)]
    return {
        'source': 'api', 'asOf': '2026-01-31', 'from': '2026-01-01',
        'builtAt': '2026-01-31T12:00:00.000Z',
        'lines': lines, 'frozen': frozen or [],
        'controls': None, 'orderCost': {},
    }


# ===========================================================================
# Master data
# ===========================================================================

class MasterDataUpsert(TestCase):
    def test_materials_created_correctly(self):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0), _pline('2', '01.2026', '11000002', 'C2', 500.0)]
        result = upsert_materials(lines)
        self.assertEqual(set(result), {'11000001', '11000002'})
        self.assertEqual(Material.objects.count(), 2)

    def test_materials_idempotent(self):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0)]
        upsert_materials(lines)
        upsert_materials(lines)
        self.assertEqual(Material.objects.count(), 1)

    def test_finished_good_flag_set_correctly(self):
        upsert_materials([_pline('1', '01.2026', '11000001', 'C1', 1000.0)])
        upsert_materials([_pline('2', '01.2026', '13000000', 'C1', 500.0)])
        self.assertTrue(Material.objects.get(code='11000001').is_finished_good)
        self.assertFalse(Material.objects.get(code='13000000').is_finished_good)

    def test_product_name_dict_overrides_inline_name(self):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0)]
        upsert_materials(lines, product_name={'11000001': 'CSB Plus'})
        self.assertEqual(Material.objects.get(code='11000001').name, 'CSB Plus')

    def test_customers_created_and_idempotent(self):
        lines = [_pline('1', '01.2026', '11000001', 'WFP001', 1000.0), _pline('2', '01.2026', '11000001', 'UNICEF', 500.0)]
        result = upsert_customers(lines)
        self.assertEqual(set(result), {'WFP001', 'UNICEF'})
        self.assertEqual(Customer.objects.count(), 2)
        upsert_customers(lines)
        self.assertEqual(Customer.objects.count(), 2)

    def test_empty_lines_return_empty_maps(self):
        self.assertEqual(upsert_materials([]), {})
        self.assertEqual(upsert_customers([]), {})

    def test_lines_without_customer_are_skipped(self):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0)]
        lines[0]['customer'] = None
        self.assertEqual(upsert_customers(lines), {})
        self.assertEqual(Customer.objects.count(), 0)


# ===========================================================================
# BatchUnitCost
# ===========================================================================

class BatchUnitCostUpsert(TestCase):
    def test_creates_records_and_returns_map(self):
        frozen = [_frozen('B001', 600.0, 1000.0), _frozen('B002', 300.0, 500.0)]
        result = upsert_batch_unit_costs(frozen)
        self.assertEqual(set(result), {'B001', 'B002'})
        self.assertEqual(BatchUnitCost.objects.count(), 2)

    def test_idempotent(self):
        frozen = [_frozen('B001', 600.0, 1000.0)]
        upsert_batch_unit_costs(frozen)
        upsert_batch_unit_costs(frozen)
        self.assertEqual(BatchUnitCost.objects.count(), 1)

    def test_final_batch_cost_is_immutable(self):
        upsert_batch_unit_costs([_frozen('B001', 600.0, 1000.0, final=True)])
        upsert_batch_unit_costs([_frozen('B001', 999.0, 1000.0, final=True)])   # attempt overwrite
        self.assertEqual(float(BatchUnitCost.objects.get(batch='B001').cost), 600.0)

    def test_non_final_batch_cost_can_be_updated(self):
        upsert_batch_unit_costs([_frozen('B001', 600.0, 1000.0, final=False)])
        upsert_batch_unit_costs([_frozen('B001', 650.0, 1000.0, final=False)])
        self.assertEqual(float(BatchUnitCost.objects.get(batch='B001').cost), 650.0)

    def test_unit_cost_per_kg_derived_correctly(self):
        upsert_batch_unit_costs([_frozen('B001', 600.0, 1000.0)])
        buc = BatchUnitCost.objects.get(batch='B001')
        self.assertAlmostEqual(float(buc.unit_cost_per_kg), 0.6, places=5)

    def test_empty_frozen_list_returns_empty_dict(self):
        self.assertEqual(upsert_batch_unit_costs([]), {})
        self.assertEqual(BatchUnitCost.objects.count(), 0)


# ===========================================================================
# persist_api_dataset
# ===========================================================================

class PersistApiDataset(TestCase):
    def _data(self, extra_lines=None):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0), _pline('2', '01.2026', '11000002', 'C2', 500.0)]
        lines += (extra_lines or [])
        return _dataset(lines=lines, frozen=[_frozen('B1', 600.0, 1000.0)])

    def test_returns_correct_counts(self):
        counts = persist_api_dataset(self._data())
        self.assertEqual(counts['materials'], 2)
        self.assertEqual(counts['customers'], 2)
        self.assertEqual(counts['batches'], 1)
        self.assertEqual(counts['lines'], 2)

    def test_idempotent_no_duplicate_lines(self):
        data = self._data()
        persist_api_dataset(data)
        persist_api_dataset(data)
        self.assertEqual(BillingLine.objects.filter(source='api').count(), 2)
        self.assertEqual(Material.objects.count(), 2)

    def test_lines_have_source_api(self):
        persist_api_dataset(self._data())
        self.assertEqual(BillingLine.objects.filter(source='api').count(), 2)
        self.assertEqual(BillingLine.objects.filter(source='spreadsheet').count(), 0)

    def test_sync_run_linked_to_lines(self):
        run = SyncRun.objects.create(source='api', status='RUNNING')
        persist_api_dataset(self._data(), sync_run=run)
        self.assertTrue(BillingLine.objects.filter(sync_run=run).exists())

    def test_line_without_material_is_skipped(self):
        lines = [_pline('1', '01.2026', '11000001', 'C1', 1000.0), _pline('2', '01.2026', '11000002', 'C2', 500.0)]
        lines[1]['material'] = ''  # no material → skipped by _persist_lines
        counts = persist_api_dataset(_dataset(lines=lines))
        self.assertEqual(counts['lines'], 1)


# ===========================================================================
# persist_spreadsheet_dataset
# ===========================================================================

class PersistSpreadsheetDataset(TestCase):
    def _ss_data(self):
        lines = [_pline('SS1', '01.2026', '11000001', 'C1', 1000.0), _pline('SS2', '02.2026', '11000001', 'C1', 800.0)]
        return _dataset(lines=lines, frozen=[])

    def test_creates_lines_with_source_spreadsheet(self):
        counts = persist_spreadsheet_dataset(self._ss_data())
        self.assertEqual(counts['lines'], 2)
        self.assertEqual(BillingLine.objects.filter(source='spreadsheet').count(), 2)
        self.assertEqual(BillingLine.objects.filter(source='api').count(), 0)

    def test_idempotent(self):
        data = self._ss_data()
        persist_spreadsheet_dataset(data)
        persist_spreadsheet_dataset(data)
        self.assertEqual(BillingLine.objects.filter(source='spreadsheet').count(), 2)

    def test_same_doc_and_item_stored_separately_per_source(self):
        """UniqueConstraint includes source, so API and spreadsheet can both hold the same billing doc."""
        api = _dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)])
        ss = _dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1050.0)])
        persist_api_dataset(api)
        persist_spreadsheet_dataset(ss)
        self.assertEqual(BillingLine.objects.count(), 2)


# ===========================================================================
# load_billing_lines_from_db
# ===========================================================================

class LoadBillingLinesFromDb(TestCase):
    def setUp(self):
        lines = [
            _pline('1', '01.2026', '11000001', 'C1', 1000.0),
            _pline('2', '02.2026', '11000001', 'C1', 800.0, cogm=560.0),
        ]
        persist_api_dataset(_dataset(lines=lines, frozen=[_frozen('B1', 600.0, 1000.0)]))

    def test_returns_none_for_empty_source(self):
        self.assertIsNone(load_billing_lines_from_db('spreadsheet'))

    def test_returns_data_dict_with_all_required_keys(self):
        d = load_billing_lines_from_db('api')
        for key in ('lines', 'periods', 'asOf', 'from', 'builtAt', 'counts',
                    'controls', 'orderCost', 'frozen', 'cogmAvailable'):
            self.assertIn(key, d, key)

    def test_controls_is_none_and_order_cost_is_empty(self):
        d = load_billing_lines_from_db('api')
        self.assertIsNone(d['controls'])
        self.assertEqual(d['orderCost'], {})

    def test_periods_sorted_chronologically(self):
        d = load_billing_lines_from_db('api')
        pkey = lambda p: p[3:] + p[:2]
        self.assertEqual(d['periods'], sorted(d['periods'], key=pkey))

    def test_counts_reflect_persisted_data(self):
        d = load_billing_lines_from_db('api')
        self.assertEqual(d['counts']['lines'], 2)
        self.assertEqual(d['counts']['billingItems'], 2)
        self.assertEqual(d['counts']['products'], 1)

    def test_line_has_all_fields_aggregate_expects(self):
        d = load_billing_lines_from_db('api')
        line = d['lines'][0]
        for key in ('billingDocument', 'billingItem', 'period', 'material', 'materialName',
                    'revenueUsd', 'costStatus', 'cogmUsd', 'cmUsd', 'cmPct',
                    'qtyKg', 'qtyMt', 'orders', 'batch'):
            self.assertIn(key, line, key)

    def test_frozen_batches_included_for_api_source(self):
        d = load_billing_lines_from_db('api')
        self.assertEqual(len(d['frozen']), 1)
        self.assertEqual(d['frozen'][0]['batch'], 'B1')

    def test_spreadsheet_source_returns_empty_frozen(self):
        persist_spreadsheet_dataset(_dataset(lines=[_pline('S1', '01.2026', '11000001', 'C1', 1000.0)]))
        d = load_billing_lines_from_db('spreadsheet')
        self.assertEqual(d['frozen'], [])

    def test_cogm_available_true_only_for_api(self):
        d_api = load_billing_lines_from_db('api')
        self.assertTrue(d_api['cogmAvailable'])
        persist_spreadsheet_dataset(_dataset(lines=[_pline('S1', '01.2026', '11000001', 'C1', 1000.0)]))
        d_ss = load_billing_lines_from_db('spreadsheet')
        self.assertFalse(d_ss['cogmAvailable'])


# ===========================================================================
# State DB restore (_load_from_db)
# ===========================================================================

class StateDbRestore(TestCase):
    def setUp(self):
        state['api']['data'] = None
        state['spreadsheet']['data'] = None

    def tearDown(self):
        state['api']['data'] = None
        state['spreadsheet']['data'] = None

    def test_populates_api_state_from_db(self):
        persist_api_dataset(_dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)]))
        _load_from_db()
        self.assertIsNotNone(state['api']['data'])
        self.assertEqual(state['api']['data']['counts']['lines'], 1)

    def test_populates_spreadsheet_state_from_db(self):
        persist_spreadsheet_dataset(_dataset(lines=[_pline('SS1', '01.2026', '11000001', 'C1', 1000.0)]))
        _load_from_db()
        self.assertIsNotNone(state['spreadsheet']['data'])

    def test_leaves_state_none_when_no_data(self):
        _load_from_db()
        self.assertIsNone(state['api']['data'])
        self.assertIsNone(state['spreadsheet']['data'])

    def test_api_data_from_db_is_usable_by_aggregate(self):
        """Data loaded from DB must satisfy aggregate()'s contract (no KeyError, correct total)."""
        from .pipeline.aggregate import aggregate
        persist_api_dataset(_dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)]))
        _load_from_db()
        result = aggregate(state['api']['data'], {})
        self.assertEqual(result['total']['revenue'], 1000.0)


# ===========================================================================
# backfill_facts management command
# ===========================================================================

class BackfillFactsCommand(TestCase):
    def _write_fixture(self, data):
        f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
        json.dump(data, f)
        f.close()
        return f.name

    def test_backfill_api_from_fixture_creates_lines(self):
        data = _dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)])
        fname = self._write_fixture(data)
        try:
            call_command('backfill_facts', '--source', 'api', '--fixture', fname, stdout=StringIO())
            self.assertEqual(BillingLine.objects.filter(source='api').count(), 1)
        finally:
            os.unlink(fname)

    def test_backfill_api_is_idempotent(self):
        data = _dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)])
        fname = self._write_fixture(data)
        try:
            call_command('backfill_facts', '--source', 'api', '--fixture', fname, stdout=StringIO())
            call_command('backfill_facts', '--source', 'api', '--fixture', fname, stdout=StringIO())
            self.assertEqual(BillingLine.objects.filter(source='api').count(), 1)
        finally:
            os.unlink(fname)

    def test_backfill_api_creates_sync_run_record(self):
        data = _dataset(lines=[_pline('1', '01.2026', '11000001', 'C1', 1000.0)])
        fname = self._write_fixture(data)
        try:
            call_command('backfill_facts', '--source', 'api', '--fixture', fname, stdout=StringIO())
            self.assertTrue(SyncRun.objects.filter(source='api', status='DONE').exists())
        finally:
            os.unlink(fname)


# ===========================================================================
# createsuperuser management command
# ===========================================================================

class CreateSuperuserCommand(TestCase):
    def test_creates_superuser_with_all_dashboards(self):
        from .auth.permissions import DASHBOARD_KEYS
        from .models import User
        with mock.patch('getpass.getpass', side_effect=['Str0ng!Passw0rd', 'Str0ng!Passw0rd']):
            call_command('createsuperuser', '--username', 'sysadmin', '--email', 'sysadmin@example.com',
                         stdout=StringIO(), stderr=StringIO())
        u = User.objects.get(username='sysadmin')
        self.assertEqual(u.role, 'SUPERUSER')
        self.assertTrue(u.is_data_steward)
        self.assertEqual(u.allowed_dashboards, list(DASHBOARD_KEYS))
        self.assertEqual(u.status, 'ACTIVE')

    def test_password_not_stored_in_plaintext(self):
        from .models import User
        pw = 'Str0ng!Passw0rd'
        with mock.patch('getpass.getpass', side_effect=[pw, pw]):
            call_command('createsuperuser', '--username', 'sysadmin2', '--email', 'sysadmin2@example.com',
                         stdout=StringIO(), stderr=StringIO())
        self.assertNotIn(pw, User.objects.get(username='sysadmin2').password_hash)
