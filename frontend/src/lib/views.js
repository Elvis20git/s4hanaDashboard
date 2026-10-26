/* Extracted once from the original plain-JS dashboard (public/app.js, no longer in this repository); maintained by hand since.
   Pure view builders: each takes the state object S (same shape as the source's) and returns, per element id, the text /
   markup / attributes the source wrote there. No DOM access. The React components in src/components render this output. */
import { MOF, PAL, fmtUSD, fmtK, fmtBMK, fmtMT, fmtPct, mLabel, pkey, esc, qtyFmt, monAbbr, yr2, fmtAvgMt, formatMoneyCompact, fmtKg } from './format.js';
import { HELP, TERMS, STATUS_COPY, VC_DEF, canOpenDataManagement } from './copy.js';
import { presetsFor, activePresetKey, scopeLabel as scopeLabelPure, fgOf, fgView, fgAvgMt, productPalette, isFinishedGood } from './derive.js';
import { NUM_FMT } from './anim.js';

/** Collapse state for the grouped cards (per viewer, local). Keys: 'prod:fg', 'prod:other', 'cust:fg', 'cust:other', 'leg:...' */
export const collapsed = new Set();

/** Records what the source would have written to each element id. */
function makeSink(seed = {}) {
  const out = {};
  const $ = id => (out[id] ??= Object.assign({
    id, innerHTML: '', textContent: '', className: '', title: '', style: {}, dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {} },
  }, seed[id] || {}));
  return { $, out };
}

// ---- helpers (verbatim) ----
export const naCell = reason => `<span class="badge mid" title="${esc(reason || 'Not costed')}">N/A</span>`;
export const cmNaBadge = (reason = 'Not costed — no manufacturing order resolves for this line') => `<span class="badge mid" title="${esc(reason)}">CM N/A</span>`;
export function estimateTag(title = 'Derived, not a source field.') {
  return helpIconDynamic('Estimated contribution margin', title, { cls: 'est-tag' });
}
export function helpIcon(key, { cls = 'help-ico', label = '?' } = {}) {
  const h = HELP[key];
  return `<button type="button" class="${cls}" data-help="${key}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(h ? h.title : key)} — more info">${esc(label)}</button>`;
}
export function helpIconDynamic(title, body, { cls = 'help-ico', label = '?' } = {}) {
  return `<button type="button" class="${cls}" data-help-title="${esc(title)}" data-help-body="${esc(body)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(title)} — more info">${esc(label)}</button>`;
}
export const cn = (v, f) => v == null || !Number.isFinite(v) ? NUM_FMT[f](v) : `<span class="cn" data-v="${v}" data-f="${f}">${NUM_FMT[f](v)}</span>`;
export const RANKED_VISIBLE_ROWS = 10;
export function cmDetail(p, prefix = '', { naReason } = {}) {
  if (p.cm == null) return cmNaBadge(naReason);
  // Assumed-$0 rows carry the cm-badge AND the est-tag "?" in the same
  // narrow cell — shrink the badge a touch so the "?" never gets clipped.
  let html = `<span class="cm-badge ${p.cmPct >= 0 ? 'pos' : 'neg'}${p.hasAssumedZero ? ' compact' : ''}">${prefix}${fmtPct(p.cmPct)}</span>`;
  if (p.hasAssumedZero) html += ' ' + estimateTag(`${fmtUSD(p.revenueAssumedZero)} of this figure is costed at an assumed $0 — no manufacturing order exists for these lines, not a resolved cost.`);
  return html;
}
export function monthCell(m, fmt, loading) {
  return `<td class="num${loading ? ' muted' : ''}">${m == null ? '—' : fmt(m)}</td>`;
}
const chev = open => `<span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span>`;
const grpBtn = (key, title, count) => `<button type="button" class="grp-btn" data-k="${key}" aria-expanded="${!collapsed.has(key)}" title="${esc(title)}">${chev(!collapsed.has(key))}<span class="gt">${esc(title)}</span><span class="cnt">${count}</span></button>`;
export function marginBarsHtml(t, last, lastMo) {
  const jSpan = v => v == null ? '' : `<span class="j">${lastMo} ${v}</span>`;
  const cmColor = t.cm >= 0 ? 'var(--color-mint)' : 'var(--color-clay)';
  const cmText = t.cm >= 0 ? 'var(--color-green-d)' : 'var(--color-clay)';
  const steps = [
    { label: 'Revenue', value: t.revenue, subValue: last?.revenue, color: 'var(--color-green)', textColor: 'var(--color-green-d)' },
    { label: '– VC', value: -t.cogm, subValue: last?.cogm != null ? -last.cogm : null, color: '#C0CEC7', textColor: null },
  ];
  const mx = Math.max(t.revenue, 1);
  const w = v => Math.min(100, Math.max(0, Math.abs(v) / mx * 100));
  const row = (s, i) => `<div class="wfrow${s.tot ? ' tot' : ''}"><div class="wl">${s.label}</div>`
    + `<div class="wt"><div class="wf-fill" data-w="${Math.max(2, w(s.value))}" style="width:${Math.max(2, w(s.value))}%;background:${s.color}"></div></div>`
    + `<div class="wv"${s.textColor ? ` style="color:${s.textColor}"` : ''}>${cn(s.value, 'k')}${jSpan(s.subValue != null ? fmtK(s.subValue) : null)}</div></div>`;
  return steps.map(row).join('')
    + `<div class="wf-div"></div>`
    + row({ label: '= CM', value: t.cm, subValue: last?.cm, color: cmColor, textColor: cmText, tot: true }, 2);
}
function section(title, inner, id) {
  return `<div class="level"${id ? ` id="${id}"` : ''}><span class="n">·</span><span class="t">${title}</span><span class="ln"></span></div><div class="cbox" style="margin-bottom:16px;padding:4px 6px">${inner}</div>`;
}
function linkSentences(link, { kind, focus }) {
  const { pairs, batches, orders } = link;
  const out = [];
  if (batches.length <= 1 && orders.length <= 1) {
    const p = pairs[0];
    if (p) out.push(`Order ${esc(p.order)} produced all of batch ${esc(p.batch)} (${fmtKg(p.qty)}).`);
  } else if (batches.length === 1) {
    const b = batches[0];
    const mine = pairs.filter(p => p.batch === b.batch).sort((x, y) => y.qty - x.qty);
    out.push(`Batch ${esc(b.batch)} (${fmtKg(b.qty)}) came from ${orders.length} orders: `
      + mine.map(p => `${esc(p.order)} made ${fmtKg(p.qty)} (${fmtPct(p.pctOfBatch)})`).join(', ') + '.');
    if (kind === 'order') {
      const my = mine.find(p => p.order === focus), others = mine.filter(p => p.order !== focus);
      if (my && others.length) {
        const othersQty = others.reduce((s, p) => s + p.qty, 0), othersPct = others.reduce((s, p) => s + p.pctOfBatch, 0);
        out.push(`This order made ${fmtKg(my.qty)} of batch ${esc(b.batch)} (${fmtPct(my.pctOfBatch)}). `
          + `The other ${fmtKg(othersQty)} (${fmtPct(othersPct)}) came from ${others.map(p => 'order ' + esc(p.order)).join(' and ')}.`);
      }
    }
  } else if (orders.length === 1) {
    const o = orders[0];
    const mine = pairs.filter(p => p.order === o.order).sort((x, y) => y.qty - x.qty);
    out.push(`Order ${esc(o.order)} (${fmtKg(o.qty)}) went into ${batches.length} batches: `
      + mine.map(p => `${esc(p.batch)} got ${fmtKg(p.qty)} (${fmtPct(p.pctOfOrder)})`).join(', ') + '.');
  } else {
    for (const p of pairs.slice().sort((x, y) => y.qty - x.qty))
      out.push(`Order ${esc(p.order)} made ${fmtKg(p.qty)} of batch ${esc(p.batch)} `
        + `(${fmtPct(p.pctOfBatch)} of the batch, ${fmtPct(p.pctOfOrder)} of the order).`);
  }
  return out;
}

