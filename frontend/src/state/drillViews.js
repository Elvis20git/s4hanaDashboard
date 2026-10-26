/* Extracted once from the original plain-JS dashboard (public/app.js, drill-down levels 1-6); maintained by hand since.
   The original functions were kept verbatim; the DOM writes go to the view object V (committed to the drill store by
   showPanel) and the click wiring becomes V.on = [{ sel, fn }] which the React drawer applies by event delegation. */
import { api, get } from './store.js';
import { commitDrill } from './drill.js';
import { MOF, fmtUSD, fmtK, fmtMT, fmtPct, mLabel, esc, fmtKg, mLabelFromDate } from '../lib/format.js';
import { TERMS } from '../lib/copy.js';
import { summarisePeriods } from '../lib/derive.js';
import { helpIcon, naCell, cmNaBadge, linkPanelHtml, marginBarsHtml, cn } from '../lib/views.js';

// The source read its global state object S; these are live getters over the same fields.
const S = { get source() { return get().source; }, get from() { return get().from; }, get to() { return get().to; } };

let crumb = [], exportRows = [], exportName = 'export';
const fresh = () => ({ title: '', eyebrow: '', grain: '', stats: [], card: null, crumb: [], body: '', count: '', on: [] });
let V = fresh();

// ---- the view-object stand-ins for the source's DOM helpers ----
function setGrain(html) { V.grain = html || ''; }
function paintCrumb() { V.crumb = crumb.map(c => ({ label: c.label, mono: !!c.mono })); }
/** Called by the drawer when a breadcrumb step is clicked: the same behaviour as the source's click handler. */
export function gotoCrumb(i) { const c = crumb[i]; if (!c) return; crumb = crumb.slice(0, i); c.go(); }
function statCells(cells) { V.card = null; V.stats = cells; }
function paintDrillCard(s) { V.card = s; }
function showPanel(wide = false) { commitDrill({ ...V, crumb: V.crumb, exportRows, exportName }, wide); }
/** The margin card shown in the drawer header — the markup the source built in paintDrillCard. */
export function drillCardHtml(s) {
    const pctCls = s.cmPct == null ? '' : s.cmPct >= 0 ? 'pos' : 'neg';
    return `<div class="t">Margin — contribution-YTD ${helpIcon('marginCard', { label: 'ⓘ' })}</div><div class="d">${s.rangeLabel}${s.single ? '' : ' & ' + s.lastMo}</div>`
      + `<div class="mg-hero"><div class="kpi"><div class="pcrow"><span class="pct num ${pctCls}">${s.cmPct == null ? '—' : cn(s.cmPct, 'pct')}</span></div>`
      + (s.last.cmPct != null && !s.single ? `<div class="pct-sub">${s.lastMo} ${fmtPct(s.last.cmPct)}</div>` : '') + `</div>`
      + `<div class="side"><div class="l">CM</div><div class="v num">${cn(s.cm, 'k')}${!s.single && s.last.cm != null ? `<span class="j">${s.lastMo} ${fmtK(s.last.cm)}</span>` : ''}</div></div></div>`
      + `<div class="wf">${marginBarsHtml(s, s.single ? null : s.last, s.lastMo)}</div>`;
}

// ---- ported drill-down functions ----
export function q(extra = {}) {
  const p = new URLSearchParams({ source: S.source, ...extra });
  if (S.from && S.to) { p.set('from', S.from); p.set('to', S.to); }
  return p;
}

export async function openProduct(code) {
  V = fresh();
  const d = await api('/api/data?' + q({ material: code }));
  const name = (d.products[0] && d.products[0].name) || code;
  crumb = [{ label: name, go: () => openProduct(code) }];
  V.title = name; V.eyebrow = 'Product · summarized-YTD';
  setGrain('📐 Level 1 of 5 — pick a period to reach its billing documents');
  const ps = summarisePeriods(d.periods);
  statCells([['Volume', fmtMT(d.total.qtyMt)], ['Revenue', fmtK(d.total.revenue)],
             ['VC', d.total.cogm == null ? 'N/A' : fmtK(d.total.cogm)],
             ['CM', d.total.cm == null ? 'N/A' : fmtK(d.total.cm)]]);
  paintDrillCard(ps);
  paintCrumb(); paintPeriodRows(d, p => openProductPeriod(code, name, p.period));
  exportRows = d.periods; exportName = name + '_by_period'; showPanel();
}

