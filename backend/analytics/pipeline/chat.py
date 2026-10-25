"""The AIF assistant: a local, rule-based analyst over the dashboard's own data.

Deliberately NOT a generative model: every number it states is read from `aggregate()` (the same function behind every card, chart and table)
or is plain arithmetic on those figures (shares, changes, price / volume / cost effects), so an answer can never disagree with the screen and
nothing is invented. No external service is called and no data leaves the server.

It answers the way an analyst would: the headline first, then the key figures, what is behind them (drivers, top contributors), anything worth
knowing (open months, revenue costed at an assumed $0, part months) and sensible next questions. Answers are structured data (kind 'rich')
that the front end lays out; the previous turn's `context` (period / product / customer) lets follow-ups such as "and in August?" work.

Contribution margin % is reported for Finished Goods (B2B/B2C) only, as on the dashboard; Others never carry a margin figure.
"""
import re

from ..jsutil import js_round, to_fixed
from ..productgroup import is_finished_good
from .aggregate import aggregate

MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


# ----------------------------------------------------------------------------------------------------------------- formatting
def money(n):
    """Compact dollars: $2.73M, $230.6K, $949."""
    if n is None:
        return 'N/A'
    a, sign = abs(n), '-' if n < 0 else ''
    if a >= 1e6:
        return f'{sign}${to_fixed(a / 1e6, 2)}M'
    if a >= 1e3:
        return f'{sign}${to_fixed(a / 1e3, 1)}K'
    return f'{sign}${js_round(a)}'


def smoney(n):
    """Signed compact dollars for changes: +$1.10M / -$45.2K."""
    return 'N/A' if n is None else ('+' if n >= 0 else '') + money(n)


def pct(n, dp=1):
    return 'N/A' if n is None else to_fixed(n, dp) + '%'


def pts(n):
    return 'N/A' if n is None else ('+' if n >= 0 else '-') + to_fixed(abs(n), 1) + ' pts'


def spct(n, dp=1):
    return 'N/A' if n is None else ('+' if n >= 0 else '-') + to_fixed(abs(n), dp) + '%'


def mt(n):
    if n is None:
        return 'N/A'
    whole, _, frac = to_fixed(abs(n), 1).partition('.')
    return f"{'-' if n < 0 else ''}{int(whole):,}.{frac} MT"


def per_kg(per_mt):
    return 'N/A' if per_mt is None else '$' + to_fixed(per_mt / 1000, 3) + '/kg'


def per_t(v):
    return 'N/A' if v is None else '$' + f'{js_round(v):,}' + '/t'


def b(s):
    """Mark a figure for bold in the front end (**…**)."""
    return f'**{s}**'


def chg(cur, prev):
    """Percentage change, or None when there is no meaningful base."""
    if cur is None or prev is None or prev == 0:
        return None
    return (cur - prev) / abs(prev) * 100


def share(part, whole):
    return None if not whole else part / whole * 100


def p_label(p):
    return f'{MONTH_FULL[int(p[:2]) - 1].capitalize()} {p[3:]}'


def p_short(p):
    return f'{MONTH_SHORT[int(p[:2]) - 1]} {p[3:]}'


def range_label(periods):
    if not periods:
        return 'the selected period'
    if len(periods) == 1:
        return p_label(periods[0])
    a, z = periods[0], periods[-1]
    return f'{MONTH_SHORT[int(a[:2]) - 1]}–{p_short(z)}' if a[3:] == z[3:] else f'{p_short(a)} – {p_short(z)}'


def pkey(p):
    return p[3:] + p[:2]


# ----------------------------------------------------------------------------------------------------------------- data helpers
def fg_of(row):
    """Finished-Goods figures of an aggregate row (a period, a product, the total): revenue, tonnes, VC, CM, CM %, price and VC per tonne."""
    g = (row.get('groups') or {}).get('fg') or {}
    q = g.get('qtyMt') or 0
    rev = g.get('revenue') or 0
    vc = g.get('cogm')
    return {'rev': rev, 'qty': q, 'vc': vc, 'cm': g.get('cm'), 'cmpct': g.get('cmPct'),
            'ppt': rev / q if q else None, 'cpt': (vc / q) if (q and vc is not None) else None}


# ----------------------------------------------------------------------------------------------------------------- answer shapes
def rich(summary, sections=None, notes=None, followups=None, title=None, ctx=None):
    return {'kind': 'rich', 'title': title, 'reply': summary, 'sections': sections or [], 'notes': notes or [],
            'followups': followups or [], 'context': ctx or {}}


def text(reply, ctx=None, followups=None):
    if followups:
        return rich(reply, followups=followups, ctx=ctx)
    return {'reply': reply, 'kind': 'text', 'context': ctx or {}}


def bullets(heading, items):
    return {'heading': heading, 'bullets': [i for i in items if i]}


def table(heading, head, rows):
    return {'heading': heading, 'table': {'head': head, 'rows': rows}}


# ----------------------------------------------------------------------------------------------------------------- parsing
def _tokens(s):
    return re.findall(r'[a-z0-9]+', s.lower())


STOP = {'the', 'and', 'for', 'of', 'tender', 'other', 'non', 'stock', 'sellable', 'by', 'products', 'product', 'items', 'item'}


def find_entity(text_l, lst):
    """Find a product or customer in the question: an exact code, the full name, or the best partial match (whole words only; at least half
    of the name's letters, or two or more distinct words, must match)."""
    code = next((e for e in lst if len(e['code']) >= 5 and e['code'].lower() in text_l), None)
    if code:
        return code
    exact = next((e for e in lst if e.get('name') and e['name'].lower() in text_l), None)
    if exact:
        return exact
    toks = set(_tokens(text_l))
    best, best_score = None, 0
    for e in lst:
        if not e.get('name'):
            continue
        words = [w for w in _tokens(e['name']) if len(w) >= 3 and w not in STOP]
        if not words:
            continue
        hit = [w for w in words if w in toks]
        score = sum(len(w) for w in hit)
        total = sum(len(w) for w in words)
        if hit and (score / total >= 0.5 or len(hit) >= 2) and score > best_score and score >= 4:
            best_score, best = score, e
    return best


def find_top_n(text_l):
    m = re.search(r'\b(?:top|bottom|lowest|highest|best|worst)\s*(\d+)\b', text_l, re.I) \
        or re.search(r'\b(\d+)\s*(?:best|highest|top|lowest|worst|bottom)\b', text_l, re.I)
    return min(10, max(1, int(m.group(1)))) if m else 5


