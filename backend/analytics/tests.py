"""Unit tests: the JavaScript-compatible number helpers, the Finished-Goods rule, the VC (cost bucket / overhead source) rules and the
aggregation invariants documented in DASHBOARD_CALCULATION_SPEC.md. Run: python backend/manage.py test analytics (AIF_NO_WARMUP=1)."""
import os

os.environ.setdefault('AIF_NO_WARMUP', '1')

from django.test import SimpleTestCase  # noqa: E402

from .cost.engine import apportion, cost_lines, in_cost_bucket, make_is_final, order_costs, resolve_overhead_sources  # noqa: E402
from .jsutil import intl_en_us, js_round, num, odata_date, round2, to_fixed  # noqa: E402
from .pipeline.aggregate import aggregate  # noqa: E402
from .productgroup import category_of, is_finished_good, product_group  # noqa: E402


class JsCompat(SimpleTestCase):
    def test_round2_matches_math_round_epsilon(self):
        self.assertEqual(round2(1.005), 1.01)          # the EPSILON nudge: Math.round((1.005+EPS)*100)/100
        self.assertEqual(round2(2.675), 2.68)
        self.assertEqual(round2(-1.005), -1.0)         # halves round toward +infinity
        self.assertEqual(round2(0.125), 0.13)
        self.assertEqual(str(round2(-0.001)), '0.0')   # never -0

    def test_js_round_half_up_toward_positive_infinity(self):
        self.assertEqual([js_round(x) for x in (0.5, 1.5, 2.5, -0.5, -1.5, -2.5)], [1, 2, 3, 0, -1, -2])

    def test_to_fixed_is_half_up_on_the_exact_binary_value(self):
        self.assertEqual(to_fixed(0.0625, 3), '0.063')   # exactly representable tie: JS rounds up (Python's format gives 0.062)
        self.assertEqual(to_fixed(1.005, 2), '1.00')     # 1.005 is slightly below the tie in binary
        self.assertEqual(to_fixed(28.275, 2), '28.27')
        self.assertEqual(to_fixed(1.510, 3), '1.510')
        self.assertEqual(to_fixed(100, 2), '100.00')

    def test_intl_en_us(self):
        self.assertEqual(intl_en_us(2025.88, 1), '2,025.9')
        self.assertEqual(intl_en_us(0.25, 1), '0.3')     # halfExpand
        self.assertEqual(intl_en_us(1234567, 0), '1,234,567')
        self.assertEqual(intl_en_us(-1500.04, 1), '-1,500')
        self.assertEqual(intl_en_us(12, 1, 1), '12.0')

    def test_num(self):
        self.assertEqual(num(None), 0)
        self.assertEqual(num(''), 0)
        self.assertEqual(num('12.50'), 12.5)
        self.assertTrue(num('1,000') != num('1,000'))    # NaN

    def test_odata_date_is_the_utc_calendar_date(self):
        self.assertEqual(odata_date('/Date(1767225600000)/'), '2026-01-01')
        self.assertEqual(odata_date('/Date(1767311999000)/'), '2026-01-01')
        self.assertEqual(odata_date('2026-03-05T00:00:00'), '2026-03-05')
        self.assertIsNone(odata_date(None))
        self.assertIsNone(odata_date('garbage'))


class ProductGroup(SimpleTestCase):
    def test_finished_good_is_prefix_11_after_stripping_zeros(self):
        for code in ('11000033', '000000000011000033', ' 11000033 '):
            self.assertTrue(is_finished_good(code), code)
        for code in ('13000000', '21000041', '61000009', '', None):
            self.assertFalse(is_finished_good(code), code)
        self.assertEqual(product_group('11000033'), 'B2B/B2C')
        self.assertEqual(product_group('13000000'), 'Other')

    def test_other_categories(self):
        self.assertEqual(category_of('13000001')['key'], 'byproducts')
        self.assertEqual(category_of('21000041')['key'], 'raw')
        self.assertEqual(category_of('61000011')['key'], 'nonstock')
        self.assertEqual(category_of('99000000')['key'], 'misc')


