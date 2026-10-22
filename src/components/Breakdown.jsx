import { useLayoutEffect, useMemo, useRef } from 'react';
import { buildProducts, buildCustomers } from '../lib/views.js';
import { fitBreakdownTable, setStickyHead } from '../lib/fitTable.js';
import { useAppState, toggleCollapsed } from '../state/store.js';
import { openProduct, openCustomer } from '../state/drillViews.js';
import { HelpIcon } from './HelpIcon.jsx';

/** A grouped Month|YTD table card. The markup is the source's table builder; group toggles and row clicks are delegated; after each
    markup change the columns are re-fitted to the card width and the sticky group rows re-anchored under the header. */
function BreakdownTable({ id, html, onRow }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) { fitBreakdownTable(ref.current, []); setStickyHead(ref.current); } }, [html]);
  const onClick = e => {
    const g = e.target.closest('.grp-btn');
    if (g) { e.stopPropagation(); toggleCollapsed(g.dataset.k); return; }
    const r = e.target.closest('.rowbtn'); if (r) onRow(r.dataset.code);
  };
  return <div className="btbl-wrap scroll-soft"><table className="tbl btbl" id={id} ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} /></div>;
}

/** Section 2 — Break down a number: Sales by product (B2B/B2C and Others groups) and Sales by customer. */
export function Breakdown() {
  const st = useAppState();
  const prod = useMemo(() => buildProducts(st), [st.data, st.monthData, st.from, st.to, st.tick]);      // eslint-disable-line react-hooks/exhaustive-deps
  const cust = useMemo(() => buildCustomers(st), [st.data, st.monthData, st.from, st.to, st.tick]);    // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="level rise" style={{ animationDelay: '.14s' }}><span className="n">2</span><span className="t">Break down a number</span><span className="ln" /></div>
      <div className="grid grid2 grid-break">
        <div className="cbox live rise" style={{ animationDelay: '.16s' }}>
          <div className="hd"><div className="t">Sales by product <HelpIcon k="productsCard" label="ⓘ" /></div><div className="d" id="prodSub">{prod.prodSub ? prod.prodSub.textContent : 'Billed revenue'}</div></div>
          <BreakdownTable id="prodTbl" html={prod.prodTbl ? prod.prodTbl.innerHTML : ''} onRow={openProduct} />
        </div>
        <div className="cbox live rise" style={{ animationDelay: '.20s' }}>
          <div className="hd"><div className="t">Sales by customer <HelpIcon title="Sales by customer" body="Customer sales split into Finished Goods (B2B/B2C) and Other. A customer can appear in both. Total = all sales." label="ⓘ" /></div><div className="d" id="custSub">{cust.custSub ? cust.custSub.textContent : 'Sold-to'}</div></div>
          <BreakdownTable id="custTbl" html={cust.custTbl ? cust.custTbl.innerHTML : ''} onRow={openCustomer} />
        </div>
      </div>
    </>
  );
}