export async function openCustomer(code) {
  V = fresh();
  const d = await api('/api/data?' + q({ customer: code }));
  const name = (d.customers[0] && d.customers[0].name) || code;
  crumb = [{ label: name, go: () => openCustomer(code) }];
  V.title = name; V.eyebrow = 'Customer · summarised-YTD';
  setGrain('📐 Level 1 of 5 — pick a period to reach its billing documents');
  const ps = summarisePeriods(d.periods);
  statCells([['Volume', fmtMT(d.total.qtyMt)], ['Revenue', fmtK(d.total.revenue)],
             ['VC', d.total.cogm == null ? 'N/A' : fmtK(d.total.cogm)],
             ['CM', d.total.cm == null ? 'N/A' : fmtK(d.total.cm)]]);
  paintDrillCard(ps);
  paintCrumb(); paintPeriodRows(d, p => openCustomerPeriod(code, name, p.period));
  exportRows = d.periods; exportName = name + '_by_period'; showPanel();
}

function paintPeriodRows(d, onPick) {
  const ps = [...d.periods].reverse();
  V.body = `<div class="mixhdr"><span>By period — ${ps.length} with activity</span><span>latest first</span></div>`
    + ps.map(p => `<div class="monthrow" data-p="${p.period}"><div class="mtag"><div class="mo">${MOF[+p.period.slice(0,2)-1]}</div><div class="yr">${p.period.slice(3)}</div></div>`
      + `<div class="mid"><div class="rf" style="font-family:'Inter';font-size:12.5px;font-weight:600">${mLabel(p.period)}</div>`
      + `<div class="u">${fmtMT(p.qtyMt)} · ${p.lines} line${p.lines !== 1 ? 's' : ''}`
      + (p.cm == null ? ' · ' + cmNaBadge() : ` · CM ${fmtK(p.cm)} (${fmtPct(p.cmPct)})`) + `</div></div>`
      + `<div class="amt"><div class="v num">${fmtK(p.revenue)}</div><div class="c">${p.cogm == null ? '' : 'VC ' + fmtK(p.cogm)}</div></div></div>`).join('');
  V.count = `${ps.length} periods`;
  V.on.push({ sel: '.monthrow', fn: el => (() => onPick({ period: el.dataset.p }))() });
}

export async function openPeriod(period) {
  V = fresh();
  const d = await api('/api/data?' + q({ period }));
  crumb = [{ label: mLabel(period), go: () => openPeriod(period) }];
  V.title = mLabel(period); V.eyebrow = 'Period · product mix';
  // The flag follows the period down to its own drill level too, not only
  // the chart/list/selector above — same gold-note language the grain
  // already uses for this level.
  setGrain('📐 Material × billing date. Billing documents are one level down.'
    + (d.total.provisional ? ' <b>Open period</b> — overhead not yet settled at period close.' : ''));
  statCells([['Revenue', fmtK(d.total.revenue)], ['Volume', fmtMT(d.total.qtyMt)],
             ['VC', d.total.cogm == null ? 'N/A' : fmtK(d.total.cogm)],
             ['CM', d.total.cm == null ? 'N/A' : fmtK(d.total.cm)], ['Lines', d.total.lines]]);
  paintCrumb();
  const tot = d.total.revenue || 1;
  V.body = `<div class="mixhdr"><span>Product mix — ${d.products.length} product(s) · click to isolate</span></div>`
    + d.products.map(p => `<div class="doc" style="cursor:pointer" data-code="${p.code}">`
      + `<div class="dt" style="background:var(--color-green-soft);min-width:44px"><div class="d num">${(p.revenue / tot * 100).toFixed(0)}%</div></div>`
      + `<div class="mid"><div class="rf" style="font-family:'Inter'">${esc(p.name)}</div><div class="sub">${fmtMT(p.qtyMt)}`
      + (p.cm == null ? ' · ' + cmNaBadge() : ` · CM ${fmtPct(p.cmPct)}`) + `</div></div>`
      + `<div class="amt"><div class="v num">${fmtK(p.revenue)}</div></div></div>`).join('');
  V.count = `${d.products.length} products · ${d.total.lines} lines in ${mLabel(period)}`;
  V.on.push({ sel: '.doc', fn: el => (() => openProductPeriod(el.dataset.code, null, period))() });
  exportRows = d.products; exportName = period.replace('.', '-') + '_products'; showPanel();
}

