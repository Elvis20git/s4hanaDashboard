import { Hero } from './Hero.jsx';
import { SalesByPeriod } from './SalesByPeriod.jsx';
import { Breakdown } from './Breakdown.jsx';
import { MarginAndMix } from './MarginAndMix.jsx';
import { useAppState } from '../state/store.js';

/** The Sales page. */
export function Overview() {
  const st = useAppState();
  return (
    <section className={'page' + (st.page === 'overview' ? ' on' : '')} id="page-overview">
      <Hero />
      <SalesByPeriod />
      <Breakdown />
      <MarginAndMix />
    </section>
  );
}
