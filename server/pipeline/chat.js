// A local, rule-based question-answering layer over the dashboard's own data.
// Deliberately NOT a generative LLM call: every number it states comes straight out of
// `aggregate()` — the exact same function every card, chart and table on the dashboard
// already uses — so an answer can never disagree with what's on screen, and there is no
// fabrication risk. No external API, no API key, works fully offline.
import { aggregate } from './aggregate.js';

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_FULL = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const fmtUSD = n => n == null ? 'N/A' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtPct = n => n == null ? 'N/A' : n.toFixed(2) + '%';
const fmtMT = n => n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' MT';
const mLabel = p => {
  const i = +p.slice(0, 2) - 1;
  return (MONTH_FULL[i] ? MONTH_FULL[i][0].toUpperCase() + MONTH_FULL[i].slice(1) : p.slice(0, 2)) + ' ' + p.slice(3);
};

function findPeriod(text, allPeriods) {
  const t = text.toLowerCase();
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`\\b(${MONTHS[i]}|${MONTH_FULL[i]})\\b`, 'i');
    if (re.test(t)) {
      const mm = String(i + 1).padStart(2, '0');
      const match = allPeriods.find(p => p.startsWith(mm + '.'));
      if (match) return match;
    }
  }
  return null;
}

function findAllPeriods(text, allPeriods) {
  const t = text.toLowerCase();
  const found = [];
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`\\b(${MONTHS[i]}|${MONTH_FULL[i]})\\b`, 'gi');
    if (re.test(t)) {
      const mm = String(i + 1).padStart(2, '0');
      const match = allPeriods.find(p => p.startsWith(mm + '.'));
      if (match) found.push(match);
    }
  }
  return found;
}

/** Fuzzy-find a product or customer by code or name fragment in the user's text. */
function findEntity(text, list) {
  const t = text.toLowerCase();
  // exact code mention (e.g. "11000033")
  const codeMatch = list.find(e => t.includes(e.code.toLowerCase()));
  if (codeMatch) return codeMatch;
  // exact full-name mention
  const nameExact = list.find(e => e.name && t.includes(e.name.toLowerCase()));
  if (nameExact) return nameExact;
  // best partial match: longest run of consecutive words from the entity's name that
  // also appear, in order, somewhere in the question text
  let best = null, bestScore = 0;
  for (const e of list) {
    if (!e.name) continue;
    const words = e.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    let score = 0;
    for (const w of words) if (t.includes(w)) score += w.length;
    if (score > bestScore && score >= 4) { bestScore = score; best = e; }
  }
  return best;
}

function findTopN(text) {
  // "top 5", "bottom 3", "lowest 10 products", "5 best", "3 lowest" — the number can
  // come before or after the ranking word, and the ranking word can be either direction.
  const m = /\b(?:top|bottom|lowest|highest|best|worst)\s*(\d+)\b/i.exec(text)
         || /\b(\d+)\s*(?:best|highest|top|lowest|worst|bottom)\b/i.exec(text);
  if (m) return Math.min(10, Math.max(1, parseInt(m[1], 10)));
  return 5;
}

// Word-boundary regexes trailed with `\w*` rather than a bare word, throughout — a plain
// `\bmargin\b` never matches "margins", and that silently drops the intent instead of
// erroring, which is a much easier bug to miss than one that crashes. Every pattern below
// was written, then exercised against its own plural before being trusted.
const wantsLowest = t => /\b(lowest|worst|least|bottom|smallest|weakest)\b/i.test(t);
const wantsCm = t => /\b(cm|margins?|contribution)\b/i.test(t);
const wantsCogm = t => /\b(cogm|vc|variable cost|cost of goods|costs?)\b/i.test(t);
const wantsRevenue = t => /\b(revenues?|sales|sold|turnover)\b/i.test(t);
const wantsVolume = t => /\b(volumes?|quantit(y|ies)|qty|tonnage|tonnes?|mt)\b/i.test(t);

function metricLine(label, v) {
  const parts = [`revenue ${fmtUSD(v.revenue)}`];
  if (v.qtyMt != null) parts.push(`volume ${fmtMT(v.qtyMt)}`);
  if (v.cogm != null) parts.push(`VC ${fmtUSD(v.cogm)}`);
  if (v.cm != null) parts.push(`CM ${fmtUSD(v.cm)} (${fmtPct(v.cmPct)})`);
  let line = `${label}: ${parts.join(', ')}.`;
  if (v.partial) line += ' Partial — not fully costed.';
  return line;
}

/**
 * Answer a question against the given dataset, honouring the same source/period
 * filter the rest of the dashboard currently has active.
 *   data     — the raw built dataset (api or spreadsheet source)
 *   scope    — { period, material, customer, from, to } — the dashboard's CURRENT filter
 *   message  — the user's question, raw text
 */
