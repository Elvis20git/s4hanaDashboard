"""The one place that decides whether an item is a Finished Good ("B2B/B2C") or Other.
Finished Goods are every material whose code starts with "11". SAP may hand the code over zero-padded to 18 characters, so
leading zeros and whitespace are stripped before the prefix check."""
import re

_LEADING_ZEROS = re.compile(r'^0+')


def normalize_material(code):
    return _LEADING_ZEROS.sub('', str('' if code is None else code).strip())


def is_finished_good(code):
    return normalize_material(code).startswith('11')


def product_group(code):
    return 'B2B/B2C' if is_finished_good(code) else 'Other'


FG_TITLE = 'B2B/B2C — Finished Goods'
OTHER_TITLE = 'Other'
OTHER_CATEGORIES = [
    {'prefix': '13', 'key': 'byproducts', 'title': 'By-products'},
    {'prefix': '21', 'key': 'raw', 'title': 'Raw materials / Maize'},
    {'prefix': '61', 'key': 'nonstock', 'title': 'Non-stock sellables'},
]
OTHER_FALLBACK = {'key': 'misc', 'title': 'Other items & services'}


def all_other_categories():
    """Every category in display order (Other's categories, fallback last)."""
    return OTHER_CATEGORIES + [OTHER_FALLBACK]


def category_of(code):
    if is_finished_good(code):
        return {'group': 'fg', 'key': 'fg', 'title': FG_TITLE}
    n = normalize_material(code)
    c = next((c for c in OTHER_CATEGORIES if n.startswith(c['prefix'])), OTHER_FALLBACK)
    return {'group': 'other', 'key': c['key'], 'title': c['title']}
