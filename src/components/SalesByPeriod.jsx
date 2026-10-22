import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildPeriod } from '../lib/views.js';
import { attachChartTooltip } from '../lib/chartTip.js';
import { periodOnPlay } from '../lib/anim.js';
import { useAnimCard } from '../hooks/useAnimCard.js';
import { useAppState } from '../state/store.js';
import { openPeriod } from '../state/drillViews.js';
import { HelpIcon } from './HelpIcon.jsx';

/** Section 1 — Sales by period: the pixel-sized SVG column chart (total revenue columns, B2B/B2C CM inner bars, B2B/B2C QTY line
    + dots + pills, hover tooltip) and the Month-by-month comparison list. The chart markup is the source's SVG builder; the box it
    is drawn into is measured here and re-measured by a ResizeObserver. */
export function SalesByPeriod() {
  const st = useAppState();
  const cardRef = useRef(null), wrapRef = useRef(null), svgRef = useRef(null), tipRef = useRef(null);
  const geoRef = useRef({ pts: [], W: 560, cxs: [], cw: 40 });
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const rect = () => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; };
    setBox(rect());
    if (!window.ResizeObserver) return undefined;
    let last = '', raf = 0;
    const ro = new ResizeObserver(() => {
      const k = Math.round(el.clientWidth) + 'x' + Math.round(el.clientHeight);
      if (k === last) return; last = k;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setBox(rect()));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const p = useMemo(() => buildPeriod(st, box), [st.data, st.priorPeriodData, box.width, box.height]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (p.geo) geoRef.current = { pts: p.geo.pts, W: p.geo.W, cxs: p.geo.cxs, cw: p.geo.cw };

  useEffect(() => attachChartTooltip(svgRef.current, tipRef.current, () => geoRef.current), []);
  useAnimCard(cardRef, [p.chart && p.chart.innerHTML], periodOnPlay);

  const d = st.data;
  const onChartClick = e => { const b = e.target.closest('.bar-hit'); if (b) openPeriod(b.dataset.p); };
  const onListClick = e => { const r = e.target.closest('.mrow'); if (r) openPeriod(r.dataset.p); };
  return (
    <>
      <div className="level rise" style={{ animationDelay: '.08s' }}>
        <span className="n">1</span><span className="t">Sales by period — month by month</span>
        <span className="src" id="lvl1src">{d ? (d.source === 'api' ? 'Live SAP' : 'Spreadsheet') : 'Live SAP'}</span><span className="ln" />
      </div>
      <div className="period rise" style={{ animationDelay: '.10s' }} ref={cardRef}>
        <div className="period-h">
          <div className="t">Sales by period <span className="hint" id="periodHint">{p.periodHint ? p.periodHint.textContent : ''}</span> <HelpIcon k="periodCard" label="ⓘ" /></div>
          <div className="lg">
            <span><i style={{ background: 'var(--color-green)' }} />Revenue (total)</span>
            <span><i style={{ background: 'var(--color-mint)' }} />Contribution margin (B2B/B2C)</span>
            <span><svg className="lg-q" width="18" height="9" viewBox="0 0 18 9" aria-hidden="true"><path d="M0 4.5H18" stroke="var(--color-amber)" strokeWidth="2.5" strokeLinecap="round" /><circle cx="9" cy="4.5" r="3.2" fill="var(--color-amber)" stroke="#fff" strokeWidth="1.2" /></svg>QTY (MT, B2B/B2C)</span>
          </div>
        </div>
        <div className="period-grid">
          <div className="chartwrap" ref={wrapRef}>
            <svg className="chart" id="chart" ref={svgRef} viewBox={(p.chart && p.chart.attrs.viewBox) || '0 0 560 236'} onClick={onChartClick}
              dangerouslySetInnerHTML={{ __html: p.chart ? p.chart.innerHTML : '' }} />
            <div className="ctip" id="chartTip" ref={tipRef} hidden />
          </div>
          <div className="mlist" id="mlist" onClick={onListClick} dangerouslySetInnerHTML={{ __html: p.mlist ? p.mlist.innerHTML : '' }} />
        </div>
      </div>
    </>
  );
}