class CostRules(SimpleTestCase):
    def test_cost_buckets(self):
        self.assertEqual(in_cost_bucket('51000010'), 'materials')
        for acct in ('54400000', '54093000', '54053000', '54200100'):
            self.assertEqual(in_cost_bucket(acct), 'activities', acct)    # activities stay in VC (owner decision)
        self.assertEqual(in_cost_bucket('94301000'), 'overhead')
        self.assertEqual(in_cost_bucket('13200000'), 'pairedOffset')
        for acct in ('52000000', '55000000', '24000000', '41000000', '99999999'):
            self.assertFalse(in_cost_bucket(acct), acct)

    def _pair(self, order, doc, z1_amt, z2_amt, qty=100):
        return [{'GLAccount': '94301000', 'OrderID': order, 'AccountingDocument': doc, 'Quantity': qty, 'AmountInGlobalCurrency': z1_amt},
                {'GLAccount': '94301000', 'OrderID': order, 'AccountingDocument': doc, 'Quantity': qty, 'AmountInGlobalCurrency': z2_amt}]

    def test_only_z2_counts_the_higher_rate_line_is_z1(self):
        jl = self._pair('O1', 'D1', 900, 100) + [{'GLAccount': '51000001', 'OrderID': 'O1', 'Quantity': 1, 'AmountInGlobalCurrency': 1000}]
        report = {}
        orders = order_costs(jl, report)
        self.assertEqual(orders['O1']['cost'], 1100)                 # materials 1000 + Z2 100; Z1 900 dropped
        self.assertEqual(orders['O1']['buckets'], {'overhead': 100, 'materials': 1000})
        self.assertEqual((report['keptLines'], report['excludedLines'], report['unknownLines']), (1, 1, 0))

    def test_unpaired_or_equal_rate_overhead_is_unknown_and_excluded(self):
        lone = [{'GLAccount': '94301000', 'OrderID': 'O2', 'AccountingDocument': 'D', 'Quantity': 10, 'AmountInGlobalCurrency': 50}]
        report = {}
        self.assertEqual(order_costs(lone, report), {})
        self.assertEqual(report['unknownLines'], 1)
        same = self._pair('O3', 'D3', 100, 100)
        self.assertEqual(order_costs(same, {}), {})

    def test_explicit_overhead_source_field_wins(self):
        jl = [{'GLAccount': '94301000', 'OrderID': 'O4', 'AccountingDocument': 'D4', 'Quantity': 10, 'AmountInGlobalCurrency': 70, 'OverheadSource': '10101303/Z2'},
              {'GLAccount': '94301000', 'OrderID': 'O4', 'AccountingDocument': 'D4', 'Quantity': 10, 'AmountInGlobalCurrency': 30, 'OverheadSource': '10101303/Z1'}]
        self.assertEqual(order_costs(jl, {})['O4']['cost'], 70)
        self.assertEqual(sorted(v for v in resolve_overhead_sources(jl).values()), ['10101303/Z1', '10101303/Z2'])

    def test_activities_are_signed_into_vc(self):
        jl = [{'GLAccount': '51000001', 'OrderID': 'O5', 'AmountInGlobalCurrency': 800},
              {'GLAccount': '51000001', 'OrderID': 'O5', 'AmountInGlobalCurrency': -100},    # a 262 reversal nets out
              {'GLAccount': '54400000', 'OrderID': 'O5', 'AmountInGlobalCurrency': 50}]
        self.assertEqual(order_costs(jl, {})['O5']['cost'], 750)

    def test_apportion_by_received_quantity_and_line_costing(self):
        orders = {'O1': {'cost': 1000.0}, 'O2': {'cost': 300.0}}
        receipts = [{'order': 'O1', 'batch': 'B1', 'qty': 600}, {'order': 'O1', 'batch': 'B2', 'qty': 400}, {'order': 'O2', 'batch': 'B2', 'qty': 100}]
        batch, order_qty, dist = apportion(orders, receipts)
        self.assertEqual(batch['B1']['cost'], 600.0)
        self.assertEqual(batch['B2']['cost'], 400.0 + 300.0)
        self.assertEqual(dist, {'O1': 1000.0, 'O2': 300.0})
        frozen = {b: {'batch': b, 'cost': e['cost'], 'qty': e['qty'], 'unitCostPerKg': e['cost'] / e['qty'], 'orders': list(e['orders']),
                      'costed': e['costed'], 'final': True} for b, e in batch.items()}
        lines = [{'batch': 'B1', 'qtyKg': 100, 'revenueUsd': 150.0}, {'batch': 'B1', 'qtyKg': -20, 'revenueUsd': -30.0},
                 {'batch': None, 'qtyKg': 5, 'revenueUsd': 9.0}, {'batch': 'GONE', 'qtyKg': 5, 'revenueUsd': 9.0}]
        cost_lines(lines, frozen)
        self.assertEqual([l['cogmUsd'] for l in lines], [100.0, -20.0, 0, 0])          # a credit note reverses at the frozen rate
        self.assertEqual([l['costStatus'] for l in lines], ['final', 'final', 'assumed-zero', 'assumed-zero'])
        self.assertEqual(lines[2]['cmUsd'], 9.0)

    def test_is_final_needs_closed_months_and_costed_orders(self):
        f = make_is_final({'O1': {}}, {'O1': '2026-08-15'}, '2026-10-23')
        self.assertTrue(f('B', {'orders': {'O1': 1}, 'costed': True}))
        self.assertFalse(make_is_final({'O1': {}}, {'O1': '2026-10-02'}, '2026-10-23')('B', {'orders': {'O1': 1}, 'costed': True}))
        self.assertFalse(f('B', {'orders': {'O1': 1}, 'costed': False}))