export async function openProductPeriod(code, name, period) {
  V = fresh();
  const r = await api('/api/lines?' + q({ material: code, period }));
  name = name || (r.rows[0] && r.rows[0].materialName) || code;
  crumb = [{ label: name, go: () => openProduct(code) }, { label: mLabel(period), go: () => openProductPeriod(code, name, period) }];
  paintDocs(r.rows, `${name} · ${mLabel(period)}`, 'Billing documents', l => openDocument(l.billingDocument, { code, name, period, kind: 'product' }));
}
export async function openCustomerPeriod(code, name, period) {
  V = fresh();
  const r = await api('/api/lines?' + q({ customer: code, period }));
  crumb = [{ label: name, go: () => openCustomer(code) }, { label: mLabel(period), go: () => openCustomerPeriod(code, name, period) }];
  paintDocs(r.rows, `${name} · ${mLabel(period)}`, 'Billing documents', l => openDocument(l.billingDocument, { code, name, period, kind: 'customer' }));
}

function paintDocs(rows, title, eyebrow, onPick) {
  const docs = new Map();
  for (const l of rows) {
    const e = docs.get(l.billingDocument) ?? { doc: l.billingDocument, date: l.billingDate, rev: 0, qty: 0, cogm: 0, costed: 0, lines: 0, party: l.customerName, prod: l.materialName };
    e.rev += l.revenueUsd; e.lines++;
    if (l.qtyMt != null) e.qty += l.qtyMt;
    if (l.cogmUsd != null) { e.cogm += l.cogmUsd; e.costed++; }
    docs.set(l.billingDocument, e);
  }
  const list = [...docs.values()].sort((a, b) => b.date.localeCompare(a.date));
  V.title = title; V.eyebrow = eyebrow;
  setGrain('📐 Level 3 of 5 — pick a document to reach its items and sold batches');
  const rev = list.reduce((s, x) => s + x.rev, 0);
  statCells([['Revenue', fmtK(rev)], ['Documents', list.length], ['Lines', rows.length]]);
  paintCrumb();
  V.body = list.map(e => {
    const dt = new Date(e.date + 'T00:00:00');
    const cm = e.costed ? e.rev - e.cogm : null;
    return `<div class="doc" style="cursor:pointer" data-doc="${e.doc}"><div class="dt"><div class="d num">${dt.getDate()}</div><div class="mo">${MOF[dt.getMonth()]}</div></div>`
      + `<div class="mid"><div class="rf">${e.doc}</div><div class="sub">${esc(e.party || e.prod || '')} · ${e.lines} item${e.lines !== 1 ? 's' : ''}`
      + (cm == null ? ' · ' + cmNaBadge() : ` · CM ${fmtK(cm)}`) + `</div></div>`
      + `<div class="amt"><div class="v num">${fmtK(e.rev)}</div><div class="q">${e.qty ? fmtMT(e.qty) : ''}</div></div></div>`;
  }).join('');
  V.count = `${list.length} billing document${list.length !== 1 ? 's' : ''}`;
  V.on.push({ sel: '.doc', fn: el => (() => onPick({ billingDocument: el.dataset.doc }))() });
  exportRows = list; exportName = title.replace(/\W+/g, '_') + '_documents'; showPanel();
}

