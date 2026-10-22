/* Hover/focus tooltip for the period chart — one handler for a column, its dot and its pill (matched by x position). Ported
   unchanged from the source dashboard (public/app.js chartTooltip); the geometry comes from getGeo() instead of module globals. */
import { mLabel, esc, fmtPct, formatMoneyCompact, formatAvgPriceKg } from './format.js';
import { fgOf, fgAvgKg } from './derive.js';
import { VC_DEF } from './copy.js';
export function attachChartTooltip(svg, tip, getGeo) {
  const P = () => getGeo().pts, GEO = () => getGeo();
  const usd = formatMoneyCompact;   // compact B/M/K money, one shared formatter
  const hl = i => { svg.querySelectorAll('.hl').forEach(el => el.classList.remove('hl')); if (i != null) svg.querySelectorAll(`[data-i="${i}"]`).forEach(el => el.classList.add('hl')); };
  function show(i) {
    const p = P()[i], g = fgOf(p); if (!p) return hide();
    // Everything here is Finished Goods (B2B/B2C) only, from the same per-period figures as the hero and the chart.
    const pg = fgOf(P()[i - 1]), q = g ? g.qtyMt : null;
    let chg = '';
    if (pg && pg.qtyMt && q != null) { const c = (q - pg.qtyMt) / Math.abs(pg.qtyMt) * 100; chg = `<div class="r"><span>QTY vs prev. month</span><b class="${c >= 0 ? 'up' : 'dn'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%</b></div>`; }
    const kg = fgAvgKg(p);
    tip.innerHTML = `<div class="th">${esc(mLabel(p.period))} · B2B/B2C${p.provisional ? ' <em>· open period</em>' : ''}</div>`
      + `<div class="r"><span>Revenue (B2B/B2C)</span><b>${g ? usd(g.revenue) : '—'}</b></div>`
      + `<div class="r"><span>Variable cost (B2B/B2C)</span><b>${g && g.cogm != null ? `${usd(g.cogm)} (${g.cogmPct != null ? fmtPct(g.cogmPct) : '—'})` : '—'}</b></div>`
      + `<div class="r"><span>Contribution margin (B2B/B2C)</span><b>${g && g.cm != null ? `${usd(g.cm)} (${g.cmPct != null ? fmtPct(g.cmPct) : '—'})` : '—'}</b></div>`
      + `<div class="r"><span>QTY (MT)</span><b>${q == null ? '—' : q.toLocaleString('en-US', { maximumFractionDigits: 1 })}</b></div>`
      + `<div class="r"><span>Avg price</span><b>${formatAvgPriceKg(kg)}</b></div>` + chg
      + `<div class="fn">Finished Goods only. Excludes Others.<span class="vcdef">${esc(VC_DEF)}</span></div>`;
    tip.hidden = false; hl(i);
    // Sit beside the hovered column (right if there is room, else left) so it never covers that column or its
    // revenue label, and keep it inside the chart box, top and bottom included.
    const host = tip.offsetParent || tip.parentElement, hb = host.getBoundingClientRect(), r = svg.getBoundingClientRect();
    const sx = r.width / GEO().W, cx = r.left - hb.left + GEO().cxs[i] * sx, half = GEO().cw * sx / 2, tw = tip.offsetWidth, gapx = 10;
    let left = cx + half + gapx;
    if (left + tw > hb.width - 4) left = cx - half - gapx - tw;
    tip.style.left = Math.min(Math.max(4, left), Math.max(4, hb.width - tw - 4)) + 'px';
    tip.style.top = Math.min(Math.max(4, r.top - hb.top + 4), Math.max(4, hb.height - tip.offsetHeight - 4)) + 'px';
  }
  function hide() { tip.hidden = true; hl(null); }
  const idxAt = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * GEO().W; let best = 0; GEO().cxs.forEach((c, i) => { if (Math.abs(c - x) < Math.abs(GEO().cxs[best] - x)) best = i; }); return best; };
  svg.addEventListener('mousemove', e => { if (P().length) show(idxAt(e)); });
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('focusin', e => { const b = e.target.closest('.bar-hit'); if (b) show(P().findIndex(p => p.period === b.dataset.p)); });
  svg.addEventListener('focusout', hide);
}
