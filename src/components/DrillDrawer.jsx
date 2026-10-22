import { Fragment, useEffect, useRef } from 'react';
import { useDrill, closeDrill } from '../state/drill.js';
import { gotoCrumb, drillCardHtml } from '../state/drillViews.js';
import { useAnimCard } from '../hooks/useAnimCard.js';

/** The drill-down drawer (levels 1–6): header with stats and the shared margin card, breadcrumb, filter, CSV export and the body.
    The levels themselves are the source's functions (state/drillViews.js); they fill a view object that this component renders. */
export function DrillDrawer() {
  const dr = useDrill();
  const v = dr.view || { title: '', eyebrow: 'Underlying detail', grain: '', stats: [], card: null, crumb: [], body: '', count: '', on: [], exportRows: [], exportName: 'export' };
  const drillRef = useRef(null), cardRef = useRef(null), bodyRef = useRef(null), searchRef = useRef(null);

  // on open, move focus into the panel itself (the source's showPanel)
  useEffect(() => { if (dr.open && drillRef.current) drillRef.current.focus(); }, [dr.open, dr.token]);
  // Escape closes the drawer
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') closeDrill(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cardHtml = v.card ? drillCardHtml(v.card) : '';
  useAnimCard(cardRef, [cardHtml, dr.token]);

  // the per-row click wiring the source attached to elements, applied by delegation
  const onBodyClick = e => {
    for (const { sel, fn } of v.on) {
      const el = e.target.closest(sel);
      if (el && bodyRef.current.contains(el)) { fn(el); return; }
    }
  };
  const onSearch = e => {
    const t = e.target.value.toLowerCase();
    [...bodyRef.current.querySelectorAll('.doc, .monthrow, tbody tr')].forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(t) ? '' : 'none';
    });
  };
  const onExport = () => {
    const rows = v.exportRows || [];
    if (!rows.length) return;
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const hdr = k => ({ cogm: 'vc', cogmUsd: 'vcUsd' }[k] || k);
    const csv = keys.map(hdr).join(',') + '\n' + rows.map(r => keys.map(k => {
      const x = r[k]; if (x == null) return 'N/A';
      return typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (v.exportName || 'export').replace(/[^a-z0-9]/gi, '_') + '.csv';
    a.click(); URL.revokeObjectURL(a.href);
  };

  const label = c => (c.mono ? <span className="mono">{c.label}</span> : c.label);
  return (
    <>
      <div className={'scrim' + (dr.open ? ' show' : '')} id="scrim" onClick={closeDrill} />
      <aside className={['drill', dr.open && 'show', dr.wide && 'wide'].filter(Boolean).join(' ')} id="drill" ref={drillRef}
        aria-hidden={dr.open ? 'false' : 'true'} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Underlying detail">
        <div className="drill-h">
          <div className="top"><div className="eyebrow" id="dEyebrow">{v.eyebrow}</div><button className="close" id="dClose" aria-label="Close" onClick={closeDrill}>✕</button></div>
          <div className="hd-cols">
            <div className="hd-left">
              <h3 id="dTitle">{v.title}</h3>
              <div className="drill-stats" id="dStats">
                {v.stats.map((c, i) => <div className="s" key={i}><div className="l">{c[0]}</div><div className="v num">{c[1]}</div></div>)}
              </div>
              <div className="grain" id="dGrain" style={{ display: v.grain ? 'inline-flex' : 'none' }} dangerouslySetInnerHTML={{ __html: v.grain }} />
            </div>
            <div className="drill-card" id="dCard" ref={cardRef} hidden={!v.card} dangerouslySetInnerHTML={{ __html: cardHtml }} />
          </div>
        </div>
        <div className="crumb" id="dCrumb">
          {v.crumb.map((c, i) => (
            <Fragment key={i}>
              {i > 0 ? ' › ' : null}
              {i === v.crumb.length - 1 ? <b>{label(c)}</b> : <span className="step" data-i={i} onClick={() => gotoCrumb(i)}>{label(c)}</span>}
            </Fragment>
          ))}
        </div>
        <div className="drill-tools" id="dTools">
          <div className="search">🔎<input id="dSearch" placeholder="Filter…" ref={searchRef} onChange={onSearch} /></div>
          <button className="btn" id="dExport" onClick={onExport}>Export CSV</button>
        </div>
        <div className="drill-count" id="dCount">{v.count}</div>
        <div className="drill-body" id="dBody" ref={bodyRef} onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: v.body }} />
      </aside>
    </>
  );
}