/** Orders-left / batches-right flow diagram, lines sized by quantity, the
    current order/batch and its own lines highlighted — only drawn for the
    "several <-> several" case, where a table of sentences stops being easy
    to scan. */
function linkDiagram(link, focusOrder, focusBatch) {
  const { orders, batches, pairs } = link;
  const rowH = 24, pad = 14;
  const H = Math.max(orders.length, batches.length) * rowH + pad * 2;
  const oY = i => pad + rowH * i + rowH / 2, bY = i => pad + rowH * i + rowH / 2;
  const oIdx = new Map(orders.map((o, i) => [o.order, i])), bIdx = new Map(batches.map((b, i) => [b.batch, i]));
  const maxQty = Math.max(...pairs.map(p => p.qty), 1);
  const lines = pairs.map(p => {
    const hot = p.order === focusOrder || p.batch === focusBatch;
    return `<line x1="92" y1="${oY(oIdx.get(p.order))}" x2="208" y2="${bY(bIdx.get(p.batch))}" `
      + `stroke="${hot ? 'var(--color-green)' : '#D7E2DC'}" stroke-width="${Math.max(1, p.qty / maxQty * 5)}" opacity="${hot ? 1 : .6}"/>`;
  }).join('');
  const oLbl = orders.map((o, i) => `<text x="88" y="${oY(i) + 4}" text-anchor="end" class="lf-lbl${o.order === focusOrder ? ' hot' : ''}">${esc(o.order)}</text>`).join('');
  const bLbl = batches.map((b, i) => `<text x="212" y="${bY(i) + 4}" text-anchor="start" class="lf-lbl${b.batch === focusBatch ? ' hot' : ''}">${esc(b.batch)}</text>`).join('');
  return `<svg class="linkflow" viewBox="0 0 300 ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:${Math.min(H, 220)}px">${lines}${oLbl}${bLbl}</svg>`;
}

/** The whole "Produced by" / "Produced into" panel — sentences, the cost-
    share line, and (only when genuinely several<->several) the diagram. */
export function linkPanelHtml(link, { kind, focus, title }) {
  if (!link || !link.pairs?.length) return '';
  const sentences = linkSentences(link, { kind, focus });
  const complex = link.orders.length > 1 && link.batches.length > 1;
  const costLines = link.pairs
    .filter(p => (kind === 'batch' ? p.batch === focus : p.order === focus) && p.costSharePct != null && link.pairs.length > 1)
    .map(p => `${fmtPct(p.costSharePct)} of ${kind === 'batch' ? 'this batch' : `batch ${esc(p.batch)}`}'s cost comes from order ${esc(p.order)}.`);
  return `<div class="insight"><b>${esc(title)}</b><br>`
    + sentences.map(s => `<div style="margin-top:6px">${s}</div>`).join('')
    + costLines.map(s => `<div style="margin-top:6px;color:var(--color-tx-2)">${s}</div>`).join('')
    + (complex ? linkDiagram(link, kind === 'order' ? focus : null, kind === 'batch' ? focus : null) : '')
    + `</div>`;
}

/** Ported from the source's render function (renderHero, minus the sparkline call). Returns what it wrote to each element id. */
export function buildHero(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
function heroBreakdown(idBase, groups, fmt) {
  const line = (cls, label, g) => `<span class="dot ${cls}"></span><span class="bl">${label}</span><span class="bv num">${fmt(g)}</span>`;
  $(idBase + '1').innerHTML = groups ? line('fg', 'B2B/B2C', groups.fg) : '';
  $(idBase + '2').innerHTML = groups ? line('oth', 'Other', groups.other) : '';
}
  const d = S.data; if (!d) return out;
  const t = d.total, ps = d.periods;
  const last = ps.at(-1), prev = ps.at(-2);
  $('hEyebrow').textContent = 'Net sales · ' + scopeLabel();
  // Day-precision range text ("1 Jan – 30 Sep 2026"), matching the production
  // Hero's date format. The end date is the actual billing cutoff (d.asOf)
  // only when the selected "to" is the latest period the system has at all
  // — otherwise an older "to" gets its own calendar month-end, since there's
  // no partial-month ambiguity for a month that's fully in the past. Picking
  // this apart from a flat "always use d.asOf" was necessary once the range
  // became freely selectable rather than gated behind a YTD/Range toggle.
  const toIsLatest = S.to === d.allPeriods.at(-1);
  const fy = +S.from.slice(3), ty = +S.to.slice(3);
  const fromTxt = `1 ${MOF[+S.from.slice(0, 2) - 1]}`;
  const toTxt = toIsLatest
    ? (() => { const [y, m, dd] = d.asOf.split('-').map(Number); return `${dd} ${MOF[m - 1]} ${y}`; })()
    : `${new Date(ty, +S.to.slice(0, 2), 0).getDate()} ${MOF[+S.to.slice(0, 2) - 1]} ${ty}`;
  const scopeDates = fy === ty ? `${fromTxt} – ${toTxt}` : `${fromTxt} ${fy} – ${toTxt}`;
  $('hScope').textContent = scopeDates;
  $('hBig').textContent = fmtK(t.revenue);
  // The newest period may be a part month. Comparing 16 days against a full month
  // reads as a collapse, so the delta says so instead of implying one.
  const partMonth = last && d.asOf.slice(0, 7) === `${last.period.slice(3)}-${last.period.slice(0, 2)}`
    && Number(d.asOf.slice(8, 10)) < 28;
  if (partMonth) $('hScope').innerHTML = `${scopeDates} <span class="partial">· ${mLabel(last.period)} part month</span>`;
  // Month only, not month+year — "SEP PERIOD", not "SEP 2026 PERIOD". The
  // tile shows only the value now; the delta moved under the headline below.
  $('hLatestL').textContent = last ? MOF[+last.period.slice(0, 2) - 1] + (partMonth ? ' (part month)' : ' period') : 'Latest period';
  $('hLatest').textContent = last ? fmtK(last.revenue) : '–';
  heroBreakdown('hLatestB', last && last.groups, g => fmtK(g.revenue));
  // Per explicit instruction: MoM back under the big number, same line as
  // the date range — "[▲ +67.4% MoM]  1 Jan – 30 Sep 2026" — with the sign
  // always shown explicitly on a positive change.
  if (last && prev && prev.revenue) {
    const chg = (last.revenue - prev.revenue) / prev.revenue * 100;
    $('hDelta').className = 'delta ' + (chg >= 0 ? 'up' : 'down');
    $('hDelta').innerHTML = `${chg >= 0 ? '▲' : '▼'} ${chg >= 0 ? '+' : '-'}${Math.abs(chg).toFixed(1)}% MoM`;
    $('hDelta').title = partMonth
      ? `${mLabel(last.period)} is a part month to ${d.asOf} — not comparable to a full ${mLabel(prev.period)}.`
      : `${mLabel(last.period)} against ${mLabel(prev.period)}.`;
  } else $('hDelta').innerHTML = '';
  // Volume and avg price in this card are the LATEST month's figures, same as the
  // period tile beside them — not the whole scope's total. All three stats in this row
  // describe the same single month, so they read together, not at odds.
  const monthTag = last ? ` (${MOF[+last.period.slice(0, 2) - 1].toUpperCase()})` : '';
  $('hVolL').textContent = 'Quantities' + monthTag;
  $('hVol').innerHTML = !last || last.qtyMt == null ? '—' : fmtMT(last.qtyMt).replace(' MT', ' <small>MT</small>');
  heroBreakdown('hVolB', last && last.groups, g => fmtMT(g.qtyMt));
  $('hPriceTag').textContent = last ? MOF[+last.period.slice(0, 2) - 1].toUpperCase() : '—';
  // Realised revenue per KG, same single-month scope as Volume beside it.
  // Unit suffix dropped per explicit instruction (sales-header-restyle-
  // prompt.md) — the SEP tag alongside it is kept as the basis indicator.
  // Avg price is Finished Goods only (B2B/B2C revenue / B2B/B2C quantity), per MT; Others are out of both sides.
  const avgMt = fgAvgMt(last);
  if (avgMt != null) $('hPrice').innerHTML = `${fmtAvgMt(avgMt)} <small>/MT</small>`;
  else $('hPrice').textContent = '—';

  return out;
}