def _line(doc, period, material, cust, rev, qty_kg, cogm, status='final', batch='B1'):
    l = {'billingDocument': doc, 'billingItem': '10', 'billingDate': f'2026-{period[:2]}-15', 'period': period, 'material': material,
         'materialName': f'Item {material}', 'customer': cust, 'customerName': f'Cust {cust}', 'batch': batch, 'qtyKg': qty_kg,
         'qtyMt': qty_kg / 1000, 'revenueUsd': rev, 'orders': ['O1'] if batch else [], 'costStatus': status}
    if cogm is not None:
        l.update(cogmUsd=cogm, cmUsd=round2(rev - cogm), cmPct=round2((rev - cogm) / rev * 100))
    return l


class Aggregation(SimpleTestCase):
    def setUp(self):
        self.data = {'source': 'api', 'asOf': '2026-03-31', 'from': '2026-01-01', 'builtAt': 'x', 'controls': None, 'lines': [
            _line('1', '01.2026', '11000001', 'C1', 1000.0, 1000, 700.0),
            _line('2', '01.2026', '11000002', 'C2', 500.0, 400, 350.0),
            _line('3', '02.2026', '11000001', 'C2', 800.0, 700, 560.0, status='provisional'),
            _line('4', '02.2026', '13000000', 'C1', 90.0, 300, 0, status='assumed-zero', batch=None),
            _line('5', '03.2026', '11000001', 'C1', -100.0, -100, -70.0),
        ]}

    def test_children_sum_to_parent(self):
        d = aggregate(self.data, {})
        for key in ('revenue', 'cogm', 'cm', 'qtyMt', 'lines'):
            self.assertAlmostEqual(sum(p[key] for p in d['periods']), d['total'][key], places=6, msg=key)
            self.assertAlmostEqual(sum(p[key] for p in d['products']), d['total'][key], places=6, msg=key)
            self.assertAlmostEqual(sum(p[key] for p in d['customers']), d['total'][key], places=6, msg=key)
        fg, oth = d['sections']['products']
        self.assertAlmostEqual(fg['total']['revenue'] + oth['total']['revenue'], d['total']['revenue'], places=6)

    def test_finished_goods_cm_pct_excludes_other(self):
        d = aggregate(self.data, {})
        g = d['total']['groups']['fg']
        self.assertEqual(g['revenue'], 2200.0)
        self.assertEqual(g['cm'], 2200.0 - 1540.0)
        self.assertEqual(g['cmPct'], 30.0)
        self.assertEqual(d['total']['cmPct'], round2(d['total']['cm'] / d['total']['revenue'] * 100))   # all products incl. Other at 100 %
        self.assertTrue(d['total']['hasAssumedZero'] and d['total']['provisional'] is True)

    def test_filters_sorting_and_all_periods(self):
        d = aggregate(self.data, {'from': '02.2026', 'to': '03.2026'})
        self.assertEqual([p['period'] for p in d['periods']], ['02.2026', '03.2026'])
        self.assertEqual(d['allPeriods'], ['01.2026', '02.2026', '03.2026'])         # never filtered
        d2 = aggregate(self.data, {'material': '11000001'})
        self.assertEqual([p['code'] for p in d2['products']], ['11000001'])
        self.assertEqual(aggregate(self.data, {})['products'][0]['code'], '11000001')   # revenue descending
        self.assertEqual(d2['counts'], {'billingDocuments': 3, 'billingItems': 3, 'lines': 3, 'batchesSold': 1, 'ordersUsed': 1, 'products': 1, 'customers': 2})

    def test_negative_credit_note_reverses_cost(self):
        d = aggregate(self.data, {'period': '03.2026'})
        self.assertEqual((d['total']['revenue'], d['total']['cogm'], d['total']['cm']), (-100.0, -70.0, -30.0))