export async function openDocument(billingDocument, ctx) {
  V = fresh();
  const r = await api('/api/lines?' + q({ billingDocument }));
  const back = ctx.kind === 'product'
    ? () => openProductPeriod(ctx.code, ctx.name, ctx.period)
    : () => openCustomerPeriod(ctx.code, ctx.name, ctx.period);
  crumb = [{ label: ctx.name, go: () => (ctx.kind === 'product' ? openProduct(ctx.code) : openCustomer(ctx.code)) },
           { label: mLabel(ctx.period), go: back },
           { label: billingDocument, mono: true, go: () => openDocument(billingDocument, ctx) }];
  V.title = 'Billing document ' + billingDocument;
  V.eyebrow = 'Items and sold batches';
  setGrain('📐 Level 4 of 5 — one row per billing item and batch. Click a manufacturing order for its cost.');
  const rev = r.rows.reduce((s, l) => s + l.revenueUsd, 0);
  const cogm = r.rows.reduce((s, l) => s + (l.cogmUsd || 0), 0);
  const anyCost = r.rows.some(l => l.cogmUsd != null);
  statCells([['Revenue', fmtK(rev)], ['VC', anyCost ? fmtK(cogm) : 'N/A'],
             ['CM', anyCost ? fmtK(rev - cogm) : 'N/A'], ['Items', r.rows.length]]);
  paintCrumb();
  V.body = `<div class="pl" style="overflow-x:auto"><table class="tbl">`
    + `<thead><tr><th>Item</th><th>Billing date</th><th>Product</th><th>Qty (MT)</th><th>Net revenue (USD)</th><th>Batch</th><th>Mfg orders</th><th>VC (USD)</th><th>CM (USD)</th><th>CM %</th><th>Status</th></tr></thead><tbody>`
    + r.rows.map(l => `<tr><td>${l.billingItem ?? '—'}</td><td>${l.billingDate}</td>`
      + `<td style="text-align:left">${esc(l.materialName)}<div class="sub mono">${l.material}</div></td>`
      + `<td>${l.qtyMt == null ? `<span class="na" title="No valid ${esc(l.baseUnit)}→MT conversion">${l.qtyKg} ${esc(l.baseUnit)}</span>` : l.qtyMt.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>`
      + `<td>${fmtK(l.revenueUsd)}</td>`
      + `<td class="mono">${l.batch ? esc(l.batch) : naCell('Missing batch')}</td>`
      + `<td><div class="ordlist">${(l.orders || []).map(o => `<span data-order="${o}" data-batch="${esc(l.batch)}">${o}</span>`).join('') || '<span class="na" style="border:0;background:none">—</span>'}</div></td>`
      + `<td>${l.cogmUsd == null ? naCell(l.costReason) : fmtK(l.cogmUsd)}</td>`
      + `<td>${l.cmUsd == null ? naCell(l.costReason) : fmtK(l.cmUsd)}</td>`
      + `<td>${l.cmPct == null ? naCell(l.costReason) : fmtPct(l.cmPct)}</td>`
      + `<td><span class="statepill ${l.costStatus === 'final' ? 'final' : l.costStatus === 'provisional' ? 'provisional' : l.costStatus === 'assumed-zero' ? 'assumed' : 'none'}" title="${esc(l.costReason || 'Batch resolves, orders settled, period closed')}">${l.costStatus === 'not-costed' ? 'Not costed' : l.costStatus === 'assumed-zero' ? 'Assumed $0' : l.costStatus}</span></td></tr>`).join('')
    + `</tbody></table></div>`
    + (anyCost ? '' : `<div class="qnote">No VC on this document — ${esc(r.rows[0]?.costReason || 'cost not available')}. Revenue, quantity, product and customer are reported in full.</div>`);
  V.count = `${r.rows.length} billing item${r.rows.length !== 1 ? 's' : ''}`;
  V.on.push({ sel: '[data-order]', fn: el => (() => openOrders(el.dataset.batch, ctx, billingDocument))() });
  exportRows = r.rows.map(l => ({ billingDocument: l.billingDocument, billingItem: l.billingItem, billingDate: l.billingDate,
    product: l.material, productName: l.materialName, qtyMt: l.qtyMt, revenueUsd: l.revenueUsd, batch: l.batch,
    orders: (l.orders || []).join(' '), cogmUsd: l.cogmUsd, cmUsd: l.cmUsd, cmPct: l.cmPct, status: l.costStatus, reason: l.costReason }));
  exportName = billingDocument + '_items'; showPanel(true);
}