/** Ported from the source's render function (renderStatus). Returns what it wrote to each element id. */
export function buildStatus(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
function setStatusDot(id, o) {
  const el = $(id);
  if (!o) {
    el.style.display = 'none';
    ['helpTitle', 'helpBody', 'helpLinks', 'helpWide'].forEach(k => delete el.dataset[k]);
    el.removeAttribute('aria-label'); return;
  }
  el.style.display = 'inline-flex';
  el.dataset.helpTitle = o.title; el.dataset.helpBody = o.paragraphs.join('\n\n'); el.dataset.helpWide = '1';
  if (o.links && o.links.length) el.dataset.helpLinks = JSON.stringify(o.links); else delete el.dataset.helpLinks;
  el.setAttribute('aria-label', o.label);
}
  const M = formatMoneyCompact, canLink = canOpenDataManagement(S.status), scope = scopeLabel();
  const warn = [], err = [], warnLinks = [], errLinks = [];
  let zero = null, closure = null;
  if (S.error) err.push(`${STATUS_COPY.errorTitle}. ${S.error}`);
  if (S.data) {
    const d = S.data;
    if (!d.cogmAvailable) {
      warn.push(STATUS_COPY.spreadsheet(d.cogmUnavailableReason));
    } else {
      const t = d.total, g = t.groups || {};
      // $0 here is a stated assumption (no manufacturing order exists for these lines), not a computed fact, so it is
      // kept visibly separate and split by basis: B2B/B2C is part of the CM on the cards, Others never is.
      if (t.hasAssumedZero) {
        const fg = (g.fg && g.fg.revenueAssumedZero) || 0, oth = (g.other && g.other.revenueAssumedZero) || 0, C = STATUS_COPY.zero;
        zero = { total: t.revenueAssumedZero };
        warn.push([C.intro(M(t.revenueAssumedZero), scope), fg > 0 ? C.fg(M(fg)) : C.noFg, ...(oth > 0 ? [C.oth(M(oth))] : []), VC_DEF].join('\n'));
        if (canLink) warnLinks.push({ label: C.link, act: 'validation:assumed-zero' });
      }
      if (t.partial) warn.push(STATUS_COPY.partial(M(t.revenueFinal + t.revenueProvisional + t.revenueAssumedZero), M(t.revenue), M(t.revenueNotCosted)));
      // Whether a period is genuinely still open is a fact about its own cost chain — whether any batch it fed is still
      // awaiting settlement or period close — not about its position in whatever window the dashboard displays.
      const openPeriods = d.periods.filter(p => p.provisional).map(p => p.period);
      if (openPeriods.length) warn.push(STATUS_COPY.provisional(openPeriods.map(mLabel).join(', '), openPeriods.length > 1, M(t.revenueProvisional)));
      const c = d.controls;
      if (c && (c.batchBreaches || c.orderBreaches || c.quantityBreaches)) {
        const n = c.batchBreaches + c.orderBreaches + c.quantityBreaches, C = STATUS_COPY.closure, ds = c.dataset;
        const outside = ds ? ds.batch + ds.order + ds.quantity - n : 0;
        closure = { n };
        err.unshift([C.head(n, scope, c.batchBreaches, c.orderBreaches, c.quantityBreaches), ...C.lines].join('\n')
          + '\n\n' + C.foot + (outside > 0 ? '\n' + C.outside(outside, ds.batch, ds.order, ds.quantity) : ''));
        if (canLink) errLinks.push({ label: C.link, act: 'validation' });
      }
    }
    // "Data through" reflects the freshness of the underlying dataset, not the
    // currently selected range filter — it shouldn't change just because the user
    // narrowed the view.
    const last = d.allPeriods.at(-1);
    $('dataThroughVal').textContent = last ? mLabel(last) : '—';
    $('dataThroughDot').style.background = (S.source === 'api' && S.status?.connection?.ok === false) ? 'var(--color-clay)' : '';
  } else {
    $('dataThroughVal').textContent = '—';
  }
  setStatusDot('warnDot', warn.length ? {
    title: zero ? STATUS_COPY.zero.title : STATUS_COPY.notesTitle, paragraphs: warn, links: warnLinks,
    label: zero ? `${STATUS_COPY.zero.title}: ${M(zero.total)} of revenue — view details` : `${STATUS_COPY.notesTitle}: ${warn.length} — view details`,
  } : null);
  setStatusDot('errDot', err.length ? {
    title: closure ? STATUS_COPY.closure.title : (S.error ? STATUS_COPY.errorTitle : STATUS_COPY.noticeTitle), paragraphs: err, links: errLinks,
    label: closure ? `${STATUS_COPY.closure.title}: ${closure.n} — view details` : `${S.error ? STATUS_COPY.errorTitle : STATUS_COPY.noticeTitle} — view details`,
  } : null);
  return out;
}

