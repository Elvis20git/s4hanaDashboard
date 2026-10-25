"""Local spreadsheet source — sales reporting only.
COGM and CM are NOT in these extracts, so every line reports "Unavailable — COGM data not included". Never mixed with the API dataset."""
import re
from datetime import date, datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

from ..jsutil import js_str, round2

KG_PER_MT = 1000


def _ymd(d):
    """Excel dates come back as naive datetimes in local-midnight terms: use their own calendar parts, never a UTC conversion."""
    if isinstance(d, (datetime, date)):
        return f'{d.year:04d}-{d.month:02d}-{d.day:02d}'
    s = str(d).strip()
    try:
        x = datetime.fromisoformat(s.replace('Z', '+00:00'))
        return x.astimezone(timezone.utc).strftime('%Y-%m-%d') if x.tzinfo else f'{x.year:04d}-{x.month:02d}-{x.day:02d}'
    except ValueError:
        return s[:10]


_CODED = re.compile(r'^(\S+)\s*\((.*)\)$', re.S)


def split_coded(v):
    """"11000033 (WFP Infant 15kg)" -> { code: '11000033', name: 'WFP Infant 15kg' }"""
    s = ('' if v is None else js_str(v)).strip()
    m = _CODED.match(s)
    return {'code': m.group(1), 'name': m.group(2)} if m else {'code': s, 'name': s}


def _sheet_rows(path):
    wb = load_workbook(path, data_only=True)
    return wb[wb.sheetnames[0]]


def parse_line_items(path):
    """Universal Journal "Display Line Items" export — the revenue control."""
    ws = _sheet_rows(path)
    it = ws.iter_rows(values_only=True)
    header = next(it, None) or ()
    keys = []
    for h in header:
        k = '' if h is None else str(h)
        while k in keys and k != '':
            k += '_1'
        keys.append(k)
    lines = []
    for row in it:
        if all(c is None or c == '' for c in row):
            continue
        r = {keys[i]: row[i] for i in range(min(len(keys), len(row))) if keys[i] != ''}
        dt = r.get('Posting Date')
        if not dt:
            continue
        d = _ymd(dt)
        prod, cust, led = split_coded(r.get('Product Sold')), split_coded(r.get('Customer')), split_coded(r.get('Ledger'))
        amt = r.get('Amount in Global Currency')
        lines.append({
            'billingDocument': '' if r.get('Reference Document') is None else js_str(r.get('Reference Document')),
            'billingItem': None,
            'billingDate': d, 'postingDate': d,
            'period': d[5:7] + '.' + d[0:4],
            'ledger': led['code'],
            'material': prod['code'], 'materialName': prod['name'],
            'customer': cust['code'], 'customerName': cust['name'],
            'glAccount': split_coded(r.get('G/L Account'))['code'],
            'batch': None, 'qtyKg': None, 'qtyMt': None, 'baseUnit': None,
            'revenueUsd': round2(-float(0 if amt is None or amt == '' else amt)),
            'cogmUsd': None, 'cmUsd': None, 'cmPct': None,
            'costStatus': 'not-costed',
            'costReason': 'Unavailable — VC data not included in the spreadsheet source',
            'orders': [],
        })
    return lines


def parse_sales_volume(path):
    """"Sales Volume Flexible Analysis" BW crosstab — supplies quantity (KG)."""
    ws = _sheet_rows(path)
    grid = [list(r) for r in ws.iter_rows(values_only=True)]
    meas_row = next((i for i, r in enumerate(grid) if 'Measures' in (r or [])), -1)
    if meas_row < 0:
        raise ValueError('Sales Volume: "Measures" header row not found')
    meas = grid[meas_row]
    while meas and meas[-1] is None:        # a JS row array ends at its last non-empty cell
        meas = meas[:-1]
    mon = grid[meas_row + 1]
    data_start = next((i for i, r in enumerate(grid) if i > meas_row and r and r[0] and re.match(r'^\d{6,}$', js_str(r[0]))), None)
    out, index = [], {}
    for i in range(data_start, len(grid)):
        r = grid[i]
        if not r or not r[0]:
            continue
        code, name = js_str(r[0]), js_str(r[1] if len(r) > 1 and r[1] is not None else code)
        bd = _ymd(r[2]) if len(r) > 2 and isinstance(r[2], (datetime, date)) else None
        for j in range(3, len(meas)):
            v = r[j] if j < len(r) else None
            if v is None or v == '':
                continue
            period = js_str(mon[j]) if j < len(mon) and mon[j] is not None else 'undefined'
            k = (code, period, bd)
            rec = index.get(k)
            if rec is None:
                rec = index[k] = {'material': code, 'materialName': name, 'period': period, 'billingDate': bd, 'netValue': 0, 'qtyKg': 0}
                out.append(rec)
            if meas[j] == 'Net Value':
                rec['netValue'] += float(v)
            elif meas[j] == 'Sales Volume Qty':
                rec['qtyKg'] += float(v)
    return out


def build_from_files(line_items_path=None, sales_volume_path=None):
    """Build the spreadsheet-source dataset from whatever files are loaded."""
    loaded, lines = [], []
    if line_items_path and Path(line_items_path).exists():
        lines = parse_line_items(line_items_path)
        loaded.append({'file': Path(line_items_path).name, 'kind': 'Universal Journal Line Items', 'rows': len(lines)})
    vol = []
    if sales_volume_path and Path(sales_volume_path).exists():
        vol = parse_sales_volume(sales_volume_path)
        loaded.append({'file': Path(sales_volume_path).name, 'kind': 'SD Sales Volume (BW crosstab)', 'rows': len(vol)})
    # Quantity comes from the volume extract, apportioned to the journal lines of the same material and period by revenue share.
    # Flagged as derived — it is not line-level source.
    vol_by = {}
    for v in vol:
        k = v['material'] + '|' + v['period']
        e = vol_by.setdefault(k, {'qtyKg': 0, 'netValue': 0})
        e['qtyKg'] += v['qtyKg']
        e['netValue'] += v['netValue']
    rev_by = {}
    for l in lines:
        k = l['material'] + '|' + l['period']
        rev_by[k] = rev_by.get(k, 0) + l['revenueUsd']
    for l in lines:
        k = l['material'] + '|' + l['period']
        v, tot = vol_by.get(k), rev_by.get(k)
        if v and tot:
            l['qtyKg'] = round2(v['qtyKg'] * (l['revenueUsd'] / tot))
            l['qtyMt'] = round2(l['qtyKg'] / KG_PER_MT)
            l['qtyDerived'] = True
    periods = list(dict.fromkeys(l['period'] for l in lines))
    as_of = ''
    frm = ''
    for l in lines:
        if l['postingDate'] > as_of:
            as_of = l['postingDate']
        if not frm or l['postingDate'] < frm:
            frm = l['postingDate']
    return {
        'source': 'spreadsheet',
        'builtAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{datetime.now(timezone.utc).microsecond // 1000:03d}Z',
        'asOf': as_of,
        'from': frm,
        'lines': lines,
        'loaded': loaded,
        'periods': periods,
        'counts': {
            'billingDocuments': len(set(l['billingDocument'] for l in lines)),
            'lines': len(lines),
            'products': len(set(l['material'] for l in lines)),
            'customers': len(set(l['customer'] for l in lines)),
            'batchesSold': 0, 'ordersUsed': 0, 'billingItems': len(lines),
        },
        'cogmAvailable': False,
    }
