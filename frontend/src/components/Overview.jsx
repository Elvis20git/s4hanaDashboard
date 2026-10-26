import { Hero } from './Hero.jsx';
import { SalesByPeriod } from './SalesByPeriod.jsx';
import { Breakdown } from './Breakdown.jsx';
import { MarginAndMix } from './MarginAndMix.jsx';
import { useAppState, loadData } from '../state/store.js';

/** The Sales page. */
export function Overview() {
  const st = useAppState();
  return (
    <section className={'page' + (st.page === 'overview' ? ' on' : '')} id="page-overview">
      {st.data ? (
        <>
          <Hero />
          <SalesByPeriod />
          <Breakdown />
          <MarginAndMix />
        </>
      ) : (
        <div className={`banner ${st.error ? 'bad' : 'warn'}`} style={{ marginTop: 24 }}>
          {st.error
            ? <><b>Data not available.</b>{' '}{st.error}{' — '}open <b>Data Management → Refresh</b> to reload from S/4HANA, or{' '}
                <button type="button" className="btn" style={{ display: 'inline-flex', padding: '3px 10px', fontSize: '11.5px', marginLeft: 6 }} onClick={loadData}>try again</button>.</>
            : <><b>Loading data from S/4HANA…</b>{' '}This takes a few minutes on the first start.</>}
        </div>
      )}
    </section>
  );
}