def wants_lowest(t): return bool(re.search(r'\b(lowest|worst|least|bottom|smallest|weakest|poorest)\b', t, re.I))
def wants_cm(t): return bool(re.search(r'\b(cm|margins?|contribution|profit(?:ability|able)?)\b', t, re.I))
def wants_cogm(t): return bool(re.search(r'\b(cogm|vc|variable cost|cost of goods|costs?)\b', t, re.I))
def wants_revenue(t): return bool(re.search(r'\b(revenues?|sales|sold|turnover|income)\b', t, re.I))
def wants_volume(t): return bool(re.search(r'\b(volumes?|quantit(y|ies)|qty|tonnage|tonnes?|tons?|mt)\b', t, re.I))
def wants_price(t): return bool(re.search(r'\b(price|pricing|per kg|per tonne|per ton|/kg)\b', t, re.I))


def resolve_periods(tl, all_periods):
    """Periods the question is about -> {'periods': [codes], 'range': [codes] | None, 'assumed': [notes]}.
    Months by name (with an optional year), 09.2026 / 09/2026, last / previous month, quarters, year to date, last N months. A month name with
    no year means the most recent matching month in the data."""
    out = {'periods': [], 'range': None, 'assumed': []}
    if not all_periods:
        return out
    latest_year = all_periods[-1][3:]
    ym = re.findall(r"\b(20\d\d)\b|'(\d\d)\b", tl)
    explicit_year = next((y[0] or '20' + y[1] for y in ym), None)

    for m in re.finditer(r'\b(0[1-9]|1[0-2])[./](20\d\d)\b', tl):
        p = f'{m.group(1)}.{m.group(2)}'
        if p in all_periods and p not in out['periods']:
            out['periods'].append(p)
    if not out['periods']:
        for i in range(12):
            if re.search(rf'\b({MONTHS[i]}|{MONTH_FULL[i]})\b', tl):
                cands = [p for p in all_periods if p.startswith(f'{i + 1:02d}.')]
                if not cands:
                    continue
                if explicit_year and f'{i + 1:02d}.{explicit_year}' in cands:
                    pick = f'{i + 1:02d}.{explicit_year}'
                else:
                    pick = cands[-1]
                    if len(cands) > 1 and not explicit_year:
                        out['assumed'].append(f'"{MONTH_FULL[i].capitalize()}" is {p_label(pick)} here (the latest one in the data); add the year, e.g. "{MONTH_FULL[i].capitalize()} {cands[0][3:]}", for another.')
                if pick not in out['periods']:
                    out['periods'].append(pick)
    if not out['periods']:
        if re.search(r'\b(previous|prior|preceding) month\b|\bmonth before\b|\blast but one\b', tl) and len(all_periods) > 1:
            out['periods'] = [all_periods[-2]]
        elif re.search(r'\b(last|latest|current|this|most recent|newest) month\b', tl):
            out['periods'] = [all_periods[-1]]
    q = re.search(r'\bq([1-4])\b|\b(first|second|third|fourth) quarter\b', tl)
    if q and not out['periods']:
        n = int(q.group(1)) if q.group(1) else ['first', 'second', 'third', 'fourth'].index(q.group(2)) + 1
        yr = explicit_year or latest_year
        rng = [p for p in all_periods if p[3:] == yr and (n - 1) * 3 < int(p[:2]) <= n * 3]
        if rng:
            out['range'] = rng
    lm = re.search(r'\blast (\d+|two|three|four|five|six|twelve) months\b', tl)
    if lm and not out['periods'] and not out['range']:
        n = {'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'twelve': 12}.get(lm.group(1)) or int(lm.group(1))
        out['range'] = all_periods[-n:]
    if not out['periods'] and not out['range']:
        if re.search(r'\b(ytd|year to date|year-to-date|this year|so far)\b', tl):
            out['range'] = [p for p in all_periods if p[3:] == latest_year]
        elif re.search(r'\b(last|previous) year\b', tl):
            r = [p for p in all_periods if p[3:] == str(int(latest_year) - 1)]
            if r:
                out['range'] = r
    return out


def scope_codes(scope, allp):
    """Period codes inside the dashboard's current from/to filter (all loaded months when none is set)."""
    s = scope or {}
    frm, to = s.get('from'), s.get('to')
    return [p for p in allp if (not frm or pkey(p) >= pkey(frm)) and (not to or pkey(p) <= pkey(to))]


# ----------------------------------------------------------------------------------------------------------------- analysis
def caveats(a, period_rows, as_of):
    """What is worth knowing about the figures in view: costs still open, revenue costed at an assumed $0, part months."""
    notes = []
    T = a['total']
    fg_az = ((T.get('groups') or {}).get('fg') or {}).get('revenueAssumedZero') or 0
    oth_az = ((T.get('groups') or {}).get('other') or {}).get('revenueAssumedZero') or 0
    if fg_az > 0:
        notes.append(f"{money(fg_az)} of finished-goods sales has no manufacturing order, so its variable cost is assumed to be $0 and the margin shown is flattered by up to that amount.")
    if oth_az > 0 and T['revenue']:
        notes.append(f"{money(oth_az)} ({pct(share(oth_az, T['revenue']))} of sales) is by-products and other items, costed at an assumed $0, so no margin is reported for them.")
    open_p = [r['period'] for r in period_rows if r.get('provisional')]
    if open_p:
        notes.append(f"{', '.join(p_short(p) for p in open_p)} {'are' if len(open_p) > 1 else 'is'} still open: variable cost on {'those months' if len(open_p) > 1 else 'that month'} can change until period close.")
    if period_rows and as_of:
        last = period_rows[-1]['period']
        if as_of[:7] == f'{last[3:]}-{last[:2]}' and int(as_of[8:10]) < 28:
            notes.append(f"{p_label(last)} is only part-way through (data to {int(as_of[8:10])} {MONTH_SHORT[int(as_of[5:7]) - 1]}), so compare it with full months with care.")
    if T.get('qtyLinesUnconverted'):
        notes.append(f"{T['qtyLinesUnconverted']} line(s) have no tonnage conversion and add revenue but no volume.")
    return notes


def product_rows(a, n=3):
    """Top n products: name, net sales, share of total, CM % (finished goods only)."""
    tot = a['total']['revenue']
    return [[r.get('name') or r['code'], money(r['revenue']), pct(share(r['revenue'], tot)),
             pct(r.get('cmPct')) if (is_finished_good(r['code']) and r.get('cmPct') is not None) else '—'] for r in a['products'][:n]]


def customer_rows(a, n=3):
    tot = a['total']['revenue']
    return [[r.get('name') or r['code'], money(r['revenue']), pct(share(r['revenue'], tot))] for r in a['customers'][:n]]


def tables_for(a):
    t = []
    if a['total']['revenue'] and a['products']:
        t.append(table('Biggest products', ['Product', 'Net sales', 'Share', 'CM %'], product_rows(a)))
    if a['total']['revenue'] and a['customers']:
        t.append(table('Biggest customers', ['Customer', 'Net sales', 'Share'], customer_rows(a)))
    return t


def follow_for(allp, topic=None, period=None):
    last = period or (allp[-1] if allp else None)
    ups = []
    if last and topic != 'explain':
        ups.append(f'Why did margin change in {p_label(last)}?')
    if len(allp) > 1 and topic != 'compare':
        ups.append(f'Compare {p_label(allp[-1])} and {p_label(allp[-2])}')
    if topic != 'rank':
        ups.append('Top 5 customers by revenue')
    if topic != 'trend':
        ups.append('Show me the month-by-month trend')
    return ups[:3]


def overview(data, full, a, label, as_of):
    T = a['total']
    f = fg_of(T)
    periods = a['periods']
    allp = [r['period'] for r in full['periods']]
    lines = [f"Net sales {b(money(T['revenue']))}: finished goods {money(f['rev'])} ({pct(share(f['rev'], T['revenue']))}) and other items {money(T['groups']['other']['revenue'])}.",
             f"Volume {b(mt(T['qtyMt']))}" + (f"; finished goods sell at an average of {b(per_kg(f['ppt']))}." if f['ppt'] is not None else '.')]
    if f['vc'] is not None:
        lines.append(f"Variable cost on finished goods is {money(f['vc'])} ({pct(share(f['vc'], f['rev']))} of their sales), leaving a contribution margin of {b(money(f['cm']))} = {b(pct(f['cmpct']))}.")
    sec = [bullets('Key figures', lines)] + tables_for(a)
    moves = []
    if len(periods) >= 2:
        last, prev = periods[-1], periods[-2]
        c = chg(last['revenue'], prev['revenue'])
        if c is not None:
            moves.append(f"{p_label(last['period'])} sales were {money(last['revenue'])}, {'up' if c >= 0 else 'down'} {b(pct(abs(c)))} on {p_label(prev['period'])} ({smoney(last['revenue'] - prev['revenue'])}).")
        best, worst = max(periods, key=lambda r: r['revenue']), min(periods, key=lambda r: r['revenue'])
        if best['period'] != worst['period']:
            moves.append(f"Strongest month {p_label(best['period'])} ({money(best['revenue'])}); weakest {p_label(worst['period'])} ({money(worst['revenue'])}).")
        lf, pf = fg_of(last), fg_of(prev)
        if lf['cmpct'] is not None and pf['cmpct'] is not None:
            moves.append(f"Finished-goods margin moved from {pct(pf['cmpct'])} to {pct(lf['cmpct'])} ({pts(lf['cmpct'] - pf['cmpct'])}).")
    if moves:
        sec.append(bullets('Recent movement', moves))
    notes = caveats(a, periods, as_of)
    if a['customers'] and T['revenue']:
        conc = share(a['customers'][0]['revenue'], T['revenue'])
        if conc is not None and conc >= 40:
            notes.insert(0, f"{a['customers'][0].get('name') or a['customers'][0]['code']} alone accounts for {pct(conc, 0)} of sales, so the business depends heavily on that one account.")
    head = f"In {label}, net sales were {b(money(T['revenue']))} on {b(mt(T['qtyMt']))}" + (f", with a finished-goods contribution margin of {b(pct(f['cmpct']))}." if f['cmpct'] is not None else '.')
    return rich(head, sec, notes, follow_for(allp, 'overview'), 'Overview', {'topic': 'overview'})


def period_profile(data, p, full, as_of):
    A = aggregate(data, {'period': p})
    T = A['total']
    allp = [r['period'] for r in full['periods']]
    idx = allp.index(p) if p in allp else -1
    prev_p = allp[idx - 1] if idx > 0 else None
    row = next((r for r in full['periods'] if r['period'] == p), None)
    f = fg_of(T)
    figs = [f"Net sales {b(money(T['revenue']))}: finished goods {money(f['rev'])}, other items {money(T['groups']['other']['revenue'])}.",
            f"Volume {b(mt(T['qtyMt']))}" + (f" at {b(per_kg(f['ppt']))} average finished-goods price." if f['ppt'] is not None else '.')]
    if f['cmpct'] is not None:
        figs.append(f"Finished-goods contribution margin {b(money(f['cm']))} = {b(pct(f['cmpct']))} (variable cost {money(f['vc'])}).")
    sec = [bullets('Key figures', figs)]
    head = f"{p_label(p)}: net sales of {b(money(T['revenue']))} on {b(mt(T['qtyMt']))}"
    if prev_p:
        B = aggregate(data, {'period': prev_p})
        c = chg(T['revenue'], B['total']['revenue'])
        pf = fg_of(B['total'])
        move = []
        if c is not None:
            head += f", {'up' if c >= 0 else 'down'} {b(pct(abs(c)))} on {p_label(prev_p)}"
            move.append(f"Net sales {smoney(T['revenue'] - B['total']['revenue'])} versus {p_label(prev_p)} ({money(B['total']['revenue'])}).")
        if f['qty'] and pf['qty']:
            move.append(f"Finished-goods volume {spct(chg(f['qty'], pf['qty']))} ({mt(pf['qty'])} to {mt(f['qty'])}).")
        if f['ppt'] and pf['ppt']:
            move.append(f"Average finished-goods price {per_kg(pf['ppt'])} to {per_kg(f['ppt'])} ({spct(chg(f['ppt'], pf['ppt']))}).")
        if f['cmpct'] is not None and pf['cmpct'] is not None:
            move.append(f"Finished-goods margin {pct(pf['cmpct'])} to {pct(f['cmpct'])} ({pts(f['cmpct'] - pf['cmpct'])}).")
        if move:
            sec.append(bullets(f'Compared with {p_label(prev_p)}', move))
    head += '.'
    sec += tables_for(A)
    ups = ([f'Why did margin change in {p_label(p)}?', f'Compare {p_label(p)} and {p_label(prev_p)}'] if prev_p else []) + ['Top 5 products by revenue']
    return rich(head, sec, caveats(A, [row] if row else [], as_of), ups[:3], p_label(p), {'topic': 'period', 'period': p})


def effects(a, b_):
    """Volume / price / cost effects of the Finished-Goods change from period b_ to a (dicts from fg_of). The split is exact:
    d(revenue) = d(volume) * P0 + d(price) * q1;   d(CM) = d(volume) * (P0 - C0) + d(price) * q1 - d(cost) * q1."""
    out = {}
    if a['ppt'] is not None and b_['ppt'] is not None:
        out['rev_volume'] = (a['qty'] - b_['qty']) * b_['ppt']
        out['rev_price'] = (a['ppt'] - b_['ppt']) * a['qty']
        if a['cpt'] is not None and b_['cpt'] is not None:
            out['cm_volume'] = (a['qty'] - b_['qty']) * (b_['ppt'] - b_['cpt'])
            out['cm_price'] = (a['ppt'] - b_['ppt']) * a['qty']
            out['cm_cost'] = -(a['cpt'] - b_['cpt']) * a['qty']
    return out


def product_movers(A, B, key='cm', n=2):
    """Finished-good products with the biggest gain / loss in CM (or revenue) between two aggregates -> (gainers, losers) of (code, name, delta)."""
    cur = {r['code']: r for r in A['products'] if is_finished_good(r['code'])}
    old = {r['code']: r for r in B['products'] if is_finished_good(r['code'])}
    d = []
    for c in set(cur) | set(old):
        name = (cur.get(c) or old.get(c)).get('name') or c
        d.append((c, name, ((cur.get(c) or {}).get(key) or 0) - ((old.get(c) or {}).get(key) or 0)))
    d.sort(key=lambda x: x[2])
    return [x for x in d[::-1][:n] if x[2] > 0], [x for x in d[:n] if x[2] < 0]


def explain(data, cur, prev, focus, full, as_of):
    A, B = aggregate(data, {'period': cur}), aggregate(data, {'period': prev})
    a, b_ = fg_of(A['total']), fg_of(B['total'])
    ef = effects(a, b_)
    cl, pl = p_label(cur), p_label(prev)
    sec = []
    if focus == 'margin' and a['cmpct'] is not None and b_['cmpct'] is not None:
        d = a['cmpct'] - b_['cmpct']
        head = (f"Finished-goods margin in {cl} was {b(pct(a['cmpct']))} against {b(pct(b_['cmpct']))} in {pl}: "
                f"{'up' if d >= 0 else 'down'} {b(to_fixed(abs(d), 1) + ' points')}, while margin dollars {'rose' if a['cm'] >= b_['cm'] else 'fell'} by {b(money(abs(a['cm'] - b_['cm'])))}.")
        if 'cm_cost' in ef:
            u0, u1 = b_['ppt'] - b_['cpt'], a['ppt'] - a['cpt']                         # margin per tonne before / after
            dp, dc = a['ppt'] - b_['ppt'], a['cpt'] - b_['cpt']
            # the percentage is driven by price and cost per tonne (volume cannot change a percentage); volume moves the dollars
            lead = 'cost per tonne' if abs(dc) > abs(dp) else 'selling price'
            head += (f" The margin per tonne went from {b(per_t(u0))} to {b(per_t(u1))} ({spct(chg(u1, u0))}), and the bigger driver of that was the {b(lead)}: "
                     f"{'cost rose' if dc > 0 else 'cost fell'} {pct(abs(chg(a['cpt'], b_['cpt']) or 0))} while the price {'rose' if dp > 0 else 'fell'} {pct(abs(chg(a['ppt'], b_['ppt']) or 0))}.")
            sec.append(bullets(f"Where the {money(abs(a['cm'] - b_['cm']))} {'increase' if a['cm'] >= b_['cm'] else 'fall'} in margin dollars came from", [
                f"{b('Selling price')}: {per_t(b_['ppt'])} to {per_t(a['ppt'])} ({spct(chg(a['ppt'], b_['ppt']))}), worth {b(smoney(ef['cm_price']))}.",
                f"{b('Variable cost')}: {per_t(b_['cpt'])} to {per_t(a['cpt'])} ({spct(chg(a['cpt'], b_['cpt']))}), worth {b(smoney(ef['cm_cost']))}.",
                f"{b('Volume')}: finished-goods tonnage {spct(chg(a['qty'], b_['qty']))} ({mt(b_['qty'])} to {mt(a['qty'])}), worth {b(smoney(ef['cm_volume']))} at the earlier unit margin. Volume changes margin dollars, not the margin percentage."]))
        gain, lose = product_movers(A, B, 'cm')
        mix = [f'{n_} added {money(v)} of margin.' for _, n_, v in gain] + [f'{n_} lost {money(abs(v))} of margin.' for _, n_, v in lose]
        if mix:
            sec.append(bullets('Which products', mix))
    elif focus != 'margin' and (a['rev'] or b_['rev']):
        if focus == 'volume':
            head = f"Finished-goods volume in {cl} was {b(mt(a['qty']))} versus {b(mt(b_['qty']))} in {pl} ({b(spct(chg(a['qty'], b_['qty'])))})."
        else:
            head = f"Finished-goods sales in {cl} were {b(money(a['rev']))} versus {b(money(b_['rev']))} in {pl} ({b(spct(chg(a['rev'], b_['rev'])))}, {smoney(a['rev'] - b_['rev'])})."
        if 'rev_volume' in ef:
            sec.append(bullets('What moved sales', [
                f"{b('Volume')}: {spct(chg(a['qty'], b_['qty']))} in tonnes ({mt(b_['qty'])} to {mt(a['qty'])}), worth {b(smoney(ef['rev_volume']))}.",
                f"{b('Price')}: the average price went from {per_t(b_['ppt'])} to {per_t(a['ppt'])} ({spct(chg(a['ppt'], b_['ppt']))}), worth {b(smoney(ef['rev_price']))}."]))
        gain, lose = product_movers(A, B, 'revenue')
        mix = [f'{n_} added {money(v)}.' for _, n_, v in gain] + [f'{n_} fell {money(abs(v))}.' for _, n_, v in lose]
        if mix:
            sec.append(bullets('Which products', mix))
    else:
        head = (f"{cl} versus {pl}: net sales {money(A['total']['revenue'])} against {money(B['total']['revenue'])} ({spct(chg(A['total']['revenue'], B['total']['revenue']))}). "
                "There is not enough finished-goods cost data in both months to split the change into price, volume and cost.")
    return rich(head, sec, caveats(A, [r for r in full['periods'] if r['period'] == cur], as_of),
                [f'Compare {cl} and {pl}', f'Tell me about {cl}', 'Show me the month-by-month trend'], f'{cl} versus {pl}', {'topic': 'explain', 'period': cur})


def compare(data, p1, p2, full, as_of):
    A, B = aggregate(data, {'period': p1}), aggregate(data, {'period': p2})
    a, b_ = fg_of(A['total']), fg_of(B['total'])
    ta, tb = A['total'], B['total']
    rows = [['Net sales', money(ta['revenue']), money(tb['revenue']), spct(chg(ta['revenue'], tb['revenue']))],
            ['FG sales', money(a['rev']), money(b_['rev']), spct(chg(a['rev'], b_['rev']))],
            ['FG volume', mt(a['qty']), mt(b_['qty']), spct(chg(a['qty'], b_['qty']))],
            ['FG price', per_kg(a['ppt']), per_kg(b_['ppt']), spct(chg(a['ppt'], b_['ppt']))],
            ['FG margin $', money(a['cm']), money(b_['cm']), spct(chg(a['cm'], b_['cm']))],
            ['FG margin %', pct(a['cmpct']), pct(b_['cmpct']), pts(a['cmpct'] - b_['cmpct']) if (a['cmpct'] is not None and b_['cmpct'] is not None) else 'N/A']]
    d = chg(ta['revenue'], tb['revenue'])
    head = (f"{p_label(p1)} had net sales of {b(money(ta['revenue']))} against {b(money(tb['revenue']))} in {p_label(p2)}: "
            + (f"{'up' if d >= 0 else 'down'} {b(pct(abs(d)))} ({smoney(ta['revenue'] - tb['revenue'])})." if d is not None else 'no comparison is possible.'))
    sec = [table('Side by side', ['', p_short(p1), p_short(p2), 'Change'], rows)]
    ef = effects(a, b_)
    why = []
    if 'rev_volume' in ef:
        why.append(f"Of the change in finished-goods sales, volume explains {smoney(ef['rev_volume'])} and price {smoney(ef['rev_price'])}.")
    if 'cm_cost' in ef:
        why.append(f"Of the change in margin dollars, volume explains {smoney(ef['cm_volume'])}, selling price {smoney(ef['cm_price'])} and unit cost {smoney(ef['cm_cost'])}.")
    if why:
        sec.append(bullets('What explains it', why))
    return rich(head, sec, caveats(A, [r for r in full['periods'] if r['period'] == p1], as_of),
                [f'Why did margin change in {p_label(p1)}?', f'Tell me about {p_label(p1)}', 'Top 5 products by revenue'], f'{p_short(p1)} vs {p_short(p2)}', {'topic': 'compare', 'period': p1})


def trend(data, codes, full, as_of, tl=''):
    rows_src = [r for r in full['periods'] if r['period'] in codes]
    if len(rows_src) < 2:
        return text('There is only one month in that range, so there is no trend to show. Try "all months" or a wider range.')
    rows, prev = [], None
    for r in rows_src[-12:]:
        f = fg_of(r)
        rows.append([p_short(r['period']), money(r['revenue']), spct(chg(r['revenue'], prev['revenue'])) if prev else '—', pct(f['cmpct']) if f['cmpct'] is not None else '—'])
        prev = r
    first, last = rows_src[0], rows_src[-1]
    best, worst = max(rows_src, key=lambda r: r['revenue']), min(rows_src, key=lambda r: r['revenue'])
    total = sum(r['revenue'] for r in rows_src)
    c = chg(last['revenue'], first['revenue'])
    cm_rows = [(r, fg_of(r)['cmpct']) for r in rows_src if fg_of(r)['cmpct'] is not None]
    stand = [f"Strongest month {b(p_label(best['period']))} ({money(best['revenue'])}); weakest {b(p_label(worst['period']))} ({money(worst['revenue'])}); average {money(total / len(rows_src))} a month."]
    if cm_rows:
        hi, lo = max(cm_rows, key=lambda x: x[1]), min(cm_rows, key=lambda x: x[1])
        stand.append(f"Finished-goods margin ranged from {b(pct(lo[1]))} ({p_short(lo[0]['period'])}) to {b(pct(hi[1]))} ({p_short(hi[0]['period'])}).")
    direction = 'higher' if (c or 0) > 5 else 'lower' if (c or 0) < -5 else 'about the same'
    pick = re.search(r'\b(best|highest|strongest|peak)\b', tl) or re.search(r'\b(worst|lowest|weakest)\b', tl)
    if pick and re.search(r'\bmonth', tl):
        m = best if re.search(r'\b(best|highest|strongest|peak)\b', tl) else worst
        f = fg_of(m)
        head = (f"The {'strongest' if m is best else 'weakest'} month in {range_label([r['period'] for r in rows_src])} was {b(p_label(m['period']))} with net sales of {b(money(m['revenue']))}"
                + (f" and a finished-goods margin of {b(pct(f['cmpct']))}." if f['cmpct'] is not None else '.'))
    else:
        head = (f"Over {range_label([r['period'] for r in rows_src])} ({len(rows_src)} months) net sales were {b(money(total))} in total; "
            f"{p_label(last['period'])} ({money(last['revenue'])}) is {direction} than {p_label(first['period'])} ({money(first['revenue'])})"
            + (f", {spct(c)}." if c is not None and direction != 'about the same' else '.'))
    agg_rng = aggregate(data, {'from': rows_src[0]['period'], 'to': rows_src[-1]['period']})
    return rich(head, [table('Month by month', ['Month', 'Net sales', 'vs prior', 'FG margin'], rows), bullets('What stands out', stand)], caveats(agg_rng, rows_src, as_of),
                [f"Why did margin change in {p_label(last['period'])}?", f"Tell me about {p_label(best['period'])}", 'Top 5 customers by revenue'], 'Trend', {'topic': 'trend'})


def ranking(tl, label, a, full):
    n = find_top_n(tl)
    is_cust = bool(re.search(r'\b(customers?|clients?|buyers?)\b', tl))
    by_cm = wants_cm(tl) and not is_cust
    by_vol = wants_volume(tl) and not by_cm and not wants_revenue(tl)
    low = wants_lowest(tl)
    kind = 'customers' if is_cust else 'products'
    noun = kind
    rows = list(a[kind])
    tot = a['total']
    excluded = 0
    if by_cm:
        before = len(rows)
        rows = [r for r in rows if is_finished_good(r['code']) and r.get('cmPct') is not None]
        excluded = before - len(rows)
        rows.sort(key=lambda r: r['cmPct'], reverse=True)
        metric = 'contribution margin %'
    elif by_vol:
        rows = [r for r in rows if r.get('qtyMt') is not None]
        rows.sort(key=lambda r: r['qtyMt'], reverse=True)
        metric = 'volume'
    else:
        rows.sort(key=lambda r: r['revenue'], reverse=True)
        metric = 'net sales'
    if low:
        rows = rows[::-1]
    rows = rows[:n]
    if not rows:
        return text(f'None of the {noun} in {label} have a measurable {metric} to rank (finished-goods margin only exists where a manufacturing order was costed).')
    body = []
    for i, r in enumerate(rows, 1):
        cm = r.get('cmPct') if (not is_cust and is_finished_good(r['code'])) else None
        body.append([str(i), r.get('name') or r['code'], mt(r['qtyMt']) if by_vol else money(r['revenue']),
                     pct(share(r['qtyMt'] or 0, tot['qtyMt'])) if by_vol else pct(share(r['revenue'], tot['revenue'])), pct(cm) if cm is not None else '—'])
    top_share = sum(share(r['revenue'], tot['revenue']) or 0 for r in rows)
    first = rows[0]
    head = (f"{'Lowest' if low else 'Top'} {len(rows)} {noun} by {metric} in {label}: {b(first.get('name') or first['code'])} "
            f"{'is at' if (low or by_cm) else 'leads at'} {b(pct(first['cmPct']) if by_cm else mt(first['qtyMt']) if by_vol else money(first['revenue']))}"
            + (f", and together these {len(rows)} make up {b(pct(top_share, 0))} of net sales." if not by_cm and not by_vol and not low else '.'))
    notes = []
    if excluded:
        notes.append(f"{excluded} {noun[:-1] if excluded == 1 else noun} without a costed finished-goods margin {'is' if excluded == 1 else 'are'} left out of this margin ranking.")
    if not is_cust and not by_cm and any(not is_finished_good(r['code']) for r in rows):
        notes.append('Margin is only reported for finished goods; by-products and other items show "—".')
    allp = [r['period'] for r in full['periods']]
    cols = ['#', 'Name', 'Volume' if by_vol else 'Net sales', 'Share', 'CM %']
    if is_cust:                                                     # margin is a product-level figure: no CM % column for customers
        cols, body = cols[:4], [r[:4] for r in body]
    return rich(head, [table('Ranking', cols, body)], notes, follow_for(allp, 'rank'),
                f"{'Lowest' if low else 'Top'} {noun}", {'topic': 'rank'})


def profile(data, ent, kind, scope, label, full, as_of, period=None):
    """How a product (kind 'product') or customer (kind 'customer') is doing; `period` pins it to one month."""
    sc = dict(scope or {})
    sc['material' if kind == 'product' else 'customer'] = ent['code']
    if period:
        sc = {k: v for k, v in sc.items() if k not in ('from', 'to', 'period')}
        sc['period'] = period
    A = aggregate(data, sc)
    name = ent.get('name') or ent['code']
    if A['total']['lines'] == 0:
        return text(f'I found no activity for {name} in {label}.', {'topic': kind})
    T = A['total']
    f = fg_of(T)
    whole = aggregate(data, {k: v for k, v in sc.items() if k not in ('material', 'customer')})
    rank_list = whole['products' if kind == 'product' else 'customers']
    pos = next((i for i, r in enumerate(rank_list, 1) if r['code'] == ent['code']), None)
    shr = share(T['revenue'], whole['total']['revenue'])
    is_fg_prod = kind == 'product' and is_finished_good(ent['code'])
    avg_fg = fg_of(whole['total'])['cmpct']
    figs = [f"Net sales {b(money(T['revenue']))} = {b(pct(shr))} of all sales in {label}" + (f", ranking #{pos} of {len(rank_list)} {'products' if kind == 'product' else 'customers'}." if pos else '.'),
            f"Volume {b(mt(T['qtyMt']))}" + (f" at an average {b(per_kg(f['ppt']))}." if f['ppt'] is not None else '.')]
    verdict = None
    if kind == 'product' and not is_fg_prod:
        figs.append('This is a by-product or other item with no manufacturing order of its own, so its variable cost is assumed to be $0 and no margin is reported.')
    elif f['cmpct'] is not None:
        extra = ''
        if avg_fg is not None:
            verdict = 'above' if f['cmpct'] > avg_fg else 'below'
            extra = f" ({verdict} the finished-goods average of {pct(avg_fg)} by {to_fixed(abs(f['cmpct'] - avg_fg), 1)} points)"
        figs.append(f"Contribution margin {b(money(f['cm']))} = {b(pct(f['cmpct']))}{extra}.")
    sec = [bullets('Key figures', figs)]
    if T['revenue']:
        if kind == 'product':
            sec.append(table('Mostly bought by', ['Customer', 'Net sales', 'Share'], customer_rows(A)))
        else:
            sec.append(table('Mostly buys', ['Product', 'Net sales', 'Share', 'CM %'], product_rows(A)))
    per = A['periods']
    over = []
    if len(per) >= 2:
        best, worst, last, prev = max(per, key=lambda r: r['revenue']), min(per, key=lambda r: r['revenue']), per[-1], per[-2]
        c = chg(last['revenue'], prev['revenue'])
        if c is not None:
            over.append(f"{p_label(last['period'])}: {money(last['revenue'])}, {'up' if c >= 0 else 'down'} {pct(abs(c))} on {p_label(prev['period'])}.")
        if best['period'] != worst['period']:
            over.append(f"Best month {p_label(best['period'])} ({money(best['revenue'])}); weakest {p_label(worst['period'])} ({money(worst['revenue'])}).")
        lf = fg_of(last)
        if is_fg_prod and lf['cmpct'] is not None:
            over.append(f"Latest margin {pct(lf['cmpct'])}.")
    if over:
        sec.append(bullets('Over time', over))
    head = f"{name} brought in {b(money(T['revenue']))} in {label}, {pct(shr)} of the total"
    head += (f", at a margin of {b(pct(f['cmpct']))}" + (f" ({verdict} average)." if verdict else '.')) if (is_fg_prod and f['cmpct'] is not None) else '.'
    ctx = {'topic': kind, ('material' if kind == 'product' else 'customer'): ent['code']}
    if period:
        ctx['period'] = period
    allp = [r['period'] for r in full['periods']]
    ups = ([f'Why did margin change in {p_label(allp[-1])}?'] if allp else []) + ['Top 5 customers by revenue' if kind == 'product' else 'Top 5 products by revenue', 'Show me the month-by-month trend']
    return rich(head, sec, caveats(A, per, as_of), ups[:3], name, ctx)


def metric_answer(tl, base, label, as_of):
    """A plain metric question (margin, revenue, volume, price, cost) answered with its context."""
    T = base['total']
    f = fg_of(T)
    periods = base['periods']
    last = periods[-1]['period'] if periods else None
    if wants_price(tl) and f['ppt'] is not None:
        det = []
        ppt = [(r['period'], fg_of(r)['ppt']) for r in periods if fg_of(r)['ppt']]
        if len(ppt) >= 2:
            hi, lo = max(ppt, key=lambda x: x[1]), min(ppt, key=lambda x: x[1])
            det.append(f"Highest in {p_label(hi[0])} ({per_kg(hi[1])}), lowest in {p_label(lo[0])} ({per_kg(lo[1])}).")
            det.append(f"Latest month ({p_label(ppt[-1][0])}): {per_kg(ppt[-1][1])}, {spct(chg(ppt[-1][1], ppt[-2][1]))} on {p_label(ppt[-2][0])}.")
        return rich(f"Finished goods sold at an average of {b(per_kg(f['ppt']))} ({b(per_t(f['ppt']))}) in {label}.", [bullets('Detail', det)] if det else [], caveats(base, periods, as_of),
                    ['Show me the month-by-month trend', 'Top 5 products by revenue'], 'Price', {'topic': 'metric'})
    if wants_cm(tl) and f['cm'] is not None:
        det = [f"Finished-goods sales {money(f['rev'])}, less variable cost {money(f['vc'])} (materials, activities and utilities)."]
        ms = [(r['period'], fg_of(r)['cmpct']) for r in periods if fg_of(r)['cmpct'] is not None]
        if len(ms) >= 2:
            hi, lo = max(ms, key=lambda x: x[1]), min(ms, key=lambda x: x[1])
            det.append(f"Best month {p_label(hi[0])} at {pct(hi[1])}, weakest {p_label(lo[0])} at {pct(lo[1])}.")
        return rich(f"Finished-goods contribution margin is {b(money(f['cm']))}, {b(pct(f['cmpct']))} of finished-goods sales, in {label}.", [bullets('How it is made up', det)], caveats(base, periods, as_of),
                    [f'Why did margin change in {p_label(last)}?' if last else 'Top 5 products by margin', 'Which product has the lowest margin?', 'Show me the month-by-month trend'], 'Margin', {'topic': 'metric'})
    if wants_cogm(tl) and f['vc'] is not None:
        return rich(f"Variable cost of finished goods is {b(money(f['vc']))} in {label}, {b(pct(share(f['vc'], f['rev'])))} of their sales (about {b(per_t(f['cpt']))} per tonne).",
                    [bullets('Definition', ['Variable cost = direct materials + activities + utilities; overheads (Z1) are excluded.'])], caveats(base, periods, as_of),
                    ['What is our contribution margin?', 'Show me the month-by-month trend'], 'Variable cost', {'topic': 'metric'})
    if wants_volume(tl) and not wants_revenue(tl):
        return rich(f"Volume is {b(mt(T['qtyMt']))} in {label}: {mt(f['qty'])} finished goods and {mt(T['groups']['other']['qtyMt'])} other items.", [], caveats(base, periods, as_of),
                    ['Show me the month-by-month trend', 'Top 5 products by volume'], 'Volume', {'topic': 'metric'})
    return rich(f"Net sales are {b(money(T['revenue']))} in {label}: {b(mt(T['qtyMt']))} sold over {T['lines']} lines.",
                [bullets('Split', [f"Finished goods {money(f['rev'])} ({pct(share(f['rev'], T['revenue']))}); other items {money(T['groups']['other']['revenue'])}."])], caveats(base, periods, as_of),
                ['Show me the month-by-month trend', 'Top 5 customers by revenue', 'Give me an overview'], 'Net sales', {'topic': 'metric'})


# ----------------------------------------------------------------------------------------------------------------- entry point
FOLLOWUP = re.compile(r'^\s*(and|also|what about|how about|same (for|in)|then|ok(ay)?[, ]|now|so|but)\b', re.I)
WHY = re.compile(r'\b(why|reason|drivers?|explain|what (changed|happened|drove|caused)|how come|due to|behind)\b', re.I)


def suggestions(full):
    allp = [r['period'] for r in full['periods']]
    ups = ['Give me an overview']
    if allp:
        ups.append(f'Tell me about {p_label(allp[-1])}')
    if len(allp) > 1:
        ups += [f'Why did margin change in {p_label(allp[-1])}?', f'Compare {p_label(allp[-1])} and {p_label(allp[-2])}']
    ups += ['Top 5 customers by revenue', 'Which product has the lowest margin?', 'Show me the month-by-month trend']
    return ups[:7]


def answer(data, scope, message, allow_controls=True, context=None):
    """Answer a question against the given dataset, honouring the dashboard's current filter (`scope`: period, material, customer, from, to).
    `context` is the previous answer's context (period / material / customer / topic) and makes follow-ups work."""
    t = str('' if message is None else message).strip()
    tl = t.lower()
    ctx = {k: str(v) for k, v in (context if isinstance(context, dict) else {}).items() if k in ('period', 'material', 'customer', 'topic') and isinstance(v, (str, int))}
    base = aggregate(data, scope or {})
    full = aggregate(data, {})              # every loaded month, for "overall" / month questions
    allp = [r['period'] for r in full['periods']]
    as_of = data.get('asOf')

    if not t:
        return text('Ask me something about revenue, margin, or a specific product, customer or month.')

    # ---- small talk ----
    if re.match(r'^\s*(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b', tl) and len(tl) < 24:
        return text("Hi! I'm your AIF assistant. I can give you the story behind the numbers: how a month went, why margin moved, how a product or customer is doing, or who the biggest accounts are.",
                    followups=suggestions(full)[:4])
    if re.search(r'\b(thanks|thank you|cheers|great|perfect|nice one)\b', tl) and len(tl) < 40:
        return text("You're welcome! Ask me anything else about the numbers.", followups=suggestions(full)[:3])
    if re.search(r'\b(help|what can you (do|answer)|capabilities|how do (i|you) (use|work))\b', tl):
        return rich("I answer from the same figures that are on your dashboard, never from guesses, and I explain them the way an analyst would. For example:",
                    [bullets('Ask me about', [
                        f"{b('A month')}: \"Tell me about September\", \"How did Q2 go?\"",
                        f"{b('Why numbers moved')}: \"Why did margin drop in April?\", \"What changed in sales last month?\"",
                        f"{b('Comparisons')}: \"Compare June and September\"",
                        f"{b('Products and customers')}: \"How is WFP Infant 15kg doing?\", \"Top 5 customers\", \"Lowest margin product\"",
                        f"{b('Trends')}: \"Month-by-month trend\", \"Best month\"",
                        f"{b('Follow-ups')}: after any answer just say \"and in August?\""])],
                    [], suggestions(full)[:4], 'What I can do', {'topic': 'help'})

    # ---- validation / source status ----
    if re.search(r'\b(breach|closure|control|reconcil|validation)\b', tl):
        if not allow_controls:
            return text("Validation and closure controls are part of Data Management, which your account doesn't have access to.")
        c = data.get('controls')
        if not c:
            return text('The spreadsheet source carries no cost chain, so there are no closure controls to report. Switch to Live APIs for validation.')
        nb, no, nq = len(c['batchClosure']['breaches']), len(c['orderClosure']['breaches']), len(c['quantityControl']['breaches'])
        tie = 'ties to the reference table' if c['reconciliation']['pass'] else 'does NOT currently tie, so please check the Validation page'
        if nb + no + nq == 0:
            return rich(f"Good news: {b('no closure breaches')}. All {c['batchClosure']['total']} batches and {c['orderClosure']['total']} orders close exactly, and revenue reconciliation {tie}.",
                        followups=['Give me an overview'], ctx={'topic': 'controls'})
        names = ' and '.join(x for x in [f'{nb} batch closure' if nb else None, f'{no} order closure' if no else None, f'{nq} quantity' if nq else None] if x)
        k = nb + no + nq
        return rich(f"There {'is' if k == 1 else 'are'} {b(str(k))} control breach{'' if k == 1 else 'es'} at the moment: {names}.",
                    [bullets('What that means', ['A batch closure breach means more variable cost was charged to a batch than the batch cost to make.',
                                                 'A quantity breach means more was sold from a batch than was produced.',
                                                 'The Validation page lists which batch or order, and by how much.'])],
                    [f'Revenue reconciliation {tie}.'], ctx={'topic': 'controls'})
    if re.search(r'\b(which source|what source|connected|connection|last refresh|data as of|data through)\b', tl):
        api = data.get('source') == 'api'
        return text(f"Source: {'live S/4HANA' if api else 'local spreadsheets'}. The data covers {base['from']} through {base['asOf']}, and the latest month loaded is {p_label(allp[-1]) if allp else 'n/a'}. "
                    f"{'Contribution margin is available.' if api else 'Variable cost and contribution margin are not included in this source.'}")

    # ---- counts ----
    if re.search(r'\bhow many\b', tl):
        c = base['counts']
        for key, word, noun in (('products', 'product', 'products'), ('customers', 'customer', 'customers'), ('billingDocuments', 'document', 'billing documents'),
                                ('batchesSold', 'batch', 'distinct batches sold'), ('ordersUsed', 'order', 'manufacturing orders behind the figures')):
            if word in tl:
                return text(f"{c[key]} {noun} in {range_label([r['period'] for r in base['periods']]) if base['periods'] else 'the current view'}.")

    # ---- parse the question ----
    pr = resolve_periods(tl, allp)
    prod = find_entity(tl, full['products'])
    cust = find_entity(tl, full['customers'])
    if prod and cust and prod['code'] == cust['code']:
        cust = None
    follow = bool(FOLLOWUP.match(tl)) or (len(tl.split()) <= 6 and bool(re.search(r'\b(it|that|this|there|them|those|same)\b', tl)))
    if follow and ctx:
        if not pr['periods'] and not pr['range'] and ctx.get('period') in allp:
            pr['periods'] = [ctx['period']]
        if not prod and not cust:
            if ctx.get('material'):
                prod = next((r for r in full['products'] if r['code'] == ctx['material']), None)
            elif ctx.get('customer'):
                cust = next((r for r in full['customers'] if r['code'] == ctx['customer']), None)
    label = range_label([r['period'] for r in base['periods']]) if base['periods'] else 'the current view'

    def done(res):
        if pr['assumed'] and res.get('kind') == 'rich':
            res['notes'] = (res.get('notes') or []) + pr['assumed']
        return res

    # ---- why did X change / what happened ----
    # (a follow-up like "and in August?" right after an explanation asks for the same explanation of that month)
    if (WHY.search(tl) or (follow and ctx.get('topic') == 'explain' and pr['periods'])) and not (prod or cust):
        focus = 'margin' if wants_cm(tl) else 'volume' if wants_volume(tl) else 'revenue' if (wants_revenue(tl) or wants_price(tl)) else ('margin' if ctx.get('topic') == 'explain' else 'revenue')
        cur = pr['periods'][0] if pr['periods'] else (ctx.get('period') if ctx.get('period') in allp else (allp[-1] if allp else None))
        if not cur:
            return text('There is no data loaded to explain yet.')
        idx = allp.index(cur)
        prev = pr['periods'][1] if len(pr['periods']) > 1 else (allp[idx - 1] if idx > 0 else None)
        if prev and pkey(prev) > pkey(cur):
            cur, prev = prev, cur
        if not prev:
            return text(f'{p_label(cur)} is the first month in the data, so there is no earlier month to compare it with.')
        return done(explain(data, cur, prev, focus, full, as_of))

    # ---- comparison between two periods ----
    if len(pr['periods']) >= 2 and re.search(r'\b(compar\w*|vs\.?|versus|against|difference|between|differ)\b', tl):
        p1, p2 = sorted(pr['periods'][:2], key=pkey, reverse=True)          # later month first
        return done(compare(data, p1, p2, full, as_of))

    # ---- trend / month by month / best-worst month ----
    if re.search(r'\b(trend|month[- ]by[- ]month|over time|by month|monthly|growth|growing|(best|worst|highest|lowest|strongest|weakest|peak) month|each month|history)\b', tl):
        return done(trend(data, pr['range'] or scope_codes(scope, allp), full, as_of, tl))

    # ---- top / bottom N ----
    if re.search(r'\b(top|highest|best|lowest|worst|bottom|rank|ranking|biggest|largest|smallest|leading)\b', tl) and re.search(r'\b(products?|customers?|skus?|clients?|buyers?|items?)\b', tl):
        rscope = {'period': pr['periods'][0]} if pr['periods'] else ({'from': pr['range'][0], 'to': pr['range'][-1]} if pr['range'] else dict(scope or {}))
        lab = p_label(pr['periods'][0]) if pr['periods'] else (range_label(pr['range']) if pr['range'] else label)
        return done(ranking(tl, lab, aggregate(data, rscope), full))

    # ---- a specific product or customer ----
    if prod or cust:
        ent, kind = (prod, 'product') if prod else (cust, 'customer')
        if pr['range']:
            sc, lab = {'from': pr['range'][0], 'to': pr['range'][-1]}, range_label(pr['range'])
        elif pr['periods']:
            sc, lab = scope, p_label(pr['periods'][0])
        else:
            sc, lab = scope, label
        return done(profile(data, ent, kind, sc, lab, full, as_of, pr['periods'][0] if pr['periods'] else None))

    # ---- a period (or range) ----
    if pr['periods']:
        return done(period_profile(data, pr['periods'][0], full, as_of))
    if pr['range']:
        return done(overview(data, full, aggregate(data, {'from': pr['range'][0], 'to': pr['range'][-1]}), range_label(pr['range']), as_of))

    # ---- overview / "how are we doing" ----
    if re.search(r'\b(overview|summary|summari[sz]e|how (are|is|am) (we|it|things|the business)|how.s (business|it going)|performance|state of|highlights|big picture|snapshot)\b', tl):
        return done(overview(data, full, base, label, as_of))

    # ---- plain metric questions over the current view ----
    if wants_price(tl) or wants_cm(tl) or wants_cogm(tl) or wants_volume(tl) or wants_revenue(tl):
        return done(metric_answer(tl, base, label, as_of))

    # ---- fallback: say what I can do, with real examples ----
    return rich("I didn't quite catch a figure or topic to look up. I can talk about a month, a product or customer, why something changed, rankings and trends.",
                followups=suggestions(full), ctx={'topic': 'fallback'})
