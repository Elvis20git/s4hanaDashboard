// The one place that decides whether an item is a Finished Good ("B2B/B2C") or Other.
// Finished Goods are every material whose code starts with "11" (e.g. 11000033 WFP Infant 15kg). Everything
// else (13... by-products, 21... maize on cobs, 61... non-stock sellables, services) is Other. SAP may hand the
// code over zero-padded to 18 characters ("000000000011000033"), so leading zeros and whitespace are stripped
// before the prefix check.
export const normalizeMaterial = code => String(code ?? '').trim().replace(/^0+/, '');
export const isFinishedGood = code => normalizeMaterial(code).startsWith('11');
export const productGroup = code => (isFinishedGood(code) ? 'B2B/B2C' : 'Other');

// Level-2 categories inside "Other". SAP's product master may carry its own material group, but the line items
// don't, so the category is derived from the code prefix. One config, used everywhere.
export const FG_TITLE = 'B2B/B2C — Finished Goods';
export const OTHER_TITLE = 'Other';
export const OTHER_CATEGORIES = [
  { prefix: '13', key: 'byproducts', title: 'By-products' },
  { prefix: '21', key: 'raw', title: 'Raw materials / Maize' },
  { prefix: '61', key: 'nonstock', title: 'Non-stock sellables' },
];
export const OTHER_FALLBACK = { key: 'misc', title: 'Other items & services' };
/** Every category in display order (Other's categories, fallback last). */
export const allOtherCategories = () => [...OTHER_CATEGORIES, OTHER_FALLBACK];
/** { group: 'fg'|'other', key, title } for a material code. */
export function categoryOf(code) {
  if (isFinishedGood(code)) return { group: 'fg', key: 'fg', title: FG_TITLE };
  const n = normalizeMaterial(code);
  const c = OTHER_CATEGORIES.find(c => n.startsWith(c.prefix)) || OTHER_FALLBACK;
  return { group: 'other', key: c.key, title: c.title };
}
