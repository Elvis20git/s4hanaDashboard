import { MenuButton } from './MenuButton.jsx';
import { useEffect, useRef } from 'react';
import { MODULES, APP_NAME } from '../lib/modules.js';
import { STATUS_COPY } from '../lib/copy.js';
import { mLabel } from '../lib/format.js';
import { presetsFor, activePresetKey, scopeLabel } from '../lib/derive.js';
import { buildStatus } from '../lib/views.js';
import { useAppState, setPreset, setFrom, setTo } from '../state/store.js';
import { useStickyBar } from '../hooks/useStickyBar.js';

/** The sticky filter bar — bound to the active module (title, subtitle, "Coming soon" badge, only the controls that module's
    config allows), sticky with a compact-on-scroll state. The period itself is shared global state, so switching between modules
    never resets it. Status dots open the shared popover (see lib/popoverEngine.js). */
export function FilterBar() {
  const st = useAppState();
  const barRef = useRef(null), sentinelRef = useRef(null);
  const m = MODULES.find(x => x.route === st.page) || MODULES[0];
  const soon = m.status === 'soon', f = m.filters || {};
  const period = !soon && !!f.period, through = !soon && !!f.dataThrough, dots = !soon && !!f.statusDots;
  const { stuck, expanded, setExpanded } = useStickyBar(barRef, sentinelRef, [st.page]);

  useEffect(() => { document.title = `${m.title} · ${APP_NAME}`; }, [m.title]);

  const d = st.data;
  const status = buildStatus(st);
  const dotProps = key => {
    const o = status[key];
    // a transient message (a failed deep link, a refused action) takes over the red dot until the next load
    if (key === 'errDot' && st.flash) {
      return { style: { display: 'inline-flex' }, 'data-help-title': STATUS_COPY.noticeTitle, 'data-help-body': st.flash, 'data-help-wide': '1', 'aria-label': `${st.flash} — view details` };
    }
    return {
      style: { display: (o.style && o.style.display) || 'none' },
      'data-help-title': o.dataset.helpTitle, 'data-help-body': o.dataset.helpBody, 'data-help-links': o.dataset.helpLinks, 'data-help-wide': o.dataset.helpWide,
      'aria-label': o.attrs['aria-label'],
    };
  };

  const active = activePresetKey(d, st.from, st.to, st.preset);
  const presets = d ? presetsFor(d.allPeriods) : [];
  const preset = presets.find(x => x.key === active);
  const summary = d ? `${preset ? preset.label : 'Custom range'} · ${scopeLabel(d, st.from, st.to)}` : '';
  const provisional = new Set(d ? d.periods.filter(p => p.provisional).map(p => p.period) : []);
  const opts = d ? d.allPeriods.map(p => <option key={p} value={p}>{mLabel(p)}{provisional.has(p) ? ' (open)' : ''}</option>) : null;

  const cls = ['topbar', 'topbar-card', !period && 'no-period', !through && 'no-through', !dots && 'no-dots',
    !(period || through || dots) && 'no-filters', stuck && 'stuck', expanded && 'expanded'].filter(Boolean).join(' ');
  return (
    <>
      <div className="bar-sentinel" id="barSentinel" aria-hidden="true" ref={sentinelRef} />
      <div className={cls} id="topBar" ref={barRef}>
        <div className="bar-title">
          <div className="bar-h"><MenuButton /><h2 id="barTitle">{m.title}</h2><span className="badge mid" id="barBadge" hidden={!soon}>Coming soon</span></div>
          <div className="sub" id="subTitle">{m.subtitle}</div>
        </div>
        <div className="bar-summary" id="barSummary" aria-live="off">{summary}</div>
        <button type="button" className="bar-filters" id="barFilters" aria-expanded={expanded} aria-controls="barControls"
          onClick={() => setExpanded(x => !x)}>Filters</button>
        <div className="controls" id="barControls">
          <div className="seg" id="scopeSeg">
            {presets.map(p => <button key={p.key} type="button" className={p.key === active ? 'on' : ''} data-key={p.key} onClick={() => setPreset(p.key)}>{p.label}</button>)}
          </div>
          <div className="fromto">
            <span className="lbl">FROM</span>
            <select className="sel" id="fromSel" value={st.from || (d ? d.allPeriods[0] : '')} onChange={e => setFrom(e.target.value)}>{opts}</select>
            <span className="arrow">→</span>
            <span className="lbl">TO</span>
            <select className="sel" id="toSel" value={st.to || (d ? d.allPeriods.at(-1) : '')} onChange={e => setTo(e.target.value)}>{opts}</select>
          </div>
          <span className="pill" id="dataThroughPill">
            <span className="live" id="dataThroughDot" style={{ background: status.dataThroughDot?.style.background || '' }} />
            Data through <b id="dataThroughVal">{status.dataThroughVal.textContent}</b>
          </span>
          <button type="button" className="dotwrap warn" id="warnDot" aria-haspopup="dialog" aria-expanded="false" {...dotProps('warnDot')}><i className="sdot" /></button>
          <button type="button" className="dotwrap bad" id="errDot" aria-haspopup="dialog" aria-expanded="false" {...dotProps('errDot')}><i className="sdot" /></button>
        </div>
      </div>
    </>
  );
}
