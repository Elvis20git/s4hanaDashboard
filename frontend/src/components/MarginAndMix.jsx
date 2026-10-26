import { useMemo, useRef } from 'react';
import { buildMargin, buildContribution } from '../lib/views.js';
import { useAnimCard } from '../hooks/useAnimCard.js';
import { useAppState, toggleCollapsed } from '../state/store.js';
import { openProduct } from '../state/drillViews.js';
import { HelpIcon } from './HelpIcon.jsx';

const Html = ({ as: T = 'span', html, ...p }) => <T {...p} dangerouslySetInnerHTML={{ __html: html }} />;

/** Section 3 — Margin — contribution (B2B/B2C, shared markup with the product drawer) and Revenue contribution by product (grouped
    donut + legend). Section 4 — Profitability by product. */
export function MarginAndMix() {
  const st = useAppState();
  const m = useMemo(() => buildMargin(st), [st.data, st.from, st.to]);                  // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(() => buildContribution(st), [st.data, st.tick]);                    // eslint-disable-line react-hooks/exhaustive-deps
  const tileRef = useRef(null), donutCardRef = useRef(null), donutRef = useRef(null);
  useAnimCard(tileRef, [m.mgWf && m.mgWf.innerHTML, m.mgPct && m.mgPct.innerHTML]);
  useAnimCard(donutCardRef, [c.donut && c.donut.innerHTML, c.dlegend && c.dlegend.innerHTML]);

  // hovering a legend group (or category) title highlights its segments and dims the rest — the source's hl()
  const hl = key => {
    const svg = donutRef.current; if (!svg) return;
    const [g, cat] = key ? key.split(':') : [];
    svg.classList.toggle('dim', !!key);
    svg.querySelectorAll('.seg').forEach(el => el.classList.toggle('hl', !!key && el.dataset.g === g && (!cat || el.dataset.cat === cat)));
  };
  const onLegendClick = e => {
    const dlg = e.target.closest('.dlg');
    if (dlg) { hl(null); toggleCollapsed(dlg.dataset.k); return; }
    const dl = e.target.closest('.dl'); if (dl && dl.dataset.code) openProduct(dl.dataset.code);
  };
  const onLegendOver = e => { const dlg = e.target.closest('.dlg'); if (dlg) hl(dlg.dataset.hl); };
  const onLegendOut = e => { const dlg = e.target.closest('.dlg'); if (dlg && !dlg.contains(e.relatedTarget)) hl(null); };
  const onSegClick = e => { const s = e.target.closest('.seg'); if (s && s.dataset.code) openProduct(s.dataset.code); };
  const onRowClick = e => { const r = e.target.closest('.rowbtn'); if (r) openProduct(r.dataset.code); };

  const mi = k => (m[k] ? m[k].innerHTML : '');
  return (
    <>
      <div className="level rise" style={{ animationDelay: '.24s' }}><span className="n">3</span><span className="t">Margin and revenue mix</span><span className="ln" /></div>
      <div className="grid grid2">
        <div className="tile live rise" id="marginTile" ref={tileRef} style={{ animationDelay: '.26s' }}>
          <div className="tile-h"><div>
            <div className="t">Margin — contribution-YTD <HelpIcon k="marginCard" label="ⓘ" /></div>
            <div className="d" id="mgSub">{m.mgSub ? m.mgSub.textContent : 'B2B/B2C'}</div>
          </div></div>
          <div className="mg-hero">
            <div className="kpi">
              <div className="pcrow">
                <Html id="mgPct" className={(m.mgPct && m.mgPct.className) || 'pct num'} html={mi('mgPct') || '–'} />
                <HelpIcon id="mgInfo" k="marginPct" label="ⓘ" ariaLabel="How contribution margin is calculated" aria-describedby="popBody" style={m.mgInfo && m.mgInfo.style.display === 'none' ? { display: 'none' } : undefined} />
              </div>
              <div className="pct-sub" id="mgPctSub">{m.mgPctSub ? m.mgPctSub.textContent : ''}</div>
            </div>
            <div className="side"><div className="l">CM</div><Html as="div" className="v num" id="mgCm" html={mi('mgCm') || '–'} /></div>
          </div>
          <Html as="div" className="wf" id="mgWf" html={mi('mgWf')} />
        </div>
        <div className="cbox live rise" ref={donutCardRef} style={{ animationDelay: '.28s' }}>
          <div className="hd"><div className="t">{c.donutTitle ? c.donutTitle.textContent : 'Revenue contribution by product-YTD'} <HelpIcon k="donutCard" label="ⓘ" /></div><div className="d">Share of net revenue</div></div>
          <div className="donutwrap">
            <svg className="donut" id="donut" viewBox="0 0 200 200" ref={donutRef} onClick={onSegClick} dangerouslySetInnerHTML={{ __html: c.donut ? c.donut.innerHTML : '' }} />
            <div className="dlegend" id="dlegend" onClick={onLegendClick} onMouseOver={onLegendOver} onMouseOut={onLegendOut}
              onFocus={e => { const g = e.target.closest('.dlg'); if (g) hl(g.dataset.hl); }} onBlur={e => { if (e.target.closest('.dlg')) hl(null); }}
              dangerouslySetInnerHTML={{ __html: c.dlegend ? c.dlegend.innerHTML : '' }} />
          </div>
        </div>
      </div>

      <div className="level rise" style={{ animationDelay: '.32s' }}>
        <span className="n">4</span><span className="t">Profitability by product-YTD</span><span className="src" id="lvl3src">{c.lvl3src ? c.lvl3src.textContent : 'Actual VC'}</span><span className="ln" />
      </div>
      <div className="cbox rise" style={{ animationDelay: '.34s' }}>
        <div className="hd"><div className="t">Profitability by product-YTD</div><div className="d" id="profDetail">{c.profDetail ? c.profDetail.textContent : 'Click a row for the waterfall'}</div></div>
        <div className="prof-body"><table className="tbl" id="profTbl" onClick={onRowClick} dangerouslySetInnerHTML={{ __html: c.profTbl ? c.profTbl.innerHTML : '' }} /></div>
      </div>
    </>
  );
}
