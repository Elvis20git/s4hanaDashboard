import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { buildHero } from '../lib/views.js';
import { drawSpark, sparkAnim } from '../lib/spark.js';
import { useAppState } from '../state/store.js';
import { HelpIcon } from './HelpIcon.jsx';

/** The net-sales sparkline beside the KPI cards: drawn in real pixels from its box, re-drawn (without replaying the entrance
    animation) when the box is resized; a resize that lands during the entrance animation waits for it to finish. */
function Spark({ periods }) {
  const ref = useRef(null), periodsRef = useRef(periods);
  useLayoutEffect(() => { periodsRef.current = periods; if (ref.current && periods) drawSpark(ref.current, periods, true); }, [periods]);
  useEffect(() => {
    const box = ref.current && ref.current.parentElement; if (!box || !window.ResizeObserver) return undefined;
    let last = '', timer = 0;
    const ro = new ResizeObserver(() => {
      const k = Math.round(box.clientWidth) + 'x' + Math.round(box.clientHeight);
      if (k === last) return; last = k;
      clearTimeout(timer);
      timer = setTimeout(() => { if (periodsRef.current) drawSpark(ref.current, periodsRef.current, false); }, Math.max(120, sparkAnim.until - performance.now()));
    });
    ro.observe(box);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, []);
  return <div className="hero-spark"><svg className="spark" id="spark" viewBox="0 0 520 96" preserveAspectRatio="none" role="img" aria-label="Net sales by month" ref={ref} /></div>;
}

const Html = ({ as: T = 'span', html, ...p }) => <T {...p} dangerouslySetInnerHTML={{ __html: html }} />;

/** Hero: headline + MoM badge + date range, the three KPI cards (period revenue, quantities, avg price — each with its B2B/B2C /
    Other breakdown) and the sparkline. Every value is what the source's renderHero wrote (see lib/views.js buildHero). */
export function Hero() {
  const st = useAppState();
  const h = useMemo(() => buildHero(st), [st.data, st.from, st.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  const t = (k, d) => (h[k] ? h[k].textContent : d);
  const hi = k => (h[k] ? h[k].innerHTML : '');
  return (
    <section className="hero rise" style={{ animationDelay: '.02s' }}>
      <div className="hero-in">
        <div className="hero-head">
          <div className="eyebrow" id="hEyebrow">{t('hEyebrow', 'Net sales')}</div>
          <div className="big num" id="hBig">{t('hBig', '$0')}</div>
          <div className="under">
            <Html id="hDelta" className={(h.hDelta && h.hDelta.className) || 'delta'} title={(h.hDelta && h.hDelta.title) || undefined} html={hi('hDelta')} />
            {hi('hScope') ? <Html id="hScope" className="asof" html={hi('hScope')} /> : <span className="asof" id="hScope">{t('hScope', '')}</span>}
          </div>
        </div>
        <div className="hstats">
          <div className="hstat"><div className="hs-in">
            <div className="l" id="hLatestL">{t('hLatestL', 'Latest period')}</div>
            <div className="v num" id="hLatest">{t('hLatest', '–')}</div>
            <Html as="div" className="brk b1" id="hLatestB1" html={hi('hLatestB1')} />
            <Html as="div" className="brk b2" id="hLatestB2" html={hi('hLatestB2')} />
          </div></div>
          <div className="hstat"><div className="hs-in">
            <div className="l" id="hVolL">{t('hVolL', 'Volume')}</div>
            <Html as="div" className="v num" id="hVol" html={hi('hVol') || '–'} />
            <Html as="div" className="brk b1" id="hVolB1" html={hi('hVolB1')} />
            <Html as="div" className="brk b2" id="hVolB2" html={hi('hVolB2')} />
          </div></div>
          <div className="hstat">
            <div className="l">Avg price <span className="dtag" id="hPriceTag">{t('hPriceTag', '—')}</span>
              <HelpIcon title="Avg price — Finished Goods only" body="Average price of Finished Goods (B2B/B2C) only: Finished Goods revenue ÷ Finished Goods quantity. Excludes Other products and services." ariaLabel="How average price is calculated — more info" label="ⓘ" />
            </div>
            <Html as="div" className="v num" id="hPrice" html={hi('hPrice') || t('hPrice', '–')} />
          </div>
        </div>
        <Spark periods={st.data ? st.data.periods : null} />
      </div>
    </section>
  );
}
