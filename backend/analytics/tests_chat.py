"""The assistant: structured analyst answers, exact figures, drivers, follow-ups and permissions (run: python backend/manage.py test analytics)."""
import json
import os
import random

os.environ.setdefault('AIF_NO_WARMUP', '1')

from django.test import Client, SimpleTestCase  # noqa: E402

from .pipeline import chat  # noqa: E402
from .pipeline.aggregate import aggregate  # noqa: E402
from .state import state  # noqa: E402
from .tests import _line  # noqa: E402
from .tests_auth import Base, H, login, make, post  # noqa: E402


def dataset():
    L = [
        _line('1', '02.2025', '11000001', 'C1', 400.0, 500, 300.0),
        _line('2', '01.2026', '11000001', 'C1', 1000.0, 1000, 700.0),
        _line('3', '01.2026', '11000002', 'C2', 500.0, 400, 350.0),
        _line('4', '02.2026', '11000001', 'C1', 800.0, 700, 560.0, status='provisional'),
        _line('5', '02.2026', '13000000', 'C2', 90.0, 300, 0, status='assumed-zero', batch=None),
        _line('6', '03.2026', '11000001', 'C1', 1500.0, 1000, 900.0),
        _line('7', '03.2026', '11000002', 'C2', 300.0, 250, 200.0),
    ]
    for l in L:
        l['billingDate'] = '2026-01-15'
    L[0]['billingDate'] = '2025-02-15'
    return {'source': 'api', 'asOf': '2026-03-31', 'from': '2025-01-01', 'builtAt': 'x', 'controls': None, 'lines': L}


SCOPE = {'from': '01.2026', 'to': '03.2026'}


def ask(q, scope=SCOPE, ctx=None, allow=True):
    return chat.answer(dataset(), scope, q, allow, ctx)


def flat(r):
    """Every string in an answer, for assertions."""
    out = [r.get('reply') or '', r.get('title') or '']
    for s in r.get('sections', []):
        out += [s['heading']] + s.get('bullets', [])
        if 'table' in s:
            out += s['table']['head'] + [c for row in s['table']['rows'] for c in row]
    return ' | '.join(out + r.get('notes', []) + r.get('followups', []))


class Formatting(SimpleTestCase):
    def test_money_is_compact(self):
        self.assertEqual(chat.money(2730000), '$2.73M')
        self.assertEqual(chat.money(230620.63), '$230.6K')
        self.assertEqual(chat.money(-45200), '-$45.2K')
        self.assertEqual(chat.money(949.4), '$949')
        self.assertEqual(chat.smoney(1100000), '+$1.10M')
        self.assertEqual(chat.pts(-12.8), '-12.8 pts')
        self.assertEqual(chat.spct(67.36), '+67.4%')

    def test_effects_split_the_change_exactly(self):
        rnd = random.Random(7)
        for _ in range(200):
            def fg():
                q, p, c = rnd.uniform(50, 2000), rnd.uniform(900, 2000), rnd.uniform(600, 1500)
                return {'qty': q, 'ppt': p, 'cpt': c, 'rev': q * p, 'vc': q * c, 'cm': q * (p - c), 'cmpct': (p - c) / p * 100}
            a, b = fg(), fg()
            e = chat.effects(a, b)
            self.assertAlmostEqual(e['rev_volume'] + e['rev_price'], a['rev'] - b['rev'], places=6)
            self.assertAlmostEqual(e['cm_volume'] + e['cm_price'] + e['cm_cost'], a['cm'] - b['cm'], places=6)