export function answer(data, scope, message) {
  const t = String(message || '').trim();
  const tl = t.toLowerCase();
  const base = aggregate(data, scope || {});
  const full = aggregate(data, {}); // unfiltered, for "overall"/"all time" questions

  if (!t) return { reply: "Ask me something about revenue, margin, or a specific product, customer or month.", kind: 'text' };

  // ---- greeting ----
  if (/^\s*(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b/.test(tl) && tl.length < 20) {
    return { reply: "Hi! Ask me about revenue, contribution margin, or a specific product, customer or month — try \"what's our margin in September\" or \"top 5 products by revenue\".", kind: 'text' };
  }

  // ---- help ----
  if (/\b(help|what can you (do|answer)|capabilities|how do (i|you) (use|work))\b/.test(tl)) {
    return {
      reply: "I can answer questions about the data currently loaded on the dashboard — I never invent a figure, everything comes straight from the same totals shown on screen. Try things like:",
      kind: 'suggestions',
      items: [
        'What was our revenue in September?',
        'What\'s the contribution margin for WFP Infant 15kg?',
        'Top 5 customers by revenue',
        'Which product has the lowest margin?',
        'Compare June and September revenue',
        'Are there any closure breaches?',
      ],
    };
  }

  // ---- closure / breach / validation status ----
  if (/\b(breach|closure|control|reconcil|validation)\b/.test(tl)) {
    const c = data.controls;
    if (!c) return { reply: "The spreadsheet source carries no cost chain, so there are no closure controls to report — switch to Live APIs for validation.", kind: 'text' };
    const breaches = c.batchClosure.breaches.length + c.orderClosure.breaches.length + c.quantityControl.breaches.length;
    if (breaches === 0) return { reply: `No closure breaches. ${c.batchClosure.total} batches and ${c.orderClosure.total} orders all close exactly, and reconciliation ${c.reconciliation.pass ? 'ties to the regression table' : 'does NOT currently tie — check Validation'}.`, kind: 'text' };
    const names = [
      c.batchClosure.breaches.length ? `${c.batchClosure.breaches.length} batch closure` : null,
      c.orderClosure.breaches.length ? `${c.orderClosure.breaches.length} order closure` : null,
      c.quantityControl.breaches.length ? `${c.quantityControl.breaches.length} quantity` : null,
    ].filter(Boolean).join(' and ');
    return { reply: `Yes — ${names} breach(es) currently. See the Validation page for which batch/order and the exact ratio.`, kind: 'text' };
  }

  // ---- source / connection status ----
  if (/\b(which source|what source|connected|connection|last refresh|data as of|data through)\b/.test(tl)) {
    return { reply: `Source: ${data.source === 'api' ? 'Live S/4HANA' : 'Local spreadsheets'}. Data covers ${base.from} through ${base.asOf}. ${data.source === 'api' ? 'Contribution margin is available.' : 'VC and contribution margin are not included in this source.'}`, kind: 'text' };
  }

  // ---- counts ----
  if (/\bhow many\b/.test(tl)) {
    if (/product/.test(tl)) return { reply: `${base.counts.products} products in the current view.`, kind: 'text' };
    if (/customer/.test(tl)) return { reply: `${base.counts.customers} customers in the current view.`, kind: 'text' };
    if (/document/.test(tl)) return { reply: `${base.counts.billingDocuments} billing documents in the current view.`, kind: 'text' };
    if (/batch/.test(tl)) return { reply: `${base.counts.batchesSold} distinct batches sold in the current view.`, kind: 'text' };
    if (/order/.test(tl)) return { reply: `${base.counts.ordersUsed} manufacturing orders behind the current view.`, kind: 'text' };
  }

  // ---- comparison between two periods ----
  const periodsMentioned = findAllPeriods(t, full.allPeriods);
  if (periodsMentioned.length >= 2 && /\b(compar\w*|vs\.?|versus|against|difference|between)\b/.test(tl)) {
    const [p1, p2] = periodsMentioned;
    const a = full.periods.find(p => p.period === p1), b = full.periods.find(p => p.period === p2);
    if (a && b) {
      const diff = a.revenue - b.revenue;
      const pct = b.revenue ? (diff / b.revenue * 100) : null;
      return {
        reply: `${mLabel(p1)}: ${fmtUSD(a.revenue)} revenue${a.cm != null ? `, CM ${fmtUSD(a.cm)} (${fmtPct(a.cmPct)})` : ''}. `
          + `${mLabel(p2)}: ${fmtUSD(b.revenue)} revenue${b.cm != null ? `, CM ${fmtUSD(b.cm)} (${fmtPct(b.cmPct)})` : ''}. `
          + `${mLabel(p1)} is ${diff >= 0 ? 'up' : 'down'} ${fmtUSD(Math.abs(diff))}${pct != null ? ` (${Math.abs(pct).toFixed(1)}%)` : ''} versus ${mLabel(p2)}.`,
        kind: 'text',
      };
    }
  }

  // ---- top / bottom N product or customer ----
  if (/\b(top|highest|best|lowest|worst|bottom|rank|ranking)\b/.test(tl) && /\b(products?|customers?|skus?)\b/.test(tl)) {
    const n = findTopN(tl);
    const isCustomer = /\bcustomers?\b/.test(tl);
    const byCm = wantsCm(tl);
    let list = (isCustomer ? base.customers : base.products).slice();
    let excludedNotCosted = 0;
    if (byCm) {
      // Ranking BY margin only makes sense over entries that actually have a margin —
      // a not-costed entry isn't "the worst margin", it's simply unmeasured, and mixing
      // the two would misreport "lowest margin" as whichever product has no cost data.
      const before = list.length;
      list = list.filter(r => r.cmPct != null);
      excludedNotCosted = before - list.length;
    }
    list.sort((a, b) => byCm ? b.cmPct - a.cmPct : b.revenue - a.revenue);
    const rows = (wantsLowest(tl) ? list.slice().reverse() : list).slice(0, n);
    if (!rows.length) return { reply: `None of the ${isCustomer ? 'customers' : 'products'} in the current view have a measurable ${byCm ? 'contribution margin' : 'revenue'} to rank.`, kind: 'text' };
    let reply = `${wantsLowest(tl) ? 'Lowest' : 'Top'} ${rows.length} ${isCustomer ? 'customers' : 'products'} by ${byCm ? 'contribution margin %' : 'revenue'}${base.filters.period ? ` in ${mLabel(base.filters.period)}` : ''}:`;
    if (excludedNotCosted) reply += ` (${excludedNotCosted} not-costed ${isCustomer ? 'customer' : 'product'}${excludedNotCosted !== 1 ? 's' : ''} excluded from this ranking)`;
    return {
      reply,
      kind: 'list',
      items: rows.map((r, i) => ({
        rank: i + 1, label: r.name || r.code, code: r.code,
        value: byCm ? fmtPct(r.cmPct) : fmtUSD(r.revenue),
        sub: byCm ? fmtUSD(r.revenue) + ' revenue' : (r.cmPct != null ? `CM ${fmtPct(r.cmPct)}` : 'CM N/A'),
      })),
    };
  }

  // ---- a specific product or customer mentioned ----
  const prod = findEntity(t, full.products);
  const cust = findEntity(t, full.customers);
  const period = findPeriod(t, full.allPeriods);
  if (prod || cust) {
    const scopeQ = { ...(scope || {}) };
    if (prod) scopeQ.material = prod.code;
    if (cust) scopeQ.customer = cust.code;
    if (period) scopeQ.period = period;
    const filtered = aggregate(data, scopeQ);
    const label = [prod?.name, cust?.name].filter(Boolean).join(' / ') + (period ? ` in ${mLabel(period)}` : '');
    if (filtered.total.lines === 0) return { reply: `No activity found for ${label} in the current view.`, kind: 'text' };
    return { reply: metricLine(label, filtered.total), kind: 'text' };
  }

  // ---- a period mentioned, no entity ----
  if (period) {
    const row = full.periods.find(p => p.period === period);
    if (!row) return { reply: `No data for ${mLabel(period)} in the current view.`, kind: 'text' };
    return { reply: metricLine(mLabel(period), row), kind: 'text' };
  }

  // ---- plain metric questions over the current scope ----
  if (wantsCm(tl) && !wantsRevenue(tl)) {
    const v = base.total;
    return { reply: v.cm == null ? "Contribution margin isn't available for this source." : `Contribution margin is ${fmtUSD(v.cm)}, ${fmtPct(v.cmPct)} of costed revenue${v.partial ? ' (partial — some revenue is not costed)' : ''}.`, kind: 'text' };
  }
  if (wantsCogm(tl)) {
    const v = base.total;
    return { reply: v.cogm == null ? "VC isn't available for this source." : `VC is ${fmtUSD(v.cogm)}.`, kind: 'text' };
  }
  if (wantsVolume(tl) && !wantsRevenue(tl)) {
    return { reply: base.total.qtyMt == null ? 'No convertible volume in the current view.' : `Volume is ${fmtMT(base.total.qtyMt)}.`, kind: 'text' };
  }
  if (wantsRevenue(tl)) {
    return { reply: `Revenue is ${fmtUSD(base.total.revenue)} over ${base.total.lines} lines${base.filters.period ? ` in ${mLabel(base.filters.period)}` : ''}.`, kind: 'text' };
  }

  // ---- fallback ----
  return {
    reply: "I didn't catch a specific figure to look up. I can answer questions about revenue, contribution margin, VC, a named product or customer, a month, or a comparison between two months. Try asking \"help\" for examples.",
    kind: 'text',
  };
}
