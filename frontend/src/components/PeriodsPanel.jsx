import { useMemo, useState } from 'react';
import { useAppState, reloadPeriod, setPeriodStatus, refreshAll, setLoadMode, isLoading, loadStatus, flashError } from '../state/store.js';
import { usePermissions } from '../auth/auth.js';
import { setDataTab } from '../state/nav.js';
import { formatMoneyCompact } from '../lib/format.js';
import { BADGE_LABEL, filterPeriods, EMPTY_FILTERS } from '../lib/periodsView.js';
import { HelpIcon } from './HelpIcon.jsx';

const TIP = 'A period is included once it is closed in SAP and loaded. Open periods are excluded until month-end close.';
const PILL = { green: 'final', amber: 'provisional', grey: 'none', red: 'bad' };
const SOURCE_NOTE = { manual: ' · set by hand', config: ' · config override' };

/* Data Management → Periods: every month from the window start to the current month. Statuses come from /api/periods (one backend
   helper); the filters and search below only narrow which rows are shown. */
export function PeriodsPanel() {
  const st = useAppState();
  const { isDataSteward } = usePermissions();
  const [busy, setBusy] = useState(null);                  // 'YYYY-MM:action' while a row action runs
  const [f, setF] = useState(EMPTY_FILTERS);
  const p = st.periods;
  const live = st.source === 'api';
  const loading = isLoading(st);
  const canAct = isDataSteward && live;
  const prog = live && st.status && st.status.sources.api.progress;
  const taskOf = r => (loading && prog && prog.phase !== 'done' ? prog.periods[r.period] : null);    // pending | loading | done | error
  const closedCount = p ? p.rows.filter(r => r.closeStatus === 'Closed').length : 0;
  const set = patch => setF(x => ({ ...x, ...patch }));

  const years = useMemo(() => (p ? [...new Set(p.rows.map(r => r.period.slice(0, 4)))] : []), [p]);
  const shown = useMemo(() => (p ? filterPeriods(p.rows, f) : []), [p, f]);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  const run = async (r, action, confirmText, fn) => {
    if (!window.confirm(confirmText)) return;
    setBusy(`${r.period}:${action}`);
    try { await fn(); }
    catch (e) { flashError(`${r.label}: ${e.message}`); await loadStatus(); }
    finally { setBusy(null); }
  };
  const READ_ONLY = "SAP is only read, never written to. This re-extracts the live window, which can take about a minute.";
  const onLoad = r => run(r, 'load', `${r.loaded === 'No' ? 'Load' : 'Reload'} ${r.label} from SAP?\n\n${READ_ONLY}`, () => reloadPeriod(r.period));
  const onToggle = r => {
    const to = r.closeStatus === 'Closed' ? 'Open' : 'Closed';
    const effect = to === 'Open'
      ? `${r.label} will be excluded from the dashboard until it is closed again.`
      : `${r.label} will be loaded and included in the dashboard.`;
    return run(r, 'toggle', `Mark ${r.label} as ${to}?\n\nThis is a manual setting in this app. It does not change anything in SAP. ${effect}\n\n${READ_ONLY}`, () => setPeriodStatus(r.period, to));
  };
  const onAuto = r => run(r, 'auto', `Remove the manual setting for ${r.label}?\n\nIt goes back to the configured value or the calendar rule. ${READ_ONLY}`, () => setPeriodStatus(r.period, 'auto'));

  const onLoadAll = async () => {
    const how = st.loadMode === 'concurrent' ? 'concurrently (several at a time)' : 'one by one, in order';
    if (!window.confirm(`Load all ${closedCount} closed periods from SAP ${how}?

${READ_ONLY}`)) return;
    setBusy('all:load');
    try { await refreshAll(); }
    catch (e) { flashError(`Load failed. ${e.message}`); await loadStatus(); }
    finally { setBusy(null); }
  };
  const isBusy = r => busy && busy.startsWith(r.period + ':');
  const off = busy !== null || loading;
  const label = (r, action, idle, working) => (busy === `${r.period}:${action}` ? working : idle);

  return (
    <div className="cbox" id="periodsPanel" style={{ marginBottom: 16 }}>
      <div className="hd">
        <div className="t">Periods <HelpIcon title="Reporting periods" body={TIP} label="ⓘ" ariaLabel="About reporting periods" /></div>
        <div className="d" id="periodsSummary">{p ? p.summary.text : 'Loading…'}</div>
      </div>
      {p && p.rows.some(r => r.closeSource !== 'calendar') ? <div className="qnote" style={{ margin: '0 16px 10px' }}>Close status for some periods is set by hand or by a config override; the rest follow the Africa/Kigali calendar. It is not read from SAP.</div> : null}

      {canAct ? (
        <div className="per-load" id="periodsLoad">
          <span className="per-load-l">Load closed periods</span>
          <div className="seg" role="group" aria-label="How to load">
            <button type="button" className={st.loadMode === 'concurrent' ? 'on' : ''} aria-pressed={st.loadMode === 'concurrent'} disabled={off}
              title="Read several months from SAP at the same time (faster)" onClick={() => setLoadMode('concurrent')}>Concurrently</button>
            <button type="button" className={st.loadMode === 'sequential' ? 'on' : ''} aria-pressed={st.loadMode === 'sequential'} disabled={off}
              title="Read the months one after another, in order (gentler on SAP)" onClick={() => setLoadMode('sequential')}>One by one</button>
          </div>
          <button type="button" className="btn" id="btnLoadAll" disabled={off || !closedCount} onClick={onLoadAll}>{busy === 'all:load' || loading ? 'Loading…' : 'Load all closed periods'}</button>
          <span className="per-hint">Both modes give identical figures. The first load is cached until you refresh.</span>
        </div>
      ) : null}

      <div className="per-tools" id="periodsTools" role="search">
        <input type="search" className="sel per-search" id="periodsSearch" placeholder="Search period, status, reason…" aria-label="Search periods"
          value={f.q} onChange={e => set({ q: e.target.value })} />
        <select className="sel" aria-label="Year" value={f.year} onChange={e => set({ year: e.target.value })}>
          <option value="">All years</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="sel" aria-label="SAP close status" value={f.close} onChange={e => set({ close: e.target.value })}>
          <option value="">Any close status</option><option>Closed</option><option>Open</option><option>Unknown</option>
        </select>
        <select className="sel" aria-label="Loaded" value={f.loaded} onChange={e => set({ loaded: e.target.value })}>
          <option value="">Loaded: any</option><option>Yes</option><option>Partial</option><option>No</option>
        </select>
        <select className="sel" aria-label="Closure controls" value={f.controls} onChange={e => set({ controls: e.target.value })}>
          <option value="">Controls: any</option><option value="ok">OK</option><option value="breach">With breaches</option>
        </select>
        <select className="sel" aria-label="Included in dashboard" value={f.included} onChange={e => set({ included: e.target.value })}>
          <option value="">Included: any</option><option>Yes</option><option>No</option>
        </select>
        <select className="sel" aria-label="Needs attention" value={f.badge} onChange={e => set({ badge: e.target.value })}>
          <option value="">Any badge</option><option value="red">Red — not loaded</option><option value="amber">Amber — attention</option><option value="green">Green — loaded</option><option value="grey">Grey — open</option>
        </select>
        <label className="per-chk"><input type="checkbox" checked={f.newest} onChange={e => set({ newest: e.target.checked })} /> Newest first</label>
        {filtered ? <button type="button" className="btn per-clear" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</button> : null}
        <span className="per-count" id="periodsCount" aria-live="polite">{p ? `Showing ${shown.length} of ${p.rows.length}` : ''}</span>
      </div>

      <div className="scroll">
        <table className="tbl" id="periodsTbl">
          <thead><tr><th>Period</th><th>SAP close status</th><th>Loaded</th><th>Rows loaded</th><th>Revenue loaded</th><th>Closure controls</th><th>Last loaded</th><th>Included in dashboard</th>{canAct ? <th>Actions</th> : null}</tr></thead>
          <tbody>
            {p && shown.length ? shown.map(r => (
              <tr key={r.period} data-period={r.period}>
                <td><b>{r.label}</b></td>
                <td title={r.error || r.reason}><span className={'statepill ' + PILL[r.badge]} data-badge={r.badge}>{r.closeStatus}</span>
                  <div className="sub">{BADGE_LABEL[r.badge]}{SOURCE_NOTE[r.closeSource] || ''}{r.override ? ` (${r.override.by})` : ''}</div></td>
                <td>{taskOf(r) === 'loading' ? <span className="per-ld"><i />Loading…</span>
                  : taskOf(r) === 'pending' ? <span className="per-q">Queued</span>
                  : taskOf(r) === 'done' ? <span className="per-q">Read ✓</span>
                  : r.closeStatus === 'Open' && !r.rows ? '—' : r.loaded}</td>
                <td>{r.rows || '—'}</td>
                <td>{r.rows ? formatMoneyCompact(r.revenue) : '—'}</td>
                <td>{r.closeStatus !== 'Closed' ? '—' : r.breachCount
                  ? <button type="button" className="pop-link" onClick={() => setDataTab('validation')}>{r.breachCount} breach{r.breachCount === 1 ? '' : 'es'} →</button> : 'OK'}</td>
                <td>{r.lastLoaded ? new Date(r.lastLoaded).toLocaleString() : '—'}</td>
                <td title={r.error || r.reason}>{r.included}<div className="sub">{r.reason}</div></td>
                {canAct ? <td><div className="per-acts">
                  {r.closeStatus === 'Closed'
                    ? <button type="button" className="btn" disabled={off} onClick={() => onLoad(r)}>{label(r, 'load', r.loaded === 'No' ? 'Load period' : 'Reload period', r.loaded === 'No' ? 'Loading…' : 'Reloading…')}</button> : null}
                  <button type="button" className="btn" disabled={off} onClick={() => onToggle(r)}>
                    {label(r, 'toggle', r.closeStatus === 'Closed' ? 'Mark open' : 'Mark closed', 'Updating…')}</button>
                  {r.override ? <button type="button" className="btn" disabled={off} title="Remove the manual setting" onClick={() => onAuto(r)}>{label(r, 'auto', 'Revert to auto', 'Updating…')}</button> : null}
                  {isBusy(r) ? <span className="per-prog" role="status" aria-label="Working"><i /></span> : null}
                </div></td> : null}
              </tr>
            )) : <tr><td colSpan={canAct ? 9 : 8} style={{ color: 'var(--color-tx-3)' }}>{!p ? (st.dataLoading ? 'Loading…' : 'Period status unavailable.') : 'No periods match these filters.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