class Analysis(SimpleTestCase):
    def test_every_answer_has_the_rich_shape_and_balanced_bold_markers(self):
        for q in ('how are we doing', 'tell me about february', 'why did margin change in march', 'compare march and january', 'top 2 customers', 'lowest margin products',
                  'how is WFP doing', 'trend', 'what is our price', 'blah', 'hello', 'help', 'who is the best customer'):
            r = ask(q)
            self.assertIn('reply', r, q)
            self.assertIn(r['kind'], ('rich', 'text'), q)
            if r['kind'] == 'rich':
                for k in ('title', 'sections', 'notes', 'followups', 'context'):
                    self.assertIn(k, r, (q, k))
                for s in [r['reply']] + r['notes'] + [x for sec in r['sections'] for x in sec.get('bullets', [])]:
                    self.assertEqual(s.count('**') % 2, 0, (q, s))

    def test_overview_states_the_exact_figures(self):
        r = ask('how are we doing')
        a = aggregate(dataset(), SCOPE)
        fg = a['total']['groups']['fg']
        self.assertIn(chat.money(a['total']['revenue']), r['reply'])
        self.assertIn(chat.pct(fg['cmPct']), r['reply'])                       # finished-goods CM %, not the all-products figure
        tbl = next(s for s in r['sections'] if s['heading'] == 'Biggest products')['table']
        self.assertEqual(tbl['rows'][0][0], 'Item 11000001')
        self.assertEqual(tbl['rows'][0][2], chat.pct(a['products'][0]['revenue'] / a['total']['revenue'] * 100))
        self.assertTrue(any('assumed' in n for n in r['notes']))                 # the by-product revenue costed at $0 is flagged

    def test_month_profile_compares_with_the_previous_month(self):
        r = ask('tell me about february')
        self.assertEqual(r['context'], {'topic': 'period', 'period': '02.2026'})
        self.assertIn('down 40.7%', r['reply'].replace('**', ''))               # (890 - 1500) / 1500
        self.assertTrue(any(s['heading'] == 'Compared with January 2026' for s in r['sections']))

    def test_why_margin_changed_splits_price_volume_cost_and_names_the_products(self):
        r = ask('why did margin change in march')
        self.assertEqual(r['title'], 'March 2026 versus February 2026')
        self.assertEqual(r['context']['period'], '03.2026')
        txt = flat(r)
        self.assertIn('Selling price', txt)
        self.assertIn('Variable cost', txt)
        self.assertIn('Volume changes margin dollars, not the margin percentage', txt)
        self.assertTrue(any(s['heading'] == 'Which products' for s in r['sections']))

    def test_why_without_a_month_uses_the_latest_and_the_one_before(self):
        r = ask('why did sales change')
        self.assertEqual(r['title'], 'March 2026 versus February 2026')

    def test_comparison_puts_the_later_month_first_and_has_a_table(self):
        r = ask('compare january and march')
        self.assertTrue(r['reply'].startswith('March 2026 had net sales of'))
        t = r['sections'][0]['table']
        self.assertEqual(t['head'], ['', 'Mar 2026', 'Jan 2026', 'Change'])
        self.assertEqual(t['rows'][0][0], 'Net sales')

    def test_follow_up_reuses_the_previous_topic(self):
        first = ask('how is Item 11000001 doing')
        self.assertEqual(first['context']['material'], '11000001')
        r = ask('and in february?', ctx=first['context'])
        self.assertEqual(r['title'], 'Item 11000001')
        self.assertEqual(r['context'], {'topic': 'product', 'material': '11000001', 'period': '02.2026'})
        self.assertIn('February 2026', r['reply'])

    def test_follow_up_after_an_explanation_explains_the_new_month(self):
        first = ask('why did margin change in february')
        r = ask('and in march?', ctx=first['context'])
        self.assertEqual(r['title'], 'March 2026 versus February 2026')

    def test_a_month_name_means_the_latest_one_unless_a_year_is_given(self):
        r = ask('tell me about february')
        self.assertEqual(r['context']['period'], '02.2026')
        self.assertTrue(any('add the year' in n for n in r['notes']))
        self.assertEqual(ask('tell me about february 2025')['context']['period'], '02.2025')

    def test_quarter_and_range_questions(self):
        r = ask('how did q1 go')
        self.assertIn('Jan–Mar 2026', r['reply'])

    def test_customer_ranking_has_no_margin_column_and_margin_ranking_is_finished_goods_only(self):
        r = ask('top 2 customers')
        self.assertEqual(r['sections'][0]['table']['head'], ['#', 'Name', 'Net sales', 'Share'])
        m = ask('lowest margin products')
        names = [row[1] for row in m['sections'][0]['table']['rows']]
        self.assertNotIn('Item 13000000', names)
        self.assertTrue(any('left out' in n for n in m['notes']))

    def test_best_and_worst_month_answer_directly(self):
        self.assertIn('strongest month', ask('which was the best month')['reply'])
        self.assertIn('March 2026', ask('which was the best month')['reply'])
        self.assertIn('weakest month', ask('weakest month')['reply'])

    def test_validation_questions_respect_data_management_access(self):
        self.assertIn("doesn't have access", ask('any closure breaches?', allow=False)['reply'])
        self.assertIn('spreadsheet source carries no cost chain', ask('any closure breaches?')['reply'])

    def test_unknown_questions_get_helpful_follow_ups_not_a_dead_end(self):
        r = ask('blah blah')
        self.assertEqual(r['kind'], 'rich')
        self.assertGreaterEqual(len(r['followups']), 3)

    def test_junk_context_is_ignored(self):
        for junk in ({'period': {'x': 1}, 'material': ['a']}, 'nonsense', None, {'period': '99.9999'}):
            self.assertIn('reply', ask('and in february?', ctx=junk))


class ChatEndpoint(Base):
    def setUp(self):
        super().setUp()
        state['api']['data'] = dataset()

    def test_endpoint_passes_context_through_and_returns_it(self):
        make('ann')
        c, _ = login('ann')
        r1 = post(c, '/api/chat', {'source': 'api', 'message': 'tell me about february'}).json()
        self.assertEqual(r1['context']['period'], '02.2026')
        r2 = post(c, '/api/chat', {'source': 'api', 'message': 'and in march?', 'context': r1['context']}).json()
        self.assertEqual(r2['context']['period'], '03.2026')
        self.assertEqual(post(c, '/api/chat', {'source': 'api', 'message': 'hi', 'context': 'garbage'}).status_code, 200)
        self.assertEqual(json.dumps(r2).count('NaN'), 0)