export async function openOrders(batch, ctx, billingDocument) {
  V = fresh();
  const b = await api('/api/batch/' + encodeURIComponent(batch));
  crumb = [{ label: ctx.name, go: () => (ctx.kind === 'product' ? openProduct(ctx.code) : openCustomer(ctx.code)) },
           { label: mLabel(ctx.period), go: () => (ctx.kind === 'product' ? openProductPeriod(ctx.code, ctx.name, ctx.period) : openCustomerPeriod(ctx.code, ctx.name, ctx.period)) },
           { label: billingDocument, mono: true, go: () => openDocument(billingDocument, ctx) },
           { label: batch, mono: true, go: () => openOrders(batch, ctx, billingDocument) }];
  V.title = 'Batch ' + batch;
  V.eyebrow = 'Level 5 of 6 — the manufacturing orders behind this VC';
  setGrain('📐 Order cost is the signed sum on materials, activities and utilities, apportioned by received quantity.');
  statCells([['Batch cost', fmtK(b.cost)], ['Produced', (b.qty / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' MT'],
             ['Unit cost', '$' + (b.unitCostPerKg * 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '/MT'],
             ['State', b.final ? 'Final' : 'Provisional']]);
  paintCrumb();
  const goOrder = o => openOrder(o, { batch, ctx, billingDocument });
  V.body = `<div class="pl" style="overflow-x:auto"><table class="tbl">`
    + `<thead><tr><th>Manufacturing order</th><th>Order cost (USD)</th><th>Materials</th><th>Activities</th><th>${TERMS.utilities} ${helpIcon('overhead')}</th></tr></thead><tbody>`
    + b.orderDetail.map(o => `<tr><td style="text-align:left"><div class="ordlist"><button type="button" data-order="${o.order}">${o.order}</button></div></td><td>${o.cost == null ? '—' : fmtK(o.cost)}</td>`
      + `<td>${fmtK(o.buckets?.materials || 0)}</td><td>${fmtK(o.buckets?.activities || 0)}</td><td>${fmtK(o.buckets?.overhead || 0)}</td></tr>`).join('')
    + `<tr class="tot"><td>Batch total (apportioned)</td><td>${fmtK(b.cost)}</td><td colspan="3">${b.qty.toLocaleString()} KG received · frozen at $${(b.unitCostPerKg * 1000).toFixed(2)}/MT</td></tr>`
    + `</tbody></table></div>`
    + `<div class="insight">The unit cost is <b>frozen</b>: this batch carries $${(b.unitCostPerKg * 1000).toFixed(2)}/MT on every line that sells it, in any period, and a credit note reverses at the same rate. `
    + `Where an order also fed other batches, only its quantity share is charged here.</div>`
    + linkPanelHtml(b.link, { kind: 'batch', focus: batch, title: 'Produced by' });
  V.on.push({ sel: '[data-order]', fn: el => (() => goOrder(el.dataset.order))() });
  V.count = `${b.orderDetail.length} manufacturing order${b.orderDetail.length !== 1 ? 's' : ''}`;
  exportRows = b.orderDetail.map(o => ({ batch, order: o.order, orderCost: o.cost,
    materials: o.buckets?.materials, activities: o.buckets?.activities, utilities: o.buckets?.overhead }));
  exportName = batch + '_orders'; showPanel(true);
}

export async function openOrder(orderId, back) {
  V = fresh();
  const o = await api('/api/order/' + encodeURIComponent(orderId));
  crumb = [{ label: back.ctx.name, go: () => (back.ctx.kind === 'product' ? openProduct(back.ctx.code) : openCustomer(back.ctx.code)) },
           { label: mLabel(back.ctx.period), go: () => (back.ctx.kind === 'product' ? openProductPeriod(back.ctx.code, back.ctx.name, back.ctx.period) : openCustomerPeriod(back.ctx.code, back.ctx.name, back.ctx.period)) },
           { label: back.billingDocument, mono: true, go: () => openDocument(back.billingDocument, back.ctx) },
           { label: back.batch, mono: true, go: () => openOrders(back.batch, back.ctx, back.billingDocument) },
           { label: orderId, mono: true, go: () => openOrder(orderId, back) }];
  V.title = 'Order ' + orderId;
  V.eyebrow = 'Level 6 of 6 — materials, activities and utilities actually posted';
  const postedRange = o.postingDateFrom === o.postingDateTo ? mLabelFromDate(o.postingDateFrom)
    : `${mLabelFromDate(o.postingDateFrom)} – ${mLabelFromDate(o.postingDateTo)}`;
  setGrain(`📐 Costs posted ${esc(postedRange)} · full actual cost, independent of the dashboard's own date range`);
  statCells([['Total actual cost', fmtK(o.totalCost)],
             ['Cost per kg produced', o.actualCostPerKg == null ? '—' : '$' + o.actualCostPerKg.toFixed(3)],
             ['Produced', fmtKg(o.qtyProducedKg)],
             ['Lines posted', o.lineCount]]);
  paintCrumb();

  const mx = Math.max(o.totalCost, 1);
  const bar = (label, val, color) => `<div class="wfrow"><div class="wl">${esc(label)}</div>`
    + `<div class="wt"><div class="wf-fill" style="width:${Math.max(2, Math.abs(val) / mx * 100)}%;background:${color}"></div></div>`
    + `<div class="wv">${fmtK(val)} <span style="color:var(--color-tx-3);font-weight:500">(${fmtPct(mx ? val / mx * 100 : null)})</span></div></div>`;
  const section2 = (title, help, inner) => `<div class="level" style="margin-top:14px"><span class="t">${esc(title)} ${helpIcon(help)}</span><span class="ln"></span></div>${inner}`;

  const gapsNote = o.headerGaps?.length
    ? `<div class="qnote">Not available — no order-header API is authorized: ${o.headerGaps.map(esc).join(', ')}. Shown instead: the posting date range above and the quantity produced from goods receipts.</div>` : '';

  const materialsTbl = `<table class="tbl"><thead><tr><th style="text-align:left">Component</th><th>Qty</th><th>Actual cost (USD)</th></tr></thead><tbody>`
    + o.materials.map(m => `<tr><td style="text-align:left">${esc(m.componentName || m.component)}<div class="sub mono">${esc(m.component)}</div></td>`
      + `<td>${m.qty.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${esc(m.unit || '')}</td><td>${fmtK(m.cost)}${m.hadReversal ? ' <span class="badge mid" title="A correction or reversal posted on this component nets out in this total">net</span>' : ''}</td></tr>`).join('')
    + `<tr class="tot"><td>Materials total</td><td></td><td>${fmtK(o.materialsTotal)}</td></tr></tbody></table>`;
  const oneRowTbl = (label, row, sub) => `<table class="tbl"><thead><tr><th style="text-align:left">${esc(label)}</th><th>Basis quantity</th><th>Actual cost (USD)</th></tr></thead><tbody>`
    + `<tr><td style="text-align:left">${esc(label)} ${sub ? `<span class="sub mono">· ${esc(sub)}</span>` : '(combined — see ⓘ)'}</td><td>${row.qty ? row.qty.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' ' + esc(row.unit || '') : '—'}</td>`
    + `<td>${fmtK(row.cost)}${row.hadReversal ? ' <span class="badge mid" title="A correction or reversal posted on this bucket nets out in this total">net</span>' : ''}</td></tr></tbody></table>`;

  V.body = `<div class="mg-hero" style="padding:6px 0 14px">` + bar('Materials', o.materialsTotal, 'var(--color-green)')
    + bar('Activities', o.activities.cost, '#C0CEC7') + bar(o.overhead.label || TERMS.utilities, o.overhead.cost, 'var(--color-mint)') + `</div>`
    + gapsNote
    + section2('Materials', 'materials', materialsTbl)
    + section2('Activities', 'activities', oneRowTbl('Activities', o.activities))
    + section2(o.overhead.label || TERMS.utilities, 'overhead', oneRowTbl(o.overhead.label || TERMS.utilities, o.overhead, o.overhead.source))
    + (o.compareBatches?.length ? `<div class="level" style="margin-top:14px"><span class="t">Cost per unit vs. the batch(es) it fed</span><span class="ln"></span></div>`
      + `<table class="tbl"><thead><tr><th style="text-align:left">Batch</th><th>This order's cost/kg</th><th>Batch's frozen cost/kg</th><th>Difference</th></tr></thead><tbody>`
      + o.compareBatches.map(c => `<tr><td style="text-align:left"><div class="ordlist"><button type="button" data-batch="${c.batch}">${c.batch}</button></div></td>`
        + `<td>${o.actualCostPerKg == null ? '—' : '$' + o.actualCostPerKg.toFixed(3)}</td>`
        + `<td>${c.unitCostPerKg == null ? '—' : '$' + c.unitCostPerKg.toFixed(3)}</td>`
        + `<td>${c.diffPerKg == null ? '—' : (c.diffPerKg >= 0 ? '+' : '') + '$' + c.diffPerKg.toFixed(3) + (c.diffPct != null ? ` (${c.diffPct >= 0 ? '+' : ''}${c.diffPct.toFixed(1)}%)` : '')}${c.reason ? `<div class="sub">${esc(c.reason)}</div>` : ''}</td></tr>`).join('')
      + `</tbody></table>` : '')
    + linkPanelHtml(o.link, { kind: 'order', focus: orderId, title: 'Produced into' });
  V.on.push({ sel: '[data-batch]', fn: el => (() => openOrders(el.dataset.batch, back.ctx, back.billingDocument))() });
  V.count = `${o.materials.length} material${o.materials.length !== 1 ? 's' : ''} · ${o.lineCount} posting${o.lineCount !== 1 ? 's' : ''}`;
  exportRows = o.materials.map(m => ({ order: orderId, section: 'materials', component: m.component, name: m.componentName, qty: m.qty, unit: m.unit, cost: m.cost }))
    .concat([{ order: orderId, section: 'activities', component: '', name: '', qty: o.activities.qty, unit: o.activities.unit, cost: o.activities.cost },
             { order: orderId, section: 'utilities', component: o.overhead.source || '', name: o.overhead.label || TERMS.utilities, qty: o.overhead.qty, unit: o.overhead.unit, cost: o.overhead.cost }]);
  exportName = orderId + '_cost'; showPanel(true);
}
