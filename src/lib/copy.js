/* Central labels, definitions and tooltip/popover copy — ported verbatim from the source dashboard (public/app.js).
   One place for every user-facing string that explains the cost terminology, the status dots and the ⓘ popovers. */

/* Central labels and copy for the cost terminology. SAP G/L 94301000 posts two sources: Z2 = "Utilities" (counts toward VC)
   and Z1 = "Overheads" (excluded). "Overheads" is only ever named in tooltips and disclaimers, never as a line or value. */
export const TERMS = { utilities: 'Utilities', utilitiesSource: '10101303/Z2', overheadsSource: '10101303/Z1' };
export const VC_DEF = 'VC = Direct Materials (variable costs) + Utilities (10101303/Z2). Overheads (Z1) excluded.';
export const MARGIN_DISCLAIMER = 'Contribution Margin is calculated using variable costs (Direct Materials) plus Utilities (10101303/Z2) only. '
  + 'Overheads (10101303/Z1) are part of SAP product costing and actual product cost, but are not included here. '
  + 'The Overheads allocation logic is owned by Finance; please contact Finance for details.';
export const UTILITIES_TIP = 'Utilities (10101303/Z2), allocated from G/L 94301000 – AIF Overhead Costs. Included in VC together with Direct Materials, and therefore in Contribution Margin.\n'
  + 'Overheads (10101303/Z1) from the same G/L are excluded from these calculations; their allocation logic is owned by Finance.';
/* Status-dot copy (central). Orange = zero-cost assumption (plus any other cost notes); red = closure control breaches. */
export const STATUS_COPY = {
  zero: {
    title: 'Zero-cost assumption',
    intro: (m, scope) => `${m} of revenue (${scope}) has no manufacturing order, so its variable cost is set to $0 by assumption rather than measured.`,
    fg: m => `• B2B/B2C (Finished Goods): ${m} — included in Contribution Margin, which may be overstated by up to this amount.`,
    noFg: 'No Finished Goods are affected; B2B/B2C Contribution Margin is not impacted.',
    oth: m => `• Others: ${m} — mostly by-products. Shown in Sales by product with VC $0; not part of B2B/B2C CM.`,
    link: 'View affected products',
  },
  notesTitle: 'Cost notes',
  spreadsheet: reason => `Spreadsheet source. ${reason} Sales figures below are complete; contribution margin is not reported from this source.`,
  partial: (costed, total, none) => `Margin covers part of the selected sales. Contribution margin is calculated on ${costed} of ${total}; ${none} carries no manufacturing order and shows N/A. The margin shown is therefore partial, not a complete contribution margin.`,
  provisional: (months, many, m) => `${months} ${many ? 'carry' : 'carries'} provisional cost. VC on a still-open period may still change until period close. ${m} of revenue in the current view is marked provisional on that basis.`,
  closure: {
    title: 'Closure control breaches',
    head: (n, scope, b, o, q) => `${n} ${n === 1 ? 'breach' : 'breaches'} found for ${scope}: ${b} batch · ${o} order · ${q} quantity.`,
    lines: ["• Batch closure — the VC charged to a batch's sales must not exceed the batch's cost.",
            "• Order closure — each manufacturing order's cost must be fully distributed to the batches it fed.",
            "• Quantity — the quantity sold from a batch must not exceed what it produced."],
    foot: 'Figures are shown as returned by SAP and are not adjusted for these breaches.',
    outside: (n, B, O, Q) => `${n} more ${n === 1 ? 'breach lies' : 'breaches lie'} outside this period; the Validation page counts the whole dataset: ${B} batch · ${O} order · ${Q} quantity.`,
    link: 'Open Validation',
  },
  errorTitle: 'Data unavailable', noticeTitle: 'Notice',
  validationScope: (first, last) => `Counts on this page cover the whole dataset (${first} – ${last}). The status dot on the dashboard counts only the breaches in the selected period.`,
};

/** A user may follow the links to Data Management › Validation only if they can use Data Management at all (hold one of
    its rights, or every right). Everyone else never sees the links. */
export const DATA_MGMT_RIGHTS = ['changeSource', 'importData', 'manageApiConfig', 'adminRefresh'];
export function canOpenDataManagement(status) {
  const u = status && status.user;
  return !!u && (u.rights.includes('*') || DATA_MGMT_RIGHTS.some(r => u.rights.includes(r)));
}

export const HELP = {
  periodCard: {
    title: 'Sales by period',
    body: 'Columns show total revenue. Contribution margin, quantities and hover details are for Finished Goods (B2B/B2C) only and exclude Others. ' + VC_DEF,
  },
  productsCard: {
    title: 'Sales by product',
    body: 'All products, grouped into Finished Goods (B2B/B2C) and Others. Subtotals per group; Total = all products. CM = Value − VC.' + ' ' + VC_DEF,
  },
  mbmCard: {
    title: 'Month-by-month comparison',
    body: 'Per month: Finished Goods (B2B/B2C) revenue, Other revenue, and month-over-month change in B2B/B2C revenue. Bars show B2B/B2C revenue.',
  },
  marginCard: {
    title: 'Margin — contribution-YTD',
    body: 'Finished Goods (B2B/B2C) only, Jan–Sep and latest month. CM = Revenue − VC (variable cost); CM % = CM ÷ Revenue. Excludes Others.',
    disclaimer: MARGIN_DISCLAIMER,
  },
  marginPct: {
    title: 'Contribution margin %',
    body: 'CM % = B2B/B2C CM ÷ B2B/B2C revenue.',
  },
  donutCard: {
    title: 'Revenue contribution by product-YTD',
    body: 'Share of total net revenue by product, grouped into Finished Goods (B2B/B2C) and Others. Hover a product for its revenue and, for Finished Goods, its CM and CM %. CM is not reported for Others.',
  },
  cmPct: {
    title: 'Contribution margin %',
    body: 'The share of net sales left after the variable cost (VC) is covered.' + ' ' + VC_DEF,
    formula: 'CM% = Contribution margin ÷ Net sales',
    tip: 'Compare within the same product line or customer — margin profile varies a lot across them.'
  },
  materials: {
    title: 'Materials',
    body: 'The raw-material components consumed by this order — each one’s own quantity and actual cost.'
  },
  activities: {
    title: 'Activities',
    body: 'The labour and machine cost confirmed on this order. Shown as one combined figure — SAP exposes its actual cost and a quantity basis here, but not a breakdown by activity type or work centre.'
  },
  overhead: {
    title: TERMS.utilities,
    body: UTILITIES_TIP,
  }
};