/** Ported from the source's render function (renderPeriod; the chart box is passed in). Returns what it wrote to each element id. */
export function buildPeriod(S, chartBox) {
  const { $, out } = makeSink({ chart: { parentElement: { getBoundingClientRect: () => chartBox } } });
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const d = S.data; if (!d) return out;
  // The drawing is in real pixels: the viewBox follows the chart box (re-rendered by a ResizeObserver), so it fills the
  // card edge to edge instead of being letterboxed. pad holds the month-label and QTY-pill rows under the baseline; TOP
  // is the small headroom for the tallest column's value label.
  const box = $('chart').parentElement.getBoundingClientRect();
  const W = Math.max(280, Math.round(box.width) || 560), H = Math.max(236, Math.round(box.height) || 236);
  $('chart').setAttribute('viewBox', `0 0 ${W} ${H}`);
  const ps = d.periods, pad = 48, TOP = 15, ph = H - pad - TOP;
  // "N months in view" — N follows whatever range is currently selected
  // (YTD, a custom range, fewer or more periods), never a fixed count.
  $('periodHint').textContent = `${ps.length} month${ps.length !== 1 ? 's' : ''} in view`;
  if (!ps.length) { $('chart').innerHTML = ''; $('mlist').innerHTML = ''; return out; }
  // Columns run flush from the left to the right content edge with an even gap between them.
  const n = ps.length, gap = Math.min(14, W / n * .22), cw = (W - gap * (n - 1)) / n, bw = cw + gap;
  const cxs = ps.map((_, i) => i * bw + cw / 2), max = Math.max(...ps.map(p => p.revenue), 1);
  // Every bar with a real value gets a label (a period whose lines net to exactly zero is skipped rather than
  // printing "$0"). The font shrinks in two steps as columns get narrow instead of ever dropping labels.
  const vlSize = cw < 30 ? 7 : cw < 42 ? 8 : 9;
  // Rows from a prior year are muted, so the year boundary is legible without a legend (no visible effect while
  // every period shown is the same year).
  const latestYear = ps.at(-1).period.slice(3);
  let s = `<defs><linearGradient id="bg26" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FA378"/><stop offset="1" stop-color="#1B7A54"/></linearGradient></defs>`;
  const labels = [];   // revenue labels are drawn last, above the QTY line, each on a white chip
  ps.forEach((p, i) => {
    const isPrior = p.period.slice(3) < latestYear;
    const h = Math.max(0, p.revenue / max * ph), x = i * bw, y = H - pad - h, w = cw;
    // The visual <rect> carries no click handler: a real <button>, overlaid via foreignObject, is the interactive
    // target (an SVG <rect> can't be a semantic button).
    s += `<foreignObject x="${(x - 2).toFixed(1)}" y="${TOP - 6}" width="${(w + 4).toFixed(1)}" height="${ph + 20}">`
      + `<button type="button" class="bar-hit" data-p="${p.period}" aria-label="${esc(mLabel(p.period))}, ${fmtUSD(p.revenue)}" style="width:100%;height:100%;background:transparent;border:0;padding:0;cursor:pointer"></button>`
      + `</foreignObject>`
      + `<rect class="bar" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${isPrior ? '#C4D6CC' : 'url(#bg26)'}" style="pointer-events:none"/>`
      // flagged (open) periods carry a small gold dot on the bar itself
      + (p.provisional ? `<circle cx="${(x + w - 4).toFixed(1)}" cy="${(y + 4).toFixed(1)}" r="3" style="fill:var(--color-gold);pointer-events:none"/>` : '');
    const fgCm = fgOf(p) ? fgOf(p).cm : null;
    if (fgCm != null && fgCm > 0) {
      // The inner bar is Finished Goods (B2B/B2C) contribution margin, inside the total-revenue column; it stays in
      // the green family (a brighter mint highlight).
      const ch = Math.max(1, fgCm / max * ph);
      s += `<rect class="cmbar" x="${(x + w * .28).toFixed(1)}" y="${(H - pad - ch).toFixed(1)}" width="${(w * .44).toFixed(1)}" height="${ch.toFixed(1)}" rx="2" fill="#A8E8C8" opacity=".9" pointer-events="none"/>`;
    }
    s += `<text class="bl" x="${cxs[i].toFixed(1)}" y="${H - pad + 13}" text-anchor="middle">${monAbbr(p.period)}</text>`
      + `<text class="bl yr" x="${cxs[i].toFixed(1)}" y="${H - pad + 23}" text-anchor="middle">${yr2(p.period)}</text>`;
    if (p.revenue !== 0) {
      // a negative bar renders at zero height on the baseline, so its label never sits closer than 14 above it
      const txt = fmtK(p.revenue), tw = txt.length * vlSize * .58 + 6;
      const anchor = cw < tw + 4 ? (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') : 'middle';
      const lx = anchor === 'start' ? x : anchor === 'end' ? x + w : cxs[i];
      labels.push({ i, txt, tw, anchor, lx, ly: Math.min(y - 5, H - pad - 14) });
    }
  });

  // ---- QTY (MT): smooth amber line on its own hidden scale, dots, and a pill per month ----
  // Finished Goods (B2B/B2C) quantity per month — the same figure as the tooltip and the hero. The line sits in the
  // 20%-80% band of the plot, skips months with no volume (no drop to zero) and copes with negative quantities.
  const DOT = 6.5, dotY = {};
  const qpts = ps.map((p, i) => ({ i, x: cxs[i], q: fgOf(p) ? fgOf(p).qtyMt : null })).filter(o => o.q != null && Number.isFinite(o.q));
  if (qpts.length) {
    const qmin = Math.min(...qpts.map(o => o.q)), qmax = Math.max(...qpts.map(o => o.q));
    const qy = q => H - pad - ph * (qmax === qmin ? .5 : .2 + .6 * (q - qmin) / (qmax - qmin));
    qpts.forEach(o => { o.y = qy(o.q); dotY[o.i] = o.y; });
    // consecutive months only: a gap in the data breaks the line instead of bridging it
    const runs = []; qpts.forEach(o => { const r = runs.at(-1); if (r && r.at(-1).i === o.i - 1) r.push(o); else runs.push([o]); });
    const smooth = r => r.length < 2 ? '' : r.map((o, k) => {
      if (!k) return `M${o.x.toFixed(1)} ${o.y.toFixed(1)}`;
      const p0 = r[k - 2] || r[k - 1], p1 = r[k - 1], p2 = o, p3 = r[k + 1] || o;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6, c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      return `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }).join(' ');
    const paths = runs.map(smooth).filter(Boolean);
    // a white halo under the line keeps it readable where it crosses the dark green columns
    paths.forEach(d => { s += `<path class="qline qhalo" d="${d}" pathLength="1" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`; });
    paths.forEach(d => { s += `<path class="qline" d="${d}" pathLength="1" fill="none" stroke="var(--color-amber)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`; });
    qpts.forEach(o => { s += `<circle class="qdot" data-i="${o.i}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${DOT}" fill="var(--color-amber)" stroke="#fff" stroke-width="2" pointer-events="none"/>`; });
  }
  // Pills under the month labels: always one decimal with a thousands separator ("649.0 MT"); when the full text
  // doesn't fit the column slot they all switch to the compact form ("2.03K MT"), never to smaller text.
  const qFull = q => `${q.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MT`;
  const qCompact = q => Math.abs(q) >= 1000 ? `${(q / 1000).toFixed(2)}K MT` : qFull(q);
  const PCH = 5.8, PPAD = 12;   // approx. mono glyph width at the pill font size, and horizontal padding
  const pillTxt = f => ps.map(p => { const q = fgOf(p) ? fgOf(p).qtyMt : null; return q != null && Number.isFinite(q) && q !== 0 ? f(q) : '—'; });
  const widest = a => Math.max(...a.map(t => t.length)) * PCH + PPAD;
  let pills = pillTxt(qFull);
  if (widest(pills) > bw) pills = pillTxt(qCompact);
  if (widest(pills) <= bw) {
    const pw = Math.min(widest(pills), bw);
    pills.forEach((txt, i) => {
      s += `<g class="qpill" data-i="${i}" pointer-events="none"><rect x="${(cxs[i] - pw / 2).toFixed(1)}" y="${H - pad + 28}" width="${pw.toFixed(1)}" height="16" rx="8"/>`
        + `<text x="${cxs[i].toFixed(1)}" y="${H - pad + 39.5}" text-anchor="middle">${txt}</text></g>`;
    });
  }
  // Revenue labels last (above line and dots), each on a white chip; a label that a dot would sit on moves up above it.
  labels.forEach(l => {
    let ly = l.ly; const dy = dotY[l.i];
    if (dy != null && Math.abs(dy - (ly - vlSize * .35)) < DOT + vlSize * .7) { const up = dy - DOT - 5; if (up >= vlSize + 1) ly = up; }
    const cx0 = l.anchor === 'start' ? l.lx : l.anchor === 'end' ? l.lx - l.tw : l.lx - l.tw / 2;
    s += `<rect class="vlchip" x="${(cx0).toFixed(1)}" y="${(ly - vlSize - 1).toFixed(1)}" width="${l.tw.toFixed(1)}" height="${vlSize + 4}" rx="3" fill="#fff" fill-opacity=".9" pointer-events="none"/>`
      + `<text class="vl" x="${(cx0 + l.tw / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" style="font-size:${vlSize}px">${l.txt}</text>`;
  });
  out.geo = { pts: ps, W, cxs, cw };
  $('chart').innerHTML = s;
  // Month-by-month list: B2B/B2C (Finished Goods) revenue, Other revenue and the month-over-month change in B2B/B2C
  // revenue, from the same per-period figures as the hero and the chart (B2B/B2C + Other = the chart's column total).
  const order = [...ps].reverse();
  const fgMax = Math.max(...ps.map(p => (fgOf(p) ? fgOf(p).revenue : 0)), 1);
  let ml = '<div class="mhead"><div class="caphdr">Month-by-Month Comparison <button type="button" class="help-ico" data-help="mbmCard" aria-haspopup="dialog" aria-expanded="false" aria-label="Month-by-month comparison — more info">ⓘ</button></div>'
    + '<div class="mcols" aria-hidden="true"><span class="c-mo"></span><span class="c-bar"></span><span>B2B/B2C</span><span>Other</span><span>MoM</span></div></div>';
  order.forEach((p, k) => {
    const i = ps.indexOf(p), g = fgOf(p), og = p.groups ? p.groups.other : null;
    const fgRev = g ? g.revenue : 0, othRev = og ? og.revenue : 0;
    // The earliest row in view has no predecessor WITHIN the filtered list, but it may still have a true calendar
    // predecessor just outside the window (Jan 2026's is Dec 2025) — S.priorPeriodData carries that one period.
    const prevFg = i > 0 ? (fgOf(ps[i - 1]) ? fgOf(ps[i - 1]).revenue : null) : fgOf(S.priorPeriodData && S.priorPeriodData.total) ? fgOf(S.priorPeriodData.total).revenue : null;
    const chg = prevFg ? (fgRev - prevFg) / prevFg * 100 : null;   // B2B/B2C only; "—" with no previous month or a zero base
    const cls = chg == null ? 'flat' : chg >= 0 ? 'up' : 'down';
    const flag = p.provisional ? ` <span class="badge mid" title="Overhead not yet settled at period close">Open</span>` : '';
    const tip = [`${mLabel(p.period)}`,
      `B2B/B2C revenue ${formatMoneyCompact(fgRev)}`, `Other revenue ${formatMoneyCompact(othRev)}`, `Total revenue ${formatMoneyCompact(p.revenue)}`,
      `B2B/B2C variable cost ${g && g.cogm != null ? `${formatMoneyCompact(g.cogm)} (${g.cogmPct != null ? fmtPct(g.cogmPct) : '—'})` : '—'}`,
      `B2B/B2C CM ${g && g.cm != null ? `${formatMoneyCompact(g.cm)} (${g.cmPct != null ? fmtPct(g.cmPct) : '—'})` : '—'}`,
      `B2B/B2C QTY ${g && g.qtyMt != null ? g.qtyMt.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' MT' : '—'}`,
      `MoM (B2B/B2C) ${chg == null ? '—' : (chg >= 0 ? '▲ +' : '▼ -') + Math.abs(chg).toFixed(1) + '%'}`, VC_DEF].join('\n');
    ml += `<button type="button" class="mrow" data-p="${p.period}" title="${esc(tip)}"><div class="mo">${MOF[+p.period.slice(0,2)-1]}<small>${p.period.replace('.', '/')}</small>${flag}</div>`
      + `<div class="track"><div class="fill" style="width:${Math.max(0, fgRev) / fgMax * 100}%;animation-delay:${.1 + k * .04}s"></div></div>`
      + `<div class="v num">${fmtK(fgRev)}</div>`
      + `<div class="o num">${othRev ? fmtK(othRev) : '$0'}</div>`
      + `<div class="d num ${cls}">${chg == null ? '—' : (chg >= 0 ? '▲ ' : '▼ ') + Math.abs(chg).toFixed(1) + '%'}</div></button>`;
  });
  $('mlist').innerHTML = ml;
  return out;
}

/** Ported from the source's render function (renderProducts). Returns what it wrote to each element id. */
export function buildProducts(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const d = S.data; if (!d) return out;
  const secs = d.sections.products, t = d.total;
  const last = d.periods.at(-1);
  const monthName = last ? MOF[+last.period.slice(0, 2) - 1] : 'Month';
  const loading = !S.monthData;
  const mRow = new Map(), mTot = new Map();
  (S.monthData?.sections?.products || []).forEach(s => {
    mTot.set(s.key, s.total); (s.rows || []).forEach(r => mRow.set(r.code, r));
  });
  const mt = S.monthData?.total, pal = productPalette(secs);
  // Contribution margin is a finished-goods measure: the Total line's CM is the B2B/B2C group's, not all products'.
  const fgT = secs.find(x => x.key === 'fg')?.total, fgM = mTot.get('fg');
  $('prodSub').textContent = 'Billed revenue · ' + scopeLabel() + (loading ? ' · Loading month figures…' : '');
  // month + YTD cells for Qty, Value, VC, CM — shared by item rows (bold YTD, abbreviated $) and subtotal rows
  // An item with sales but no quantity (a service, a non-stock item) shows 0.0, never blank; "—" is only for a month
  // in which the item had no activity at all. In Others an item with no cost shows VC $0.
  const mcell = (m, v, f, fallback) => `<td class="num${loading ? ' muted' : ''}">${!m ? '—' : v == null ? fallback : f(v)}</td>`;
  const cells = (x, m, f, na, oth) => mcell(m, m?.qtyMt, qtyFmt, qtyFmt(0)) + `<td class="num"><b>${qtyFmt(x.qtyMt ?? 0)}</b></td>`
    + monthCell(m?.revenue, f, loading) + `<td class="num"><b>${f(x.revenue)}</b></td>`
    + mcell(m, m?.cogm, f, oth ? f(0) : '—') + `<td class="num"><b>${x.cogm == null ? (oth ? f(0) : naCell(na)) : f(x.cogm)}</b></td>`
    + mcell(m, m?.cm, f, '—') + `<td class="num"><b>${x.cm == null ? naCell(na) : f(x.cm)}</b></td>`;
  const item = (p, g) => `<tr class="it" data-g="${g}"><td class="frz"><button type="button" class="rowbtn" data-code="${p.code}" title="${esc(p.name)}"><span class="dotc" style="display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:7px;background:${pal.get(p.code)}"></span><span>${esc(p.name)}</span><div class="sub mono">${p.code}</div></button></td>`
    + cells(p, mRow.get(p.code), fmtBMK, 'VC unavailable', g === 'other') + `</tr>`;
  const head = (cls, key, title, count, x, m, oth) => `<tr class="grp-row ${cls}"><td class="frz">${grpBtn(key, title, count)}</td>${cells(x, m, fmtK, 'VC unavailable', oth)}</tr>`;
  let body = '';
  // Two flat groups: B2B/B2C — Finished Goods, then Others (every other item, services included). The donut keeps
  // the category breakdown; this table does not.
  secs.forEach(sec => {
    if (!sec.rows.length) return;
    const oth = sec.key === 'other', title = oth ? 'Others' : sec.title;
    body += head(oth ? 'lvl1 oth' : 'lvl1 fg', 'prod:' + sec.key, title, sec.rows.length, sec.total, mTot.get(sec.key), oth);
    if (!collapsed.has('prod:' + sec.key)) body += sec.rows.map(p => item(p, sec.key)).join('');
  });
  $('prodTbl').innerHTML = `<thead><tr>`
      + `<th rowspan="2" class="frz" style="text-align:left">SKU</th>`
      + `<th colspan="2" class="bt-group">Qty (MT)</th>`
      + `<th colspan="2" class="bt-group">Value ($)</th>`
      + `<th colspan="2" class="bt-group">VC ($)</th>`
      + `<th colspan="2" class="bt-group">CM ($)</th></tr>`
      + `<tr><th class="bt-sub">${monthName}</th><th>YTD</th><th class="bt-sub">${monthName}</th><th>YTD</th><th class="bt-sub">${monthName}</th><th>YTD</th><th class="bt-sub">${monthName}</th><th>YTD</th></tr></thead><tbody>`
    + body
    + `</tbody><tfoot><tr class="tot"><td class="frz">Total</td>`
    + monthCell(mt ? (mt.qtyMt ?? 0) : null, qtyFmt, loading)
    + `<td class="num">${qtyFmt(t.qtyMt ?? 0)}</td>`
    + monthCell(mt?.revenue, fmtK, loading)
    + `<td class="num">${fmtK(t.revenue)}</td>`
    + monthCell(mt?.cogm, fmtK, loading)
    + `<td class="num">${t.cogm == null ? naCell() : fmtK(t.cogm)}</td>`
    + monthCell(fgM ? fgM.cm : null, fmtK, loading)
    + `<td class="num" title="Finished goods only">${fgT && fgT.cm != null ? fmtK(fgT.cm) : naCell()}</td></tr></tfoot>`;
  return out;
}

/** Ported from the source's render function (renderCustomers). Returns what it wrote to each element id. */
export function buildCustomers(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const d = S.data; if (!d) return out;
  const secs = d.sections.customers, t = d.total;
  const last = d.periods.at(-1);
  const monthName = last ? MOF[+last.period.slice(0, 2) - 1] : 'Month';
  const loading = !S.monthData;
  const mRow = { fg: new Map(), other: new Map() }, mTot = new Map();
  (S.monthData?.sections?.customers || []).forEach(s => { mTot.set(s.key, s.total); (s.rows || []).forEach(r => mRow[s.key]?.set(r.code, r)); });
  const mt = S.monthData?.total;
  $('custSub').textContent = 'Sold-to · ' + scopeLabel() + (loading ? ' · Loading month figures…' : '');
  // a customer that bought both appears in both sections, each with that section's own amounts
  const cells = (x, m) => monthCell(m?.revenue, fmtK, loading) + `<td class="num"><b>${fmtK(x.revenue)}</b></td>`
    + monthCell(m?.cm, fmtK, loading) + `<td class="num"><b>${x.cm == null ? '—' : fmtK(x.cm)}</b></td>`;
  let body = '';
  secs.forEach(sec => {
    if (!sec.rows.length) return;
    body += `<tr class="grp-row lvl1 ${sec.key === 'fg' ? 'fg' : 'oth'}"><td class="frz">${grpBtn('cust:' + sec.key, sec.title, sec.rows.length)}</td>${cells(sec.total, mTot.get(sec.key))}</tr>`;
    if (collapsed.has('cust:' + sec.key)) return;
    body += sec.rows.map((c, i) => {
      const name = c.name || c.code;
      return `<tr class="it" data-g="${sec.key}"><td class="frz"><button type="button" class="rowbtn" data-code="${c.code}" title="${esc(name)}"><span class="dotc" style="display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:7px;background:${PAL[i % PAL.length]}"></span><span>${esc(name)}</span></button></td>`
        + cells(c, mRow[sec.key].get(c.code)) + `</tr>`;
    }).join('');
  });
  $('custTbl').innerHTML = `<thead><tr>`
      + `<th rowspan="2" class="frz" style="text-align:left">Customer</th>`
      + `<th colspan="2" class="bt-group">Revenue ($)</th>`
      + `<th colspan="2" class="bt-group">CM ($)</th></tr>`
      + `<tr><th class="bt-sub">${monthName}</th><th>YTD</th><th class="bt-sub">${monthName}</th><th>YTD</th></tr></thead><tbody>`
    + body
    + `</tbody><tfoot><tr class="tot"><td class="frz">Total</td>`
    + monthCell(mt?.revenue, fmtK, loading)
    + `<td class="num">${fmtK(t.revenue)}</td>`
    + monthCell(mt?.cm, fmtK, loading)
    + `<td class="num">${t.cm == null ? naCell() : fmtK(t.cm)}</td></tr></tfoot>`;
  return out;
}

/** Ported from the source's render function (renderMargin). Returns what it wrote to each element id. */
export function buildMargin(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const d = S.data; if (!d) return out;
  const t = fgView(d.total);
  if (!d.cogmAvailable || !t) {
    $('mgPct').className = 'pct num';
    $('mgPct').innerHTML = '<span class="na" style="font-size:20px">Unavailable</span>';
    $('mgPctSub').textContent = '';
    $('mgCm').innerHTML = '<span class="na">N/A</span>';
    $('mgWf').innerHTML = '';
    $('mgInfo').style.display = 'none';
    return out;
  }
  $('mgInfo').style.display = '';
  // The latest month's own figure rides alongside the scope total throughout this
  // card — same pattern as the hero card's Volume/CM tiles: one bold headline value,
  // one lighter "Sep $X" figure beside it, so the two never have to be cross-checked
  // against each other in different places.
  const lastP = d.periods.at(-1), last = fgView(lastP);
  const lastMo = lastP ? MOF[+lastP.period.slice(0, 2) - 1] : '';
  const jSpan = v => v == null ? '' : `<span class="j">${lastMo} ${v}</span>`;

  // Dynamic range subtitle, matching the reference card's own format
  // exactly ("Jan–Sep 2026 & Sep · Margin Analysis"), across any From/To
  // selection including ranges that cross the 2025/2026 boundary.
  const rangeLabel = S.from.slice(3) === S.to.slice(3)
    ? `${MOF[+S.from.slice(0, 2) - 1]}–${mLabel(S.to)}`
    : `${mLabel(S.from)}–${mLabel(S.to)}`;
  $('mgSub').textContent = `${rangeLabel}${lastMo ? ' & ' + lastMo : ''} · B2B/B2C`;

  // Standalone headline metric — its colour is its own sign, not revenue's.
  $('mgPct').className = 'pct num ' + (t.cmPct >= 0 ? 'pos' : 'neg');
  $('mgPct').innerHTML = cn(t.cmPct, 'pct');
  $('mgPctSub').textContent = last && last.cmPct != null ? `${lastMo} ${fmtPct(last.cmPct)}` : '';
  $('mgCm').innerHTML = cn(t.cm, 'k') + jSpan(last && last.cm != null ? fmtK(last.cm) : null);

  // Revenue stays dark green throughout (bar and figure alike); COGM is a
  // plain cost, no sign-colour. CM — gold is reserved for the big % only
  // now — is the lighter green on both its bar and its own number when
  // positive, and still flips to red on a genuine negative margin.
  $('mgWf').innerHTML = marginBarsHtml(t, last, lastMo);
  return out;
}

/** Ported from the source's render function (renderContribution, minus the event wiring). Returns what it wrote to each element id. */
export function buildContribution(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const d = S.data; if (!d) return out;
  const pp = d.products, tot = d.total.revenue || 1;
  const secs = d.sections.products, pal = productPalette(secs);
  // Every product is shown, grouped: Finished Goods (B2B/B2C) first, then Other's categories — the segments, their
  // colours and the legend all follow that order, and a thin outer ring marks the two groups.
  const groups = [];
  const fgS = secs.find(s => s.key === 'fg'), othS = secs.find(s => s.key === 'other');
  if (fgS && fgS.rows.length) groups.push({ key: 'fg', title: fgS.title, rev: fgS.total.revenue, blocks: [{ key: 'fg', title: null, rows: fgS.rows }] });
  if (othS && othS.categories.length) groups.push({ key: 'other', title: othS.title, rev: othS.total.revenue, blocks: othS.categories.map(c => ({ key: c.key, title: c.title, rev: c.total.revenue, rows: c.rows })) });
  const r = 70, C = 2 * Math.PI * r; let off = 0, arcs = '';
  // Hover text. Finished Goods show CM and CM % (FG basis; the group title uses the very figures of the Margin —
  // contribution card); Others show revenue and share only, never a CM.
  const fgT = d.total.groups && d.total.groups.fg;
  const pctOf = v => (v / tot * 100).toFixed(1) + '%';
  const NOCM = 'CM not reported for Others';
  const segTip = (p, g, bl) => [`${p.name} · ${bl.title || g.title}`, `Revenue ${fmtUSD(p.revenue)} · ${pctOf(p.revenue)} of total revenue`,
    g.key === 'fg' ? `CM ${p.cm == null ? '—' : `${fmtUSD(p.cm)} (${fmtPct(p.cmPct)})`}` : NOCM].join('\n');
  const grpTip = g => [g.title, `Revenue ${fmtUSD(g.rev)} · ${pctOf(g.rev)} of total revenue`,
    g.key === 'fg' ? `CM ${fgT && fgT.cm != null ? `${fmtUSD(fgT.cm)} (${fmtPct(fgT.cmPct)})` : '—'}` : NOCM].join('\n');
  const blkTip = (bl, g) => [`${bl.title}`, `Revenue ${fmtUSD(bl.rev)} · ${pctOf(bl.rev)} of total revenue`, NOCM].join('\n');
  // Others is only ~2% of revenue, which would be an invisible sliver: its arc gets a minimum width (the other
  // group shrinks to make room); the legend and tooltips keep the true figures.
  const MIN_OTHER = 0.04, hasFg = groups.some(g => g.key === 'fg'), hasOth = groups.some(g => g.key === 'other');
  const othTrue = hasOth ? Math.max(0, groups.find(g => g.key === 'other').rev) / tot : 0;
  const disp = { other: !hasOth ? 0 : !hasFg ? 1 : Math.min(.5, Math.max(othTrue, MIN_OTHER)) };
  disp.fg = 1 - disp.other;
  groups.forEach(g => g.blocks.forEach(bl => bl.rows.forEach(p => {
    const len = g.rev > 0 ? Math.max(0, p.revenue) / g.rev * disp[g.key] * C : 0;
    arcs += `<circle class="seg" data-g="${g.key}" data-cat="${bl.key}" data-code="${p.code}" data-len="${len}" data-off="${off}" data-c="${C}" cx="100" cy="100" r="${r}" fill="none" stroke="${pal.get(p.code)}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"><title>${esc(segTip(p, g, bl))}</title></circle>`;
    off += len;
  })));
  // outer ring: one arc per group, with a small gap between them
  const R2 = 90, C2 = 2 * Math.PI * R2; let o2 = 0, ring = '';
  const gap = groups.length > 1 ? 0.012 * C2 : 0;
  groups.forEach(g => {
    const len = disp[g.key] * C2, shown = Math.max(0, len - gap);
    ring += `<circle class="gring" data-g="${g.key}" cx="100" cy="100" r="${R2}" fill="none" stroke="${g.key === 'fg' ? '#1B7A54' : '#C9922E'}" stroke-width="3" stroke-dasharray="${shown} ${C2 - shown}" stroke-dashoffset="${-(o2 + gap / 2)}" transform="rotate(-90 100 100)"/>`;
    o2 += len;
  });
  const lastPer = d.periods && d.periods.length ? d.periods[d.periods.length - 1] : null;
  const lastMon = lastPer ? MOF[+lastPer.period.slice(0, 2) - 1] : '—';
  $('donut').innerHTML = arcs + ring + `<text x="100" y="92" text-anchor="middle" class="num cn" data-v="${tot}" data-f="k" style="font-size:22px;font-weight:600;fill:var(--color-tx)">${fmtK(tot)}</text>`
    + `<text x="100" y="108" text-anchor="middle" style="font-size:9px;letter-spacing:.08em;fill:var(--color-tx-3);font-weight:600">NET REVENUE</text>`
    + `<text x="100" y="122" text-anchor="middle" style="font-size:8.5px;fill:var(--color-tx-2);font-weight:600">Jan to ${lastMon}</text>`;
  // Legend: group titles carry the group's share of total revenue, item % is also share of total revenue.
  const item = (p, bl) => `<button type="button" class="dl" data-code="${p.code}" data-g="${bl.g}" data-cat="${bl.key}" title="${esc(segTip(p, groups.find(x => x.key === bl.g), bl))}"><span class="sw" style="background:${pal.get(p.code)}"></span><span class="nm">${esc(p.name)}</span><span class="pc">${cn(p.revenue / tot * 100, 'pc1')}</span></button>`;
  const legBtn = (key, cls, title, share, hl, tip) => `<button type="button" class="dlg ${cls}" data-k="leg:${key}" data-hl="${hl}" title="${esc(tip)}" aria-expanded="${!collapsed.has('leg:' + key)}">${chev(!collapsed.has('leg:' + key))}<span class="nm">${esc(title)}</span><span class="pc">${share.toFixed(1)}%</span></button>`;
  let lg = '';
  groups.forEach(g => {
    lg += legBtn(g.key, 'g1', g.title, g.rev / tot * 100, g.key, grpTip(g));
    if (collapsed.has('leg:' + g.key)) return;
    g.blocks.forEach(bl => {
      bl.g = g.key;
      if (bl.title) { lg += legBtn(g.key + ':' + bl.key, 'g2', bl.title, bl.rev / tot * 100, g.key + ':' + bl.key, blkTip(bl, g)); if (collapsed.has('leg:' + g.key + ':' + bl.key)) return; }
      lg += bl.rows.map(p => item(p, bl)).join('');
    });
  });
  $('dlegend').innerHTML = lg;
  const hasCogm = d.cogmAvailable;
  $('lvl3src').textContent = hasCogm ? 'Actual VC' : 'VC unavailable';
  // The production ProfitabilityTile is Product/Revenue/CM% only — this
  // app's own version carries Qty, COGM and Coverage too, which are real
  // features (cost tracing this app has and the reference doesn't), so the
  // extra columns stay; only the row-count-when-scrolling convention and the
  // real-button-per-row pattern are ported. Reference's own BreakdownTable
  // (also a <table>) wraps only the name cell in a button rather than the
  // whole row — a <tr> can't be a semantic button — so this does the same.
  const scrolls = pp.length > RANKED_VISIBLE_ROWS;
  $('profDetail').textContent = 'Click a row for the waterfall' + (scrolls ? ` · ${pp.length} total` : '');
  $('profTbl').innerHTML = `<thead><tr><th style="text-align:left">Product</th><th>Qty (MT)</th><th>Revenue</th><th>VC</th><th>CM</th><th>CM % ${helpIcon('cmPct')}</th></tr></thead><tbody>`
    + pp.map((p, i) => `<tr><td><button type="button" class="rowbtn" data-code="${p.code}" title="${esc(p.name)}"><span class="dotc" style="display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:7px;background:${PAL[i % PAL.length]}"></span>${esc(p.name)}<div class="sub mono">${p.code}</div></button></td>`
      + `<td>${p.qtyMt == null ? '—' : p.qtyMt.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>`
      + `<td>${fmtBMK(p.revenue)}</td>`
      + `<td>${p.cogm == null ? naCell('VC unavailable') : fmtBMK(p.cogm)}</td>`
      + `<td>${p.cm == null ? naCell('VC unavailable') : fmtBMK(p.cm)}</td>`
      + `<td>${isFinishedGood(p.code) ? cmDetail(p, '', { naReason: 'VC unavailable' }) : '—'}</td></tr>`).join('')
    + `</tbody><tfoot><tr class="tot"><td>Total — ${pp.length} products</td><td>${d.total.qtyMt == null ? '—' : d.total.qtyMt.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>`
    + `<td>${fmtK(d.total.revenue)}</td><td>${d.total.cogm == null ? naCell() : fmtK(d.total.cogm)}</td>`
    + `<td>${d.total.cm == null ? naCell() : fmtK(d.total.cm)}</td><td>${fmtPct(d.total.groups && d.total.groups.fg ? d.total.groups.fg.cmPct : null)}</td></tr></tfoot>`;
  return out;
}

/** Ported from the source's render function (renderValidation). Returns what it wrote to each element id. */
export function buildValidation(S, seed = {}) {
  const { $, out } = makeSink(seed);
  const scopeLabel = () => scopeLabelPure(S.data, S.from, S.to);
  const v = S.validation;
  if (!v) { $('valBody').innerHTML = `<div class="banner warn">Validation applies to the live API source. Switch the source to Live APIs to see the controls.</div>`; return out; }
  const c = v.controls;
  if (!c || !c.reconciliation) { $('valBody').innerHTML = `<div class="banner warn">${(c && c.note) || 'Validation controls require a live data refresh — click <b>Refresh</b> in the Source &amp; load tab to generate them.'}</div>`; return out; }
  const card = (cls, l, val, d) => `<div class="vcard ${cls}"><div class="l">${l}</div><div class="v num">${val}</div><div class="d">${d}</div></div>`;
  let h = `<div class="vgrid">`
    + card(c.reconciliation.pass ? 'ok' : 'bad', 'Revenue reconciliation', c.reconciliation.pass ? 'Ties' : 'DIFFERENCE',
        `${fmtUSD(c.reconciliation.total.revenue)} over ${c.reconciliation.total.lines} lines`)
    + card(c.batchClosure.breaches.length ? 'bad' : 'ok', 'Batch closure', `${c.batchClosure.total - c.batchClosure.breaches.length}/${c.batchClosure.total}`, 'Σ line VC ≤ batch cost')
    + card(c.orderClosure.breaches.length ? 'bad' : 'ok', 'Order closure', `${c.orderClosure.total - c.orderClosure.breaches.length}/${c.orderClosure.total}`, 'cost fully distributed')
    + card(c.quantityControl.breaches.length ? 'bad' : 'ok', 'Quantity control', `${c.quantityControl.total - c.quantityControl.breaches.length}/${c.quantityControl.total}`, 'delivered ≤ net produced')
    + `</div>`
    + (S.data && S.data.allPeriods.length ? `<div class="qnote">${esc(STATUS_COPY.validationScope(mLabel(S.data.allPeriods[0]), mLabel(S.data.allPeriods.at(-1))))}</div>` : '');

  h += section('Reconciliation against the regression table', `<table class="tbl"><thead><tr><th>Period</th><th>Revenue (USD)</th><th>Target (USD)</th><th>Difference</th><th>Lines</th><th>Target</th><th>Result</th></tr></thead><tbody>`
    + c.reconciliation.rows.map(r => `<tr><td>${mLabel(r.period)}</td><td>${fmtUSD(r.revenue)}</td><td>${fmtUSD(r.target)}</td>`
      + `<td class="${Math.abs(r.diff) > 0.005 ? 'neg' : ''}">${r.diff.toFixed(2)}</td><td>${r.lines}</td><td>${r.targetLines}</td>`
      + `<td><span class="statepill ${r.pass ? 'final' : 'none'}">${r.pass ? 'ties' : 'differs'}</span></td></tr>`).join('')
    + `<tr class="tot"><td>YTD</td><td>${fmtUSD(c.reconciliation.total.revenue)}</td><td>${fmtUSD(c.reconciliation.total.target)}</td>`
    + `<td>${c.reconciliation.total.diff.toFixed(2)}</td><td>${c.reconciliation.total.lines}</td><td>${c.reconciliation.total.targetLines}</td>`
    + `<td><span class="statepill ${c.reconciliation.pass ? 'final' : 'none'}">${c.reconciliation.pass ? 'ties' : 'differs'}</span></td></tr></tbody></table>`);

  h += section('Provisional / final / assumed-$0 split, by period', `<table class="tbl"><thead><tr><th>Period</th><th>Revenue</th><th>Final</th><th>Provisional</th><th>Assumed $0</th><th>Not costed</th><th>VC</th><th>CM</th><th>CM %</th></tr></thead><tbody>`
    + c.coverage.map(r => `<tr><td>${mLabel(r.period)}</td><td>${fmtUSD(r.revenue)}</td><td>${fmtUSD(r.revenueFinal)}</td>`
      + `<td>${fmtUSD(r.revenueProvisional)}</td><td>${fmtUSD(r.revenueAssumedZero)}</td><td>${fmtUSD(r.revenueNotCosted)}</td>`
      + `<td>${fmtUSD(r.cogm)}</td><td>${fmtUSD(r.cm)}</td><td>${fmtPct(r.cmPct)}</td></tr>`).join('') + `</tbody></table>`);

  const breaches = [...c.batchClosure.breaches.map(b => ['Batch closure', b.batch, fmtUSD(b.batchCost), fmtUSD(b.allocatedCogm), b.ratio?.toFixed(4), 'Allocated VC exceeds the batch cost']),
                    ...c.orderClosure.breaches.map(b => ['Order closure', b.order, fmtUSD(b.expected), fmtUSD(b.distributed), b.diff.toFixed(2), 'Order cost not fully distributed']),
                    ...c.quantityControl.breaches.map(b => ['Quantity', b.batch, b.producedKg.toLocaleString() + ' KG', b.deliveredKg.toLocaleString() + ' KG', b.excessKg.toLocaleString(), 'Delivered exceeds net produced quantity'])];
  h += section(`Closure breaches (${breaches.length})`, breaches.length
    ? `<table class="tbl"><thead><tr><th>Control</th><th>Key</th><th>Expected / cost</th><th>Actual / allocated</th><th>Ratio or excess</th><th>Reading</th></tr></thead><tbody>`
      + breaches.map(r => `<tr><td>${r[0]}</td><td class="mono" style="text-align:left">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="neg">${r[4]}</td><td style="text-align:left">${r[5]}</td></tr>`).join('')
      + `</tbody></table>`
    : `<div class="qnote">No breaches. Every batch costs out for no more than it cost, and every order's cost is fully distributed.</div>`);

  h += section(`Lines with missing cost (${c.missingCost.length})`, c.missingCost.length
    ? `<div class="scroll"><table class="tbl"><thead><tr><th>Document</th><th>Item</th><th>Period</th><th>Product</th><th>Batch</th><th>Revenue</th><th>Reason</th></tr></thead><tbody>`
      + c.missingCost.slice(0, 500).map(m => `<tr><td class="mono" style="text-align:left">${m.billingDocument}</td><td>${m.billingItem ?? '—'}</td><td>${mLabel(m.period)}</td>`
        + `<td style="text-align:left">${m.material}</td><td class="mono">${m.batch ?? '—'}</td><td>${fmtUSD(m.revenueUsd)}</td><td style="text-align:left">${esc(m.reason)}</td></tr>`).join('')
      + `</tbody></table></div>`
    : `<div class="qnote">None — every line resolves to final, provisional, or an assumed $0 (see below).</div>`);

  // Affected products for the period the dashboard is filtered to (the status-dot link lands here)
  const azIn = c.assumedZeroCost.filter(m => S.from && S.to && pkey(m.period) >= pkey(S.from) && pkey(m.period) <= pkey(S.to));
  const azBy = new Map();
  for (const m of azIn) { const e = azBy.get(m.material) || { code: m.material, group: m.group, lines: 0, rev: 0 }; e.lines++; e.rev += m.revenueUsd; azBy.set(m.material, e); }
  const azName = code => ((S.data && S.data.products.find(p => p.code === code)) || {}).name || code;
  const azSummary = azBy.size
    ? `<table class="tbl zsum"><caption>Affected products — ${esc(scopeLabel())} (follows the dashboard filter)</caption><thead><tr><th style="text-align:left">Product</th><th>Basis</th><th>Lines</th><th>Revenue</th></tr></thead><tbody>`
      + [...azBy.values()].sort((a, b) => b.rev - a.rev).map(e => `<tr><td style="text-align:left">${esc(azName(e.code))}<div class="sub mono">${esc(e.code)}</div></td><td>${e.group}</td><td>${e.lines}</td><td>${formatMoneyCompact(e.rev)}</td></tr>`).join('')
      + `<tr class="tot"><td style="text-align:left">Total</td><td></td><td>${azIn.length}</td><td>${formatMoneyCompact(azIn.reduce((x, m) => x + m.revenueUsd, 0))}</td></tr></tbody></table>`
    : `<div class="qnote">None in ${esc(scopeLabel())}.</div>`;
  h += section(`Lines costed at an assumed $0 (${c.assumedZeroCost.length})`, c.assumedZeroCost.length
    ? azSummary + `<div class="qnote" style="margin-bottom:0">$0 here is a stated assumption — these products have no manufacturing order at all, so there is no real cost to resolve. Counted as costed on explicit instruction; their reported CM equals their full revenue, not a measured figure.</div>`
      + `<div class="scroll"><table class="tbl"><thead><tr><th>Document</th><th>Item</th><th>Period</th><th>Product</th><th>Revenue</th><th>Reason</th></tr></thead><tbody>`
      + c.assumedZeroCost.slice(0, 500).map(m => `<tr><td class="mono" style="text-align:left">${m.billingDocument}</td><td>${m.billingItem ?? '—'}</td><td>${mLabel(m.period)}</td>`
        + `<td style="text-align:left">${m.material}</td><td>${fmtUSD(m.revenueUsd)}</td><td style="text-align:left">${esc(m.reason)}</td></tr>`).join('')
      + `</tbody></table></div>`
    : `<div class="qnote">None in the current view.</div>`, 'valAssumedZero');

  h += section(`Conversion issues (${c.conversionIssues.length})`, c.conversionIssues.length
    ? `<div class="scroll"><table class="tbl"><thead><tr><th>Document</th><th>Item</th><th>Product</th><th>Quantity</th><th>Unit</th><th>Reason</th></tr></thead><tbody>`
      + c.conversionIssues.map(m => `<tr><td class="mono" style="text-align:left">${m.billingDocument}</td><td>${m.billingItem ?? '—'}</td><td style="text-align:left">${m.material}</td>`
        + `<td>${m.qty}</td><td>${esc(m.unit)}</td><td style="text-align:left">${esc(m.reason)}</td></tr>`).join('') + `</tbody></table></div>`
    : `<div class="qnote">None.</div>`);

  h += section(`Unmatched records (${c.unmatchedRecords.length})`, c.unmatchedRecords.length
    ? `<table class="tbl"><tbody>` + c.unmatchedRecords.map(m => `<tr><td class="mono" style="text-align:left">${m.billingDocument}</td><td>${m.material}</td><td>${fmtUSD(m.revenueUsd)}</td><td style="text-align:left">${esc(m.reason)}</td></tr>`).join('') + `</tbody></table>`
    : `<div class="qnote">None — every ledger revenue line matched a billing item.</div>`);

  $('valBody').innerHTML = h;
  return out;
}
